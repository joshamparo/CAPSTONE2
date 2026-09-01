const DEFAULT_FROM = 'Pascualinga Hospital <no-reply@notify.pascualinga.com>';

function configuredProvider() {
  const requested = String(process.env.EMAIL_PROVIDER || 'auto').trim().toLowerCase();
  if (requested === 'resend' || requested === 'emailjs') return requested;
  return String(process.env.RESEND_API_KEY || '').trim() ? 'resend' : 'emailjs';
}

async function sendWithResend({ to, subject, html, text }) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) throw new Error('RESEND_API_KEY is missing');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: String(process.env.RESEND_FROM_EMAIL || DEFAULT_FROM).trim(),
      to: [to], subject, html, text
    })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Resend rejected the email: ${String(data?.message || `HTTP ${response.status}`).slice(0, 240)}`);
  return { ok: true, provider: 'resend', id: data?.id || null };
}

async function sendWithEmailJs({ to, templateId, templateParams }) {
  const serviceId = String(process.env.EMAILJS_SERVICE_ID || 'service_ur884qv').trim();
  const publicKey = String(process.env.EMAILJS_PUBLIC_KEY || '45tRyW8WG36pIFeBo').trim();
  const privateKey = String(process.env.EMAILJS_PRIVATE_KEY || '').trim();
  if (!serviceId || !publicKey || !privateKey || !templateId) throw new Error('EmailJS fallback is not configured');
  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service_id: serviceId, template_id: templateId, user_id: publicKey, accessToken: privateKey, template_params: { to_email: to, ...templateParams } })
  });
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`EmailJS rejected the email${details ? `: ${details.slice(0, 160)}` : ''}`);
  }
  return { ok: true, provider: 'emailjs', id: null };
}

async function sendEmail(message) {
  const to = String(message?.to || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('A valid recipient email is required');
  if (!String(message?.subject || '').trim()) throw new Error('Email subject is required');
  return configuredProvider() === 'resend'
    ? sendWithResend({ ...message, to })
    : sendWithEmailJs({ ...message, to });
}

module.exports = { sendEmail, configuredProvider };
