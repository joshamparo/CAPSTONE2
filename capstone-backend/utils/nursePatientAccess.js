const CLINICAL_DEPARTMENT_ROLES = {
  LABORATORY: 'medtech',
  RADIOLOGY: 'radiographer',
  ECG: 'ecg_operator',
  'PHYSICAL THERAPY': 'physical_therapist'
};

function isCentralIntakeRequest(method, path) {
  if (String(method || '').trim().toUpperCase() !== 'POST') return false;
  return ['/walk-in-intake', '/er-registration'].includes(String(path || '').trim().toLowerCase());
}

function nursePatientScope(department, now = new Date()) {
  const dept = String(department || '').trim().toUpperCase();
  if (dept === 'ER') return {
    OR: [
      { admission_status: { equals: 'Emergency', mode: 'insensitive' } },
      { admission_status: { equals: 'Pending Admission', mode: 'insensitive' } },
      { ward_number: { startsWith: 'E', mode: 'insensitive' } }
    ]
  };
  if (dept === 'OPD') return { admission_status: { equals: 'Outpatient', mode: 'insensitive' } };
  if (dept === 'PEDIA') {
    const adultCutoff = new Date(now);
    adultCutoff.setUTCFullYear(adultCutoff.getUTCFullYear() - 18);
    return { OR: [{ ward_number: { startsWith: 'P', mode: 'insensitive' } }, { date_of_birth: { gt: adultCutoff } }] };
  }
  if (dept === 'MEDICINE') return { OR: [{ admission_status: { equals: 'Inpatient', mode: 'insensitive' } }, { ward_number: { startsWith: 'M', mode: 'insensitive' } }] };
  const assignedRole = CLINICAL_DEPARTMENT_ROLES[dept];
  if (assignedRole) return { clinical_orders: { some: { assigned_role: assignedRole } } };
  return { id: '__no_department_patient_match__' };
}

module.exports = { nursePatientScope, CLINICAL_DEPARTMENT_ROLES, isCentralIntakeRequest };
