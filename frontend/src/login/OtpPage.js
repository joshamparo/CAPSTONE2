import React, { useEffect, useRef, useState } from 'react';
import './OtpPage.css';
import { useNavigate } from 'react-router-dom';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';
const emptyCode = () => new Array(6).fill('');
const routeForRole = (role) => ({
  admin: '/admin', staff: '/admin', patient: '/patient', doctor: '/doctor', nurse: '/nurse',
  pharmacist: '/pharmacist', cashier: '/cashier', doctor_secretary: '/doctor-secretary',
  medtech: '/medtech', radiographer: '/radiographer', ecg_operator: '/ecg', physical_therapist: '/pt'
}[role] || '/');

const OtpPage = () => {
  const [otp, setOtp] = useState(emptyCode);
  const [displayEmail] = useState(() => localStorage.getItem('tempLoginEmail') || '');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [resendTimer, setResendTimer] = useState(60);
  const [entryTimer, setEntryTimer] = useState(60);
  const [submitting, setSubmitting] = useState(false);
  const inputRefs = useRef([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (!localStorage.getItem('otpChallengeId')) navigate('/login', { replace: true });
  }, [navigate]);
  useEffect(() => {
    const timer = window.setInterval(() => setEntryTimer((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (entryTimer === 0) {
      localStorage.removeItem('otpChallengeId');
      navigate('/login', { replace: true });
    }
  }, [entryTimer, navigate]);
  useEffect(() => {
    if (resendTimer <= 0) return undefined;
    const timer = window.setInterval(() => setResendTimer((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendTimer]);

  const clearCode = () => {
    setOtp(emptyCode());
    window.setTimeout(() => inputRefs.current[0]?.focus(), 0);
  };

  const handleVerify = async (code) => {
    if (submitting) return;
    const challengeId = localStorage.getItem('otpChallengeId');
    if (!challengeId) return navigate('/login', { replace: true });
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/staff/login/otp/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challengeId, code })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.message || 'Unable to verify the code.');
        clearCode();
        if (response.status === 429 || /sign in again|expired/i.test(data.message || '')) {
          window.setTimeout(() => navigate('/login', { replace: true }), 1500);
        }
        return;
      }
      const role = String(data.account_type || data.accountType || data.roles || localStorage.getItem('tempLoginRole') || '').toLowerCase();
      localStorage.setItem('currentUser', JSON.stringify({ ...data, role }));
      ['otpChallengeId', 'tempLoginEmail', 'tempLoginRole', 'generatedOTP', 'tempUserDetails', 'otpEmailFailed', 'displayOtpCode']
        .forEach((key) => localStorage.removeItem(key));
      setSuccess('Sign-in verified. Redirecting...');
      window.setTimeout(() => navigate(routeForRole(role), { replace: true }), 400);
    } catch (_) {
      setError('Cannot connect to the server. Please try again.');
      clearCode();
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendTimer > 0 || submitting) return;
    const challengeId = localStorage.getItem('otpChallengeId');
    if (!challengeId) return navigate('/login', { replace: true });
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/staff/login/otp/resend`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challengeId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.message || 'Unable to resend the verification code.');
        if (data.retryAfterSeconds) setResendTimer(data.retryAfterSeconds);
        return;
      }
      clearCode();
      setEntryTimer(Number(data.expiresInSeconds) || 60);
      setResendTimer(Number(data.resendAfterSeconds) || 60);
      setSuccess(`New code sent to ${displayEmail}`);
    } catch (_) {
      setError('Cannot connect to the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleChange = (element, index) => {
    const value = element.value.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[index] = value;
    setOtp(next);
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
    if (next.every(Boolean)) handleVerify(next.join(''));
  };

  return (
    <div className="background-container"><div className="login-card">
      <div className="logo-container"><img src={process.env.PUBLIC_URL + '/images/pgh logo.png'} alt="PGH Logo" className="logo" /></div>
      {error && <div className="error-card"><p className="error-message">{error}</p></div>}
      {success && <div className="success-card"><p className="success-message">{success}</p></div>}
      <p className="email-display">{displayEmail}</p>
      <h1 className="title">Approve Sign in Request</h1>
      <p className="instruction">An OTP code has been sent to your registered email. Check your inbox and spam folder, then enter the 6-digit code below.</p>
      <p className="entry-timer" style={{ textAlign: 'center', color: 'black', fontWeight: 'bold', marginBottom: '1rem' }}>
        {Math.floor(entryTimer / 60)}:{String(entryTimer % 60).padStart(2, '0')}
      </p>
      <div className="otp-inputs">{otp.map((digit, index) => <input key={index} type="text" maxLength="1"
        ref={(element) => { inputRefs.current[index] = element; }} value={digit} disabled={submitting}
        onChange={(event) => handleChange(event.target, index)}
        onKeyDown={(event) => { if (event.key === 'Backspace' && !otp[index] && index > 0) inputRefs.current[index - 1]?.focus(); }}
        inputMode="numeric" pattern="\d*" autoComplete={index === 0 ? 'one-time-code' : 'off'} />)}</div>
      <div className="refresh-section"><p>Didn't receive a sign-in request?</p>
        {resendTimer > 0 ? <p className="resend-timer">Resend code in <strong style={{ color: '#ea580c' }}>{resendTimer}s</strong></p>
          : <button className="resend-link" onClick={handleResendOtp} disabled={submitting}>Resend Code</button>}
      </div>
      <button className="reset-btn" onClick={() => navigate('/recovery')}>Reset your password</button>
    </div></div>
  );
};

export default OtpPage;
