-- Profiles ------------------------------------------------------------------
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  phone text UNIQUE,
  username text UNIQUE,
  name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles readable by authenticated" ON public.profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "own profile insert" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Subscriptions (backend source of truth for Premium) -------------------------
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'premium',
  status text NOT NULL DEFAULT 'inactive',
  provider text,
  provider_ref text,
  amount_inr integer NOT NULL DEFAULT 279,
  current_period_start timestamptz,
  current_period_end timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own subscription read" ON public.subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Calls -----------------------------------------------------------------------
CREATE TABLE public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_id uuid NOT NULL,
  callee_id uuid NOT NULL,
  call_type text NOT NULL CHECK (call_type IN ('voice','video')),
  status text NOT NULL DEFAULT 'ringing'
    CHECK (status IN ('ringing','accepted','connected','reconnecting','completed','rejected','missed','busy','failed','cancelled')),
  end_reason text,
  max_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  connected_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer NOT NULL DEFAULT 0
);
CREATE INDEX calls_caller_idx ON public.calls (caller_id, created_at DESC);
CREATE INDEX calls_callee_idx ON public.calls (callee_id, created_at DESC);
GRANT SELECT ON public.calls TO authenticated;
GRANT ALL ON public.calls TO service_role;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "participants read calls" ON public.calls
  FOR SELECT TO authenticated USING (auth.uid() = caller_id OR auth.uid() = callee_id);

-- Signaling -------------------------------------------------------------------
CREATE TABLE public.call_signals (
  id bigserial PRIMARY KEY,
  call_id uuid NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('offer','answer','ice','renegotiate','reconnect')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX call_signals_call_idx ON public.call_signals (call_id, id);
GRANT SELECT, INSERT ON public.call_signals TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.call_signals_id_seq TO authenticated;
GRANT ALL ON public.call_signals TO service_role;
GRANT ALL ON SEQUENCE public.call_signals_id_seq TO service_role;
ALTER TABLE public.call_signals ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_call_participant(_call_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.calls c
    WHERE c.id = _call_id AND (c.caller_id = _user_id OR c.callee_id = _user_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_call_live(_call_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.calls c
    WHERE c.id = _call_id
      AND c.status IN ('ringing','accepted','connected','reconnecting')
      AND c.created_at > now() - interval '4 hours'
  );
$$;

CREATE POLICY "participants read signals" ON public.call_signals
  FOR SELECT TO authenticated USING (public.is_call_participant(call_id, auth.uid()));
CREATE POLICY "participants send signals" ON public.call_signals
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_call_participant(call_id, auth.uid())
    AND public.is_call_live(call_id)
  );

-- Phone OTP records (server-only) ---------------------------------------------
CREATE TABLE public.phone_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  consumed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX phone_otps_phone_idx ON public.phone_otps (phone, created_at DESC);
GRANT ALL ON public.phone_otps TO service_role;
ALTER TABLE public.phone_otps ENABLE ROW LEVEL SECURITY;

-- Entitlements ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_premium(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.status = 'active'
      AND (s.current_period_end IS NULL OR s.current_period_end > now())
  );
$$;

-- Free plan call rules, computed from real call records. Day boundary is
-- midnight India time, matching the app's daily reset.
CREATE OR REPLACE FUNCTION public.call_entitlement(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  premium boolean := public.is_premium(_user_id);
  used_calls integer := 0;
  used_seconds integer := 0;
  per_call integer := 300;
  day_seconds integer := 600;
  day_calls integer := 2;
  remaining_day integer;
  allowance integer;
BEGIN
  IF premium THEN
    RETURN jsonb_build_object(
      'premium', true, 'blocked', NULL, 'callsLeft', NULL,
      'secondsLeftToday', NULL, 'maxCallSeconds', NULL,
      'completedToday', 0, 'secondsUsedToday', 0
    );
  END IF;

  SELECT count(*), coalesce(sum(duration_seconds), 0)
    INTO used_calls, used_seconds
  FROM public.calls
  WHERE status = 'completed'
    AND (caller_id = _user_id OR callee_id = _user_id)
    AND (coalesce(connected_at, created_at) AT TIME ZONE 'Asia/Kolkata')::date
        = (now() AT TIME ZONE 'Asia/Kolkata')::date;

  remaining_day := greatest(day_seconds - used_seconds, 0);
  allowance := least(per_call, remaining_day);

  RETURN jsonb_build_object(
    'premium', false,
    'blocked', CASE
      WHEN used_calls >= day_calls THEN 'calls'
      WHEN remaining_day <= 0 THEN 'callMinutes'
      ELSE NULL END,
    'callsLeft', greatest(day_calls - used_calls, 0),
    'secondsLeftToday', remaining_day,
    'maxCallSeconds', allowance,
    'completedToday', used_calls,
    'secondsUsedToday', used_seconds
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_premium(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.call_entitlement(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_call_participant(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_call_live(uuid) TO authenticated, service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.call_signals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;
ALTER TABLE public.calls REPLICA IDENTITY FULL;