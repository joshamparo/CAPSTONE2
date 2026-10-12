-- Appointment fields used by ER intake, video consultations, assignment, and
-- payment workflows. Install them before the API accepts live traffic.

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS emergency_name text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS emergency_relation text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS emergency_phone text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS patient_id uuid;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS doctor_uuid uuid;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS consultation_mode text DEFAULT 'onsite';
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS meeting_room_id text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS meeting_created_at timestamptz;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS meeting_started_at timestamptz;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS meeting_ended_at timestamptz;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS meeting_expires_at timestamptz;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS triage_level integer;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS triage_status text DEFAULT 'Unassessed';
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS triage_reasons jsonb;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS triaged_by text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS triaged_at timestamptz;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS triage_overridden_by text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS triage_overridden_at timestamptz;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS blood_pressure text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS heart_rate integer;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS respiratory_rate integer;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS spo2 integer;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS temperature decimal(5,2);
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS triage_override_reason text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS triage_decided_by text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS triage_final_level integer;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS patient_waiting_at timestamptz;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS patient_waiting_name text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS walkin_ticket text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS walkin_ticket_seq integer;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS walkin_ticket_date date;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS assignment_status text DEFAULT 'PENDING_ASSIGNMENT';
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS assigned_by text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS paymongo_checkout_session_id text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS paymongo_payment_id text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS paymongo_event_id text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS payment_status text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS completed_by text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS amount integer;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS currency text;

CREATE INDEX IF NOT EXISTS appointments_patient_idx ON public.appointments(patient_id, appointment_date DESC);
CREATE INDEX IF NOT EXISTS appointments_doctor_uuid_idx ON public.appointments(doctor_uuid, appointment_date DESC);
CREATE INDEX IF NOT EXISTS appointments_email_idx ON public.appointments(lower(coalesce(email, '')), appointment_date DESC);
CREATE INDEX IF NOT EXISTS appointments_meeting_idx ON public.appointments(meeting_started_at DESC, meeting_room_id);
CREATE INDEX IF NOT EXISTS appointments_triage_idx ON public.appointments(triage_level, appointment_date DESC);
CREATE INDEX IF NOT EXISTS appointments_walkin_ticket_lookup ON public.appointments(walkin_ticket_date, doctor_id, walkin_ticket_seq);
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS appointments_walkin_ticket_unique
    ON public.appointments(walkin_ticket_date, walkin_ticket_seq)
    WHERE walkin_ticket_seq IS NOT NULL;
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING 'Skipped appointments_walkin_ticket_unique because legacy duplicate tickets require reconciliation';
END $$;
CREATE INDEX IF NOT EXISTS appointments_completed_idx ON public.appointments(completed_at DESC);
CREATE INDEX IF NOT EXISTS appointments_assignment_status_idx
  ON public.appointments(assignment_status, consultation_mode, appointment_date);
