ALTER TABLE public.clinical_orders
ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS acknowledged_by TEXT;
