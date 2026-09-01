const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

export const sendOTPEmail = async (email, otp) => {
  console.log(`[EmailService] Attempting to send OTP to ${email}...`);
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
