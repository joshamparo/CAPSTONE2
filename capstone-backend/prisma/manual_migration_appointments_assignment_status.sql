ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS assignment_status text NOT NULL DEFAULT 'PENDING_ASSIGNMENT';

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz NULL;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS assigned_by text NULL;

-- Helpful index for secretary inbox.
CREATE INDEX IF NOT EXISTS appointments_assignment_status_idx
  ON public.appointments (assignment_status, consultation_mode, appointment_date);
