-- Keep the newest-first audit trail and signed-session account checks indexed.
CREATE INDEX IF NOT EXISTS activity_logs_timestamp_idx
  ON public.activity_logs (timestamp DESC);

CREATE INDEX IF NOT EXISTS staff_email_lower_idx
  ON public.staff (lower(email));

CREATE INDEX IF NOT EXISTS nurses_email_lower_idx
  ON public.nurses (lower(email));

CREATE INDEX IF NOT EXISTS doctors_email_lower_idx
  ON public.doctors (lower(email));

CREATE INDEX IF NOT EXISTS accounts_email_lower_idx
  ON public.accounts (lower(email));
