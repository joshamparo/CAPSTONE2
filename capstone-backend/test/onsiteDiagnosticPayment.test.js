const test = require('node:test');
const assert = require('node:assert/strict');
const { approvalRequestIdFromOrderNotes } = require('../utils/onsiteDiagnosticPayment');

test('links an approved onsite diagnostic order back to its approval request', () => {
  assert.equal(
    approvalRequestIdFromOrderNotes('From appointment approval request 42 (ApprovalRequest:42)'),
    '42'
  );
});

test('does not infer payment linkage for unrelated or malformed order notes', () => {
  assert.equal(approvalRequestIdFromOrderNotes('Video Consultation PAYREF:42'), null);
  assert.equal(approvalRequestIdFromOrderNotes('ApprovalRequest:not-a-number'), null);
  assert.equal(approvalRequestIdFromOrderNotes(''), null);
});
