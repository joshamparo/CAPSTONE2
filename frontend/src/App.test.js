import { buildAuthHeaders, safeJson } from './utils/api';

test('buildAuthHeaders attaches the signed session and normalized identity', () => {
  expect(buildAuthHeaders({
    sessionToken: 'signed-token',
    role: 'Doctor',
    email: 'Doctor@Example.com',
    firstName: 'Ana',
    lastName: 'Reyes'
  })).toEqual(expect.objectContaining({
    Authorization: 'Bearer signed-token',
    'x-user-role': 'doctor',
    'x-user-email': 'Doctor@Example.com',
    'x-user-name': 'Ana Reyes'
  }));
});

test('safeJson rejects malformed session storage values', () => {
  expect(safeJson('{broken')).toBeNull();
});
