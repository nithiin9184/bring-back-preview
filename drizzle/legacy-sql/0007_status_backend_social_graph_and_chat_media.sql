-- Account privacy flag used by public-status visibility.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;
GRANT SELECT (is_private) ON public.profiles TO authenticated;

-- 1. Social graph -------------------------------------------------------------
CREATE TABLE public.blocks (
  blocker_id uuid NOT NULL,
  blocked_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
GRANT SELECT, INSERT, DELETE ON public.blocks TO authenticated;
GRANT ALL ON public.blocks TO service_role;
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own blocks read" ON public.blocks
  FOR SELECT TO authenticated USING (auth.uid() = blocker_id);
CREATE POLICY "own blocks write" ON public.blocks
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = blocker_id);
CREATE POLICY "own blocks remove" ON public.blocks
  FOR DELETE TO authenticated USING (auth.uid() = blocker_id);

-- Who the owner has approved: 'chat' allows messaging, 'contact' is a saved contact.
CREATE TABLE public.connections (
  owner_id uuid NOT NULL,
  peer_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'contact' CHECK (kind IN ('chat','contact')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, peer_id),
  CHECK (owner_id <> peer_id)
);
CREATE INDEX connections_peer_idx ON public.connections (peer_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.connections TO authenticated;
GRANT ALL ON public.connections TO service_role;
ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "connections visible to both sides" ON public.connections
  FOR SELECT TO authenticated USING (auth.uid() = owner_id OR auth.uid() = peer_id);
CREATE POLICY "own connections write" ON public.connections
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "own connections update" ON public.connections
  FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "own connections remove" ON public.connections
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- One row per side. Images and calls require both rows.
CREATE TABLE public.trust_choices (
  user_id uuid NOT NULL,
  peer_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, peer_id),
  CHECK (user_id <> peer_id)
);
CREATE INDEX trust_choices_peer_idx ON public.trust_choices (peer_id);
GRANT SELECT, INSERT, DELETE ON public.trust_choices TO authenticated;
GRANT ALL ON public.trust_choices TO service_role;
ALTER TABLE public.trust_choices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trust visible to both sides" ON public.trust_choices
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR auth.uid() = peer_id);
CREATE POLICY "own trust write" ON public.trust_choices
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own trust remove" ON public.trust_choices
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 2. Graph helpers ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_blocked_pair(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocks b
    WHERE (b.blocker_id = _a AND b.blocked_id = _b)
       OR (b.blocker_id = _b AND b.blocked_id = _a)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_connected(_owner uuid, _peer uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.connections c
    WHERE c.owner_id = _owner AND c.peer_id = _peer
  );
$$;

CREATE OR REPLACE FUNCTION public.mutual_trust(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.trust_choices t WHERE t.user_id = _a AND t.peer_id = _b)
     AND EXISTS (SELECT 1 FROM public.trust_choices t WHERE t.user_id = _b AND t.peer_id = _a);
$$;

-- 3. Statuses -----------------------------------------------------------------
CREATE TABLE public.statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('text','photo','video')),
  text text,
  caption text,
  background text,
  caption_x real,
  caption_y real,
  text_align text CHECK (text_align IS NULL OR text_align IN ('left','center','right')),
  text_y real,
  media_path text,
  media_mime text,
  video_start real,
  video_end real,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('public','private')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  CHECK (kind = 'text' OR media_path IS NOT NULL)
);
CREATE INDEX statuses_author_idx ON public.statuses (author_id, created_at DESC);
CREATE INDEX statuses_live_idx ON public.statuses (expires_at);

CREATE TABLE public.status_views (
  status_id uuid NOT NULL REFERENCES public.statuses(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL,
  audience text NOT NULL DEFAULT 'public' CHECK (audience IN ('public','private')),
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (status_id, viewer_id)
);
CREATE INDEX status_views_viewer_idx ON public.status_views (viewer_id);

-- Server-side visibility rule for one status and one viewer.
CREATE OR REPLACE FUNCTION public.can_view_status(_status_id uuid, _viewer uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.statuses%ROWTYPE;
  author_private boolean := false;
BEGIN
  SELECT * INTO s FROM public.statuses WHERE id = _status_id;
  IF NOT FOUND OR _viewer IS NULL THEN RETURN false; END IF;
  IF s.author_id = _viewer THEN RETURN true; END IF;
  IF s.expires_at <= now() THEN RETURN false; END IF;
  IF public.is_blocked_pair(s.author_id, _viewer) THEN RETURN false; END IF;
  IF s.visibility = 'private' THEN
    RETURN public.is_connected(s.author_id, _viewer);
  END IF;
  SELECT p.is_private INTO author_private FROM public.profiles p WHERE p.id = s.author_id;
  RETURN NOT coalesce(author_private, false) OR public.is_connected(s.author_id, _viewer);
END;
$$;

GRANT SELECT, INSERT, DELETE ON public.statuses TO authenticated;
GRANT ALL ON public.statuses TO service_role;
ALTER TABLE public.statuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "statuses visible per rules" ON public.statuses
  FOR SELECT TO authenticated USING (public.can_view_status(id, auth.uid()));
CREATE POLICY "author creates status" ON public.statuses
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = author_id);
CREATE POLICY "author deletes status" ON public.statuses
  FOR DELETE TO authenticated USING (auth.uid() = author_id);

GRANT SELECT, INSERT ON public.status_views TO authenticated;
GRANT ALL ON public.status_views TO service_role;
ALTER TABLE public.status_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "views readable by author and viewer" ON public.status_views
  FOR SELECT TO authenticated USING (
    auth.uid() = viewer_id
    OR EXISTS (SELECT 1 FROM public.statuses s WHERE s.id = status_id AND s.author_id = auth.uid())
  );
CREATE POLICY "viewer records own view" ON public.status_views
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = viewer_id AND public.can_view_status(status_id, auth.uid()));

-- 4. Chat image media ---------------------------------------------------------
-- Object storage holds the bytes; this table holds metadata and authorization.
CREATE TABLE public.chat_media (
  path text PRIMARY KEY,
  sender_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  client_id text NOT NULL,
  message_id uuid REFERENCES public.messages(id) ON DELETE CASCADE,
  mime text NOT NULL DEFAULT 'image/jpeg',
  size_bytes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CHECK (sender_id <> recipient_id)
);
CREATE INDEX chat_media_pair_idx ON public.chat_media (sender_id, recipient_id, created_at DESC);
CREATE INDEX chat_media_message_idx ON public.chat_media (message_id);
GRANT SELECT ON public.chat_media TO authenticated;
GRANT ALL ON public.chat_media TO service_role;
ALTER TABLE public.chat_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat media readable by participants" ON public.chat_media
  FOR SELECT TO authenticated USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

GRANT EXECUTE ON FUNCTION public.is_blocked_pair(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_connected(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mutual_trust(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_status(uuid, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.is_blocked_pair(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_connected(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mutual_trust(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_view_status(uuid, uuid) FROM PUBLIC, anon;

-- 5. Realtime -----------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.statuses;
ALTER PUBLICATION supabase_realtime ADD TABLE public.status_views;
ALTER TABLE public.statuses REPLICA IDENTITY FULL;
ALTER TABLE public.status_views REPLICA IDENTITY FULL;