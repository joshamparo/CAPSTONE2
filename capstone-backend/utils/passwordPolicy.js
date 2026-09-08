function resetPasswordCriteria(password) {
  const value = String(password || '');
  return {
    length: value.length >= 11,
    number: /[0-9]/.test(value),
    special: /[^A-Za-z0-9]/.test(value),
    uppercase: /[A-Z]/.test(value)
  };
}

function isValidResetPassword(password) {
  return Object.values(resetPasswordCriteria(password)).every(Boolean);
}

module.exports = { resetPasswordCriteria, isValidResetPassword };
