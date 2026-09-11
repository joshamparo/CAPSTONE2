const { normalizeNurseDepartment } = require('../middleware/requireNurseDepartment');

const SPECIALTIES = Object.freeze({
  ER: ['ER', 'Emergency', 'Emergency Room', 'Emergency Medicine', 'Emergency Nursing'], OPD: ['OPD', 'Outpatient'],
  PEDIA: ['PEDIA', 'Pediatrics'], MEDICINE: ['Medicine', 'Internal Medicine'],
  LABORATORY: ['Laboratory'], PATHOLOGY: ['Pathology'], ECG: ['ECG', 'Cardiology'],
  RADIOLOGY: ['Radiology'], 'PHYSICAL THERAPY': ['Physical Therapy', 'Rehabilitation Medicine'],
  'DENTAL CLINIC': ['Dental Clinic', 'Dental Medicine'],
  'SURGERY (MINOR)': ['Surgery (Minor)', 'Minor Surgery', 'Surgery'],
  ANESTHESIA: ['Anesthesia', 'Anesthesiology'],
  'OTOLARYNGOLOGY (ENT)': ['Otolaryngology (ENT)', 'Otolaryngology', 'ENT'],
  ORTHOPEDICS: ['Orthopedics'], 'VIDEO CONSULTATION': ['Video Consultation']
});
const clinicalRoles = { LABORATORY: 'medtech', RADIOLOGY: 'radiographer', ECG: 'ecg_operator', 'PHYSICAL THERAPY': 'physical_therapist' };
const noPatients = () => ({ id: { in: [] } });
const canManageWard = (department) => ['ER', 'MEDICINE'].includes(normalizeNurseDepartment(department));

async function nurseAppointmentScope(db, department) {
  const dept = normalizeNurseDepartment(department);
  const aliases = SPECIALTIES[dept];
  if (!aliases) return { id: { in: [] } };
  if (dept === 'VIDEO CONSULTATION') return { consultation_mode: 'video' };
  const doctors = await db.doctors.findMany({
    where: { OR: aliases.map(value => ({ specialization: { equals: value, mode: 'insensitive' } })) },
    select: { id: true }
  });
  const reasons = aliases.flatMap(value => [
    { reason: { startsWith: `[APPOINTMENT][CLINIC] ${value}:`, mode: 'insensitive' } },
    { reason: { equals: value, mode: 'insensitive' } }
  ]);
  if (dept === 'ER') reasons.push(
    { reason: { startsWith: '[TRIAGE] ER Consultation:', mode: 'insensitive' } },
    { reason: { startsWith: '[TRIAGE][WALK-IN] ER Consultation', mode: 'insensitive' } }
  );
  return { AND: [{ OR: [{ consultation_mode: 'onsite' }, { consultation_mode: null }] },
    { OR: [{ doctor_uuid: { in: doctors.map(row => row.id) } }, ...reasons] }] };
}

// Scope by recorded assignments, never age, diagnosis guesses, or partial service names.
async function resolveNursePatientScope(db, department, email = '') {
  const dept = normalizeNurseDepartment(department);
  if (!SPECIALTIES[dept]) return noPatients();
  const storageReady = await require('./nurseCareStorage').ensureNurseCareTable()
    .then(() => true)
    .catch((error) => {
      console.warn('[Nurse scope] Specialty history is unavailable; continuing with operational records:', error?.message || error);
      return false;
    });
  const historyPatients = storageReady
    ? await db.$queryRaw`SELECT patient_id AS id FROM public.nurse_patient_departments WHERE department = ${dept}
        UNION SELECT patient_id AS id FROM public.nurse_specialty_care WHERE department = ${dept}`.catch(() => [])
    : [];
  const appointmentScope = await nurseAppointmentScope(db, dept);
  const appointments = await db.appointments.findMany({
    where: { AND: [appointmentScope, { patient_id: { not: null } }] }, select: { patient_id: true }
  });
  const scopes = [{ id: { in: [...new Set(appointments.map(row => row.patient_id).filter(Boolean))] } }];
  if (dept === 'ER') {
    const receptionAppointments = await db.appointments.findMany({ where: { reason: { startsWith: '[APPOINTMENT][CLINIC]' }, patient_id: { not: null } }, select: { patient_id: true } });
    scopes.push({ id: { in: receptionAppointments.map(row => row.patient_id) } });
    // Compatibility for records created before explicit intake/history links
    // existed. Keep the match limited to established ER statuses and ER room
    // codes so unrelated outpatient and specialty records remain excluded.
    scopes.push(
      { admission_status: { in: ['Emergency', 'ER Observation', 'Pending Admission', 'Admission Requested'] } },
      { AND: [
        { ward_number: { startsWith: 'E', mode: 'insensitive' } },
        { admission_status: { in: ['Emergency', 'ER Observation', 'Pending Admission', 'Admission Requested', 'Inpatient', 'Admitted'] } }
      ] }
    );
  }
  scopes.push({ id: { in: historyPatients.map(row => row.id) } });
  const intakeTypes = dept === 'ER' ? ['er_consult', 'onsite_consult', 'lab', 'imaging', 'pharmacy', 'admission_eval']
    : dept === 'LABORATORY' ? ['lab'] : [];
  const intakePatients = await db.$queryRaw`
    SELECT id FROM public.patients p WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.clinical_records->'walkInIntakes') = 'array'
        THEN p.clinical_records->'walkInIntakes' ELSE '[]'::jsonb END) intake
      WHERE lower(intake->>'type') IN (SELECT jsonb_array_elements_text(${JSON.stringify(intakeTypes)}::jsonb))
        OR lower(trim(intake->>'specialization')) IN (SELECT jsonb_array_elements_text(${JSON.stringify(SPECIALTIES[dept].map(v => v.toLowerCase()))}::jsonb))
    )`;
  scopes.push({ id: { in: intakePatients.map(row => row.id) } });
  const services = SPECIALTIES[dept].map(value => ({ service: { equals: value, mode: 'insensitive' } }));
  if (clinicalRoles[dept]) services.push({ assigned_role: clinicalRoles[dept] });
  if (email) services.push({ assigned_role: 'nurse', assigned_to: { equals: email, mode: 'insensitive' } });
  scopes.push({ clinical_orders: { some: { OR: services } } });
  const wardPrefixes = { ER: ['ER-'], PEDIA: ['PD-'], MEDICINE: ['GW-', 'ICU-'] };
  const wardNames = { ER: ['Emergency'], PEDIA: ['Pediatrics'], MEDICINE: ['General Ward', 'ICU'], ORTHOPEDICS: ['Orthopedics'] };
  const registryTable = wardNames[dept] ? await db.$queryRaw`SELECT to_regclass('public.ward_rooms')::text AS name` : [];
  if (registryTable[0]?.name) {
    const wardPatients = await db.$queryRaw`SELECT p.id FROM public.patients p
      JOIN public.ward_rooms room ON lower(trim(room.room_code)) = lower(trim(p.ward_number))
      WHERE lower(room.ward_name) IN (SELECT jsonb_array_elements_text(${JSON.stringify(wardNames[dept].map(v => v.toLowerCase()))}::jsonb))
        AND lower(p.admission_status) IN ('inpatient', 'admitted', 'emergency', 'er observation')`;
    scopes.push({ id: { in: wardPatients.map(row => row.id) } });
  } else if (wardPrefixes[dept]) scopes.push({ AND: [
    { admission_status: { in: ['Inpatient', 'Admitted', 'Emergency', 'ER Observation'] } },
    { OR: wardPrefixes[dept].map(prefix => ({ ward_number: { startsWith: prefix, mode: 'insensitive' } })) }
  ] });
  if (canManageWard(dept)) scopes.push({ admission_status: { in: ['Pending Admission', 'Admission Requested'] } });
  if (dept === 'ER') scopes.push({ admission_status: { equals: 'Emergency', mode: 'insensitive' } });
  return { OR: scopes };
}

module.exports = { SPECIALTIES, canManageWard, nurseAppointmentScope, resolveNursePatientScope };
