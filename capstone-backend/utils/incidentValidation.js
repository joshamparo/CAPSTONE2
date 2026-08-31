const INCIDENT_TYPES = new Set(['Fall', 'Medication', 'Equipment', 'Harassment', 'Other']);
const SEVERITIES = new Set(['Low', 'Moderate', 'High', 'Critical']);
const FOLLOW_UP_STATUSES = new Set(['For Review', 'Escalated', 'Monitoring', 'Closed']);

function validateIncident(input = {}) {
  const clean = (value, max) => String(value || '').trim().slice(0, max);
  const incidentDate = clean(input.incident_date, 10);
  const incidentTime = clean(input.incident_time, 8);
  const incidentType = clean(input.incident_type, 80);
  const severity = clean(input.severity || 'Moderate', 30);
  const location = clean(input.location, 160);
  const description = clean(input.description, 4000);
  const actionTaken = clean(input.action_taken, 4000);
  const escalatedTo = clean(input.escalated_to, 160) || null;
  const patientName = clean(input.patient_name, 200) || null;
  const followUpStatus = clean(input.follow_up_status || 'For Review', 40);
  const patientId = clean(input.patient_id, 80) || null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(incidentDate) || Number.isNaN(new Date(`${incidentDate}T00:00:00Z`).getTime())) return { error: 'A valid incident date is required.' };
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(incidentTime)) return { error: 'A valid incident time is required.' };
  if (!INCIDENT_TYPES.has(incidentType)) return { error: 'Select a valid incident type.' };
  if (!SEVERITIES.has(severity)) return { error: 'Select a valid severity.' };
  if (!FOLLOW_UP_STATUSES.has(followUpStatus)) return { error: 'Select a valid follow-up status.' };
  if (location.length < 2) return { error: 'Incident location is required.' };
  if (description.length < 10) return { error: 'Incident description must contain at least 10 characters.' };
  if (actionTaken.length < 3) return { error: 'Immediate action taken is required.' };
  if (patientId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(patientId)) return { error: 'Selected patient is invalid.' };

  return { value: { incidentDate, incidentTime, incidentType, severity, location, description, actionTaken, escalatedTo, patientId, patientName, followUpStatus } };
}

module.exports = { validateIncident };
