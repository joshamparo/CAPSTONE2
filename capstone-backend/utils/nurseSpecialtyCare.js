const { SPECIALTIES } = require('./nurseScope');

// These are documentation workflows, not automated clinical decisions.
const definitions = {
  ER: ['ER Endorsement', ['Identity confirmed', 'Triage recorded', 'Receiving team identified'], ['Receiving team', 'Handoff summary']],
  OPD: ['Clinic Rooming', ['Arrival confirmed', 'Rooming completed', 'Doctor notified'], ['Room / clinic', 'Follow-up instructions']],
  PEDIA: ['Pediatric Observation', ['Guardian details reviewed', 'Current weight recorded in vitals', 'Doctor orders reviewed'], ['Guardian / relationship', 'Observation and family handoff']],
  MEDICINE: ['Bedside Rounds', ['Patient and location confirmed', 'Orders reviewed', 'Shift handover reviewed'], ['Rounds observations', 'Pending care and handoff']],
  LABORATORY: ['Specimen Handoff', ['Request and patient matched', 'Preparation checked against order', 'Specimen label checked'], ['Specimen / collection reference', 'Collection and handoff details']],
  'VIDEO CONSULTATION': ['Virtual Consult Support', ['Identity confirmed', 'Connection readiness checked', 'Doctor notified'], ['Readiness / connection issues', 'Consult follow-up and handoff']],
  ECG: ['ECG Preparation', ['Patient and ECG request matched', 'Preparation reviewed', 'Operator notified'], ['ECG request / appointment', 'Preparation and operator handoff']],
  RADIOLOGY: ['Imaging Preparation', ['Patient and exam request matched', 'Ordered preparation reviewed', 'Transport / receiving team confirmed'], ['Exam and transport details', 'Preparation and imaging handoff']],
  'PHYSICAL THERAPY': ['Therapy Coordination', ['Referral reviewed', 'Ordered restrictions reviewed', 'Therapist notified'], ['Session / referral', 'Mobility observations and therapist handoff']],
  'DENTAL CLINIC': ['Dental Assistance', ['Patient and planned visit confirmed', 'Preparation reviewed', 'Dentist notified'], ['Visit / procedure', 'Assistance and aftercare handoff']],
  'SURGERY (MINOR)': ['Minor Surgery Support', ['Planned procedure confirmed', 'Required consent documentation checked', 'Preparation reviewed against orders'], ['Procedure / preparation', 'Recovery observations and handoff']],
  ANESTHESIA: ['Anesthesia Support', ['Patient and procedure confirmed', 'Anesthesia orders reviewed', 'Receiving team confirmed'], ['Preparation observations', 'Recovery observations and handoff']],
  'OTOLARYNGOLOGY (ENT)': ['ENT Assistance', ['Patient and visit confirmed', 'Ordered preparation reviewed', 'ENT doctor notified'], ['Visit / procedure', 'Assistance and follow-up handoff']],
  PATHOLOGY: ['Pathology Specimen Handoff', ['Request and patient matched', 'Specimen identification checked', 'Receiving service confirmed'], ['Specimen / container reference', 'Handoff and pending result details']],
  ORTHOPEDICS: ['Orthopedic Nursing', ['Doctor orders reviewed', 'Mobility restrictions reviewed', 'Assistance needs reviewed'], ['Mobility and support observations', 'Rehabilitation coordination and handoff']]
};
const CARE_CONFIG = Object.fromEntries(Object.entries(definitions).map(([department, [title, checks, fields]]) => [department, {
  department, title, checks, fields, stages: ['Preparation', 'In progress', 'Handed off', 'Completed', 'Cancelled']
}]));

function validateCare(body, config, current) {
  if (!config) return 'Unknown nurse specialization.';
  if (!config.stages.includes(body.stage)) return 'Select a valid workflow stage.';
  if (!Array.isArray(body.checks) || body.checks.length !== config.checks.length || body.checks.some(v => typeof v !== 'boolean')) return 'Complete the preparation checklist.';
  if (!Array.isArray(body.notes) || body.notes.length !== config.fields.length || body.notes.some(v => typeof v !== 'string' || v.length > 2000)) return 'Each documentation field must be at most 2,000 characters.';
  if (body.handoffTo != null && (typeof body.handoffTo !== 'string' || body.handoffTo.length > 120)) return 'Receiving team must be text of at most 120 characters.';
  if (['Completed', 'Cancelled'].includes(current?.stage)) return 'Completed or cancelled records are read-only. Start a new care episode.';
  if (body.stage === 'Cancelled') return current && body.notes.some(v => v.trim()) ? '' : 'Record a cancellation reason in the notes of an existing episode.';
  const next = config.stages.indexOf(body.stage);
  const previous = current ? config.stages.indexOf(current.stage) : 0;
  if (next < previous || next > previous + 1) return 'Save each workflow stage in order.';
  if (next > 0 && body.checks.some(v => !v)) return 'Confirm all preparation checks before advancing.';
  if (next >= 2 && (!String(body.handoffTo || '').trim() || !body.notes.every(v => v.trim()))) return 'Record the receiving team and handoff documentation.';
  if (String(body.handoffTo || '').length > 120) return 'Receiving team must be at most 120 characters.';
  return '';
}
module.exports = { CARE_CONFIG, validateCare, DEPARTMENTS: Object.keys(SPECIALTIES) };
