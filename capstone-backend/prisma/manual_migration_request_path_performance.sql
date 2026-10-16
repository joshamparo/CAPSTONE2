-- Additive prerequisites formerly checked or created inside live API requests.
-- Keeping DDL in the serialized startup bootstrap avoids request-time locks.

CREATE TABLE IF NOT EXISTS public.announcements (
  id BIGSERIAL PRIMARY KEY,
  title TEXT,
  content TEXT,
  priority TEXT,
  target TEXT,
  author TEXT,
  pinned BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE IF EXISTS public.announcements ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS public.announcements ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.announcements ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS announcements_created_idx ON public.announcements(created_at DESC);

CREATE TABLE IF NOT EXISTS public.appointment_approval_requests (
  id BIGSERIAL PRIMARY KEY,
  patient_id UUID,
  patient_name TEXT,
  doctor_name TEXT,
  doctor_id UUID,
  nurse_name TEXT,
  requested_date DATE,
  requested_time TIME,
  service_type TEXT,
  service_category TEXT,
  department_key TEXT,
  service_name TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  suggested_date DATE,
  suggested_time TIME,
  suggested_note TEXT,
  appointment_id BIGINT,
  doctor_last_read_at TIMESTAMPTZ,
  nurse_last_read_at TIMESTAMPTZ,
  booking_ref TEXT,
  paymongo_checkout_session_id TEXT,
  paymongo_payment_id TEXT,
  paymongo_event_id TEXT,
  payment_status TEXT,
  paid_at TIMESTAMPTZ,
  amount INTEGER,
  currency TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE IF EXISTS public.appointment_approval_requests ADD COLUMN IF NOT EXISTS doctor_id UUID;
ALTER TABLE IF EXISTS public.appointment_approval_requests ADD COLUMN IF NOT EXISTS service_type TEXT;
ALTER TABLE IF EXISTS public.appointment_approval_requests ADD COLUMN IF NOT EXISTS service_category TEXT;
ALTER TABLE IF EXISTS public.appointment_approval_requests ADD COLUMN IF NOT EXISTS department_key TEXT;
ALTER TABLE IF EXISTS public.appointment_approval_requests ADD COLUMN IF NOT EXISTS service_name TEXT;
ALTER TABLE IF EXISTS public.appointment_approval_requests ADD COLUMN IF NOT EXISTS booking_ref TEXT;
ALTER TABLE IF EXISTS public.appointment_approval_requests ADD COLUMN IF NOT EXISTS paymongo_checkout_session_id TEXT;
ALTER TABLE IF EXISTS public.appointment_approval_requests ADD COLUMN IF NOT EXISTS paymongo_payment_id TEXT;
ALTER TABLE IF EXISTS public.appointment_approval_requests ADD COLUMN IF NOT EXISTS paymongo_event_id TEXT;
ALTER TABLE IF EXISTS public.appointment_approval_requests ADD COLUMN IF NOT EXISTS payment_status TEXT;
ALTER TABLE IF EXISTS public.appointment_approval_requests ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.appointment_approval_requests ADD COLUMN IF NOT EXISTS amount INTEGER;
ALTER TABLE IF EXISTS public.appointment_approval_requests ADD COLUMN IF NOT EXISTS currency TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS appointment_approval_requests_booking_ref_uidx ON public.appointment_approval_requests(booking_ref) WHERE booking_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS appointment_approval_requests_doctor_status_idx ON public.appointment_approval_requests(doctor_name, status, created_at DESC);
CREATE INDEX IF NOT EXISTS appointment_approval_requests_nurse_status_idx ON public.appointment_approval_requests(nurse_name, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.appointment_messages (
  id BIGSERIAL PRIMARY KEY,
  request_id BIGINT NOT NULL REFERENCES public.appointment_approval_requests(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL,
  sender_name TEXT,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appointment_messages_request_created_idx ON public.appointment_messages(request_id, created_at DESC);

ALTER TABLE IF EXISTS public.billing_invoices ADD COLUMN IF NOT EXISTS appointment_id BIGINT;
ALTER TABLE IF EXISTS public.billing_invoices ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Draft';
ALTER TABLE IF EXISTS public.billing_invoices ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE IF EXISTS public.billing_invoices ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE IF EXISTS public.billing_invoices ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS public.billing_invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE IF EXISTS public.billing_payments ADD COLUMN IF NOT EXISTS received_by TEXT;
ALTER TABLE IF EXISTS public.billing_payments ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_payments_invoice_idempotency
  ON public.billing_payments(invoice_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';

CREATE TABLE IF NOT EXISTS public.doctor_service_fees (
  id BIGSERIAL PRIMARY KEY,
  doctor_uuid UUID NOT NULL,
  service_key TEXT NOT NULL,
  service_name TEXT NOT NULL,
  default_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doctor_uuid, service_key)
);

CREATE TABLE IF NOT EXISTS public.billing_adjustments (
  id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES public.billing_invoices(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  reference TEXT,
  reason TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_adjustments_invoice_id ON public.billing_adjustments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_billing_adjustments_created_at ON public.billing_adjustments(created_at);

CREATE TABLE IF NOT EXISTS public.billing_hmo_claims (
  id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT UNIQUE REFERENCES public.billing_invoices(id) ON DELETE CASCADE,
  appointment_id BIGINT,
  patient_id UUID,
  patient_name TEXT,
  patient_reference TEXT,
  hmo_provider TEXT,
  hmo_loa_number TEXT,
  hmo_card_number TEXT,
  coverage_json JSONB,
  philhealth_deduction NUMERIC(12,2) NOT NULL DEFAULT 0,
  philhealth_status TEXT NOT NULL DEFAULT 'Pending Verification',
  philhealth_reference TEXT,
  philhealth_verified_by TEXT,
  philhealth_verified_at TIMESTAMPTZ,
  loa_approved_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pending',
  notes TEXT,
  requested_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS appointment_id BIGINT;
ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS patient_id UUID;
ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS patient_name TEXT;
ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS patient_reference TEXT;
ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS hmo_provider TEXT;
ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS hmo_loa_number TEXT;
ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS hmo_card_number TEXT;
ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS coverage_json JSONB;
ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS philhealth_status TEXT NOT NULL DEFAULT 'Pending Verification';
ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS philhealth_reference TEXT;
ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS philhealth_verified_by TEXT;
ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS philhealth_verified_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_billing_hmo_claims_status ON public.billing_hmo_claims(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_hmo_claims_invoice_id ON public.billing_hmo_claims(invoice_id);
CREATE INDEX IF NOT EXISTS idx_billing_hmo_claims_patient_reference ON public.billing_hmo_claims(patient_reference);
