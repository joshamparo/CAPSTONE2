'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function walkInHandlerSource() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'patients.js'), 'utf8');
  const start = source.indexOf("router.post('/walk-in-intake'");
  const end = source.indexOf('// POST create new patient', start);
  assert.ok(start >= 0 && end > start, 'walk-in intake handler must remain discoverable');
  return source.slice(start, end);
}

test('walk-in intake does not run schema DDL during a patient request', () => {
  const handler = walkInHandlerSource();
  assert.doesNotMatch(handler, /\b(?:CREATE|ALTER)\s+(?:TABLE|INDEX)\b/i);
  const beforePayload = handler.slice(0, handler.indexOf('const payload'));
  assert.doesNotMatch(beforePayload, /ensureBillingTablesExist/i);
});

test('consultation availability checks do not run schema DDL or repeat per doctor', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'patients.js'), 'utf8');
  const start = source.indexOf('async function enforceDoctorAvailability');
  const end = source.indexOf('router.use(requireRole', start);
  const availability = source.slice(start, end);
  assert.doesNotMatch(availability, /\b(?:CREATE|ALTER)\s+(?:TABLE|INDEX)\b/i);

  const handler = walkInHandlerSource();
  assert.match(handler, /const availabilityByDoctor = new Map\(\)/);
  assert.match(handler, /availabilityByDoctor\.set\(dId, enforceRes\)/);
  assert.match(handler, /availabilityByDoctor\.get\(dId\)/);
  assert.match(handler, /await getIntakeDoctorIds\(tx, selectedSpec\)/);
});

test('walk-in failures log their internal stage and safe diagnostic message', () => {
  const handler = walkInHandlerSource();
  assert.match(handler, /stage: failureStage/);
  assert.match(handler, /message: String\(err\?\.message \|\| 'Unknown error'\)\.slice\(0, 500\)/);
});

test('walk-in failures are traceable without exposing database errors', () => {
  const handler = walkInHandlerSource();
  assert.match(handler, /crypto\.randomUUID\(\)\.slice\(0, 8\)/);
  assert.match(handler, /\[Walk-in intake\] Failed/);
  assert.match(handler, /Unable to process walk-in intake\. Reference:/);
  assert.doesNotMatch(handler, /res\.status\([^)]*\)\.json\(\{[^}]*err\?\.message/);
});

test('walk-in intake does not scan historical invoices or wait for email delivery', () => {
  const handler = walkInHandlerSource();
  assert.doesNotMatch(handler, /interval\s+'120 days'/i);
  assert.doesNotMatch(handler, /LIMIT\s+9999/i);
  assert.doesNotMatch(handler, /await\s+Promise\.race\s*\(/i);
});

test('walk-in tickets use the same daily scope as the database uniqueness rule', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'patients.js'), 'utf8');
  const start = source.indexOf('async function nextWalkInTicket');
  const end = source.indexOf('async function sendAppointmentSummaryEmail', start);
  assert.ok(start >= 0 && end > start, 'ticket generator must remain discoverable');
  const generator = source.slice(start, end);
  assert.match(generator, /VALUES\s*\(\s*\$1::date,\s*''/i);
  assert.match(generator, /MAX\(walkin_ticket_seq\)[\s\S]+walkin_ticket_date\s*=\s*\$1::date/i);
  assert.doesNotMatch(generator, /\$2/);
});

test('ER intake stores a legacy-constraint-compatible patient admission status', () => {
  const handler = walkInHandlerSource();
  assert.match(handler, /routeMeta\.type === 'er_consult' \? 'Outpatient'/);
  assert.match(handler, /admission_status:\s*'Outpatient'/);
  assert.doesNotMatch(handler, /admission_status:\s*routeMeta\.type === 'er_consult' \? 'Emergency'/);
  assert.doesNotMatch(handler, /admission_status:\s*routeMeta\.type === 'er_consult' \? 'ER Observation'/);
});

test('ER registration defers billing and HMO claims until care is rendered', () => {
  const handler = walkInHandlerSource();
  assert.match(handler, /const deferErBilling = routeMeta\.type === 'er_consult'/);
  assert.match(handler, /if \(Boolean\(payload\.hasHmo\) && !deferErBilling\)/);
  assert.match(handler, /if \(hasServices && !deferErBilling\)/);
  assert.match(handler, /if \(!deferErBilling && Boolean\(payload\.hasHmo\)/);
  assert.match(handler, /const hasHmoClaim = hasHmoCoverage && !deferErBilling/);
  assert.match(handler, /state: 'deferred', label: 'Deferred until ER billing'/);
});

test('walk-in HMO recovery uses only the invoice returned by the exact intake', () => {
  const handler = walkInHandlerSource();
  assert.match(handler, /linkedInvoiceRaw\s*=\s*String\(result\?\.linkedInvoiceId/i);
  assert.doesNotMatch(handler, /created_at\s+>=\s+\(now\(\)\s+-\s+interval\s+'15 minutes'\)/i);
  assert.doesNotMatch(handler, /ON CONFLICT\s+\(invoice_id\)/i);
  assert.match(handler, /upsertWalkInHmoClaim\s*\(/i);
});

test('PhilHealth-only intake cannot create an HMO monitoring claim', () => {
  const handler = walkInHandlerSource();
  assert.match(handler, /const hasHmoCoverage = Boolean\(payload\.hasHmo\)/i);
  assert.match(handler, /const hasHmoClaim = hasHmoCoverage && !deferErBilling/i);
  assert.match(handler, /const shouldCreateClaim = hasHmoClaim && desiredHmoStatus/i);
  assert.match(handler, /:\s*'PhilHealth Only'/i);
});

test('walk-in intake validates PhilHealth identity and never trusts a client deduction', () => {
  const handler = walkInHandlerSource();
  assert.match(handler, /philhealthDigits[\s\S]+\^\\d\{12\}\$/i);
  assert.match(handler, /payload\.philhealthNumber\s*=\s*hasPhilhealth\s*\?\s*philhealthDigits\s*:\s*null/i);
  assert.match(handler, /payload\.philhealthDeduction\s*=\s*0/i);
  assert.match(handler, /PhilHealth Pending Verification/i);
  assert.match(handler, /philhealth_number:\s*hasPhilhealth\s*\?\s*philhealthDigits\s*:\s*null/i);
  assert.match(handler, /\.\.\.\(hasPhilhealth\s*\?\s*\{\s*philhealth_number:\s*philhealthDigits\s*\}\s*:\s*\{\}\)/i);
});

test('PhilHealth-only intake cannot declare HMO services as covered', () => {
  const handler = walkInHandlerSource();
  assert.match(handler, /if\s*\(payload\.hasHmo\s*!==\s*true\)\s*payload\.hmoCoveredServices\s*=\s*null/i);
});

test('awaiting LOA requires an explicit temporary payment choice', () => {
  const handler = walkInHandlerSource();
  assert.match(handler, /desiredHmoStatus === 'Awaiting LOA'[^}]+\['temp_cash', 'guarantee'\]/i);
});

test('walk-in HMO locking does not deserialize PostgreSQL void results', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'patients.js'), 'utf8');
  assert.match(source, /SELECT id::text AS id FROM public\.billing_invoices[^']+FOR UPDATE/i);
  assert.doesNotMatch(source, /SELECT pg_advisory_xact_lock/i);
});

test('walk-in HMO synchronization cannot roll back the core intake transaction', () => {
  const handler = walkInHandlerSource();
  assert.match(handler, /const syncHmoInsideCoreTransaction = false/i);
  assert.match(handler, /HMO monitoring is synchronized by the post-commit layer/i);
  assert.match(handler, /LAYER 2 FALLBACK SAFETY NET/i);
});

test('walk-in response exposes HMO sync state and an idempotent retry route', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'patients.js'), 'utf8');
  assert.match(source, /hmoSync\s*=\s*syncedClaims\s*>\s*0/i);
  assert.match(source, /router\.post\('\/walk-in-intake\/hmo-sync'/i);
  assert.match(source, /upsertWalkInHmoClaim\(tx/i);
  assert.match(source, /Billing invoice was not found for this patient/i);
});

test('direct diagnostic intake follows the actually selected service category', () => {
  const handler = walkInHandlerSource();
  assert.match(handler, /selectedLabs\.length > 0 && selectedImaging\.length === 0/i);
  assert.match(handler, /routeMeta = getWalkInRouteMeta\('lab'\)/i);
  assert.match(handler, /selectedImaging\.length > 0 && selectedLabs\.length === 0/i);
  assert.match(handler, /routeMeta = getWalkInRouteMeta\('imaging'\)/i);
  assert.match(handler, /createdRecord\.services = selectedServices\.join\(', '\)/i);
  assert.match(handler, /linkedInvoiceId: linkedInvoiceId \? String\(linkedInvoiceId\) : null/i);
  assert.match(handler, /billing:\s*\{ invoice_id: result\?\.linkedInvoiceId/i);
});

test('direct clinical routes create selected services once instead of using the concern as a duplicate order', () => {
  const handler = walkInHandlerSource();
  assert.match(handler, /routeServices\[0\]\s*\|\|\s*payload\.mainConcern/i);
  assert.match(handler, /routeMeta\.type === 'lab'\s*\?\s*payload\.selectedLabServices\.slice\(1\)/i);
  assert.match(handler, /routeMeta\.type === 'imaging'\s*\?\s*payload\.selectedImagingServices\.slice\(1\)/i);
});
