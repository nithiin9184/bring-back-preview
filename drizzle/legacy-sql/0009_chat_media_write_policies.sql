GRANT INSERT, UPDATE, DELETE ON public.chat_media TO authenticated;

CREATE POLICY "sender creates chat media" ON public.chat_media
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND NOT public.is_blocked_pair(sender_id, recipient_id)
    AND public.mutual_trust(sender_id, recipient_id)
  );

CREATE POLICY "sender updates own chat media" ON public.chat_media
  FOR UPDATE TO authenticated USING (auth.uid() = sender_id) WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "sender deletes own chat media" ON public.chat_media
  FOR DELETE TO authenticated USING (auth.uid() = sender_id);