const BASE_FIELDS = {
  patientName: null,
  patientDob: null,
  facilityName: null,
  resultDate: null,
  doctorName: null,
  testNames: null,
  hasPatientIdentity: null,
  hasResultContent: null,
  hasAuthorizedSignoff: null,
  hasFindings: null,
  hasImpression: null,
  hasEcgTracing: null
};

function expectedCategory(value) {
  const raw = String(value || '').toLowerCase();
  if (/ecg|ekg|electrocardio/.test(raw)) return 'ecg';
  if (/imag|radiolog|x[ -]?ray/.test(raw)) return 'imaging';
  return 'laboratory';
}

function verificationPrompt() {
  return [
    'Review this medical test result document only for routing, identity matching, and document completeness.',
    'Do not diagnose, recommend treatment, or decide whether a medical value is clinically normal.',
    'A blank template, request form, or document without actual results is incomplete.',
    'For laboratory results, identify whether actual result values and an authorized signoff are present.',
    'For ECG, identify whether a tracing or waveform, interpretation, and authorized signoff are present.',
    'For radiology or imaging, identify whether findings, impression, and an authorized signoff are present.',
    'Treat unclear handwriting, scans, identity, signatures, or document type as requiring human review.',
    'Return strict JSON only with this shape:',
    '{"score":number,"patientMatch":boolean|null,"flags":string[],"documentType":string|null,"manualReviewRequired":boolean,"extractedFields":{"patientName":string|null,"patientDob":string|null,"facilityName":string|null,"resultDate":string|null,"doctorName":string|null,"testNames":string[]|null,"hasPatientIdentity":boolean|null,"hasResultContent":boolean|null,"hasAuthorizedSignoff":boolean|null,"hasFindings":boolean|null,"hasImpression":boolean|null,"hasEcgTracing":boolean|null}}'
  ].join(' ');
}

function parseOutput(json) {
  const raw = json?.output_text || (Array.isArray(json?.output)
    ? json.output.flatMap((item) => item?.content || []).map((part) => part?.text).filter(Boolean).join('\n')
    : '');
  if (!raw) return null;
  const clean = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(clean); } catch (_) { return null; }
}

function normalizeAiResult(value) {
  if (!value || typeof value !== 'object') return null;
  const score = Math.max(0, Math.min(100, Math.round(Number(value.score) || 0)));
  const flags = Array.isArray(value.flags) ? value.flags.map((flag) => String(flag || '').trim()).filter(Boolean).slice(0, 30) : [];
  const fields = value.extractedFields && typeof value.extractedFields === 'object' ? value.extractedFields : {};
  return {
    score,
    patientMatch: typeof value.patientMatch === 'boolean' ? value.patientMatch : null,
    flags,
    documentType: value.documentType == null ? null : String(value.documentType).slice(0, 120),
    manualReviewRequired: value.manualReviewRequired === true,
    extractedFields: { ...BASE_FIELDS, ...fields }
  };
}

function completenessFlags(ai, expectedType) {
  const normalized = normalizeAiResult(ai);
  if (!normalized) return { score: 0, flags: ['ai_invalid_response', 'manual_review_required'], extractedFields: { ...BASE_FIELDS } };
  const fields = normalized.extractedFields;
  const flags = [...normalized.flags];
  if (normalized.patientMatch === false) flags.push('patient_mismatch', 'manual_review_required');
  if (fields.hasPatientIdentity === false) flags.push('missing_patient_identity');
  if (fields.hasResultContent === false) flags.push('missing_result_content');
  if (fields.hasAuthorizedSignoff === false) flags.push('missing_authorized_signoff');
  const category = expectedCategory(expectedType);
  if (category === 'ecg' && fields.hasEcgTracing === false) flags.push('missing_ecg_tracing');
  if (category === 'imaging' && fields.hasFindings === false) flags.push('missing_findings');
  if (category === 'imaging' && fields.hasImpression === false) flags.push('missing_impression');
  if (normalized.manualReviewRequired || flags.some((flag) => /^missing_|mismatch|unclear|unreadable/i.test(flag))) flags.push('manual_review_required');
  return { ...normalized, flags: [...new Set(flags)] };
}

function buildPdfPayload({ model, buffer, filename, expectedPatientName, expectedPatientDob, expectedType }) {
  return {
    model,
    store: false,
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: JSON.stringify({ instructions: verificationPrompt(), expected: { patientName: expectedPatientName || null, patientDob: expectedPatientDob || null, resultType: expectedType || null } }) },
        { type: 'input_file', filename: String(filename || 'medical-result.pdf').slice(0, 180), file_data: buffer.toString('base64') }
      ]
    }]
  };
}

module.exports = { verificationPrompt, parseOutput, normalizeAiResult, completenessFlags, buildPdfPayload, expectedCategory };
