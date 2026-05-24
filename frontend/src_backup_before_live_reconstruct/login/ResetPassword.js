import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Check, X } from 'lucide-react';
import './Login.css';

const ResetPassword = () => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const token = searchParams.get('token');

  // Validation Logic
  const hasLength = newPassword.length >= 11;
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(newPassword);
  const hasNumber = /\d/.test(newPassword);

  useEffect(() => {
    if (!token) {
        // If no token in URL, maybe they are testing the UI or something went wrong.
        // For now we allow them to see the page but submission will likely fail unless we handle it.
        // But strictly speaking, we should probably redirect or show error.
        // However, existing logic might have used localStorage. Let's keep it clean for new flow.
        setMessage("Invalid or missing reset token.");
    }
  }, [token]);

  const handleReset = async (e) => {
    e.preventDefault();
    setMessage('');
    setIsSuccess(false);

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

    if (!token) {
        setMessage("Invalid reset token. Please request a new password reset link.");
        return;
    }

    setLoading(true);

    try {
        const response = await fetch('http://localhost:5000/api/staff/reset-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ token, newPassword }),
        });

        const data = await response.json();

        if (response.ok) {
            setMessage("Password reset successfully! Redirecting to login...");
            setIsSuccess(true);
            setTimeout(() => {
                navigate('/login');
            }, 2000);
        } else {
            setMessage(data.message || "Failed to reset password.");
        }
    } catch (err) {
        setMessage("Server error. Please try again later.");
    } finally {
        setLoading(false);
    }
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
                disabled={loading}
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
                disabled={loading}
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

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? 'Resetting...' : 'Confirm Password'}
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
