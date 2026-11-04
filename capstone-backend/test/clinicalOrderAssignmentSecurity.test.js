const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const router = require('../routes/clinicalOrders');
const { canAccessOrderRow, canTransitionStatus, inferActor } = router.__test;
const root = path.join(__dirname, '..', '..');
const clinicalDashboard = fs.readFileSync(path.join(root, 'frontend', 'src', 'ClinicalStaff', 'ClinicalStaffDashboard.js'), 'utf8');
const patientsRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'patients.js'), 'utf8');

const roles = ['medtech', 'radiographer', 'ecg_operator', 'physical_therapist'];

test('all clinical roles share the same sidebar sequence, with video consultations only for PT', () => {
  const navStart = clinicalDashboard.indexOf('<nav className="cs-nav">');
  const navEnd = clinicalDashboard.indexOf('</nav>', navStart);
  assert.notEqual(navStart, -1);
  assert.notEqual(navEnd, -1);
  const nav = clinicalDashboard.slice(navStart, navEnd);
  assert.deepEqual(
    [...nav.matchAll(/label="([^"]+)"/g)].map(([, label]) => label),
    ['Dashboard', 'Patient Records', 'Approvals', 'Appointments', 'Medical Orders', 'Video Consultations']
  );
  assert.match(nav, /isPhysicalTherapist \? <TabButton id="video"/);
  assert.doesNotMatch(nav, /isEcgOperator|isPhysicalTherapist \? <TabButton id="appointments"|isPhysicalTherapist \? <TabButton id="orders"/);
  assert.doesNotMatch(clinicalDashboard, /if \(!isEcgOperator\) return;\s*if \(activeTab === 'appointments'\)/);
});

test('clinical patient records are scoped to service-assigned patients and the signed staff identity', () => {
  const scopeStart = patientsRoute.indexOf('async function clinicalPatientOrderScope');
  const scopeEnd = patientsRoute.indexOf('\n}\n', scopeStart);
  assert.notEqual(scopeStart, -1);
  const scope = patientsRoute.slice(scopeStart, scopeEnd);
  assert.match(scope, /assigned_role: role/);
  assert.match(scope, /assigned_to: email/);
  assert.match(scope, /assigned_to: null/);
  assert.match(patientsRoute, /const scopedWhere = clinicalScope[\s\S]{0,220}clinicalScope[\s\S]{0,160}where: scopedWhere/);
  assert.match(patientsRoute, /This patient is not assigned to your clinical service\./);
});

test('Physical Therapists use the header sign-out and do not get a sidebar logout button', () => {
  assert.match(clinicalDashboard, /\{!isPhysicalTherapist \? \([\s\S]{0,260}cs-sidebar-footer[\s\S]{0,180}Logout[\s\S]{0,80}: null\}/);
  assert.match(clinicalDashboard, /<AccountHeaderActions[\s\S]{0,160}onSignOut=\{confirmLogout\}/);
});

for (const role of roles) {
  test(`${role} queue is shared until claimed and private after assignment`, () => {
    const actorA = { actorRole: role, actorEmail: 'staff.a@example.test' };
    const actorB = { actorRole: role, actorEmail: 'staff.b@example.test' };
    const unclaimed = { assignedRole: role, assignedTo: null };
    const claimed = { assignedRole: role, assignedTo: actorA.actorEmail };

    assert.equal(canAccessOrderRow(unclaimed, actorA), true);
    assert.equal(canAccessOrderRow(unclaimed, actorB), true);
    assert.equal(canAccessOrderRow(claimed, actorA), true);
    assert.equal(canAccessOrderRow(claimed, actorB), false);
  });
}

test('a different department cannot access an unclaimed or claimed order', () => {
  const order = { assignedRole: 'medtech', assignedTo: null };
  assert.equal(canAccessOrderRow(order, { actorRole: 'radiographer', actorEmail: 'radio@example.test' }), false);

  order.assignedTo = 'medtech@example.test';
  assert.equal(canAccessOrderRow(order, { actorRole: 'radiographer', actorEmail: 'medtech@example.test' }), false);
});

test('admin and cashier retain their explicit operational access', () => {
  const order = { assignedRole: 'medtech', assignedTo: 'medtech@example.test' };
  assert.equal(canAccessOrderRow(order, { actorRole: 'admin', actorEmail: 'admin@example.test' }), true);
  assert.equal(canAccessOrderRow(order, { actorRole: 'cashier', actorEmail: 'cashier@example.test' }), true);
});

test('doctor orders assigned to nurses remain visible before individual assignment', () => {
  const order = { orderedByRole: 'Doctor', orderedByName: 'Verified Doctor', assignedRole: 'nurse', assignedTo: null };
  assert.equal(canAccessOrderRow(order, { actorRole: 'nurse', actorEmail: 'er.nurse@example.test', actorName: 'ER Nurse' }), true);
});

test('nurse order status follows pending to in-progress to completed', () => {
  assert.equal(canTransitionStatus({ fromStatus: 'Pending', toStatus: 'In Progress', actorRole: 'nurse', assignedRole: 'nurse' }), true);
  assert.equal(canTransitionStatus({ fromStatus: 'Pending', toStatus: 'Completed', actorRole: 'nurse', assignedRole: 'nurse' }), false);
  assert.equal(canTransitionStatus({ fromStatus: 'In Progress', toStatus: 'Completed', actorRole: 'nurse', assignedRole: 'nurse' }), true);
  assert.equal(canTransitionStatus({ fromStatus: 'Completed', toStatus: 'In Progress', actorRole: 'nurse', assignedRole: 'nurse' }), false);
  assert.equal(canTransitionStatus({ fromStatus: 'Pending', toStatus: 'In Progress', actorRole: 'nurse', assignedRole: 'medtech' }), false);
});

test('clinical-order identity comes from the signed session, not spoofed headers', () => {
  const actor = inferActor({
    auth: { role: 'medtech', email: 'verified@example.test' },
    headers: {
      'x-user-role': 'admin',
      'x-user-email': 'attacker@example.test',
      'x-user-name': 'Display Name'
    }
  });

  assert.deepEqual(actor, {
    actorRole: 'medtech',
    actorEmail: 'verified@example.test',
    actorName: 'Display Name'
  });
});

test('doctor ownership uses the server-resolved name instead of a spoofed display header', () => {
  const actor = inferActor({
    auth: { role: 'doctor', email: 'doctor@example.test' },
    clinicalActorName: 'Verified Doctor',
    headers: { 'x-user-name': 'Another Doctor' }
  });
  assert.equal(actor.actorName, 'Verified Doctor');
  assert.equal(canAccessOrderRow(
    { orderedByRole: 'Doctor', orderedByName: 'Another Doctor', assignedRole: 'medtech' },
    actor
  ), false);
});
