'use strict';

const PURPOSE_MAX = 200;
const CLINICAL_TEXT_MAX = 2000;

function dateKeyInManila(now = new Date()) {
  const manila = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  return `${manila.getUTCFullYear()}-${String(manila.getUTCMonth() + 1).padStart(2, '0')}-${String(manila.getUTCDate()).padStart(2, '0')}`;
}

function normalizeMedicalCertificateInput(input = {}, now = new Date()) {
  const patientId = String(input.patientId || '').trim();
  const purpose = String(input.purpose || '').trim();
  const diagnosis = String(input.diagnosis || '').trim();
  const recommendations = String(input.recommendations || '').trim();
  const validUntil = String(input.validUntil || '').trim();

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(patientId)) {
    return { ok: false, message: 'Select a valid patient first.' };
  }
  if (!purpose) return { ok: false, message: 'Purpose is required.' };
  if (purpose.length > PURPOSE_MAX) return { ok: false, message: `Purpose must be ${PURPOSE_MAX} characters or fewer.` };
  if (diagnosis.length > CLINICAL_TEXT_MAX) return { ok: false, message: `Diagnosis / Findings must be ${CLINICAL_TEXT_MAX} characters or fewer.` };
  if (recommendations.length > CLINICAL_TEXT_MAX) return { ok: false, message: `Recommendations must be ${CLINICAL_TEXT_MAX} characters or fewer.` };

  if (validUntil) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return { ok: false, message: 'Enter a valid expiration date.' };
    const parsed = new Date(`${validUntil}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== validUntil) {
      return { ok: false, message: 'Enter a valid expiration date.' };
    }
    if (validUntil < dateKeyInManila(now)) return { ok: false, message: 'Valid Until cannot be earlier than today.' };
  }

  return {
    ok: true,
    value: {
      patientId,
      purpose,
      diagnosis: diagnosis || null,
      recommendations: recommendations || null,
      validUntil: validUntil || null
    }
  };
}

module.exports = { normalizeMedicalCertificateInput };
