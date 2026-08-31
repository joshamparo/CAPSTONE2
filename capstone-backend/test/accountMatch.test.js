const test = require('node:test');
const assert = require('node:assert/strict');
const { selectCanonicalAccount } = require('../utils/accountMatch');

test('same-role account mirrors prefer the clinical table', () => {
  const nurse = { model: 'nurses', user: { id: 'nurse-1', account_type: 'nurse' } };
  const mirror = { model: 'accounts', user: { id: 12, roles: 'nurse' } };
  const result = selectCanonicalAccount([nurse, mirror]);
  assert.equal(result.selected, nurse);
  assert.equal(result.duplicate, true);
  assert.equal(result.conflicting, false);
});

test('same email with conflicting roles remains blocked', () => {
  const result = selectCanonicalAccount([
    { model: 'staff', user: { id: 1, account_type: 'admin' } },
    { model: 'accounts', user: { id: 2, roles: 'nurse' } }
  ]);
  assert.equal(result.selected, null);
  assert.equal(result.conflicting, true);
});

test('a single legacy account remains selectable', () => {
  const account = { model: 'accounts', user: { id: 3, roles: 'admin' } };
  assert.equal(selectCanonicalAccount([account]).selected, account);
});
