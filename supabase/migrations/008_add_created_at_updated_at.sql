-- =============================================================================
-- 008_add_created_at_updated_at.sql
-- PERMANENT FIX FOR ERROR:
--   Code: 42703  Message: column "updated_at" of relation "consultation_messages" does not exist
--   Code: 42703  Message: column "created_at" of relation "consultation_messages" does not exist
-- =============================================================================
-- The consultation_messages table was created WITHOUT created_at/updated_at columns
-- in the base schema! Backend code inserts these, resulting in 42703. This migration
-- adds the missing timestamp columns DEFAULT NOW() so Tier 1 (full) insert works.
-- =============================================================================

-- 1) If the table doesn't exist, skip (safety). This entire migration is idempotent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'consultation_messages') THEN
    RAISE NOTICE 'consultation_messages table does not exist — skipping 008_create_created_at_updated_at migration.';
    RETURN;
  END IF;
END $$;

-- =============================================================================
-- ADD created_at column IF NOT EXISTS (DEFAULT NOW() for existing + new rows)
-- =============================================================================
ALTER TABLE IF EXISTS public.consultation_messages
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- =============================================================================
-- ADD updated_at column IF NOT EXISTS (DEFAULT NOW() for existing + new rows)
-- =============================================================================
ALTER TABLE IF EXISTS public.consultation_messages
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- =============================================================================
-- BACKFILL: Force update of any NULL values just in case (shouldn't happen due to
-- DEFAULT NOW() above, but safety for legacy ALTERed rows.)
-- =============================================================================
DO $$
BEGIN
  BEGIN
    UPDATE public.consultation_messages
    SET
      created_at = COALESCE(created_at, NOW()),
      updated_at = COALESCE(updated_at, NOW())
    WHERE
      created_at IS NULL OR updated_at IS NULL;
  EXCEPTION
    WHEN undefined_column THEN
      RAISE NOTICE 'Column missing during backfill — ignore, ALTER IF NOT EXISTS handled it.';
    WHEN OTHERS THEN
      RAISE NOTICE 'Backfill update skip: %', SQLERRM;
  END;
END $$;

-- =============================================================================
-- CREATE INDEXES (IF NOT EXISTS) for faster ORDER BY created_at lookups
-- (used by getRecentMessages, SUPABASE realtime, etc.)
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_consultation_messages_created_at
  ON public.consultation_messages (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_consultation_messages_updated_at
  ON public.consultation_messages (updated_at DESC);

-- =============================================================================
-- RESET Supabase PostgREST schema cache (fixes "Could not find X column in
-- schema cache" errors seen on frontend after adding new columns!)
-- =============================================================================
NOTIFY pgrst, 'reload schema';
ANALYZE public.consultation_messages;

-- =============================================================================
-- INFO ONLY: Verify columns exist now (for manual paste to Supabase SQL editor
-- output — doesn't affect DB)
-- =============================================================================
DO $$
DECLARE
  has_created BOOLEAN := FALSE;
  has_updated BOOLEAN := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'consultation_messages'
      AND column_name  = 'created_at'
  ) INTO has_created;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'consultation_messages'
      AND column_name  = 'updated_at'
  ) INTO has_updated;
  RAISE NOTICE '008 Migration complete: created_at=%, updated_at=%', has_created, has_updated;
END $$;
