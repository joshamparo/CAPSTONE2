import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff, Check, X } from 'lucide-react';
import './Login.css';
import { API_BASE } from '../utils/api';

const ResetPassword = () => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [tokenStatus, setTokenStatus] = useState('checking');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const resetToken = new URLSearchParams(location.search).get('token') || '';

  useEffect(() => {
    let active = true;
    const verifyToken = async () => {
      if (!resetToken) {
        setTokenStatus('invalid');
        setMessage('This password reset link is incomplete. Please request a new one.');
        return;
      }
      try {
        const response = await fetch(`${API_BASE}/api/staff/verify-reset-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: resetToken })
        });
        const data = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok || data?.valid !== true) {
          setTokenStatus('invalid');
          setMessage(String(data?.message || 'This password reset link is invalid or has expired. Please request a new one.'));
          return;
        }
        setTokenStatus('valid');
        setMessage('');
      } catch (err) {
        if (!active) return;
        setTokenStatus('invalid');
        setMessage('The reset link could not be verified. Please try again or request a new one.');
      }
    };
    verifyToken();
    return () => { active = false; };
  }, [resetToken]);

  // Validation Logic
  const hasLength = newPassword.length >= 11;
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(newPassword);
  const hasNumber = /\d/.test(newPassword);

  const handleReset = async (e) => {
    e.preventDefault();
    setMessage('');
    setIsSuccess(false);

    if (tokenStatus !== 'valid') {
      setMessage('This password reset link is invalid or has expired. Please request a new one.');
      return;
    }

    if (!newPassword.trim() || !confirmPassword.trim()) {
      setMessage("No empty field should be left out.");
      return;
    }

    if (!hasLength || !hasSpecialChar || !hasNumber) {
      setMessage("Please meet all password requirements.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/api/staff/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: resetToken, newPassword })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(String(data?.message || 'Password reset failed. Please request a new link.'));
        return;
      }
    } catch (err) {
      console.error("Backend connection error during reset:", err);
      setMessage('Cannot connect to the server. Your password was not changed. Please try again.');
      return;
    } finally {
      setIsSubmitting(false);
    }

    window.history.replaceState({}, document.title, '/reset-password');
    setMessage("Password successfully reset! Redirecting to login...");
    setIsSuccess(true);
    setTimeout(() => {
      navigate('/login');
    }, 2000);
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
          <h2>Reset Password</h2>
          <p className="subtitle">
            Enter a new password and re-enter new password to reset your account.
          </p>
        </div>

        {message && (
          <div className={`alert ${isSuccess ? 'success' : 'error'}`}>
            <p>{message}</p>
          </div>
        )}

        <form onSubmit={handleReset} className="login-form">
          <div className="form-group">
            <label>Enter a new password</label>
            <div className="input-wrapper">
              <input 
                type={showNewPassword ? "text" : "password"} 
                placeholder="Enter new password" 
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <button 
                type="button"
                className="toggle-password"
                onClick={() => setShowNewPassword(!showNewPassword)}
              >
                {showNewPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            
            <div className="password-checklist">
              <div className={`checklist-item ${hasLength ? 'valid' : ''}`}>
                {hasLength ? <Check size={14} /> : <X size={14} />}
                <span>At least 11 characters</span>
              </div>
              <div className={`checklist-item ${hasSpecialChar ? 'valid' : ''}`}>
                {hasSpecialChar ? <Check size={14} /> : <X size={14} />}
                <span>Contains special characters</span>
              </div>
              <div className={`checklist-item ${hasNumber ? 'valid' : ''}`}>
                {hasNumber ? <Check size={14} /> : <X size={14} />}
                <span>Contains numbers</span>
              </div>
            </div>
          </div>
          <div className="form-group">
            <label>Re-enter new password</label>
            <div className="input-wrapper">
              <input 
                type={showConfirmPassword ? "text" : "password"} 
                placeholder="Re-enter new password" 
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <button 
                type="button"
                className="toggle-password"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          <button type="submit" className="submit-btn" disabled={tokenStatus !== 'valid' || isSubmitting}>
            {tokenStatus === 'checking' ? 'Verifying link...' : (isSubmitting ? 'Updating password...' : 'Confirm Password')}
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

export default ResetPassword;
