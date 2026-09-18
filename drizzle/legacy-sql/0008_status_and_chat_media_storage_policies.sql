-- status-media objects are stored as <author_id>/<status_id>/<file>
CREATE POLICY "status media upload by author" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'status-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "status media readable per status rules" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'status-media'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR EXISTS (
        SELECT 1 FROM public.statuses s
        WHERE s.media_path = storage.objects.name
          AND public.can_view_status(s.id, auth.uid())
      )
    )
  );

CREATE POLICY "status media deletable by author" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'status-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- chat-media objects are stored as <sender_id>/<client_id>/<file>
CREATE POLICY "chat media upload by sender" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "chat media readable by participants" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.chat_media cm
      WHERE cm.path = storage.objects.name
        AND (cm.sender_id = auth.uid() OR cm.recipient_id = auth.uid())
        AND NOT public.is_blocked_pair(cm.sender_id, cm.recipient_id)
        AND (cm.expires_at IS NULL OR cm.expires_at > now())
    )
  );

CREATE POLICY "chat media deletable by sender" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );