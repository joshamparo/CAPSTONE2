import emailjs from '@emailjs/browser';

const SERVICE_ID = process.env.REACT_APP_EMAILJS_SERVICE_ID || "service_ur884qv";
const TEMPLATE_ID = process.env.REACT_APP_EMAILJS_TEMPLATE_ID || "template_ir71fnn";
const PUBLIC_KEY = process.env.REACT_APP_EMAILJS_PUBLIC_KEY || "45tRyW8WG36pIFeBo";

export const sendOTPEmail = async (email, otp) => {
  if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY) {
    return false;
  }

  const templateParams = {
    to_email: email,
    otp_code: otp,
  };

  try {
    const response = await emailjs.send(SERVICE_ID, TEMPLATE_ID, templateParams, PUBLIC_KEY);
    return response && response.status === 200;
  } catch (err) {
    return false;
  }
};

export const sendPasswordResetEmail = async (email, name, link) => {
  if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY) {
    return false;
  }

  const templateParams = {
    to_email: email,
    to_name: name,
    reset_link: link,
    otp_code: link // Fallback if they use the same template without changing variables
  };

  try {
    const response = await emailjs.send(SERVICE_ID, TEMPLATE_ID, templateParams, PUBLIC_KEY);
    return response && response.status === 200;
  } catch (err) {
    return false;
  }
};

export const isRecoveryEmailAllowed = async (email) => {
  if (!email || typeof email !== 'string') {
    return false;
  }

  try {
    const response = await fetch('http://localhost:5000/api/staff/recovery-email-allowed', {
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
