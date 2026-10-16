ALTER TABLE public.assistant_knowledge_entries
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS module text,
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;

CREATE INDEX IF NOT EXISTS assistant_knowledge_status_module_idx
  ON public.assistant_knowledge_entries (status, module, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.assistant_feedback (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  knowledge_key text,
  role text NOT NULL,
  module text,
  source text NOT NULL,
  rating text NOT NULL CHECK (rating IN ('helpful', 'not_helpful')),
  reason text CHECK (reason IS NULL OR reason IN ('outdated', 'wrong_language', 'did_not_answer', 'other')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_feedback_created_idx
  ON public.assistant_feedback (created_at DESC);

CREATE INDEX IF NOT EXISTS assistant_feedback_knowledge_idx
  ON public.assistant_feedback (knowledge_key, created_at DESC);
