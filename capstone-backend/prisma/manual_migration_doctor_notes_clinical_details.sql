ALTER TABLE public.doctor_notes
ADD COLUMN IF NOT EXISTS clinical_details jsonb;
