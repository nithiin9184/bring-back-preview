-- Messages ------------------------------------------------------------------
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  client_id text NOT NULL,
  body text,
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  reply_to text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  read_at timestamptz,
  CHECK (sender_id <> recipient_id),
  CHECK (body IS NOT NULL OR jsonb_array_length(images) > 0),
  UNIQUE (sender_id, client_id)
);
CREATE INDEX messages_recipient_idx ON public.messages (recipient_id, created_at DESC);
CREATE INDEX messages_sender_idx ON public.messages (sender_id, created_at DESC);
CREATE INDEX messages_undelivered_idx ON public.messages (recipient_id) WHERE delivered_at IS NULL;

GRANT SELECT, INSERT, UPDATE (delivered_at, read_at) ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "participants read messages" ON public.messages
  FOR SELECT TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = recipient_id);
CREATE POLICY "sender creates own messages" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "recipient marks delivered or read" ON public.messages
  FOR UPDATE TO authenticated
  USING (auth.uid() = recipient_id)
  WITH CHECK (auth.uid() = recipient_id);

-- Notifications -------------------------------------------------------------
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  actor_id uuid,
  type text NOT NULL
    CHECK (type IN ('follower','request','accepted','like','message','message_request','call','security')),
  name text NOT NULL DEFAULT '',
  username text,
  text text NOT NULL,
  tone text NOT NULL DEFAULT 'default' CHECK (tone IN ('default','warning','success')),
  unread boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (actor_id IS NULL OR actor_id <> user_id)
);
CREATE INDEX notifications_user_idx ON public.notifications (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE (unread) ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own notifications read" ON public.notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "actor creates notifications for others" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid() AND user_id <> auth.uid());
CREATE POLICY "own notifications mark read" ON public.notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Realtime ------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;