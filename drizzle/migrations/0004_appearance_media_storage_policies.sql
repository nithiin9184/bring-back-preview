CREATE POLICY "appearance media upload by owner" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'appearance-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "appearance media readable by owner" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'appearance-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "appearance media replaceable by owner" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'appearance-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'appearance-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "appearance media deletable by owner" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'appearance-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );