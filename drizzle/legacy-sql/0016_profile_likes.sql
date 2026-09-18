-- Profile likes.
--
-- A like was a device-only flag until now; this makes it an account action so
-- the liked person can be told about it through the existing notifications
-- table (the like itself is the server-backed event the notification follows).
-- Not applied to any live database by this change.

CREATE TABLE IF NOT EXISTS public.profile_likes (
  liker_id uuid NOT NULL,
  liked_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (liker_id, liked_id),
  CHECK (liker_id <> liked_id)
);
CREATE INDEX IF NOT EXISTS profile_likes_liked_idx ON public.profile_likes (liked_id);

GRANT SELECT, INSERT, DELETE ON public.profile_likes TO authenticated;
GRANT ALL ON public.profile_likes TO service_role;
ALTER TABLE public.profile_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "likes visible to both sides" ON public.profile_likes;
CREATE POLICY "likes visible to both sides" ON public.profile_likes
  FOR SELECT TO authenticated USING (auth.uid() = liker_id OR auth.uid() = liked_id);
DROP POLICY IF EXISTS "own likes insert" ON public.profile_likes;
CREATE POLICY "own likes insert" ON public.profile_likes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = liker_id);
DROP POLICY IF EXISTS "own likes delete" ON public.profile_likes;
CREATE POLICY "own likes delete" ON public.profile_likes
  FOR DELETE TO authenticated USING (auth.uid() = liker_id);

-- Realtime: notification updates (read state from another device) must reach
-- every open session, so UPDATE events are needed alongside INSERT.
-- (The table is already in the publication with REPLICA IDENTITY FULL.)
