-- =============================================================================
-- PASCUALINGA HOSPITAL — CRITICAL MIGRATION #003 (RUN AFTER 001 + 002)
-- NURSE ↔ DOCTOR UNIFIED INBOX: MISSING COLUMNS + INDEXES
-- This fixes the ERROR: "Could not find the 'room' column of 'consultation_messages' in the schema cache"
-- Also enables 2-way sync: Nurse Mobile App (Physical Therapy / Lab / Rad rooms) ↔ Doctor Web Chat
-- =============================================================================

-- =============================================================================
-- 1. NEW MISSING COLUMNS THAT WERE NEVER ADDED (fixes schema cache error!)
--    IF NOT EXISTS — idempotent, safe to re-run multiple times
-- =============================================================================
ALTER TABLE public.consultation_messages
  ADD COLUMN IF NOT EXISTS room text null,
  ADD COLUMN IF NOT EXISTS sender_role text null,
  ADD COLUMN IF NOT EXISTS sender_name text null,
  ADD COLUMN IF NOT EXISTS specialty text null,
  ADD COLUMN IF NOT EXISTS sender_email text null,
  ADD COLUMN IF NOT EXISTS sender_username text null;

-- =============================================================================
-- 2. COMMENTS FOR DOH / RA 10173 AUDIT TRAIL
-- =============================================================================
COMMENT ON COLUMN public.consultation_messages.room IS 'Free-text room/dept label (e.g. "Physical Therapy", "Lab", "ER", "Radiology"). Written by Nurse Mobile App and Doctor dual-write. Query with OR: specialty IN (...) OR room IN (...) for unified inbox.';
COMMENT ON COLUMN public.consultation_messages.sender_role IS 'Role at send time: doctor | nurse | medtech | radiographer | physical_therapist | pharmacist | cashier | admin. Used by Nurses Allied tab filter.';
COMMENT ON COLUMN public.consultation_messages.sender_name IS 'Human-readable sender display name snapshot at send time (e.g. "Dr. Josh Amparo" / "Nurse Maria").';
COMMENT ON COLUMN public.consultation_messages.specialty IS 'Legacy doctor-side room key (e.g. "global_doctors"). Now dual-written alongside room for backwards compat.';
COMMENT ON COLUMN public.consultation_messages.sender_email IS 'Cached sender email for bubble mine/not-mine detection (redundant but speeds up render, avoids auth join).';
COMMENT ON COLUMN public.consultation_messages.sender_username IS 'Cached sender username for bubble mine/not-mine detection (e.g. joshamparo5).';

-- =============================================================================
-- 3. NEW INDEXES FOR UNIFIED INBOX PERFORMANCE (OR query: specialty + room)
--    Live filter works on 10k+ messages without seq scan
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_chat_room_created_desc ON public.consultation_messages (room, created_at DESC) WHERE room IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_specialty_created_desc ON public.consultation_messages (specialty, created_at DESC) WHERE specialty IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_sender_role_created ON public.consultation_messages (sender_role, created_at DESC) WHERE sender_role IS NOT NULL;

-- =============================================================================
-- 4. REFRESH POSTGREST / SUPABASE SCHEMA CACHE
--    Supabase caches table schema; after ALTER TABLE the PostgREST layer does
--    NOT automatically know about new columns unless we NOTIFY reload.
--    This prevents the "Could not find column X in schema cache" red error toast.
-- =============================================================================
NOTIFY pgrst, 'reload schema';
ANALYZE public.consultation_messages;

-- After running this SQL in Supabase SQL Editor:
--   1. Wait 5-10 seconds for schema cache refresh
--   2. Hard refresh your Doctor Web frontend (Ctrl+Shift+R)
--   3. Re-send test message — "Could not find room column" error should be GONE ✅
--   4. Open Nurse Mobile App → Physical Therapy room → send a test message
--   5. Doctor Web → Doctor Chat → 🏥 All Hospital tab / 🩹 Nurses Allied tab → message appears with 🟠 P avatar ✅
--   6. Doctor replies → message appears in Nurse Mobile App room ✅ (2-WAY CONNECTED!)
