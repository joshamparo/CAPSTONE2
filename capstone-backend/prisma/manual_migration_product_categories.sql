-- Product Categories + product images (Medicines + Supplies)
-- Run this in Supabase SQL editor (or via a manual runner) before using category/image features in POS.

CREATE TABLE IF NOT EXISTS public.product_categories (
  id bigserial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  image_url text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.medicines
  ADD COLUMN IF NOT EXISTS category_id bigint NULL REFERENCES public.product_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS image_url text NULL;

ALTER TABLE public.supplies
  ADD COLUMN IF NOT EXISTS category_id bigint NULL REFERENCES public.product_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS image_url text NULL;

CREATE INDEX IF NOT EXISTS medicines_category_id_idx ON public.medicines(category_id);
CREATE INDEX IF NOT EXISTS supplies_category_id_idx ON public.supplies(category_id);

-- Backfill categories from existing medicine.category values
INSERT INTO public.product_categories(name)
SELECT DISTINCT TRIM(category) AS name
FROM public.medicines
WHERE category IS NOT NULL AND TRIM(category) <> ''
ON CONFLICT (name) DO NOTHING;

-- Ensure defaults exist
INSERT INTO public.product_categories(name)
VALUES ('Medical Supplies'), ('Uncategorized')
ON CONFLICT (name) DO NOTHING;

-- Map medicines.category -> medicines.category_id
UPDATE public.medicines m
SET category_id = c.id
FROM public.product_categories c
WHERE m.category_id IS NULL
  AND m.category IS NOT NULL
  AND TRIM(m.category) <> ''
  AND c.name = TRIM(m.category);

-- Default supplies to Medical Supplies if not set
UPDATE public.supplies s
SET category_id = c.id
FROM public.product_categories c
WHERE s.category_id IS NULL
  AND c.name = 'Medical Supplies';

