-- Move staff/presence/restock prerequisites out of live request handling.
-- This migration is applied by the serialized pre-start schema bootstrap.

ALTER TABLE IF EXISTS public.staff ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE IF EXISTS public.staff ADD COLUMN IF NOT EXISTS last_active timestamptz;
ALTER TABLE IF EXISTS public.staff ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE IF EXISTS public.staff ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE IF EXISTS public.staff ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS staff_presence_idx ON public.staff(status, last_active);

ALTER TABLE IF EXISTS public.nurses ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE IF EXISTS public.nurses ADD COLUMN IF NOT EXISTS last_active timestamptz;
ALTER TABLE IF EXISTS public.nurses ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE IF EXISTS public.nurses ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE IF EXISTS public.nurses ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS nurses_presence_idx ON public.nurses(status, last_active);

ALTER TABLE IF EXISTS public.doctors ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE IF EXISTS public.doctors ADD COLUMN IF NOT EXISTS last_active timestamptz;
ALTER TABLE IF EXISTS public.doctors ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE IF EXISTS public.doctors ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE IF EXISTS public.doctors ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS doctors_presence_idx ON public.doctors(status, last_active);

ALTER TABLE IF EXISTS public.accounts ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE IF EXISTS public.accounts ADD COLUMN IF NOT EXISTS last_active timestamptz;
ALTER TABLE IF EXISTS public.accounts ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE IF EXISTS public.accounts ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE IF EXISTS public.accounts ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE IF EXISTS public.accounts ADD COLUMN IF NOT EXISTS linked_doctor_id uuid;
CREATE INDEX IF NOT EXISTS accounts_presence_idx ON public.accounts(status, last_active);
CREATE INDEX IF NOT EXISTS accounts_linked_doctor_idx ON public.accounts(linked_doctor_id);

ALTER TABLE IF EXISTS public.medicines ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE IF EXISTS public.medicines ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE IF EXISTS public.supplies ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE IF EXISTS public.supplies ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.user_settings (
  id BIGSERIAL PRIMARY KEY,
  user_email TEXT NOT NULL,
  user_role TEXT NOT NULL,
  prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_email, user_role)
);
CREATE INDEX IF NOT EXISTS user_settings_user_idx ON public.user_settings(user_email, user_role);

CREATE TABLE IF NOT EXISTS public.restock_requests (
  id BIGSERIAL PRIMARY KEY,
  item_type TEXT NOT NULL,
  item_id BIGINT NOT NULL,
  item_name TEXT,
  requested_qty INT NOT NULL DEFAULT 0,
  fulfilled_qty INT NOT NULL DEFAULT 0,
  priority TEXT NOT NULL DEFAULT 'Normal',
  status TEXT NOT NULL DEFAULT 'Pending',
  note TEXT,
  requested_by TEXT,
  fulfilled_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS restock_requests_status_created_at_idx ON public.restock_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS restock_requests_item_idx ON public.restock_requests(item_type, item_id);
CREATE UNIQUE INDEX IF NOT EXISTS restock_requests_open_item_unique_idx
  ON public.restock_requests(item_type, item_id)
  WHERE status IN ('Pending', 'In Progress');

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
CREATE INDEX IF NOT EXISTS stock_movements_item_idx ON public.stock_movements(item_type, item_id);
