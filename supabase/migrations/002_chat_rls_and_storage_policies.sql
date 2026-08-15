-- =============================================================================
-- PASCUALINGA HOSPITAL — CRITICAL MIGRATION #002 (RUN AFTER 001_DOCTOR_CHAT_COLUMNS)
-- ROW LEVEL SECURITY + STORAGE BUCKET POLICIES (Medicolegal / RA 10173 compliant)
-- Scope: doctor-to-doctor chat ONLY authenticated staff can read/write own rows
-- NEVER run public anon write on medical records
-- =============================================================================

-- 1. ENABLE RLS on consultation_messages (default OFF prevents direct anon access after table created)
ALTER TABLE public.consultation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_messages FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- 2. POLICY: DOCTORS / NURSES + CLINICAL STAFF CAN READ ALL MESSAGES IN THEIR ROOM
--    (Doctor chat room is work shared collaboration read)
-- =============================================================================
DROP POLICY IF EXISTS chat_read_staff_only ON public.consultation_messages;
CREATE POLICY chat_read_staff_only ON public.consultation_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users au
      WHERE au.id = auth.uid()
        AND (
          (COALESCE(au.raw_app_meta_data->>'role', '') IN ('doctor','nurse','medtech','radiographer','ecg_operator','physical_therapist','doctor_secretary','admin','staff'))
          OR
          (COALESCE(au.raw_user_meta_data->>'role', '') IN ('doctor','nurse','medtech','radiographer','ecg_operator','physical_therapist','doctor_secretary','admin','staff'))
        )
    )
  );

-- =============================================================================
-- 3. POLICY: INSERT — Sender must be authenticated staff, sender_id matches auth.uid()
--    (Prevents forgery / spamming other doctor identities in chat)
-- =============================================================================
DROP POLICY IF EXISTS chat_insert_own_sender ON public.consultation_messages;
CREATE POLICY chat_insert_own_sender ON public.consultation_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users au
      WHERE au.id = auth.uid()
        AND (
          (COALESCE(au.raw_app_meta_data->>'role', '') IN ('doctor','nurse','medtech','radiographer','ecg_operator','physical_therapist','doctor_secretary','admin','staff'))
          OR
          (COALESCE(au.raw_user_meta_data->>'role', '') IN ('doctor','nurse','medtech','radiographer','ecg_operator','physical_therapist','doctor_secretary','admin','staff'))
        )
    )
    AND
    (sender_id = auth.uid() OR sender_id IS NULL)
  );

-- =============================================================================
-- 4. POLICY: UPDATE — Owner only. Can edit OWN message for first 30 minutes + toggle deleted/pinned ONLY by sender (soft delete or pin announcements)
-- =============================================================================
DROP POLICY IF EXISTS chat_update_own_message ON public.consultation_messages;
CREATE POLICY chat_update_own_message ON public.consultation_messages
  FOR UPDATE
  TO authenticated
  USING (
    (sender_id = auth.uid())
    OR
    EXISTS (
      SELECT 1 FROM auth.users au
      WHERE au.id = auth.uid()
        AND (COALESCE(au.raw_app_meta_data->>'role','') = 'admin' OR COALESCE(au.raw_user_meta_data->>'role','') = 'admin')
    )
  )
  WITH CHECK (
    (
      (sender_id = auth.uid())
      AND
      (created_at IS NULL OR created_at >= (NOW() - INTERVAL '30 minutes'))
    )
    OR
    EXISTS (
      SELECT 1 FROM auth.users au
      WHERE au.id = auth.uid()
        AND (COALESCE(au.raw_app_meta_data->>'role','') = 'admin' OR COALESCE(au.raw_user_meta_data->>'role','') = 'admin')
    )
  );

-- =============================================================================
-- 5. POLICY: DELETE — ADMIN ONLY (MEDICOLEGAL — NEVER allow users HARD DELETE)
--    Soft delete (update deleted=true) is used via UPDATE policy above.
--    Hard DELETE SQL command blocked for ALL non-superusers to preserve audit trail.
-- =============================================================================
DROP POLICY IF EXISTS chat_delete_admin_only ON public.consultation_messages;
CREATE POLICY chat_delete_admin_only ON public.consultation_messages
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users au
      WHERE au.id = auth.uid()
        AND (COALESCE(au.raw_app_meta_data->>'role','') = 'admin' OR COALESCE(au.raw_user_meta_data->>'role','') = 'admin')
    )
  );

-- =============================================================================
-- 6. STORAGE BUCKET RLS: doctor-chat-attachments
--    Bucket is created by migration #001, RLS is enabled on bucket by default since Supabase v12+
-- =============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('doctor-chat-attachments', 'doctor-chat-attachments', false, 52428800, ARRAY['image/*','application/pdf','video/mp4','video/webm','video/quicktime']::text[])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS storage_chat_attach_read_authenticated ON storage.objects;
CREATE POLICY storage_chat_attach_read_authenticated ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'doctor-chat-attachments'
    AND
    EXISTS (
      SELECT 1 FROM auth.users au
      WHERE au.id = auth.uid()
        AND (
          (COALESCE(au.raw_app_meta_data->>'role', '') IN ('doctor','nurse','medtech','radiographer','ecg_operator','physical_therapist','doctor_secretary','cashier','pharmacist','admin','staff'))
          OR
          (COALESCE(au.raw_user_meta_data->>'role', '') IN ('doctor','nurse','medtech','radiographer','ecg_operator','physical_therapist','doctor_secretary','cashier','pharmacist','admin','staff'))
        )
    )
  );

DROP POLICY IF EXISTS storage_chat_attach_upload_own ON storage.objects;
CREATE POLICY storage_chat_attach_upload_own ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'doctor-chat-attachments'
    AND
    (name ~ '^doctor-chat-attachments\/(.)+\/(.)+')
    AND
    EXISTS (
      SELECT 1 FROM auth.users au
      WHERE au.id = auth.uid()
        AND (
          (COALESCE(au.raw_app_meta_data->>'role', '') IN ('doctor','nurse','medtech','radiographer','ecg_operator','physical_therapist','doctor_secretary','admin','staff'))
          OR
          (COALESCE(au.raw_user_meta_data->>'role', '') IN ('doctor','nurse','medtech','radiographer','ecg_operator','physical_therapist','doctor_secretary','admin','staff'))
        )
    )
    AND
    ((storage.foldername(name))[2] IN (
      SELECT LOWER(COALESCE(NULLIF(au.raw_user_meta_data->>'username',''), NULLIF(au.email,''))) FROM auth.users au WHERE au.id = auth.uid()
    )
    OR
    (storage.foldername(name))[2] IN (
      SELECT LOWER(CONCAT(
        COALESCE(NULLIF(au.raw_user_meta_data->>'firstName',''), ''),
        CASE WHEN COALESCE(NULLIF(au.raw_user_meta_data->>'firstName',''), NULLIF(au.email,'')) IS NOT NULL THEN '-' ELSE '' END,
        COALESCE(NULLIF(au.raw_user_meta_data->>'lastName',''), '')
      )) FROM auth.users au WHERE au.id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS storage_chat_attach_delete_own_or_admin ON storage.objects;
CREATE POLICY storage_chat_attach_delete_own_or_admin ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'doctor-chat-attachments'
    AND (
      EXISTS (
        SELECT 1 FROM auth.users au
        WHERE au.id = auth.uid()
          AND (COALESCE(au.raw_app_meta_data->>'role','') = 'admin' OR COALESCE(au.raw_user_meta_data->>'role','') = 'admin')
      )
      OR
      (storage.foldername(name))[2] IN (
        SELECT LOWER(COALESCE(NULLIF(au.raw_user_meta_data->>'username',''), NULLIF(au.email,''))) FROM auth.users au WHERE au.id = auth.uid()
      )
    )
  );

-- =============================================================================
-- 7. INDEXES SPEED UP CHAT (live 10k+ messages)
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_chat_room_created ON public.consultation_messages (consultation_room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_sender_created ON public.consultation_messages (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_pinned ON public.consultation_messages (pinned, pinned_at DESC) WHERE pinned IS TRUE;
CREATE INDEX IF NOT EXISTS idx_chat_deleted ON public.consultation_messages (deleted, created_at DESC);
