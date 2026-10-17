-- Request and movement structures used by the nurse-to-pharmacy workflow.
-- These run once during deployment, never while a pharmacist is clicking an action.
CREATE TABLE IF NOT EXISTS public.requests (
  id BIGSERIAL PRIMARY KEY,
  patient_id UUID NULL,
  patient_name TEXT NULL,
  requested_by TEXT NULL,
  message TEXT NULL,
  status TEXT NULL CHECK (
    status IS NULL OR lower(status) IN (
      'pending', 'processing', 'in progress', 'approved',
      'completed', 'rejected', 'cancelled'
    )
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS patient_name TEXT NULL;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS requested_by TEXT NULL;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS message TEXT NULL;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS status TEXT NULL;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS requests_status_created_idx ON public.requests(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id BIGSERIAL PRIMARY KEY,
  item_type TEXT NOT NULL,
  item_id BIGINT NOT NULL,
  delta INT NOT NULL,
  reason TEXT NOT NULL,
  patient_id UUID,
  request_id BIGINT,
  actor_name TEXT,
  actor_role TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_movements_patient_idx ON public.stock_movements(patient_id);
CREATE INDEX IF NOT EXISTS stock_movements_request_idx ON public.stock_movements(request_id);
