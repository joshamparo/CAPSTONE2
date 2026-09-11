function approvalRequestIdFromOrderNotes(notes) {
  const match = String(notes || '').match(/(?:^|[\s(])ApprovalRequest:(\d+)(?:[\s)]|$)/i);
  return match ? match[1] : null;
}

module.exports = { approvalRequestIdFromOrderNotes };
