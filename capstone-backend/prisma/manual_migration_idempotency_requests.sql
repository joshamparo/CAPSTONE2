CREATE TABLE IF NOT EXISTS public.idempotency_requests (
  operation text NOT NULL,
  actor_key text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  state text NOT NULL DEFAULT 'processing',
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  PRIMARY KEY (operation, actor_key, idempotency_key),
  CONSTRAINT idempotency_requests_state_check CHECK (state IN ('processing', 'completed'))
);

CREATE INDEX IF NOT EXISTS idempotency_requests_expiry_idx
  ON public.idempotency_requests(expires_at);
