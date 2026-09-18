-- Phone-number authentication, permanent 7-digit Unique ID, session audit.

-- 1. Accounts ---------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS unique_id varchar(7),
  ADD COLUMN IF NOT EXISTS phone_number_normalized text,
  ADD COLUMN IF NOT EXISTS auth_status text NOT NULL DEFAULT 'verified',
  ADD COLUMN IF NOT EXISTS profile_completed boolean NOT NULL DEFAULT false;

-- Backfill the normalized phone from the legacy column before constraints.
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

-- The phone number is a private authentication identity: the authenticated
-- role may never read it, only the service role.
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, unique_id, username, name, auth_status, profile_completed, created_at, updated_at)
  ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- Unique ID, account id and auth phone are permanent once written.
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

-- 2. OTP challenges (server-only) -------------------------------------------
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

-- 3. Session audit trail ------------------------------------------------------
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