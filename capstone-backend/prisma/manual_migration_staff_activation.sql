ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS reset_password_token TEXT;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS reset_password_expires TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS accounts_reset_password_token_idx ON public.accounts(reset_password_token);
