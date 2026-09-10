const prisma = require('./prisma');
let ready;
function ensureNurseCareTable() {
  if (!ready) ready = (async () => {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS public.nurse_specialty_care (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES public.patients(id),
      department text NOT NULL, stage text NOT NULL CHECK (stage IN ('Preparation', 'In progress', 'Handed off', 'Completed', 'Cancelled')), checks jsonb NOT NULL, notes jsonb NOT NULL,
      handoff_to text NOT NULL DEFAULT '', order_id bigint REFERENCES public.clinical_orders(id),
      version integer NOT NULL DEFAULT 1, history jsonb NOT NULL DEFAULT '[]',
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS nurse_specialty_care_patient_idx ON public.nurse_specialty_care (patient_id, created_at DESC)');
    await prisma.$executeRawUnsafe("CREATE UNIQUE INDEX IF NOT EXISTS nurse_specialty_care_active_idx ON public.nurse_specialty_care (patient_id, department) WHERE stage NOT IN ('Completed', 'Cancelled')");
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS public.nurse_patient_departments (
      patient_id uuid NOT NULL REFERENCES public.patients(id), department text NOT NULL,
      assigned_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (patient_id, department)
    )`);
    await prisma.$executeRawUnsafe('ALTER TABLE public.nurse_specialty_care ENABLE ROW LEVEL SECURITY');
    await prisma.$executeRawUnsafe('ALTER TABLE public.nurse_patient_departments ENABLE ROW LEVEL SECURITY');
  })().catch(error => { ready = null; throw error; });
  return ready;
}
module.exports = { ensureNurseCareTable };
