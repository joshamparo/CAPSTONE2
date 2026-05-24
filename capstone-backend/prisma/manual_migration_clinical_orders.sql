BEGIN;

ALTER TABLE public.lab_results
ADD COLUMN IF NOT EXISTS order_id bigint;

CREATE TABLE IF NOT EXISTS public.clinical_orders (
  id bigserial PRIMARY KEY,
  patient_id uuid NULL,
  patient_name text NULL,
  kind text NULL,
  service text NULL,
  priority text NOT NULL DEFAULT 'Routine',
  status text NOT NULL DEFAULT 'Pending',
  notes text NULL,
  ordered_by_name text NULL,
  ordered_by_role text NULL,
  assigned_role text NULL,
  assigned_to text NULL,
  scheduled_at timestamptz NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clinical_orders_patient_id_idx ON public.clinical_orders (patient_id);
CREATE INDEX IF NOT EXISTS clinical_orders_assigned_role_status_idx ON public.clinical_orders (assigned_role, status);
CREATE INDEX IF NOT EXISTS clinical_orders_scheduled_at_idx ON public.clinical_orders (scheduled_at);

CREATE TABLE IF NOT EXISTS public.clinical_order_events (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES public.clinical_orders(id) ON DELETE CASCADE,
  actor_name text NULL,
  actor_role text NULL,
  action text NULL,
  from_status text NULL,
  to_status text NULL,
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clinical_order_events_order_id_created_at_idx ON public.clinical_order_events (order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.clinical_schedule_events (
  id bigserial PRIMARY KEY,
  role text NULL,
  staff_email text NULL,
  order_id bigint NULL REFERENCES public.clinical_orders(id) ON DELETE SET NULL,
  patient_id uuid NULL,
  title text NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NULL,
  location text NULL,
  status text NOT NULL DEFAULT 'Scheduled',
  notes text NULL,
  created_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clinical_schedule_events_role_start_at_idx ON public.clinical_schedule_events (role, start_at);
CREATE INDEX IF NOT EXISTS clinical_schedule_events_staff_email_start_at_idx ON public.clinical_schedule_events (staff_email, start_at);
CREATE INDEX IF NOT EXISTS clinical_schedule_events_order_id_idx ON public.clinical_schedule_events (order_id);
CREATE INDEX IF NOT EXISTS clinical_schedule_events_patient_id_idx ON public.clinical_schedule_events (patient_id);

ALTER TABLE public.clinical_orders
DROP CONSTRAINT IF EXISTS clinical_orders_patient_id_fkey;
ALTER TABLE public.clinical_orders
ADD CONSTRAINT clinical_orders_patient_id_fkey
  FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE SET NULL;

ALTER TABLE public.clinical_schedule_events
DROP CONSTRAINT IF EXISTS clinical_schedule_events_patient_id_fkey;
ALTER TABLE public.clinical_schedule_events
ADD CONSTRAINT clinical_schedule_events_patient_id_fkey
  FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE SET NULL;

ALTER TABLE public.lab_results
DROP CONSTRAINT IF EXISTS lab_results_order_id_fkey;
ALTER TABLE public.lab_results
ADD CONSTRAINT lab_results_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES public.clinical_orders(id) ON DELETE SET NULL;

COMMIT;
