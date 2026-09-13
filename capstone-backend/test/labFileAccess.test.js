const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('path');
process.env.SESSION_SECRET = 'lab-file-test-secret';
const { createSessionToken } = require('../utils/sessionToken');
const requireRole = require('../middleware/requireRole');
const createRouter = require('../routes/labFiles');
const { createLabFileAccessToken } = require('../utils/labFileAccessToken');
const publicUploads = require('../middleware/publicUploads');
requireRole.setSessionAccountVerifier(async () => true);
const patientId = '11111111-1111-4111-8111-111111111111';
let reads = 0;
let status = 'verified';
let server, base;
const deny = (res) => { res.status(403).json({ message: 'Forbidden' }); return false; };
test.before(async () => {
  const app = express();
  app.use('/uploads', publicUploads(path.join(__dirname, '..', 'uploads')));
  app.use('/file', createRouter({
    prisma: {
      $queryRaw: async (_sql, value) => value === 1n || value === 'lab-local:fixture.pdf' ? [{ patient_id: patientId, order_id: 2n, url: 'lab-local:fixture.pdf', verification_status: status }] : [],
      patients: { findFirst: async () => ({ id: patientId, email: null }) }
    }, requireRole,
    authorizeNurseDepartment: (_req, _res, next) => next(),
    enforceNursePatientAccess: async (req, res) => req.auth.role !== 'nurse' || req.auth.email === 'assigned@example.com' || deny(res),
    enforceClinicalOrderAccess: async (req, res, row) => { assert.equal(row.orderId, 2n); return req.auth.email === 'assigned@example.com' || deny(res); },
    enforceDoctorPatientAccess: async (req, res) => ({ allowed: req.auth.email === 'assigned@example.com' || deny(res) }),
    getStorage: () => null,
    readFile: async () => { reads++; return { buffer: Buffer.from('%PDF-1.4\nfixture'), mimeType: 'application/pdf', filename: 'fixture.pdf' }; }
  }));
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await new Promise(resolve => server.close(resolve)); });
async function request(role, id = patientId, email = 'assigned@example.com', extra = {}) {
  const headers = role ? { Authorization: 'Bearer ' + createSessionToken({ id, email, role }), ...extra } : extra;
  return fetch(base + '/file?id=1', { headers });
}
test('anonymous visitors and spoofed patient headers cannot download files', async () => {
  const before = reads;
  assert.equal((await request(null, null, null, { 'x-user-role': 'admin' })).status, 401);
  assert.equal((await request('patient', 'other', 'other@example.com', { 'x-patient-id': patientId, 'x-user-email': 'assigned@example.com' })).status, 403);
  assert.equal(reads, before);
});
test('the signed owner can preview and download a released PDF with no-store headers', async () => {
  const response = await request('patient');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/pdf/);
  assert.match(response.headers.get('content-disposition'), /fixture.pdf/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.match(await response.text(), /%PDF/);
});
test('the mobile signed link opens a released PDF without app authorization headers', async () => {
  const token = createLabFileAccessToken({ resultId: '1', patientId });
  const response = await fetch(base + '/file/mobile/' + encodeURIComponent(token) + '/1.pdf');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/pdf/);
  assert.match(response.headers.get('content-disposition'), /^inline;/);
});
test('mobile links reject tampering and unreleased results', async () => {
  const token = createLabFileAccessToken({ resultId: '1', patientId });
  assert.equal((await fetch(base + '/file/mobile?id=2&token=' + encodeURIComponent(token))).status, 401);
  status = 'pending';
  try { assert.equal((await fetch(base + '/file/mobile?id=1&token=' + encodeURIComponent(token))).status, 403); }
  finally { status = 'verified'; }
});
test('unreleased files stay unavailable to patients', async () => {
  status = 'pending';
  try { assert.equal((await request('patient')).status, 403); }
  finally { status = 'verified'; }
});
test('assigned clinical roles and admin retain file access', async () => {
  for (const role of ['doctor', 'nurse', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist', 'admin']) assert.equal((await request(role)).status, 200, role);
});
test('unassigned staff and unrelated roles cannot download the file', async () => {
  const before = reads;
  for (const role of ['doctor', 'nurse', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist', 'cashier', 'pharmacist']) assert.equal((await request(role, 'staff', 'unassigned@example.com')).status, 403, role);
  assert.equal(reads, before);
});
test('old static medical paths and encoded separator variants are blocked', async () => {
  for (const pathname of ['/uploads/lab-results/fixture.pdf', '/uploads/LAB-RESULTS/fixture.pdf', '/uploads/lab-results%2ffixture.pdf', '/uploads/lab-results%5cfixture.pdf']) {
    assert.equal((await fetch(base + pathname)).status, 404, pathname);
  }
});
