-- Contact Requests --------------------------------------------------------
-- One row per request. The recipient answers it ("chat" or "contact"); the
-- sender may only withdraw. Blocked pairs can neither send nor be answered.

CREATE TABLE public.contact_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'chat', 'contact', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK (sender_id <> recipient_id),
  CHECK ((status = 'pending') = (resolved_at IS NULL))
);

-- At most one unanswered request per direction.
CREATE UNIQUE INDEX contact_requests_open_pair_idx
  ON public.contact_requests (sender_id, recipient_id)
  WHERE status = 'pending';
CREATE INDEX contact_requests_recipient_idx
  ON public.contact_requests (recipient_id, status, created_at DESC);
CREATE INDEX contact_requests_sender_idx
  ON public.contact_requests (sender_id, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_requests TO authenticated;
GRANT ALL ON public.contact_requests TO service_role;

ALTER TABLE public.contact_requests ENABLE ROW LEVEL SECURITY;

-- Both sides may read their own requests.
CREATE POLICY "contact requests visible to both sides" ON public.contact_requests
  FOR SELECT TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

-- Only the sender creates a request, only while unanswered, never across a block.
CREATE POLICY "own contact requests send" ON public.contact_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND sender_id <> recipient_id
    AND status = 'pending'
    AND resolved_at IS NULL
    AND NOT public.is_blocked_pair(sender_id, recipient_id)
  );

-- Only the recipient answers, and only a still-pending request.
CREATE POLICY "recipient answers contact request" ON public.contact_requests
  FOR UPDATE TO authenticated
  USING (auth.uid() = recipient_id AND status = 'pending')
  WITH CHECK (
    auth.uid() = recipient_id
    AND status IN ('chat', 'contact', 'deleted')
    AND NOT public.is_blocked_pair(sender_id, recipient_id)
  );

-- The sender withdraws; the recipient may discard.
CREATE POLICY "contact request removal" ON public.contact_requests
  FOR DELETE TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

-- Realtime so both sides see a request appear or resolve immediately.
ALTER TABLE public.contact_requests REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.contact_requests;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END
$$;
