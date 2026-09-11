const compact = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const REVIEWER_TERMS = Object.freeze({
  medtech: ['pathology', 'pathologist', 'laboratorymedicine'],
  lab_technician: ['pathology', 'pathologist', 'laboratorymedicine'],
  laboratory_technician: ['pathology', 'pathologist', 'laboratorymedicine'],
  radiographer: ['radiology', 'radiologist'],
  imaging_technician: ['radiology', 'radiologist'],
  ecg_operator: ['ecg', 'cardiology', 'cardiologist'],
  physical_therapist: ['rehabilitationmedicine', 'physiatry', 'physiatrist', 'orthopedics']
});

function canDoctorReviewOrder(doctor, order) {
  const identity = [doctor?.specialization, doctor?.department].map(compact).filter(Boolean);
  const role = String(order?.assigned_role || order?.assignedRole || '').trim().toLowerCase();
  let terms = REVIEWER_TERMS[role] || [];
  if (!terms.length) {
    const service = compact(`${order?.kind || ''} ${order?.service || ''}`);
    if (/radiolog|imaging|xray|ultrasound|ctscan|mri/.test(service)) terms = REVIEWER_TERMS.radiographer;
    else if (/ecg|electrocardio/.test(service)) terms = REVIEWER_TERMS.ecg_operator;
    else if (/physicaltherapy|rehab/.test(service)) terms = REVIEWER_TERMS.physical_therapist;
    else if (/lab|blood|urinal|specimen|patholog/.test(service)) terms = REVIEWER_TERMS.medtech;
  }
  return identity.some(value => terms.some(term => value.includes(term) || term.includes(value)));
}

module.exports = { canDoctorReviewOrder };
