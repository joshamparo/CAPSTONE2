const test = require('node:test');
const assert = require('node:assert/strict');

const router = require('../routes/clinicalOrders');
const { canAccessOrderRow, inferActor } = router.__test;

const roles = ['medtech', 'radiographer', 'ecg_operator', 'physical_therapist'];

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
