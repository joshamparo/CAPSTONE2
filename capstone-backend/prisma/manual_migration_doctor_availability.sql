-- Availability schema used by nurse consultation intake and doctor scheduling.
-- Installed at process startup so live intake requests never execute DDL.

CREATE TABLE IF NOT EXISTS public.doctor_availability_rules (
  id bigserial PRIMARY KEY,
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'onsite',
  day_of_week integer NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  slot_minutes integer NOT NULL DEFAULT 30,
  max_per_slot integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.doctor_availability_exceptions (
  id bigserial PRIMARY KEY,
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'onsite',
  date date NOT NULL,
  start_time time NULL,
  end_time time NULL,
  kind text NOT NULL DEFAULT 'block',
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.doctor_availability_date_windows (
  id bigserial PRIMARY KEY,
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'onsite',
  date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  slot_minutes integer NOT NULL DEFAULT 30,
  max_per_slot integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.doctor_availability_day_offs (
  id bigserial PRIMARY KEY,
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'onsite',
  day_of_week integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doctor_id, mode, day_of_week)
);

CREATE INDEX IF NOT EXISTS doctor_availability_rules_doc_dow_idx
  ON public.doctor_availability_rules(doctor_id, day_of_week);
CREATE INDEX IF NOT EXISTS doctor_availability_exceptions_doc_date_idx
  ON public.doctor_availability_exceptions(doctor_id, date);
CREATE INDEX IF NOT EXISTS doctor_availability_day_offs_doc_dow_idx
  ON public.doctor_availability_day_offs(doctor_id, day_of_week);
CREATE INDEX IF NOT EXISTS doctor_availability_date_windows_doc_date_idx
  ON public.doctor_availability_date_windows(doctor_id, date);
