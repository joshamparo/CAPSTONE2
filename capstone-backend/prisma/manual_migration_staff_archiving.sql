DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['staff', 'nurses', 'doctors', 'accounts']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true', table_name);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ', table_name);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS archived_by TEXT', table_name);
  END LOOP;
END $$;
