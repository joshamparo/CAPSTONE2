-- Manual migration: Suppliers + Purchase Orders (Bulk Supplier Orders)
-- Apply to the same Postgres database used by Prisma (schema "public").

CREATE TABLE IF NOT EXISTS public.suppliers (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  contact     TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id            BIGSERIAL PRIMARY KEY,
  status        TEXT NOT NULL DEFAULT 'Pending',
  supplier_id   BIGINT REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT,
  created_by    TEXT,
  received_by   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  received_at   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id                BIGSERIAL PRIMARY KEY,
  purchase_order_id BIGINT NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  item_type         TEXT NOT NULL,
  item_id           BIGINT NOT NULL,
  packs             INT DEFAULT 0,
  pack_size         INT DEFAULT 0,
  total_units       INT NOT NULL DEFAULT 0,
  unit_cost         DECIMAL,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS purchase_order_items_po_id_idx ON public.purchase_order_items(purchase_order_id);

-- Seed a safe default supplier option.
INSERT INTO public.suppliers(name)
VALUES ('Walk-in / Unknown')
ON CONFLICT (name) DO NOTHING;

