const { sendEmail } = require('./mailer');
const { staffInvitationEmail } = require('./emailTemplates');

async function sendStaffInvitationEmail({ email, name, setupLink }) {
  return sendEmail({
    to: email,
    subject: 'Set up your Pascualinga staff account',
    text: `Hello ${name}, an administrator created your Pascualinga staff account. Set your password using this secure one-time link: ${setupLink}\n\nThis link expires in 30 minutes.`,
    html: staffInvitationEmail({ name, email, setupLink })
  });
}

module.exports = { sendStaffInvitationEmail };
