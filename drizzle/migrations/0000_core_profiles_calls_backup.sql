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

-- Phone-number authentication, permanent 7-digit Unique ID, session audit.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS unique_id varchar(7),
  ADD COLUMN IF NOT EXISTS phone_number_normalized text,
  ADD COLUMN IF NOT EXISTS auth_status text NOT NULL DEFAULT 'verified',
  ADD COLUMN IF NOT EXISTS profile_completed boolean NOT NULL DEFAULT false;

UPDATE public.profiles
   SET phone_number_normalized = phone
 WHERE phone_number_normalized IS NULL AND phone IS NOT NULL;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_unique_id_format CHECK (unique_id ~ '^[1-9][0-9]{6}$');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_auth_status_valid
      CHECK (auth_status IN ('verified','suspended','deactivated'));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_unique_id_key UNIQUE (unique_id);
  EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_phone_number_normalized_key UNIQUE (phone_number_normalized);
  EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
  END;
END
$$;

REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, unique_id, username, name, auth_status, profile_completed, created_at, updated_at)
  ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

CREATE OR REPLACE FUNCTION public.profiles_protect_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.unique_id IS NOT NULL AND NEW.unique_id IS DISTINCT FROM OLD.unique_id THEN
    RAISE EXCEPTION 'unique_id is permanent and cannot be changed';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'account id is permanent and cannot be changed';
  END IF;
  IF OLD.phone_number_normalized IS NOT NULL
     AND NEW.phone_number_normalized IS DISTINCT FROM OLD.phone_number_normalized THEN
    RAISE EXCEPTION 'the authentication phone number cannot be changed';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_identity ON public.profiles;
CREATE TRIGGER profiles_protect_identity
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_protect_identity();

CREATE TABLE IF NOT EXISTS public.otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number_normalized text NOT NULL,
  otp_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  resend_count integer NOT NULL DEFAULT 0,
  channel text NOT NULL DEFAULT 'whatsapp',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  superseded_at timestamptz,
  invalidated_reason text
);
CREATE INDEX IF NOT EXISTS otp_challenges_phone_idx
  ON public.otp_challenges (phone_number_normalized, created_at DESC);
GRANT ALL ON public.otp_challenges TO service_role;
ALTER TABLE public.otp_challenges ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx
  ON public.auth_sessions (user_id, created_at DESC);
GRANT SELECT ON public.auth_sessions TO authenticated;
GRANT ALL ON public.auth_sessions TO service_role;
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own sessions read" ON public.auth_sessions;
CREATE POLICY "own sessions read" ON public.auth_sessions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Backup & Restore ----------------------------------------------------------
CREATE TABLE public.google_connections (
  user_id uuid PRIMARY KEY,
  connector_id text NOT NULL DEFAULT 'google_drive',
  connection_key_ciphertext text NOT NULL,
  google_email text,
  status text NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'revoked', 'disconnected')),
  connected_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_checked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.google_connections TO service_role;
ALTER TABLE public.google_connections ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.backup_settings (
  user_id uuid PRIMARY KEY,
  auto_enabled boolean NOT NULL DEFAULT false,
  frequency text NOT NULL DEFAULT 'daily'
    CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  include_media boolean NOT NULL DEFAULT false,
  next_run_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX backup_settings_due_idx
  ON public.backup_settings (next_run_at)
  WHERE auto_enabled;
GRANT SELECT ON public.backup_settings TO authenticated;
GRANT ALL ON public.backup_settings TO service_role;
ALTER TABLE public.backup_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own backup settings read" ON public.backup_settings
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.backup_snapshots (
  user_id uuid PRIMARY KEY,
  payload_ciphertext text NOT NULL,
  payload_version integer NOT NULL,
  item_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.backup_snapshots TO service_role;
ALTER TABLE public.backup_snapshots ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  backup_version integer NOT NULL,
  drive_file_id text,
  destination text NOT NULL DEFAULT 'google_drive_appdata',
  size_bytes bigint NOT NULL DEFAULT 0,
  checksum text NOT NULL,
  encryption text NOT NULL DEFAULT 'aes-256-gcm',
  includes_media boolean NOT NULL DEFAULT false,
  item_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'failed', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  deleted_at timestamptz
);
CREATE INDEX backups_user_idx ON public.backups (user_id, created_at DESC);
GRANT SELECT ON public.backups TO authenticated;
GRANT ALL ON public.backups TO service_role;
ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own backups read" ON public.backups
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.backup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  trigger text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'scheduled')),
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'preparing', 'uploading', 'verifying', 'completed', 'failed', 'cancelled')),
  progress integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  include_media boolean NOT NULL DEFAULT false,
  backup_id uuid REFERENCES public.backups(id) ON DELETE SET NULL,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX backup_jobs_user_idx ON public.backup_jobs (user_id, created_at DESC);
CREATE UNIQUE INDEX backup_jobs_one_active_idx
  ON public.backup_jobs (user_id)
  WHERE state IN ('queued', 'preparing', 'uploading', 'verifying');
GRANT SELECT ON public.backup_jobs TO authenticated;
GRANT ALL ON public.backup_jobs TO service_role;
ALTER TABLE public.backup_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own backup jobs read" ON public.backup_jobs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.restore_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  backup_id uuid NOT NULL REFERENCES public.backups(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'preparing'
    CHECK (state IN ('preparing', 'downloading', 'verifying', 'decrypting', 'restoring', 'completed', 'failed', 'cancelled')),
  progress integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  restored_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX restore_jobs_user_idx ON public.restore_jobs (user_id, created_at DESC);
CREATE UNIQUE INDEX restore_jobs_one_active_idx
  ON public.restore_jobs (user_id)
  WHERE state IN ('preparing', 'downloading', 'verifying', 'decrypting', 'restoring');
GRANT SELECT ON public.restore_jobs TO authenticated;
GRANT ALL ON public.restore_jobs TO service_role;
ALTER TABLE public.restore_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own restore jobs read" ON public.restore_jobs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.backup_rate_limits (
  user_id uuid NOT NULL,
  operation text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, operation)
);
GRANT ALL ON public.backup_rate_limits TO service_role;
ALTER TABLE public.backup_rate_limits ENABLE ROW LEVEL SECURITY;