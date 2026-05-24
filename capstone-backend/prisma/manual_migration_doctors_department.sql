-- Adds doctors.department for ER vs OPD duty assignment.
-- Run this on Supabase SQL Editor (production DB).

ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS department text;

CREATE INDEX IF NOT EXISTS doctors_department_lookup
  ON public.doctors (department);

