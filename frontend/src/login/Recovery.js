import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Login.css';
import { API_BASE } from '../utils/api';

const Recovery = () => {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [firstCharNotice, setFirstCharNotice] = useState('');
  const [resendTimer, setResendTimer] = useState(0);
  const navigate = useNavigate();

  const readJson = async (response) => {
    try {
      return await response.json();
    } catch (_) {
      return null;
    }
  };

  useEffect(() => {
    if (resendTimer <= 0) return undefined;
    const timer = window.setInterval(() => setResendTimer((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendTimer]);

  const handleRecovery = async (e) => {
    e.preventDefault();
    setMessage('');
    setIsSuccess(false);
    
    if (!email.trim()) {
      setMessage("No empty field should be left out.");
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/api/staff/request-password-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail })
      });
      const data = await readJson(response);
      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = Math.max(1, Number(response.headers.get('Retry-After')) || Number(data?.retryAfterSeconds) || 60);
          setResendTimer(retryAfter);
          throw new Error(`Please wait ${retryAfter} seconds before requesting another email.`);
        }
        throw new Error(String(data?.message || 'Recovery service is temporarily unavailable. Please try again later.'));
      }
      setIsSuccess(true);
      setMessage(String(data?.message || 'If the account is eligible, a password reset email will arrive shortly.'));
      setResendTimer(Math.max(1, Number(data?.resendAfterSeconds) || 60));
    } catch (error) {
      console.error("Recovery validation error:", error);
      setMessage(String(error?.message || "Could not connect to the server. Please try again later."));
    } finally {
      setIsSubmitting(false);
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
    if (value !== email) {
      setIsSuccess(false);
      setMessage('');
      setResendTimer(0);
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
            {isSuccess ? (
              <div className="didnt-receive" style={{ marginTop: 10, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <span>Didn't receive the email?</span>
                {resendTimer > 0 ? (
                  <span style={{ color: '#64748b', fontWeight: 600 }}>Resend in {resendTimer}s</span>
                ) : (
                  <button type="button" onClick={handleRecovery} disabled={isSubmitting} style={{ padding: 0, border: 0, background: 'transparent', color: '#ea580c', fontWeight: 800, cursor: isSubmitting ? 'wait' : 'pointer', textDecoration: 'underline' }}>
                    Resend Email
                  </button>
                )}
              </div>
            ) : null}
          </div>

          <button type="submit" className="submit-btn" disabled={isSubmitting || (isSuccess && resendTimer > 0)}>
            {isSubmitting ? 'Sending recovery link...' : isSuccess ? 'Recovery email sent' : 'Reset your password'}
          </button>
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
