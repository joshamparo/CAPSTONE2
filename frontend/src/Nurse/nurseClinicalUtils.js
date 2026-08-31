const firstRecordedValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

export const getLatestRecordedVitals = (patient = {}) => {
  const logs = patient?.clinical_records?.vitals_logs;
  if (Array.isArray(logs) && logs.length > 0) return logs[0] || {};
  return patient?.vitals || patient?.clinical_records?.erRegistration?.vitals || {};
};

const toNumber = (value) => {
  const parsed = Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

export const buildPatientWatchEntry = (patient = {}) => {
  const vitals = getLatestRecordedVitals(patient);
  const bloodPressure = firstRecordedValue(vitals.blood_pressure, vitals.bloodPressure);
  const heartRate = firstRecordedValue(vitals.heart_rate, vitals.heartRate);
  const oxygen = firstRecordedValue(vitals.spo2, vitals.oxygen_saturation, vitals.oxygenSaturation);
  const temperature = firstRecordedValue(vitals.temperature, vitals.temp);
  const systolic = toNumber(String(bloodPressure || '').split('/')[0]);
  const heartRateNumber = toNumber(heartRate);
  const oxygenNumber = toNumber(oxygen);
  const temperatureNumber = toNumber(temperature);
  const triageLevel = toNumber(firstRecordedValue(
    patient.triage_level,
    patient.triageLevel,
    patient?.clinical_records?.erRegistration?.triage?.level
  ));

  const reasons = [];
  if (triageLevel !== null && triageLevel <= 2) reasons.push(`Triage level ${triageLevel}`);
  if (systolic !== null && (systolic >= 180 || systolic <= 90)) reasons.push(`BP ${bloodPressure}`);
  if (heartRateNumber !== null && (heartRateNumber >= 120 || heartRateNumber <= 50)) reasons.push(`HR ${heartRate}`);
  if (oxygenNumber !== null && oxygenNumber <= 92) reasons.push(`SpO2 ${oxygen}%`);
  if (temperatureNumber !== null && temperatureNumber >= 39) reasons.push(`Temperature ${temperature}°C`);
  if (reasons.length === 0) return null;

  const firstName = patient.firstName || patient.first_name || '';
  const lastName = patient.lastName || patient.last_name || '';
  const ward = patient.wardNumber || patient.ward_number || '';
  return {
    id: patient._id || patient.id,
    name: `${firstName} ${lastName}`.trim() || 'Unknown patient',
    room: ward ? `Ward ${ward}` : 'Unassigned',
    bp: bloodPressure || '—',
    hr: heartRate !== undefined && heartRate !== null && heartRate !== '' ? String(heartRate) : '—',
    spo2: oxygen !== undefined && oxygen !== null && oxygen !== '' ? String(oxygen) : '—',
    status: triageLevel === 1 || (oxygenNumber !== null && oxygenNumber <= 90) ? 'critical' : 'watch',
    trend: 'recorded',
    triageLevel,
    reason: reasons.join(', ')
  };
};

export const buildPatientWatchlist = (patients = []) => (
  (Array.isArray(patients) ? patients : [])
    .map(buildPatientWatchEntry)
    .filter(Boolean)
);
