DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['staff', 'nurses', 'doctors', 'accounts']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0', table_name);
  END LOOP;
END $$;
