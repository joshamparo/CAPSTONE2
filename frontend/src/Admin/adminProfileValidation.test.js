import { adminAvatarError, adminDepartmentError, adminPasswordIsValid, adminPhoneError } from './adminProfileValidation';

test('accepts valid department and Philippine phone formats', () => {
  expect(adminDepartmentError('General Administration')).toBe('');
  expect(adminPhoneError('0912 345 6789')).toBe('');
  expect(adminPhoneError('+63 912 345 6789')).toBe('');
});

test('rejects missing or malformed personal information', () => {
  expect(adminDepartmentError('')).toMatch(/required/i);
  expect(adminDepartmentError('<script>')).toMatch(/invalid/i);
  expect(adminPhoneError('12345')).toMatch(/valid PH number/i);
});

test('password rules match backend complexity requirements', () => {
  expect(adminPasswordIsValid('weakpassword1!')).toBe(false);
  expect(adminPasswordIsValid('StrongPass1!')).toBe(true);
});

test('avatar validation accepts supported files up to five megabytes', () => {
  expect(adminAvatarError({ type: 'image/png', size: 1024 })).toBe('');
  expect(adminAvatarError({ type: 'image/gif', size: 1024 })).toMatch(/JPG, PNG, or WebP/i);
  expect(adminAvatarError({ type: 'image/jpeg', size: 6 * 1024 * 1024 })).toMatch(/5 MB/i);
});
