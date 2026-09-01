const test = require('node:test');
const assert = require('node:assert/strict');
const { otpEmail, recoveryEmail, staffWelcomeEmail, appointmentEmail } = require('../utils/emailTemplates');

test('transactional templates share Pascualinga branding and safe email markup', () => {
  const templates = [
    otpEmail({ otp: '123456', expiresAt: '12:30 PM' }),
    recoveryEmail({ resetLink: 'https://pascualinga.com/reset-password?token=safe-token' }),
    staffWelcomeEmail({ name: 'Test Nurse', email: 'nurse@example.com', temporaryPassword: 'StrongTemp1!', loginUrl: 'https://pascualinga.com/login' }),
    appointmentEmail({ title: 'Appointment Confirmed', message: 'Your schedule is ready.', service: 'Consultation', schedule: '2026-09-02 at 09:00', status: 'Confirmed', footer: 'Please arrive early.' })
  ];
  for (const html of templates) {
    assert.match(html, /PASCUAL GENERAL HOSPITAL/);
    assert.match(html, /https:\/\/pascualinga\.com\/pgh-logo\.png/);
    assert.match(html, /#f2550b/);
    assert.match(html, /automated message from Pascualinga/i);
  }
});

test('email templates escape user-controlled content', () => {
  const html = staffWelcomeEmail({
    name: '<script>alert(1)</script>',
    email: 'safe@example.com',
    temporaryPassword: '<unsafe>Strong1!',
    loginUrl: 'https://pascualinga.com/login'
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;unsafe&gt;/);
});
