const router = require('express').Router();
const requireRole = require('../middleware/requireRole');
const { sendEmail, configuredProvider } = require('../utils/mailer');
const { otpEmail, staffWelcomeEmail } = require('../utils/emailTemplates');

const cleanText = (value, max = 200) => String(value || '').trim().slice(0, max);

router.post('/send-otp', async (req, res) => {
  return res.status(410).json({ success: false, message: 'Client-supplied OTP delivery has been retired. Sign in through /api/staff/login.' });
  /* istanbul ignore next -- retained temporarily for old clients; unreachable by design */
  /*
  const email = cleanText(req.body?.email).toLowerCase();
  const otp = cleanText(req.body?.otp, 8);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{4,8}$/.test(otp)) {
    return res.status(400).json({ success: false, message: 'A valid email and OTP are required.' });
  }
  const expiresAt = new Date(Date.now() + 15 * 60000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  try {
    const result = await sendEmail({
      to: email,
      subject: 'Your Pascualinga verification code',
      text: `Your Pascualinga verification code is ${otp}. It expires at ${expiresAt}. Do not share this code.`,
      html: otpEmail({ otp, expiresAt }),
      templateId: process.env.EMAILJS_TEMPLATE_ID || 'template_x8k19wl',
      templateParams: { otp_code: otp, otp, code: otp, passcode: otp, time: expiresAt, expiration_time: expiresAt, from_name: 'Pascualinga Hospital' }
    });
    console.log(`[Email] OTP sent via ${result.provider}; id=${result.id || 'n/a'}`);
    return res.json({ success: true, message: 'OTP email sent', provider: result.provider });
  } catch (error) {
    console.error(`[Email] ${configuredProvider()} OTP send failed:`, error?.message || error);
    return res.status(502).json({ success: false, message: 'Unable to send the OTP email right now. Please try again.' });
  }
  */
});

router.post('/send-staff-welcome', requireRole(['admin']), async (req, res) => {
  return res.status(410).json({ success: false, message: 'Temporary-password email delivery has been retired. Create or resend the staff invitation through /api/staff.' });
  /* istanbul ignore next -- retained temporarily for old clients; unreachable by design */
  /*
  const email = cleanText(req.body?.email).toLowerCase();
  const name = cleanText(req.body?.name || 'Staff member', 120);
  const temporaryPassword = String(req.body?.temporaryPassword || '');
  const loginUrl = String(process.env.PUBLIC_WEB_ORIGIN || 'https://pascualinga.com').replace(/\/+$/, '') + '/login';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || temporaryPassword.length < 11) {
    return res.status(400).json({ success: false, message: 'Valid staff credentials are required.' });
  }
  try {
    const result = await sendEmail({
      to: email,
      subject: 'Your Pascualinga staff account',
      text: `Hello ${name},\n\nYour Pascualinga account is ready.\nEmail: ${email}\nTemporary password: ${temporaryPassword}\nLogin: ${loginUrl}\n\nPlease sign in and change your password immediately.`,
      html: staffWelcomeEmail({ name, email, temporaryPassword, loginUrl }),
      templateId: process.env.EMAILJS_STAFF_TEMPLATE_ID || 'template_zkps5b8',
      templateParams: { staff_name: name, staff_email: email, temp_password: temporaryPassword, login_link: loginUrl, login_url: loginUrl }
    });
    return res.json({ success: true, provider: result.provider });
  } catch (error) {
    console.error(`[Email] ${configuredProvider()} staff welcome send failed:`, error?.message || error);
    return res.status(502).json({ success: false, message: 'Staff account was created, but its email could not be sent.' });
  }
  */
});

module.exports = router;
