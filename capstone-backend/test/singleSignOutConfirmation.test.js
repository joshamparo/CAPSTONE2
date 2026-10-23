const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendRoot = path.join(__dirname, '..', '..', 'frontend', 'src');
const read = (relativePath) => fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8');

test('dashboard account menus execute logout after the shared single confirmation', () => {
  const expectations = [
    ['Admin/AdminDashboard.js', /onSignOut=\{confirmLogout\}/],
    ['Nurse/NurseDashboard.js', /onSignOut=\{handleLogout\}/],
    ['OfficeStaff/OfficeStaffDashboard.js', /onSignOut=\{handleLogout\}/],
    ['DoctorSecretary/DoctorSecretaryDashboard.js', /onSignOut=\{logout\}/],
    ['ClinicalStaff/ClinicalStaffDashboard.js', /onSignOut=\{confirmLogout\}/],
    ['Doctor/DoctorDashboard.js', /onSignOut=\{handleLogout\}/],
    ['Patient/PatientDashboard.js', /onSignOut=\{handleLogout\}/],
    ['Pharmacist/PharmacistDashboard.js', /onSignOut=\{confirmLogout\}/],
    ['Staff/StaffDashboard.js', /onSignOut=\{handleLogout\}/]
  ];

  for (const [file, pattern] of expectations) {
    assert.match(read(file), pattern, `${file} must pass its final logout action to AccountHeaderActions`);
  }
});

test('nurse and office staff do not render a second sign-out confirmation', () => {
  for (const file of ['Nurse/NurseDashboard.js', 'OfficeStaff/OfficeStaffDashboard.js']) {
    const source = read(file);
    assert.doesNotMatch(source, /showLogoutConfirm|setShowLogoutConfirm/);
    assert.doesNotMatch(source, /import SignOutConfirmModal/);
  }
});
