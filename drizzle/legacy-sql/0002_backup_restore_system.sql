-- N Connect Backup & Restore: server-authoritative schema.
-- Every row is owned by exactly one auth user. All writes happen through
-- server functions using the service role; clients may only read their own
-- metadata. No backup payload is ever stored in plaintext.

-- 1. Google connections -------------------------------------------------------
CREATE TABLE public.google_connections (
  user_id uuid PRIMARY KEY,
  connector_id text NOT NULL DEFAULT 'google_drive',
  -- App User Connector connection key, AES-256-GCM ciphertext. The browser can
  -- never read it: no grants for anon/authenticated on this table at all.
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

-- 2. Backup settings ----------------------------------------------------------
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

-- 3. Encrypted device snapshot -----------------------------------------------
-- N Connect chats/contacts live on the device. The app hands the server an
-- encrypted snapshot; scheduled jobs use the latest snapshot so a backup never
-- depends on the app being open. Ciphertext only, service role only.
CREATE TABLE public.backup_snapshots (
  user_id uuid PRIMARY KEY,
  payload_ciphertext text NOT NULL,
  payload_version integer NOT NULL,
  item_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.backup_snapshots TO service_role;
ALTER TABLE public.backup_snapshots ENABLE ROW LEVEL SECURITY;

-- 4. Backup metadata ---------------------------------------------------------
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

-- 5. Backup jobs (state machine) ---------------------------------------------
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
-- At most one live backup job per user: prevents duplicate concurrent backups.
CREATE UNIQUE INDEX backup_jobs_one_active_idx
  ON public.backup_jobs (user_id)
  WHERE state IN ('queued', 'preparing', 'uploading', 'verifying');
GRANT SELECT ON public.backup_jobs TO authenticated;
GRANT ALL ON public.backup_jobs TO service_role;
ALTER TABLE public.backup_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own backup jobs read" ON public.backup_jobs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 6. Restore jobs (state machine) --------------------------------------------
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

-- 7. Rate limiting -----------------------------------------------------------
CREATE TABLE public.backup_rate_limits (
  user_id uuid NOT NULL,
  operation text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, operation)
);
GRANT ALL ON public.backup_rate_limits TO service_role;
ALTER TABLE public.backup_rate_limits ENABLE ROW LEVEL SECURITY;