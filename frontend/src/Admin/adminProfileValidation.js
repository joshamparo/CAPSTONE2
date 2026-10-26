export const adminPasswordCriteria = (value) => {
  const password = String(value || '');
  return {
    length: password.length >= 11,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /\d/.test(password),
    hasSpecial: /[^A-Za-z0-9]/.test(password)
  };
};

export const adminPasswordIsValid = (value) => Object.values(adminPasswordCriteria(value)).every(Boolean);

export const adminDepartmentError = (value) => {
  const department = String(value || '').trim();
  if (!department) return 'Department / Role is required.';
  if (department.length < 2) return 'Department / Role must contain at least 2 characters.';
  if (department.length > 80) return 'Department / Role must be 80 characters or fewer.';
  if (/[<>\u0000-\u001f]/.test(department)) return 'Department / Role contains invalid characters.';
  return '';
};

export const adminPhoneError = (value) => {
  const phone = String(value || '').trim();
  if (!phone) return 'Phone number is required.';
  const compact = phone.replace(/[\s\-()]/g, '');
  if (!/^(?:09\d{9}|\+639\d{9})$/.test(compact)) return 'Use a valid PH number: 09XXXXXXXXX or +639XXXXXXXXX.';
  return '';
};

export const adminAvatarError = (file) => {
  if (!file) return '';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(String(file.type || '').toLowerCase())) {
    return 'Avatar must be a JPG, PNG, or WebP image.';
  }
  if (Number(file.size || 0) > 5 * 1024 * 1024) return 'Avatar must not exceed 5 MB.';
  return '';
};
