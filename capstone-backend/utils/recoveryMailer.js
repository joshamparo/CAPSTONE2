const { buildRecoveryTemplateParams } = require('./recoveryEmail');

async function sendRecoveryEmail({ email, resetLink }) {
  const serviceId = process.env.EMAILJS_SERVICE_ID || 'service_ur884qv';
  const publicKey = process.env.EMAILJS_PUBLIC_KEY || '45tRyW8WG36pIFeBo';
  const privateKey = process.env.EMAILJS_PRIVATE_KEY;
  const templateId = process.env.EMAILJS_RECOVERY_TEMPLATE_ID || 'template_xyatwcf';
  if (!serviceId || !publicKey || !privateKey) throw new Error('Recovery email service is not configured');
  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      accessToken: privateKey,
      template_params: buildRecoveryTemplateParams(email, resetLink)
    })
  });
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`Recovery email provider rejected the request${details ? `: ${details.slice(0, 160)}` : ''}`);
  }
  return true;
}

module.exports = { sendRecoveryEmail };
