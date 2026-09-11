const NON_ADMIN_PROFILE_KEYS = new Set([
  'id', '_id', 'password', 'currentPassword', 'requiresPasswordAuth',
  'newPassword', 'confirmNewPassword'
]);

function nonAdminProfileFieldError(body) {
  const fields = Object.keys(body && typeof body === 'object' ? body : {})
    .filter((key) => !NON_ADMIN_PROFILE_KEYS.has(key));
  return fields.length
    ? 'Only your password can be changed. Contact an administrator to update account details.'
    : '';
}

module.exports = { nonAdminProfileFieldError };
