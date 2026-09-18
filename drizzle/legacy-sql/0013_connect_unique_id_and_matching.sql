-- Connect matching + server-issued Unique ID allocation ---------------------
-- Everything the Connect screen needs lives here: a waiting room, one row per
-- live pairing, and the rules that decide who may be paired with whom. The
-- Unique ID allocator is a database function so an ID is issued exactly once,
-- against the UNIQUE constraint, and can never be chosen by a client.

-- 1. Unique ID ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_unique_id()
RETURNS varchar(7)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing varchar(7);
  candidate varchar(7);
  attempts integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'a session is required';
  END IF;

  SELECT unique_id INTO existing FROM public.profiles WHERE id = auth.uid();
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  LOOP
    attempts := attempts + 1;
    candidate := (1000000 + floor(random() * 9000000)::bigint)::varchar;
    BEGIN
      UPDATE public.profiles
         SET unique_id = candidate
       WHERE id = auth.uid() AND unique_id IS NULL;
      SELECT unique_id INTO existing FROM public.profiles WHERE id = auth.uid();
      IF existing IS NOT NULL THEN
        RETURN existing;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      NULL; -- taken: try another candidate
    END;
    IF attempts >= 25 THEN
      RAISE EXCEPTION 'could not allocate a unique id';
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_unique_id() FROM public;
GRANT EXECUTE ON FUNCTION public.issue_unique_id() TO authenticated;

-- 2. Connect waiting room ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.connect_queue (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS connect_queue_waiting_idx
  ON public.connect_queue (heartbeat_at DESC, joined_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.connect_queue TO authenticated;
GRANT ALL ON public.connect_queue TO service_role;
ALTER TABLE public.connect_queue ENABLE ROW LEVEL SECURITY;

-- A waiting person is never listed to anyone else: only your own row is visible.
DROP POLICY IF EXISTS "own queue row" ON public.connect_queue;
CREATE POLICY "own queue row" ON public.connect_queue
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Live pairings -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.connect_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  a_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  b_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  a_vote text CHECK (a_vote IN ('up', 'down')),
  b_vote text CHECK (b_vote IN ('up', 'down')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CHECK (a_id <> b_id)
);
CREATE INDEX IF NOT EXISTS connect_sessions_a_idx
  ON public.connect_sessions (a_id, ended_at, created_at DESC);
CREATE INDEX IF NOT EXISTS connect_sessions_b_idx
  ON public.connect_sessions (b_id, ended_at, created_at DESC);

GRANT SELECT, UPDATE ON public.connect_sessions TO authenticated;
GRANT ALL ON public.connect_sessions TO service_role;
ALTER TABLE public.connect_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own connect sessions read" ON public.connect_sessions;
CREATE POLICY "own connect sessions read" ON public.connect_sessions
  FOR SELECT TO authenticated
  USING (auth.uid() = a_id OR auth.uid() = b_id);

DROP POLICY IF EXISTS "own connect sessions answer" ON public.connect_sessions;
CREATE POLICY "own connect sessions answer" ON public.connect_sessions
  FOR UPDATE TO authenticated
  USING (auth.uid() = a_id OR auth.uid() = b_id)
  WITH CHECK (auth.uid() = a_id OR auth.uid() = b_id);

ALTER TABLE public.connect_sessions REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.connect_sessions;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END
$$;

-- 4. Matching ----------------------------------------------------------------
-- Eligibility: a verified account with a completed profile and a Unique ID.
-- Availability: a queue row with a heartbeat in the last 45 seconds.
-- Pairing: the longest-waiting available stranger who is not blocked either
-- way and is not already an approved connection. Rows are locked with
-- SKIP LOCKED so two callers can never claim the same partner.
CREATE OR REPLACE FUNCTION public.connect_find_match()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  eligible boolean;
  partner uuid;
  session_id uuid;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'a session is required';
  END IF;

  SELECT (p.profile_completed AND p.auth_status = 'verified' AND p.unique_id IS NOT NULL)
    INTO eligible
    FROM public.profiles p
   WHERE p.id = me;
  IF NOT COALESCE(eligible, false) THEN
    RETURN NULL;
  END IF;

  SELECT id INTO session_id
    FROM public.connect_sessions
   WHERE ended_at IS NULL AND (a_id = me OR b_id = me)
   ORDER BY created_at DESC
   LIMIT 1;
  IF session_id IS NOT NULL THEN
    RETURN session_id;
  END IF;

  INSERT INTO public.connect_queue (user_id, joined_at, heartbeat_at)
  VALUES (me, now(), now())
  ON CONFLICT (user_id) DO UPDATE SET heartbeat_at = now();

  SELECT q.user_id INTO partner
    FROM public.connect_queue q
    JOIN public.profiles p ON p.id = q.user_id
   WHERE q.user_id <> me
     AND q.heartbeat_at > now() - interval '45 seconds'
     AND p.profile_completed
     AND p.auth_status = 'verified'
     AND p.unique_id IS NOT NULL
     AND NOT public.is_blocked_pair(me, q.user_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.connections c
        WHERE (c.owner_id = me AND c.peer_id = q.user_id)
           OR (c.owner_id = q.user_id AND c.peer_id = me)
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.connect_sessions s
        WHERE s.ended_at IS NULL AND (s.a_id = q.user_id OR s.b_id = q.user_id)
     )
   ORDER BY q.joined_at
   FOR UPDATE OF q SKIP LOCKED
   LIMIT 1;

  IF partner IS NULL THEN
    RETURN NULL; -- still waiting: no available stranger right now
  END IF;

  DELETE FROM public.connect_queue WHERE user_id IN (me, partner);

  INSERT INTO public.connect_sessions (a_id, b_id)
  VALUES (me, partner)
  RETURNING id INTO session_id;

  RETURN session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.connect_find_match() FROM public;
GRANT EXECUTE ON FUNCTION public.connect_find_match() TO authenticated;

-- Leaves the waiting room and ends any live pairing of the caller.
CREATE OR REPLACE FUNCTION public.connect_leave()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'a session is required';
  END IF;
  DELETE FROM public.connect_queue WHERE user_id = me;
  UPDATE public.connect_sessions
     SET ended_at = now()
   WHERE ended_at IS NULL AND (a_id = me OR b_id = me);
END;
$$;

REVOKE ALL ON FUNCTION public.connect_leave() FROM public;
GRANT EXECUTE ON FUNCTION public.connect_leave() TO authenticated;
