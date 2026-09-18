CREATE TABLE public._probe_visibility (id integer PRIMARY KEY);
GRANT ALL ON public._probe_visibility TO service_role;
ALTER TABLE public._probe_visibility ENABLE ROW LEVEL SECURITY;