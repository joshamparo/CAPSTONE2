const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPdfPayload,
  completenessFlags,
  expectedCategory,
  parseOutput
} = require('../utils/labAiVerification');

test('buildPdfPayload sends a private scanned PDF directly to the Responses API', () => {
  const payload = buildPdfPayload({
    model: 'test-model',
    buffer: Buffer.from('sample-pdf'),
    filename: 'CBC Result.pdf',
    expectedPatientName: 'Sample Patient',
    expectedPatientDob: '2000-01-02',
    expectedType: 'laboratory: Complete Blood Count'
  });

  assert.equal(payload.store, false);
  assert.equal(payload.model, 'test-model');
  const content = payload.input[0].content;
  assert.equal(content[1].type, 'input_file');
  assert.equal(content[1].filename, 'CBC Result.pdf');
  assert.equal(Buffer.from(content[1].file_data, 'base64').toString(), 'sample-pdf');
  assert.match(content[0].text, /Sample Patient/);
  assert.match(content[0].text, /Complete Blood Count/);
});

test('blank laboratory forms are sent to manual review', () => {
  const checked = completenessFlags({
    score: 82,
    patientMatch: null,
    flags: [],
    manualReviewRequired: false,
    extractedFields: {
      hasPatientIdentity: false,
      hasResultContent: false,
      hasAuthorizedSignoff: false
    }
  }, 'laboratory: CBC');

  assert.deepEqual(checked.flags, [
    'missing_patient_identity',
    'missing_result_content',
    'missing_authorized_signoff',
    'manual_review_required'
  ]);
});

test('radiology and ECG use form-specific completeness checks', () => {
  const imaging = completenessFlags({
    score: 90,
    flags: [],
    extractedFields: { hasFindings: false, hasImpression: false }
  }, 'radiology: chest x-ray');
  assert.equal(expectedCategory('Radiology result'), 'imaging');
  assert.ok(imaging.flags.includes('missing_findings'));
  assert.ok(imaging.flags.includes('missing_impression'));
  assert.ok(imaging.flags.includes('manual_review_required'));

  const ecg = completenessFlags({
    score: 90,
    flags: [],
    extractedFields: { hasEcgTracing: false }
  }, 'ECG result');
  assert.ok(ecg.flags.includes('missing_ecg_tracing'));
  assert.ok(ecg.flags.includes('manual_review_required'));
});

test('parseOutput accepts fenced JSON returned by a model', () => {
  assert.deepEqual(parseOutput({ output_text: '```json\n{"score":74,"flags":[]}\n```' }), {
    score: 74,
    flags: []
  });
});
