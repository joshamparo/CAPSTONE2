const BRAND = {
  orange: '#f2550b',
  orangeDark: '#d94801',
  ink: '#172033',
  muted: '#667085',
  border: '#e7eaf0',
  surface: '#fff7ed',
  webOrigin: String(process.env.PUBLIC_WEB_ORIGIN || 'https://pascualinga.com').replace(/\/+$/, '')
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

function brandedEmail({ preheader, title, intro, content, action, notice }) {
  const logoUrl = `${BRAND.webOrigin}/pgh-logo.png`;
  const actionHtml = action?.url && action?.label
    ? `<tr><td align="center" style="padding:8px 32px 28px"><a href="${escapeHtml(action.url)}" style="background:${BRAND.orange};border-radius:8px;color:#ffffff;display:inline-block;font-family:Arial,sans-serif;font-size:15px;font-weight:700;line-height:48px;text-align:center;text-decoration:none;padding:0 28px">${escapeHtml(action.label)}</a></td></tr>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f6f8;padding:24px 12px"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader || title)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid ${BRAND.border};border-radius:14px;overflow:hidden"><tr><td style="height:7px;background:${BRAND.orange}"></td></tr><tr><td align="center" style="padding:30px 32px 12px"><img src="${logoUrl}" width="68" height="68" alt="Pascual General Hospital" style="display:block;border:0;object-fit:contain"><div style="font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:${BRAND.orangeDark};padding-top:10px;letter-spacing:.3px">PASCUAL GENERAL HOSPITAL</div></td></tr><tr><td align="center" style="padding:4px 32px 8px;font-family:Arial,sans-serif;font-size:26px;line-height:34px;font-weight:800;color:${BRAND.ink}">${escapeHtml(title)}</td></tr><tr><td align="center" style="padding:0 32px 22px;font-family:Arial,sans-serif;font-size:15px;line-height:23px;color:${BRAND.muted}">${escapeHtml(intro)}</td></tr><tr><td style="padding:0 32px 24px;font-family:Arial,sans-serif;font-size:15px;line-height:23px;color:${BRAND.ink}">${content}</td></tr>${actionHtml}${notice ? `<tr><td style="padding:0 32px 28px"><div style="background:${BRAND.surface};border-left:4px solid ${BRAND.orange};border-radius:6px;padding:12px 14px;font-family:Arial,sans-serif;font-size:13px;line-height:20px;color:${BRAND.muted}">${escapeHtml(notice)}</div></td></tr>` : ''}<tr><td style="border-top:1px solid ${BRAND.border};padding:20px 32px;text-align:center;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#98a2b3">This is an automated message from Pascualinga.<br>Please do not reply or share security codes and passwords.</td></tr></table></td></tr></table></body></html>`;
}

function otpEmail({ otp, expiresAt }) {
  return brandedEmail({
    preheader: `Your Pascualinga verification code is ${otp}`,
    title: 'Verify your email',
    intro: 'Enter this one-time code to continue securely.',
    content: `<div style="background:${BRAND.surface};border:1px solid #fed7aa;border-radius:10px;padding:18px;text-align:center;font-family:Arial,sans-serif;font-size:32px;line-height:40px;font-weight:800;letter-spacing:9px;color:${BRAND.orangeDark}">${escapeHtml(otp)}</div><p style="margin:18px 0 0;text-align:center;color:${BRAND.muted}">Valid until <strong>${escapeHtml(expiresAt)}</strong>.</p>`,
    notice: 'Never share this code. Pascualinga staff will not ask you for it.'
  });
}

function recoveryEmail({ resetLink }) {
  return brandedEmail({
    preheader: 'Reset your Pascualinga password securely',
    title: 'Reset your password',
    intro: 'We received a request to change the password for your account.',
    content: '<p style="margin:0;text-align:center">Select the button below to choose a new password.</p>',
    action: { url: resetLink, label: 'Reset password' },
    notice: 'This secure link expires and works only once. If you did not request it, you can safely ignore this email.'
  });
}

function staffWelcomeEmail({ name, email, temporaryPassword, loginUrl }) {
  return brandedEmail({
    preheader: 'Your Pascualinga staff account is ready',
    title: 'Welcome to Pascualinga',
    intro: `Hello ${name}, your staff account has been created.`,
    content: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;border:1px solid ${BRAND.border};border-radius:9px"><tr><td style="padding:14px;color:${BRAND.muted}">Email</td><td style="padding:14px;text-align:right;font-weight:700">${escapeHtml(email)}</td></tr><tr><td style="padding:14px;border-top:1px solid ${BRAND.border};color:${BRAND.muted}">Temporary password</td><td style="padding:14px;border-top:1px solid ${BRAND.border};text-align:right;font-weight:700">${escapeHtml(temporaryPassword)}</td></tr></table>`,
    action: { url: loginUrl, label: 'Open Pascualinga' },
    notice: 'Sign in and change your temporary password immediately. Do not forward this email.'
  });
}

function appointmentEmail({ title, message, service, schedule, status, footer }) {
  return brandedEmail({
    preheader: `${title}: ${schedule}`,
    title,
    intro: message,
    content: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;border:1px solid ${BRAND.border};border-radius:9px"><tr><td style="padding:12px;color:${BRAND.muted}">Service</td><td style="padding:12px;text-align:right;font-weight:700">${escapeHtml(service)}</td></tr><tr><td style="padding:12px;border-top:1px solid ${BRAND.border};color:${BRAND.muted}">Schedule</td><td style="padding:12px;border-top:1px solid ${BRAND.border};text-align:right;font-weight:700">${escapeHtml(schedule)}</td></tr><tr><td style="padding:12px;border-top:1px solid ${BRAND.border};color:${BRAND.muted}">Status</td><td style="padding:12px;border-top:1px solid ${BRAND.border};text-align:right;font-weight:700;color:${BRAND.orangeDark}">${escapeHtml(status)}</td></tr></table>`,
    notice: footer
  });
}

module.exports = { escapeHtml, otpEmail, recoveryEmail, staffWelcomeEmail, appointmentEmail };
