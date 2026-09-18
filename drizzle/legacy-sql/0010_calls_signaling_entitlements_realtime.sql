DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.call_signals;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END
$$;
ALTER TABLE public.calls REPLICA IDENTITY FULL;