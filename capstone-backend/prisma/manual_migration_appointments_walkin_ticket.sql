-- Walk-in queue ticket fields for appointments.
-- Run this on Supabase SQL Editor (production DB).

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS walkin_ticket text;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS walkin_ticket_seq integer;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS walkin_ticket_date date;

-- Optional helper index (speeds up ticket generation lookups).
CREATE INDEX IF NOT EXISTS appointments_walkin_ticket_lookup
  ON public.appointments (walkin_ticket_date, doctor_id, walkin_ticket_seq);

