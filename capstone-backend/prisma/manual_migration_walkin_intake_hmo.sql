-- Walk-in intake, HMO, and cashier support.
-- Installed during backend prestart so patient registration never performs DDL.

CREATE TABLE IF NOT EXISTS public.nurse_tasks (
  id bigserial PRIMARY KEY,
  department text NOT NULL,
  shift_label text NULL,
  title text NOT NULL,
  priority text NOT NULL DEFAULT 'routine',
  due_time text NULL,
  patient_id uuid NULL,
  patient_name text NULL,
  status text NOT NULL DEFAULT 'open',
  completed boolean NOT NULL DEFAULT false,
  created_by_name text NULL,
  created_by_email text NULL,
  completed_by_name text NULL,
  completed_by_email text NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.walkin_ticket_counters (
  ticket_date date NOT NULL,
  doctor_key text NOT NULL DEFAULT '',
  last_seq integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_date, doctor_key)
);

CREATE TABLE IF NOT EXISTS public.doctor_service_fees (
  id bigserial PRIMARY KEY,
  doctor_uuid uuid NOT NULL,
  service_key text NOT NULL,
  service_name text NOT NULL,
  default_fee numeric(10,2) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doctor_uuid, service_key)
);

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS hmo_provider varchar(100);
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS hmo_loa_number varchar(100);
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS hmo_card_number varchar(100);
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS hmo_notes text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS philhealth_number varchar(50);
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS philhealth_deduction numeric(12,2) DEFAULT 0;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS hmo_covered_json jsonb;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS is_hmo boolean DEFAULT false;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS hmo_status varchar(40) DEFAULT 'Awaiting LOA';
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS patient_reference text;

ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS is_hmo boolean DEFAULT false;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS hmo boolean DEFAULT false;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS hmo_provider text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS hmo_card_number text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS hmo_loa_number text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS philhealth_amount numeric(12,2) DEFAULT 0;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS is_philhealth boolean DEFAULT false;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS company text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS patient_reference text UNIQUE;

ALTER TABLE public.billing_invoices ADD COLUMN IF NOT EXISTS is_hmo boolean DEFAULT false;
ALTER TABLE public.billing_invoices ADD COLUMN IF NOT EXISTS hmo_provider text;
ALTER TABLE public.billing_invoices ADD COLUMN IF NOT EXISTS hmo_status text;
ALTER TABLE public.billing_invoices ADD COLUMN IF NOT EXISTS is_philhealth boolean DEFAULT false;
ALTER TABLE public.billing_invoices ADD COLUMN IF NOT EXISTS patient_reference text;

CREATE TABLE IF NOT EXISTS public.billing_adjustments (
  id bigserial PRIMARY KEY,
  invoice_id bigint NOT NULL REFERENCES public.billing_invoices(id) ON DELETE CASCADE,
  type text NOT NULL,
  amount numeric(10,2) NOT NULL DEFAULT 0,
  reference text NULL,
  reason text NULL,
  created_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.billing_hmo_claims (
  id bigserial PRIMARY KEY,
  invoice_id bigint NULL REFERENCES public.billing_invoices(id) ON DELETE CASCADE,
  appointment_id bigint NULL,
  patient_id uuid NULL,
  patient_name text NULL,
  hmo_provider text NULL,
  hmo_loa_number text NULL,
  hmo_card_number text NULL,
  hmo_amount numeric(12,2) NOT NULL DEFAULT 0,
  philhealth_amount numeric(12,2) NOT NULL DEFAULT 0,
  philhealth_deduction numeric(12,2) NOT NULL DEFAULT 0,
  loa_approved_amount numeric(12,2) NOT NULL DEFAULT 0,
  claim_status text NOT NULL DEFAULT 'Pending - Nurse Intake',
  status text NOT NULL DEFAULT 'Pending',
  coverage_json jsonb NULL,
  patient_reference text NULL,
  notes text NULL,
  created_by text NULL,
  requested_by text NULL,
  updated_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_hmo_claims ADD COLUMN IF NOT EXISTS invoice_id bigint NULL;
ALTER TABLE public.billing_hmo_claims ADD COLUMN IF NOT EXISTS appointment_id bigint NULL;
ALTER TABLE public.billing_hmo_claims ADD COLUMN IF NOT EXISTS patient_id uuid NULL;
ALTER TABLE public.billing_hmo_claims ADD COLUMN IF NOT EXISTS patient_name text NULL;
ALTER TABLE public.billing_hmo_claims ADD COLUMN IF NOT EXISTS hmo_provider text NULL;
ALTER TABLE public.billing_hmo_claims ADD COLUMN IF NOT EXISTS hmo_loa_number text NULL;
ALTER TABLE public.billing_hmo_claims ADD COLUMN IF NOT EXISTS hmo_card_number text NULL;
ALTER TABLE public.billing_hmo_claims ADD COLUMN IF NOT EXISTS philhealth_deduction numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.billing_hmo_claims ADD COLUMN IF NOT EXISTS loa_approved_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.billing_hmo_claims ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Pending';
ALTER TABLE public.billing_hmo_claims ADD COLUMN IF NOT EXISTS coverage_json jsonb NULL;
ALTER TABLE public.billing_hmo_claims ADD COLUMN IF NOT EXISTS patient_reference text NULL;
ALTER TABLE public.billing_hmo_claims ADD COLUMN IF NOT EXISTS requested_by text NULL;
ALTER TABLE public.billing_hmo_claims ADD COLUMN IF NOT EXISTS updated_by text NULL;

CREATE INDEX IF NOT EXISTS idx_billing_adjustments_invoice_id ON public.billing_adjustments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_billing_adjustments_created_at ON public.billing_adjustments(created_at);
CREATE INDEX IF NOT EXISTS idx_billing_hmo_claims_status ON public.billing_hmo_claims(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_hmo_claims_invoice_id ON public.billing_hmo_claims(invoice_id);
CREATE INDEX IF NOT EXISTS idx_billing_hmo_claims_patient_id ON public.billing_hmo_claims(patient_id);
CREATE INDEX IF NOT EXISTS idx_billing_hmo_claims_appointment_id ON public.billing_hmo_claims(appointment_id);
CREATE INDEX IF NOT EXISTS idx_billing_hmo_claims_patient_reference ON public.billing_hmo_claims(patient_reference);
CREATE INDEX IF NOT EXISTS idx_appointments_patient_reference ON public.appointments(patient_reference);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_patient_reference ON public.billing_invoices(patient_reference);
