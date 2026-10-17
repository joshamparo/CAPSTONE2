-- Schema used by the pharmacy POS checkout path. Applying this at deploy time
-- avoids lock-heavy ALTER TABLE statements during a live checkout.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS patient_id uuid NULL,
  ADD COLUMN IF NOT EXISTS invoice_id bigint NULL;

CREATE INDEX IF NOT EXISTS sales_patient_id_idx ON public.sales(patient_id);
CREATE INDEX IF NOT EXISTS sales_invoice_id_idx ON public.sales(invoice_id);
