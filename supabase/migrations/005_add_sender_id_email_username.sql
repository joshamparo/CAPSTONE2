-- =============================================================================
-- PASCUALINGA HOSPITAL — CRITICAL MIGRATION #005 (RUN AFTER 003 + 004)
-- Fixes: "Could not find the 'sender_id' column of 'consultation_messages' in the schema cache"
--
-- THIS FIXES THE LAST RED ERROR WHEN SENDING MESSAGES!
-- Run this in Supabase SQL Editor ONE TIME.
-- All statements are IDEMPOTENT (IF NOT EXISTS / DROP NOT NULL safe to rerun).
-- =============================================================================

-- =============================================================================
-- 1. ADD MISSING SENDER IDENTITY COLUMNS (sender_id, sender_email, sender_username)
--    These are referenced in ALL FULL tier frontend payloads for 100% accurate
--    MINE vs OTHER sender bubble detection (name matching can fail for generic
--    names like "Doctor"; sender_id is unique per auth user = zero ambiguity.)
-- =============================================================================
ALTER TABLE public.consultation_messages ADD COLUMN IF NOT EXISTS sender_id text null;
ALTER TABLE public.consultation_messages ADD COLUMN IF NOT EXISTS sender_email text null;
ALTER TABLE public.consultation_messages ADD COLUMN IF NOT EXISTS sender_username text null;

-- Also ensure room / sender_role / sender_name / specialty exist — these were
-- added in Migration 003 but re-declared here IF NOT EXISTS for safety in case
-- user skipped 003 or ran them in wrong order earlier:
ALTER TABLE public.consultation_messages ADD COLUMN IF NOT EXISTS room text null;
ALTER TABLE public.consultation_messages ADD COLUMN IF NOT EXISTS sender_role text null;
ALTER TABLE public.consultation_messages ADD COLUMN IF NOT EXISTS sender_name text null;
ALTER TABLE public.consultation_messages ADD COLUMN IF NOT EXISTS specialty text null;
ALTER TABLE public.consultation_messages ADD COLUMN IF NOT EXISTS sender_dept text null;

-- =============================================================================
-- 2. DROP NOT NULL + SET SAFE DEFAULTS (same pattern as Migration 004)
--    If any column was manually created before with NOT NULL — relax it now,
--    so partial payloads during fallback tiers never throw constraint errors.
-- =============================================================================
ALTER TABLE public.consultation_messages ALTER COLUMN sender_id DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN sender_email DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN sender_username DROP NOT NULL;

ALTER TABLE public.consultation_messages ALTER COLUMN room DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN sender_role DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN sender_role SET DEFAULT 'staff';
ALTER TABLE public.consultation_messages ALTER COLUMN sender_name DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN specialty DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN specialty SET DEFAULT 'global_doctors';
ALTER TABLE public.consultation_messages ALTER COLUMN sender_dept DROP NOT NULL;

-- =============================================================================
-- 3. PERFORMANCE INDEXES
--    sender_id lookup = O(1) fast MINE detection for 10k+ message threads.
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_chat_sender_id_created ON public.consultation_messages (sender_id, created_at DESC) WHERE sender_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_sender_username ON public.consultation_messages (sender_username, created_at DESC) WHERE sender_username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_room_created_desc ON public.consultation_messages (room, created_at DESC) WHERE room IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_specialty_created_desc ON public.consultation_messages (specialty, created_at DESC) WHERE specialty IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_sender_role_created ON public.consultation_messages (sender_role, created_at DESC) WHERE sender_role IS NOT NULL;

-- =============================================================================
-- 4. BACKFILL EXISTING ROWS
--    Old messages sent before this migration get default values so bubble render
--    isDoctorChatMine never crashes with NULL/undefined identity fields.
-- =============================================================================
UPDATE public.consultation_messages SET deleted = false WHERE deleted IS NULL;
UPDATE public.consultation_messages SET pinned = false WHERE pinned IS NULL;
UPDATE public.consultation_messages SET sender_role = 'staff' WHERE sender_role IS NULL;
UPDATE public.consultation_messages SET specialty = 'global_doctors' WHERE specialty IS NULL AND COALESCE(room, '') = '';

-- =============================================================================
-- 5. REFRESH SUPABASE POSTGREST SCHEMA CACHE — CRITICAL! 🔥
--    This forces Supabase API layer to DISCOVER all new columns IMMEDIATELY,
--    so the red toast "Could not find column 'sender_id' in schema cache"
--    disappears INSTANTLY without waiting or refreshing the project.
-- =============================================================================
NOTIFY pgrst, 'reload schema';
ANALYZE public.consultation_messages;

-- =============
-- AFTER RUNNING:
-- =============
--   1. Wait 5-10 seconds for PostgREST schema cache reload to propagate
--   2. HARD REFRESH Doctor Web (Ctrl+Shift+R / Cmd+Shift+R)
--   3. Send a test message → NO RED ERROR!
--   4. Send message from Nurse Mobile App (Physical Therapy / Lab / Rad) →
--      shows in 🏥 All Hospital tab + 🩹 Nurses Allied tab with correct
--      🟠 P / 🔴 L / 🔵 R avatars.
--   5. Doctor replies → Nurse mobile app sees reply in correct room ✅
-- =============
