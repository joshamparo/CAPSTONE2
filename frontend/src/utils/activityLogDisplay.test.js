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
});
