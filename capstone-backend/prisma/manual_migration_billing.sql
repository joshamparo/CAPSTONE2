-- Billing: invoices + payments
-- Run this in Supabase SQL editor (or via a manual runner) before using the billing modules.

CREATE TABLE IF NOT EXISTS public.billing_invoices (
  id bigserial PRIMARY KEY,
  patient_id uuid NULL REFERENCES public.patients(id) ON DELETE SET NULL,
  appointment_id bigint NULL REFERENCES public.appointments(id) ON DELETE SET NULL,
  status text NULL DEFAULT 'Draft',
  notes text NULL,
  created_by text NULL,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_invoices_patient_id_idx ON public.billing_invoices(patient_id);
CREATE INDEX IF NOT EXISTS billing_invoices_status_idx ON public.billing_invoices(status);
CREATE INDEX IF NOT EXISTS billing_invoices_created_at_idx ON public.billing_invoices(created_at);

CREATE TABLE IF NOT EXISTS public.billing_invoice_items (
  id bigserial PRIMARY KEY,
  invoice_id bigint NOT NULL REFERENCES public.billing_invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity int NOT NULL DEFAULT 1,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  line_total numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_invoice_items_invoice_id_idx ON public.billing_invoice_items(invoice_id);

CREATE TABLE IF NOT EXISTS public.billing_payments (
  id bigserial PRIMARY KEY,
  invoice_id bigint NOT NULL REFERENCES public.billing_invoices(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  method text NULL,
  reference text NULL,
  received_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_payments_invoice_id_idx ON public.billing_payments(invoice_id);
CREATE INDEX IF NOT EXISTS billing_payments_created_at_idx ON public.billing_payments(created_at);

