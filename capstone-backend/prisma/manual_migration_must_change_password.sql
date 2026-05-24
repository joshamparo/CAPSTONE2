-- Manual migration to add must_change_password column to various tables
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false;
ALTER TABLE public.nurses ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false;
ALTER TABLE public.doctors ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false;
