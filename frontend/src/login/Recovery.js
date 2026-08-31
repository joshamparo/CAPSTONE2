import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Login.css';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';
const RECOVERY_ALLOWED_ROLES = new Set([
  'admin',
  'nurse',
  'doctor',
  'pharmacist',
  'staff',
  'cashier',
  'doctor_secretary',
  'medtech',
  'radiographer',
  'ecg_operator',
  'physical_therapist'
]);

const Recovery = () => {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [firstCharNotice, setFirstCharNotice] = useState('');
  const navigate = useNavigate();

  const readJson = async (response) => {
    try {
      return await response.json();
    } catch (_) {
      return null;
    }
  };

  const handleRecovery = async (e) => {
    e.preventDefault();
    setMessage('');
    setIsSuccess(false);
    
    if (!email.trim()) {
      setMessage("No empty field should be left out.");
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    
    try {
      // Validate the email directly through the backend staff API route
      const response = await fetch(`${API_BASE}/api/staff/recovery-email-allowed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail })
      });

      const data = await readJson(response);

      if (!response.ok || !data.allowed) {
        if (response.status >= 500) {
          setMessage(data?.message || "Recovery service is temporarily unavailable. Please try again later.");
        } else if (data?.message) {
          setMessage(String(data.message));
        } else {
          setMessage("Email is invalid or not registered by the admin.");
        }
        return;
      }

      // Enforce the validation on the specific allowed account types
      const accountType = data.accountType ? data.accountType.toLowerCase() : '';

      if (!RECOVERY_ALLOWED_ROLES.has(accountType)) {
        setMessage("This account type is not authorized for this recovery portal.");
        return;
      }

      const tokenResponse = await fetch(`${API_BASE}/api/staff/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail })
      });
      const tokenData = await readJson(tokenResponse);
      if (!tokenResponse.ok || !tokenData?.token) {
        throw new Error(String(tokenData?.message || 'Unable to create a password reset link.'));
      }

      const webOrigin = String(process.env.REACT_APP_WEB_ORIGIN || window.location.origin).replace(/\/+$/, '');
      const resetLink = `${webOrigin}/reset-password?email=${encodeURIComponent(normalizedEmail)}&token=${encodeURIComponent(tokenData.token)}`;

      // Send the recovery email using the backend
      const emailResponse = await fetch(`${API_BASE}/api/email/send-recovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, resetLink: resetLink })
      });

      if (!emailResponse.ok) {
        const emailData = await readJson(emailResponse);
        throw new Error(String(emailData?.message || "Backend failed to send recovery email."));
      }

      setIsSuccess(true);
      setMessage(''); // Clear global message to use the inline text instead

    } catch (error) {
      console.error("Recovery validation error:", error);
      setMessage(String(error?.message || "Could not connect to the server. Please try again later."));
    }
  };

  const handleEmailChange = (e) => {
    const value = e.target.value;
    const cleanedValue = value.replace(/\s+/g, '');

    if (email === '' && cleanedValue.length > 0) {
      const firstChar = cleanedValue[0];
      if (firstChar && !/^[A-Za-z]$/.test(firstChar)) {
        setFirstCharNotice('The first character must be a letter.');
        return;
      }
    }

    if (firstCharNotice) {
      setFirstCharNotice('');
    }
    setEmail(cleanedValue);
  };

  return (
    <div className="login-container">
      <div className="auth-card">
        <div className="login-header">
          <img 
            src={process.env.PUBLIC_URL + "/images/pgh logo.png"} 
            alt="PGH Logo" 
            className="brand-logo" 
          />
          <h2>Account Recovery</h2>
          <p className="subtitle">
            Forgot your password? Enter your email address and we will send an instruction to recover your account.
          </p>
        </div>

        {message && (
          <div className={`alert ${isSuccess ? 'success' : 'error'}`}>
            <p>{message}</p>
          </div>
        )}

        <form onSubmit={handleRecovery} className="login-form">
          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label>Email Address</label>
              {isSuccess && (
                <span style={{ fontSize: '13px', color: '#16a34a', fontWeight: '600' }}>
                  Check your email to change your password.
                </span>
              )}
              {firstCharNotice && !isSuccess && (
                <span className="login-field-notice">{firstCharNotice}</span>
              )}
            </div>
            <div className="input-wrapper">
              <input 
                type="email" 
                placeholder="Enter your email" 
                value={email}
                onChange={handleEmailChange}
              />
            </div>
            <div className="didnt-receive">Didn't receive an Email?</div>
          </div>

          <button type="submit" className="submit-btn">Reset your password</button>
        </form>

        <div className="login-footer">
          <span className="back-link" onClick={() => navigate('/login')}>
            Go back to Login
          </span>
        </div>
      </div>
    </div>
  );
};

export default Recovery;
