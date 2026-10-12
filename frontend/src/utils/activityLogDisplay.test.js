import { formatActivityLog } from './activityLogDisplay';

describe('formatActivityLog', () => {
  test('turns staff before/after JSON into a professional summary', () => {
    const formatted = formatActivityLog({
      action: 'Update Staff',
      target: 'genesis@example.com',
      details: JSON.stringify({
        model: 'doctors',
        before: { first_name: 'Genesis', last_name: 'Lontok', department: 'OPD', status: 'Offline' },
        after: { first_name: 'Genesis', last_name: 'Lontok', department: 'Medicine', status: 'Online' }
      })
    });

    expect(formatted.action).toBe('Update Staff Account');
    expect(formatted.details).toBe('Updated department and account status for Genesis Lontok.');
    expect(formatted.details).not.toContain('{');
    expect(formatted.rawDetails).toContain('"before"');
  });

  test('keeps normal human-readable activity descriptions unchanged', () => {
    const formatted = formatActivityLog({ action: 'Appointment Completed', details: 'Completed appointment 42' });
    expect(formatted.action).toBe('Appointment Completed');
    expect(formatted.details).toBe('Completed appointment 42');
  });

  test('turns legacy pharmacy report payloads into a concise admin summary', () => {
    const formatted = formatActivityLog({
      action: 'Create',
      target: 'SalesReport',
      details: `Submitted pharmacy sales report • ${JSON.stringify({
        from: '2026-10-11T16:00:00.000Z',
        to: '2026-10-12T16:00:00.000Z',
        summary: { transaction_count: 3, revenue: 150 }
      })}`
    });

    expect(formatted.action).toBe('Submit Pharmacy Sales Report');
    expect(formatted.details).toBe('Sales report for Oct 11, 2026 to Oct 12, 2026: 3 transactions and ₱150.00 revenue.');
    expect(formatted.details).not.toContain('{');
  });

  test('uses clearer sign-in wording for OTP log entries', () => {
    const formatted = formatActivityLog({ action: 'Login', details: 'User logged in with OTP' });
    expect(formatted.action).toBe('Sign In');
    expect(formatted.details).toBe('Signed in using a one-time password.');
  });
});
