CREATE TABLE IF NOT EXISTS public.assistant_knowledge_entries (
  id uuid PRIMARY KEY,
  key text NOT NULL UNIQUE,
  type text NOT NULL CHECK (type IN ('service', 'faq', 'contact', 'schedule', 'workflow')),
  title text NOT NULL,
  answer_en text NOT NULL,
  answer_tl text NOT NULL DEFAULT '',
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  audience_roles jsonb NOT NULL DEFAULT '["public"]'::jsonb,
  department text,
  price_php numeric(12,2),
  notes text,
  active boolean NOT NULL DEFAULT true,
  effective_from timestamptz,
  expires_at timestamptz,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(keywords) = 'array'),
  CHECK (jsonb_typeof(audience_roles) = 'array'),
  CHECK (price_php IS NULL OR price_php >= 0),
  CHECK (expires_at IS NULL OR effective_from IS NULL OR expires_at > effective_from)
);

CREATE INDEX IF NOT EXISTS assistant_knowledge_active_idx
  ON public.assistant_knowledge_entries (active, updated_at DESC);

CREATE INDEX IF NOT EXISTS assistant_knowledge_type_idx
  ON public.assistant_knowledge_entries (type);

CREATE TABLE IF NOT EXISTS public.assistant_knowledge_history (
  id uuid PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES public.assistant_knowledge_entries(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('create', 'update', 'activate', 'deactivate')),
  snapshot jsonb NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_knowledge_history_entry_idx
  ON public.assistant_knowledge_history (entry_id, changed_at DESC);
