const { buildRecoveryTemplateParams } = require('./recoveryEmail');
const { sendEmail } = require('./mailer');
const { recoveryEmail } = require('./emailTemplates');

async function sendRecoveryEmail({ email, resetLink }) {
  const templateId = process.env.EMAILJS_RECOVERY_TEMPLATE_ID || 'template_xyatwcf';
  return sendEmail({
    to: email,
    subject: 'Reset your Pascualinga password',
    text: `Use this secure link to reset your Pascualinga password: ${resetLink}\n\nThis link expires and can only be used once.`,
    html: recoveryEmail({ resetLink }),
    templateId,
    templateParams: buildRecoveryTemplateParams(email, resetLink)
  });
}

module.exports = { sendRecoveryEmail };
