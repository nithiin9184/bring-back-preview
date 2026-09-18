-- Temporary Connect chat messages -------------------------------------------
-- Messages exchanged inside a Connect pairing live here, entirely separate from
-- the permanent one-to-one `public.messages` table: they belong to a session,
-- they disappear with it, and they are never part of a normal chat thread.
--
-- Rules enforced by the database, not by the screen:
--   * only the two matched accounts of a session may read its messages
--   * only those two may write, and only while the session is still live
--     (ended / cancelled sessions accept nothing more)
--   * a blocked pair may not exchange anything
--   * messages are removed with the session row

CREATE TABLE IF NOT EXISTS public.connect_session_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.connect_sessions (id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  client_id text NOT NULL,
  body text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sender_id, client_id)
);

CREATE INDEX IF NOT EXISTS connect_session_messages_session_idx
  ON public.connect_session_messages (session_id, created_at);

GRANT SELECT, INSERT ON public.connect_session_messages TO authenticated;
GRANT ALL ON public.connect_session_messages TO service_role;
ALTER TABLE public.connect_session_messages ENABLE ROW LEVEL SECURITY;

-- Membership test: is the caller one of the two matched accounts of a session?
CREATE OR REPLACE FUNCTION public.connect_session_member(_session_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.connect_sessions s
     WHERE s.id = _session_id
       AND (s.a_id = _user_id OR s.b_id = _user_id)
  )
$$;

-- Write test: a live session, the caller is a member, and the pair is not blocked.
CREATE OR REPLACE FUNCTION public.connect_session_writable(_session_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.connect_sessions s
     WHERE s.id = _session_id
       AND s.ended_at IS NULL
       AND (s.a_id = _user_id OR s.b_id = _user_id)
       AND NOT public.is_blocked_pair(s.a_id, s.b_id)
  )
$$;

REVOKE ALL ON FUNCTION public.connect_session_member(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.connect_session_writable(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.connect_session_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.connect_session_writable(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "session members read connect messages" ON public.connect_session_messages;
CREATE POLICY "session members read connect messages" ON public.connect_session_messages
  FOR SELECT TO authenticated
  USING (public.connect_session_member(session_id, auth.uid()));

DROP POLICY IF EXISTS "session members send connect messages" ON public.connect_session_messages;
CREATE POLICY "session members send connect messages" ON public.connect_session_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.connect_session_writable(session_id, auth.uid())
  );

-- Realtime: both matched users see new messages immediately.
ALTER TABLE public.connect_session_messages REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.connect_session_messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END
$$;
