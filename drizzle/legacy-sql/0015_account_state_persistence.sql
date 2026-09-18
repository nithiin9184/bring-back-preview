-- Account & app-state persistence.
--
-- Moves the last device-local account state into the database: profile detail,
-- every settings group, per-chat list state (pin/archive/mute/unread/draft/
-- last message), muted profiles, filed reports and real device sessions.
--
-- Security rules preserved from earlier migrations:
--   * the authentication phone number stays invisible to the authenticated role
--   * the permanent Unique ID and the account id remain immutable
--   * nothing here exposes passwords, OTP hashes or session tokens; sessions
--     expose only display metadata, never the session reference

-- 1. Profile detail -----------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS village text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS region text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pin_code text NOT NULL DEFAULT '';

-- Display fields are readable by signed-in users; the phone number is not.
GRANT SELECT (bio, photo_url, location, village, city, region, pin_code)
  ON public.profiles TO authenticated;
GRANT UPDATE (name, bio, photo_url, location, village, city, region, pin_code, is_private)
  ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- 2. Settings -----------------------------------------------------------------
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

-- 3. Chat-list state (never the messages themselves) --------------------------
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

-- 4. Muted profiles -----------------------------------------------------------
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

-- 5. Reports ------------------------------------------------------------------
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

-- 6. Real device sessions -----------------------------------------------------
-- `auth_sessions` already exists (migration 0001) and holds one row per issued
-- session with a short, opaque reference - never a token. Display metadata and
-- a revoke path are added here.
ALTER TABLE public.auth_sessions
  ADD COLUMN IF NOT EXISTS device_label text NOT NULL DEFAULT 'This device',
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS place text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS revoked_reason text;

CREATE INDEX IF NOT EXISTS auth_sessions_live_idx
  ON public.auth_sessions (user_id, last_seen_at DESC)
  WHERE revoked_at IS NULL;

-- The session reference itself is never exposed to the authenticated role.
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
