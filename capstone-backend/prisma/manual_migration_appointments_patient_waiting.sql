-- Add missing columns used by Prisma schema for appointments.
-- Run this on Supabase SQL Editor (production DB).

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS patient_waiting_at timestamptz;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS patient_waiting_name text;

