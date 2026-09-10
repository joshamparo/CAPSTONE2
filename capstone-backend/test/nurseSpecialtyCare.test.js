const test = require('node:test');
const assert = require('node:assert/strict');
const { CARE_CONFIG, validateCare, DEPARTMENTS } = require('../utils/nurseSpecialtyCare');
const { canManageWard } = require('../utils/nurseScope');

for (const department of DEPARTMENTS) {
  test(`${department}: preparation, handoff, completion and read-only history`, () => {
    const config = CARE_CONFIG[department];
    assert.ok(config.title && config.fields.length && config.checks.length);
    const form = { stage: 'Preparation', checks: config.checks.map(() => false), notes: config.fields.map(() => ''), handoffTo: '' };
    assert.equal(validateCare(form, config), '');
    assert.match(validateCare({ ...form, stage: 'In progress' }, config), /checks/);
    assert.match(validateCare({ ...form, stage: 'Completed' }, config), /in order/);
    form.checks = config.checks.map(() => true);
    form.stage = 'In progress';
    assert.equal(validateCare(form, config, { stage: 'Preparation' }), '');
    assert.match(validateCare({ ...form, stage: 'Handed off' }, config, form), /receiving team/);
    form.notes = config.fields.map(() => 'Documented observation');
    form.handoffTo = 'Receiving care team';
    assert.equal(validateCare({ ...form, stage: 'Handed off' }, config, form), '');
    assert.equal(validateCare({ ...form, stage: 'Completed' }, config, { stage: 'Handed off' }), '');
    assert.match(validateCare(form, config, { stage: 'Completed' }), /in order|read-only/);
    assert.equal(canManageWard(department), ['ER', 'MEDICINE'].includes(department));
  });
}
test('invalid or oversized specialty documentation is rejected', () => {
  const config = CARE_CONFIG.ER;
  assert.match(validateCare({ stage: 'Made up' }, config), /valid workflow/);
  assert.match(validateCare({ stage: 'Preparation', checks: [true] }, config), /checklist/);
  assert.match(validateCare({ stage: 'Preparation', checks: config.checks.map(() => true), notes: ['x'.repeat(2001), 'note'] }, config), /2,000/);
  assert.equal(DEPARTMENTS.length, 15);
  assert.equal(canManageWard('Internal Medicine'), true);
  assert.equal(canManageWard(''), false);
  assert.equal(canManageWard('unknown'), false);
});
test('cancellation requires documentation and leaves the episode read-only', () => {
  const config = CARE_CONFIG.LABORATORY;
  const body = { stage: 'Cancelled', checks: config.checks.map(() => false), notes: config.fields.map(() => ''), handoffTo: '' };
  assert.match(validateCare(body, config, { stage: 'Preparation' }), /cancellation reason/);
  body.notes[1] = 'Visit cancelled before collection.';
  assert.equal(validateCare(body, config, { stage: 'Preparation' }), '');
  assert.match(validateCare(body, config, { stage: 'Cancelled' }), /read-only/);
});
