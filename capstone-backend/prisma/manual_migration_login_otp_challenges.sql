CREATE TABLE IF NOT EXISTS public.login_otp_challenges (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_model TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    resend_after TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_otp_challenges_lookup_idx
    ON public.login_otp_challenges (id, consumed_at, expires_at);
