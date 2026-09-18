-- Subscriptions, Connect Credits and Entitlements ---------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS plan_id text NOT NULL DEFAULT 'credits';
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_plan_id_check'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_plan_id_check
      CHECK (plan_id IN ('credits','verification'));
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_user_id_key'
  ) THEN
    ALTER TABLE public.subscriptions DROP CONSTRAINT subscriptions_user_id_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_user_plan_key'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_user_plan_key UNIQUE (user_id, plan_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_status_check'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_status_check
      CHECK (status IN ('inactive','active','cancelled','expired'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS subscriptions_user_status_idx
  ON public.subscriptions (user_id, status);

CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('daily_spend','extra_spend','extra_purchase')),
  amount integer NOT NULL CHECK (amount > 0),
  reason text,
  payment_intent_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  day date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date)
);
CREATE INDEX IF NOT EXISTS credit_ledger_user_day_idx
  ON public.credit_ledger (user_id, day, kind);
CREATE INDEX IF NOT EXISTS credit_ledger_user_kind_idx
  ON public.credit_ledger (user_id, kind);

GRANT SELECT ON public.credit_ledger TO authenticated;
GRANT ALL ON public.credit_ledger TO service_role;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own credit ledger read" ON public.credit_ledger;
CREATE POLICY "own credit ledger read" ON public.credit_ledger
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('plan','extra_credits')),
  plan_id text CHECK (plan_id IS NULL OR plan_id IN ('credits','verification')),
  credits integer CHECK (credits IS NULL OR credits > 0),
  amount_inr integer NOT NULL CHECK (amount_inr > 0),
  provider text NOT NULL DEFAULT 'razorpay',
  provider_order_id text,
  provider_payment_id text,
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','paid','failed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_intents_shape_check CHECK (
    (kind = 'plan' AND plan_id IS NOT NULL AND credits IS NULL)
    OR (kind = 'extra_credits' AND credits IS NOT NULL AND plan_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS payment_intents_user_idx
  ON public.payment_intents (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_provider_order_idx
  ON public.payment_intents (provider, provider_order_id)
  WHERE provider_order_id IS NOT NULL;

GRANT SELECT ON public.payment_intents TO authenticated;
GRANT ALL ON public.payment_intents TO service_role;
ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own payment intents read" ON public.payment_intents;
CREATE POLICY "own payment intents read" ON public.payment_intents
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.is_premium(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.status = 'active'
      AND (s.current_period_end IS NULL OR s.current_period_end > now())
  );
$$;

CREATE OR REPLACE FUNCTION public.credit_snapshot(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  premium boolean := public.is_premium(_user_id);
  allowance integer := CASE WHEN premium THEN 70 ELSE 15 END;
  today_ist date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  used integer := 0;
  extra integer := 0;
BEGIN
  SELECT coalesce(sum(amount), 0) INTO used
  FROM public.credit_ledger
  WHERE user_id = _user_id AND kind = 'daily_spend' AND day = today_ist;

  SELECT coalesce(sum(CASE WHEN kind = 'extra_purchase' THEN amount ELSE -amount END), 0)
    INTO extra
  FROM public.credit_ledger
  WHERE user_id = _user_id AND kind IN ('extra_purchase','extra_spend');

  RETURN jsonb_build_object(
    'premium', premium,
    'dailyAllowance', allowance,
    'dailyUsed', least(used, allowance),
    'dailyLeft', greatest(allowance - used, 0),
    'extraCredits', greatest(extra, 0),
    'creditsLeft', greatest(allowance - used, 0) + greatest(extra, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.spend_connect_credit(_user_id uuid, _amount integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  snap jsonb;
  want integer := greatest(coalesce(_amount, 1), 1);
  from_daily integer;
  from_extra integer;
BEGIN
  IF _user_id IS NULL OR _user_id <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  snap := public.credit_snapshot(_user_id);
  IF (snap->>'creditsLeft')::int < want THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'credits', 'credits', snap);
  END IF;

  from_daily := least(want, (snap->>'dailyLeft')::int);
  from_extra := want - from_daily;

  IF from_daily > 0 THEN
    INSERT INTO public.credit_ledger (user_id, kind, amount)
    VALUES (_user_id, 'daily_spend', from_daily);
  END IF;
  IF from_extra > 0 THEN
    INSERT INTO public.credit_ledger (user_id, kind, amount)
    VALUES (_user_id, 'extra_spend', from_extra);
  END IF;

  RETURN jsonb_build_object('ok', true, 'credits', public.credit_snapshot(_user_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.entitlement_snapshot(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  premium boolean := public.is_premium(_user_id);
  today_ist date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  images_used integer := 0;
  verification_end timestamptz;
  credits_active boolean := false;
BEGIN
  SELECT count(*) INTO images_used
  FROM public.chat_media
  WHERE sender_id = _user_id
    AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = today_ist;

  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = _user_id AND s.plan_id = 'credits' AND s.status = 'active'
      AND (s.current_period_end IS NULL OR s.current_period_end > now())
  ) INTO credits_active;

  SELECT s.current_period_end INTO verification_end
  FROM public.subscriptions s
  WHERE s.user_id = _user_id AND s.plan_id = 'verification' AND s.status = 'active'
    AND (s.current_period_end IS NULL OR s.current_period_end > now())
  LIMIT 1;

  RETURN jsonb_build_object(
    'plan', CASE WHEN premium THEN 'premium' ELSE 'free' END,
    'premium', premium,
    'creditsPlanActive', credits_active,
    'verificationActive', verification_end IS NOT NULL,
    'verificationExpiresAt', verification_end,
    'credits', public.credit_snapshot(_user_id),
    'images', jsonb_build_object(
      'allowance', CASE WHEN premium THEN 20 ELSE 5 END,
      'used', images_used,
      'left', greatest((CASE WHEN premium THEN 20 ELSE 5 END) - images_used, 0)
    ),
    'calls', public.call_entitlement(_user_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.credit_snapshot(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.spend_connect_credit(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.entitlement_snapshot(uuid) TO authenticated, service_role;

ALTER TABLE public.subscriptions REPLICA IDENTITY FULL;
ALTER TABLE public.credit_ledger REPLICA IDENTITY FULL;
ALTER TABLE public.payment_intents REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.credit_ledger;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_intents;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- Connect matching + server-issued Unique ID allocation ---------------------
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
      NULL;
    END;
    IF attempts >= 25 THEN
      RAISE EXCEPTION 'could not allocate a unique id';
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_unique_id() FROM public;
GRANT EXECUTE ON FUNCTION public.issue_unique_id() TO authenticated;

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

DROP POLICY IF EXISTS "own queue row" ON public.connect_queue;
CREATE POLICY "own queue row" ON public.connect_queue
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

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
    RETURN NULL;
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

-- Temporary Connect chat messages -------------------------------------------
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

ALTER TABLE public.connect_session_messages REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.connect_session_messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END
$$;

-- Account & app-state persistence -------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS village text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS region text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pin_code text NOT NULL DEFAULT '';

GRANT SELECT (bio, photo_url, location, village, city, region, pin_code)
  ON public.profiles TO authenticated;
GRANT UPDATE (name, bio, photo_url, location, village, city, region, pin_code, is_private)
  ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id uuid PRIMARY KEY,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own settings read" ON public.user_settings;
CREATE POLICY "own settings read" ON public.user_settings
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own settings insert" ON public.user_settings;
CREATE POLICY "own settings insert" ON public.user_settings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own settings update" ON public.user_settings;
CREATE POLICY "own settings update" ON public.user_settings
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.chat_states (
  user_id uuid NOT NULL,
  peer_username text NOT NULL,
  peer_name text NOT NULL DEFAULT '',
  pinned boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  muted boolean NOT NULL DEFAULT false,
  accepted boolean NOT NULL DEFAULT true,
  disappearing boolean NOT NULL DEFAULT false,
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  last_read_at timestamptz,
  draft text NOT NULL DEFAULT '',
  last_message_preview text NOT NULL DEFAULT '',
  last_message_label text NOT NULL DEFAULT '',
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, peer_username)
);
CREATE INDEX IF NOT EXISTS chat_states_user_idx
  ON public.chat_states (user_id, last_message_at DESC NULLS LAST);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_states TO authenticated;
GRANT ALL ON public.chat_states TO service_role;
ALTER TABLE public.chat_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own chat state read" ON public.chat_states;
CREATE POLICY "own chat state read" ON public.chat_states
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own chat state insert" ON public.chat_states;
CREATE POLICY "own chat state insert" ON public.chat_states
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own chat state update" ON public.chat_states;
CREATE POLICY "own chat state update" ON public.chat_states
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own chat state delete" ON public.chat_states;
CREATE POLICY "own chat state delete" ON public.chat_states
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.profile_mutes (
  user_id uuid NOT NULL,
  muted_username text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, muted_username)
);
GRANT SELECT, INSERT, DELETE ON public.profile_mutes TO authenticated;
GRANT ALL ON public.profile_mutes TO service_role;
ALTER TABLE public.profile_mutes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own mutes read" ON public.profile_mutes;
CREATE POLICY "own mutes read" ON public.profile_mutes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own mutes insert" ON public.profile_mutes;
CREATE POLICY "own mutes insert" ON public.profile_mutes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own mutes delete" ON public.profile_mutes;
CREATE POLICY "own mutes delete" ON public.profile_mutes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.user_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL,
  reported_username text NOT NULL,
  reported_id uuid,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'reviewing', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_reports_reporter_idx
  ON public.user_reports (reporter_id, created_at DESC);
GRANT SELECT, INSERT ON public.user_reports TO authenticated;
GRANT ALL ON public.user_reports TO service_role;
ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own reports read" ON public.user_reports;
CREATE POLICY "own reports read" ON public.user_reports
  FOR SELECT TO authenticated USING (auth.uid() = reporter_id);
DROP POLICY IF EXISTS "own reports insert" ON public.user_reports;
CREATE POLICY "own reports insert" ON public.user_reports
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = reporter_id);

ALTER TABLE public.auth_sessions
  ADD COLUMN IF NOT EXISTS device_label text NOT NULL DEFAULT 'This device',
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS place text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS revoked_reason text;

CREATE INDEX IF NOT EXISTS auth_sessions_live_idx
  ON public.auth_sessions (user_id, last_seen_at DESC)
  WHERE revoked_at IS NULL;

GRANT SELECT (id, user_id, created_at, expires_at, revoked_at, device_label, platform, place, last_seen_at)
  ON public.auth_sessions TO authenticated;
GRANT UPDATE (revoked_at, revoked_reason, last_seen_at, device_label, platform, place)
  ON public.auth_sessions TO authenticated;
GRANT INSERT ON public.auth_sessions TO authenticated;
GRANT ALL ON public.auth_sessions TO service_role;

DROP POLICY IF EXISTS "own sessions insert" ON public.auth_sessions;
CREATE POLICY "own sessions insert" ON public.auth_sessions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own sessions update" ON public.auth_sessions;
CREATE POLICY "own sessions update" ON public.auth_sessions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Profile likes --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_likes (
  liker_id uuid NOT NULL,
  liked_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (liker_id, liked_id),
  CHECK (liker_id <> liked_id)
);
CREATE INDEX IF NOT EXISTS profile_likes_liked_idx ON public.profile_likes (liked_id);

GRANT SELECT, INSERT, DELETE ON public.profile_likes TO authenticated;
GRANT ALL ON public.profile_likes TO service_role;
ALTER TABLE public.profile_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "likes visible to both sides" ON public.profile_likes;
CREATE POLICY "likes visible to both sides" ON public.profile_likes
  FOR SELECT TO authenticated USING (auth.uid() = liker_id OR auth.uid() = liked_id);
DROP POLICY IF EXISTS "own likes insert" ON public.profile_likes;
CREATE POLICY "own likes insert" ON public.profile_likes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = liker_id);
DROP POLICY IF EXISTS "own likes delete" ON public.profile_likes;
CREATE POLICY "own likes delete" ON public.profile_likes
  FOR DELETE TO authenticated USING (auth.uid() = liker_id);