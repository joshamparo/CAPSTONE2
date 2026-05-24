import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, ArrowLeft, CheckCircle } from 'lucide-react';
import './Login.css';
import { sendPasswordResetEmail } from '../utils/emailService';

const Recovery = () => {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [firstCharNotice, setFirstCharNotice] = useState('');
  const navigate = useNavigate();

  const handleRecovery = async (e) => {
    e.preventDefault();
    setMessage('');
    setIsSuccess(false);
    
    if (!email.trim()) {
      setMessage("No empty field should be left out.");
      return;
    }

    setLoading(true);

    try {
      // 1. Call Backend to generate token
      const response = await fetch('http://localhost:5000/api/staff/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok) {
        // 2. Send Email with Magic Link
        const resetLink = `${window.location.origin}/reset-password?token=${data.token}`;
        const emailSent = await sendPasswordResetEmail(data.email, data.firstName, resetLink);

        if (emailSent) {
          setSubmitted(true);
          setIsSuccess(true);
        } else {
          setMessage("Failed to send email. Please try again later.");
        }
      } else {
        setMessage(data.message || "User not found.");
      }
    } catch (err) {
      setMessage("Server error. Please try again later.");
    } finally {
      setLoading(false);
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

  if (submitted) {
    return (
      <div className="login-container">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div className="login-header">
            <div style={{ 
              width: '80px', 
              height: '80px', 
              background: '#dcfce7', 
              borderRadius: '50%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              margin: '0 auto 20px' 
            }}>
              <Mail size={40} color="#16a34a" />
            </div>
            <h2>Check your mail</h2>
            <p className="subtitle">
              We have sent a password recover instructions to your email.
            </p>
            <div style={{ margin: '20px 0', padding: '15px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <span style={{ fontWeight: '600', color: '#334155' }}>{email}</span>
            </div>
            <p className="subtitle" style={{ fontSize: '0.9rem' }}>
              Did not receive the email? Check your spam filter, or <span onClick={() => setSubmitted(false)} style={{ color: '#005b96', cursor: 'pointer', fontWeight: '600' }}>try another email address</span>
            </p>
          </div>
          
          <div className="login-footer">
            <span className="back-link" onClick={() => navigate('/login')}>
              Skip, I'll confirm later
            </span>
          </div>
        </div>
      </div>
    );
  }

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
            <label>Email Address</label>
            <div className="input-wrapper">
              <input 
                type="email" 
                placeholder="Enter your email" 
                value={email}
                onChange={handleEmailChange}
                disabled={loading}
              />
            </div>
            {firstCharNotice && (
              <div className="field-notice">{firstCharNotice}</div>
            )}
          </div>

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? 'Sending...' : 'Reset password'}
          </button>
        </form>

        <div className="login-footer">
          <span className="back-link" onClick={() => navigate('/login')}>
            <ArrowLeft size={16} style={{ display: 'inline', marginRight: '5px' }} />
            Go back to Login
          </span>
        </div>
      </div>
    </div>
  );
};

export default Recovery;
