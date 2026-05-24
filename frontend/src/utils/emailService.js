import emailjs from '@emailjs/browser';

const SERVICE_ID = process.env.REACT_APP_EMAILJS_SERVICE_ID || "service_ur884qv";
const OTP_TEMPLATE_ID =
  process.env.REACT_APP_EMAILJS_OTP_TEMPLATE_ID ||
  process.env.REACT_APP_EMAILJS_TEMPLATE_ID ||
  "template_x8k19wl";
const PUBLIC_KEY = process.env.REACT_APP_EMAILJS_PUBLIC_KEY || "45tRyW8WG36pIFeBo";
const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

export const sendOTPEmail = async (email, otp) => {
  try {
    const expirationTime = new Date(Date.now() + 15 * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const templateParams = {
      to_email: email,
      otp_code: otp,
      otp: otp,
      passcode: otp,
      message: otp,
      time: expirationTime,
      expiration_time: expirationTime
    };

    const response = await emailjs.send(SERVICE_ID, OTP_TEMPLATE_ID, templateParams, PUBLIC_KEY);
    if (response && response.status === 200) return true;
  } catch (err) {
  }

  try {
    const response = await fetch(`${API_BASE}/api/email/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });
    return response.ok;
  } catch (_) {
    return false;
  }
};

export const isRecoveryEmailAllowed = async (email) => {
  if (!email || typeof email !== 'string') {
    return false;
  }

  try {
    const response = await fetch(`${API_BASE}/api/staff/recovery-email-allowed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json().catch(() => null);
    return !!(data && data.allowed);
  } catch (err) {
    return false;
  }
};
