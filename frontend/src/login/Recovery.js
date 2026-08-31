import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Login.css';
import { API_BASE } from '../utils/api';

const Recovery = () => {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/api/staff/request-password-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail })
      });
      const data = await readJson(response);
      if (!response.ok) {
        if (response.status === 429) throw new Error('Too many recovery attempts. Please wait before trying again.');
        throw new Error(String(data?.message || 'Recovery service is temporarily unavailable. Please try again later.'));
      }
      setIsSuccess(true);
      setMessage('');
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

          <button type="submit" className="submit-btn" disabled={isSubmitting}>
            {isSubmitting ? 'Sending recovery link...' : 'Reset your password'}
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
