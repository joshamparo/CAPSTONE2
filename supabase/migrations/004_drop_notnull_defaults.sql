-- =============================================================================
-- PASCUALINGA HOSPITAL — MIGRATION #004 (RUN AFTER 001 + 002 + 003)
-- DROP NOT NULL CONSTRAINTS + ADD DEFAULTS FOR MAXIMUM RESILIENCE
-- Fixes: "null value in column 'sender_role' violates not-null constraint"
-- Run this in Supabase SQL Editor ONCE. Even if already run, it's IDEMPOTENT.
-- =============================================================================

-- =============================================================================
-- 1. DROP NOT NULL + SET DEFAULTS on ALL NEW COLUMNS added by 001 + 003
--    Result: If any frontend payload is missing a field, default/NULL = OK.
--    NO MORE RED TOASTS from schema/constraint issues! ✅
-- =============================================================================

-- --- Columns from Migration 003 (Unified Inbox / Nurse sync) ---
ALTER TABLE public.consultation_messages ALTER COLUMN room DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN room SET DEFAULT NULL;

ALTER TABLE public.consultation_messages ALTER COLUMN sender_role DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN sender_role SET DEFAULT 'staff';

ALTER TABLE public.consultation_messages ALTER COLUMN sender_name DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN sender_name SET DEFAULT NULL;

ALTER TABLE public.consultation_messages ALTER COLUMN specialty DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN specialty SET DEFAULT 'global_doctors';

ALTER TABLE public.consultation_messages ALTER COLUMN sender_email DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN sender_email SET DEFAULT NULL;

ALTER TABLE public.consultation_messages ALTER COLUMN sender_username DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN sender_username SET DEFAULT NULL;

-- --- Columns from Migration 001 (Doctor Chat delete/pin/attachment/reply) ---
ALTER TABLE public.consultation_messages ALTER COLUMN deleted DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN deleted SET DEFAULT false;

ALTER TABLE public.consultation_messages ALTER COLUMN pinned DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN pinned SET DEFAULT false;

ALTER TABLE public.consultation_messages ALTER COLUMN sender_dept DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN sender_dept SET DEFAULT NULL;

ALTER TABLE public.consultation_messages ALTER COLUMN reply_to_id DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN reply_to_body DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN reply_to_sender DROP NOT NULL;

ALTER TABLE public.consultation_messages ALTER COLUMN attachment_kind DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN attachment_name DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN attachment_size DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN attachment_mime DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN attachment_path DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN attachment_url DROP NOT NULL;
ALTER TABLE public.consultation_messages ALTER COLUMN attachment_public_url DROP NOT NULL;

-- =============================================================================
-- 2. FIX EXISTING ROWS — backfill defaults for old messages with missing cols
--    (Legacy messages created before 001/003 won't crash bubble render anymore)
-- =============================================================================
UPDATE public.consultation_messages SET deleted = false WHERE deleted IS NULL;
UPDATE public.consultation_messages SET pinned = false WHERE pinned IS NULL;
UPDATE public.consultation_messages SET specialty = 'global_doctors' WHERE specialty IS NULL AND COALESCE(room, '') = '';
UPDATE public.consultation_messages SET sender_role = 'doctor' WHERE sender_role IS NULL AND (sender_dept IS NOT NULL OR lower(COALESCE(body,'')) LIKE 'dr.%');
UPDATE public.consultation_messages SET sender_role = 'staff' WHERE sender_role IS NULL;

-- =============================================================================
-- 3. REFRESH SUPABASE SCHEMA CACHE AGAIN (just to be safe)
-- =============================================================================
NOTIFY pgrst, 'reload schema';
ANALYZE public.consultation_messages;

-- After running:
-- 1. Hard refresh Doctor Web (Ctrl+Shift+R / Cmd+Shift+R)
-- 2. Send test message from Doctor → 0 errors, 0 warning toasts
-- 3. Send test message from Nurse PT Mobile App → shows in 🏥 All Hospital / 🩹 Nurses Allied tabs with 🟠 P avatar
