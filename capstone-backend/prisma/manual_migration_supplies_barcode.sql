-- Manual migration: add barcode support for supplies
-- Apply to Postgres schema "public"

ALTER TABLE public.supplies
  ADD COLUMN IF NOT EXISTS barcode text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'supplies_barcode_key'
  ) THEN
    CREATE UNIQUE INDEX supplies_barcode_key ON public.supplies(barcode) WHERE barcode IS NOT NULL;
  END IF;
END $$;

