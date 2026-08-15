-- =============================================================================
-- PASCUALINGA HOSPITAL — CRITICAL MIGRATION #001 (RUN BEFORE 002 RLS POLICIES)
-- DOCTOR-TO-DOCTOR CHAT: NEW COLUMNS + STORAGE BUCKET
-- Required by: Doctor chat features (delete, pin, attachments, reply) launched 2026-08-15
-- =============================================================================

-- =============================================================================
-- 1. NEW COLUMNS: consultation_messages
-- =============================================================================
ALTER TABLE public.consultation_messages
ADD COLUMN IF NOT EXISTS deleted boolean default false,
ADD COLUMN IF NOT EXISTS deleted_at timestamptz null,
ADD COLUMN IF NOT EXISTS deleted_by text null,
ADD COLUMN IF NOT EXISTS pinned boolean default false,
ADD COLUMN IF NOT EXISTS pinned_at timestamptz null,
ADD COLUMN IF NOT EXISTS pinned_by text null,
ADD COLUMN IF NOT EXISTS attachment_kind text null,
ADD COLUMN IF NOT EXISTS attachment_name text null,
ADD COLUMN IF NOT EXISTS attachment_size bigint null,
ADD COLUMN IF NOT EXISTS attachment_mime text null,
ADD COLUMN IF NOT EXISTS attachment_path text null,
ADD COLUMN IF NOT EXISTS attachment_url text null,
ADD COLUMN IF NOT EXISTS attachment_public_url text null,
ADD COLUMN IF NOT EXISTS reply_to_id uuid null references public.consultation_messages(id) on delete set null,
ADD COLUMN IF NOT EXISTS reply_to_body text null,
ADD COLUMN IF NOT EXISTS reply_to_sender text null,
ADD COLUMN IF NOT EXISTS sender_dept text null;

-- =============================================================================
-- 2. COMMENTS ON NEW COLUMNS (Audit trail for DOH / RA 10173)
-- =============================================================================
COMMENT ON COLUMN public.consultation_messages.deleted IS 'SOFT DELETE ONLY. If TRUE, message hidden from UI but remains in DB for audit. NEVER hard delete via SQL except admin annual purge.';
COMMENT ON COLUMN public.consultation_messages.deleted_at IS 'UTC timestamp when sender soft-deleted message.';
COMMENT ON COLUMN public.consultation_messages.deleted_by IS 'Normalized sender username/email who performed soft delete.';
COMMENT ON COLUMN public.consultation_messages.pinned IS 'If TRUE, message appears top of chat (max 3 per room). Used for shift handover / STAT announcements.';
COMMENT ON COLUMN public.consultation_messages.pinned_at IS 'UTC timestamp pinned.';
COMMENT ON COLUMN public.consultation_messages.pinned_by IS 'Doctor fullname who pinned (for audit).';
COMMENT ON COLUMN public.consultation_messages.attachment_kind IS 'Enum: image | pdf | video. Controls which renderer is used in bubble UI.';
COMMENT ON COLUMN public.consultation_messages.attachment_name IS 'Original filename shown in chat bubble (patient-visible names redacted if needed).';
COMMENT ON COLUMN public.consultation_messages.attachment_size IS 'Bytes, for download/upload progress bars + quota validation.';
COMMENT ON COLUMN public.consultation_messages.attachment_mime IS 'RFC 2045 MIME type (e.g. application/pdf, image/png, video/mp4).';
COMMENT ON COLUMN public.consultation_messages.attachment_path IS 'storage.objects name key inside bucket doctor-chat-attachments/roomId/username/timestamp_filename.ext';
COMMENT ON COLUMN public.consultation_messages.attachment_url IS 'Signed expiring URL (TTL 72 hours) generated on upload — auth users only. Re-issue on view expire.';
COMMENT ON COLUMN public.consultation_messages.attachment_public_url IS 'Fallback public CDN URL for non-PHI attachments (PDF guidelines, posters).';
COMMENT ON COLUMN public.consultation_messages.reply_to_id IS 'FK self-ref — which earlier message this is in reply/quote thread.';
COMMENT ON COLUMN public.consultation_messages.reply_to_body IS 'Cached 240-char snapshot of replied message (so even if original is soft-deleted, quote preview renders).';
COMMENT ON COLUMN public.consultation_messages.reply_to_sender IS 'Cached original sender name/Dr. title for quote header (no extra join on render).';
COMMENT ON COLUMN public.consultation_messages.sender_dept IS 'Department snapshot at send time (e.g. "ER / Pediatrics") — shows next to green dot.';

-- =============================================================================
-- 3. STORAGE: Create bucket doctor-chat-attachments if not exists
-- =============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('doctor-chat-attachments', 'doctor-chat-attachments', true, 52428800, ARRAY['image/*','application/pdf','video/mp4','video/webm','video/quicktime']::text[])
ON CONFLICT (id) DO NOTHING;

-- Run 002_chat_rls_and_storage_policies.sql AFTER this one completes.
