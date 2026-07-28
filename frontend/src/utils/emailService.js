import emailjs from '@emailjs/browser';

const SERVICE_ID = process.env.REACT_APP_EMAILJS_SERVICE_ID || "service_ur884qv";
const OTP_TEMPLATE_ID =
  process.env.REACT_APP_EMAILJS_OTP_TEMPLATE_ID ||
  process.env.REACT_APP_EMAILJS_TEMPLATE_ID ||
  "template_zkps5b8";
const PUBLIC_KEY = process.env.REACT_APP_EMAILJS_PUBLIC_KEY || "45tRyW8WG36pIFeBo";
const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

if (PUBLIC_KEY) {
  try {
    emailjs.init({ publicKey: PUBLIC_KEY });
    console.log("[EmailService] EmailJS SDK initialized with public key.");
  } catch (e) {
    console.warn("[EmailService] EmailJS SDK init skipped:", e?.message || e);
  }
}

export const sendOTPEmail = async (email, otp) => {
  console.log(`[EmailService] Attempting to send OTP to ${email}...`);
  const expirationTime = new Date(Date.now() + 15 * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const templateParams = {
    to_email: email,
    otp_code: otp,
    otp: otp,
    code: otp,
    passcode: otp,
    time: expirationTime,
    expiration_time: expirationTime,
    from_name: "Pascualinga Hospital"
  };

  try {
    console.log(`[EmailService] Sending via EmailJS Client SDK... (Template: ${OTP_TEMPLATE_ID})`);
    const response = await emailjs.send(SERVICE_ID, OTP_TEMPLATE_ID, templateParams, { publicKey: PUBLIC_KEY });
    if (response && response.status === 200) {
      console.log("[EmailService] EmailJS Client SDK success!");
      return true;
    }
    console.warn("[EmailService] EmailJS Client returned non-200 status:", response?.status);
  } catch (err) {
    console.error("[EmailService] EmailJS Client SDK error:", err?.text || err?.message || err);
  }

  console.log("[EmailService] Falling back to Backend REST API...");
  try {
    const response = await fetch(`${API_BASE}/api/email/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });

    if (response.ok) {
      console.log("[EmailService] Backend API success!");
      return true;
    }

    let errorMessage = `HTTP ${response.status}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData?.message || errorData?.details || errorMessage;
    } catch (_) {}
    console.error("[EmailService] Backend API failed:", errorMessage);
  } catch (err) {
    console.error("[EmailService] Backend API connection error:", err?.message || err);
  }

  return false;
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
