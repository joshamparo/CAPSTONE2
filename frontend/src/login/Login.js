import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User, Lock, ArrowLeft, Eye, EyeOff, Pause, Play } from 'lucide-react';
import './Login.css';
import PrivacyConsentModal, { hasPrivacyConsent } from '../components/PrivacyConsentModal';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

const slides = [
  {
    image: "/images/login-hospital-1.jpg",
    title: "PASCUALINGA",
    subtitle: "Trusted care, guided by compassion and innovation."
  },
  {
    image: "/images/login-hospital-2.jpg",
    title: "Inside the Hospital",
    subtitle: "Dedicated professionals, your health partners."
  },
  {
    image: "/images/login-hospital-3.jpg",
    title: "Modern Facilities",
    subtitle: "Equipped with the latest medical technology for your safety."
  }
];

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [firstCharNotice, setFirstCharNotice] = useState('');
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isSlidePaused, setIsSlidePaused] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ));
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [isLockedOut, setIsLockedOut] = useState(false);
  const [lockoutTimer, setLockoutTimer] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(() => !hasPrivacyConsent());

  const navigate = useNavigate();

  useEffect(() => {
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
    };
  }, []);

  useEffect(() => {
    // Check localStorage for existing lockout
    const savedLockoutTime = localStorage.getItem('loginLockoutTime');
    if (savedLockoutTime) {
      const remainingTime = Math.ceil((parseInt(savedLockoutTime) - Date.now()) / 1000);
      if (remainingTime > 0) {
        setIsLockedOut(true);
        setLockoutTimer(remainingTime);
        setError(`Too many login attempts. Please try again in ${remainingTime} seconds.`);
      } else {
        localStorage.removeItem('loginLockoutTime');
        localStorage.removeItem('loginAttempts');
      }
    } else {
      // Check attempts
      const attempts = parseInt(localStorage.getItem('loginAttempts') || '0');
      setLoginAttempts(attempts);
    }

  }, []);

  useEffect(() => {
    if (isSlidePaused) return undefined;
    const slideInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        setCurrentSlide((prev) => (prev === slides.length - 1 ? 0 : prev + 1));
      }
    }, 6000);
    return () => clearInterval(slideInterval);
  }, [isSlidePaused]);

  useEffect(() => {
    let timer;
    if (isLockedOut && lockoutTimer > 0) {
      timer = setInterval(() => {
        setLockoutTimer((prev) => {
          const newValue = prev - 1;
          if (newValue <= 0) {
             setIsLockedOut(false);
             setLoginAttempts(0);
             localStorage.removeItem('loginLockoutTime');
             localStorage.removeItem('loginAttempts');
             setError('');
             return 0;
          }
          setError(`Too many login attempts. Please try again in ${newValue} seconds.`);
          return newValue;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isLockedOut, lockoutTimer]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (isLockedOut || isSubmitting) return;

    setError('');
    setSuccess('');
    
    if (!email.trim() || !password.trim()) {
      setError("No empty field should be left out.");
      return;
    }

    let role = '';
    let isValid = false;
    let credentialFailure = false;
    let loginChallenge = null;

    {
        // Authenticate every account through the backend so protected API
        // requests receive a signed session token.
        const controller = new AbortController();
        const loginTimeout = window.setTimeout(() => controller.abort(), 15000);
        try {
          setIsSubmitting(true);
          const res = await fetch(`${API_BASE}/api/staff/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim(), password: password.trim() }),
            signal: controller.signal
          });
    
          if (res.ok) {
            const data = await res.json();
            role = String(data.role || '').toLowerCase();
            loginChallenge = data;
            isValid = Boolean(data.otpRequired && data.challengeId);
          } else {
            const errorData = await res.json().catch(() => ({}));
            credentialFailure = res.status === 400;
            setError(errorData.message || (credentialFailure
              ? 'Invalid Email or Password.'
              : 'The login service is temporarily unavailable. Please try again.'));
          }
        } catch (err) {
          console.error("Login API connection error:", err);
          setError(err?.name === 'AbortError'
            ? 'Login request timed out. Please try again.'
            : 'Cannot connect to the server. Please try again later.');
          return; 
        } finally {
          window.clearTimeout(loginTimeout);
          setIsSubmitting(false);
        }
    }

    if (isValid) {
      localStorage.setItem('otpChallengeId', loginChallenge.challengeId);
      localStorage.setItem('tempLoginEmail', loginChallenge.email || email.trim().toLowerCase());
      localStorage.setItem('tempLoginRole', role);
      ['generatedOTP', 'tempUserDetails', 'otpEmailFailed', 'displayOtpCode'].forEach((key) => localStorage.removeItem(key));
      Object.keys(localStorage).filter((key) => key.startsWith('otp_bypass_')).forEach((key) => localStorage.removeItem(key));
      setLoginAttempts(0);
      localStorage.removeItem('loginAttempts');
      localStorage.removeItem('loginLockoutTime');
      setSuccess('Verification code sent. Redirecting...');
      setTimeout(() => navigate('/otp'), 500);
      return;
    } else if (credentialFailure) {
      // Failed Login
      const newAttempts = loginAttempts + 1;
      setLoginAttempts(newAttempts);
      localStorage.setItem('loginAttempts', newAttempts.toString());

      if (newAttempts >= 3) {
        setIsLockedOut(true);
        const lockoutDuration = 60; // 60 seconds
        setLockoutTimer(lockoutDuration);
        const lockoutTime = Date.now() + (lockoutDuration * 1000);
        localStorage.setItem('loginLockoutTime', lockoutTime.toString());
        setError(`Too many login attempts. Please try again in ${lockoutDuration} seconds.`);
      } else {
        const remaining = 3 - newAttempts;
        setError(`Invalid Email or Password. You have ${remaining} attempt${remaining !== 1 ? 's' : ''} left.`);
      }
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
      <div className="login-wrapper">
        {/* Left Side: Form */}
        <div className="login-form-section">
          <div className="login-header">
            <img
              src={process.env.PUBLIC_URL + "/images/login-pgh-logo.png"}
              alt="PGH Logo" 
              width="60"
              height="60"
              className="brand-logo" 
            />
            <h1>Welcome Back</h1>
            <p className="subtitle">Please sign in to continue</p>
          </div>

          <div className="alerts-slot">
            {error && (
              <div className="alert error" role="alert" aria-live="assertive">
                <p>{error}</p>
              </div>
            )}
            {success && (
              <div className="alert success" role="status" aria-live="polite">
                <p>{success}</p>
              </div>
            )}
          </div>

          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <div className="label-row">
                <label htmlFor="login-email">Email Address</label>
                {firstCharNotice && (
                  <span className="login-field-notice" id="login-email-notice">{firstCharNotice}</span>
                )}
              </div>
              <div className="input-wrapper">
                <User className="field-icon" size={20} />
                <input 
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  aria-describedby={firstCharNotice ? 'login-email-notice' : undefined}
                  required
                  placeholder="Enter your email" 
                  value={email}
                  onChange={handleEmailChange}
                  disabled={isLockedOut}
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="login-password">Password</label>
              <div className="input-wrapper">
                <Lock className="field-icon" size={20} />
                <input 
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  placeholder="Enter your password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLockedOut}
                />
                <button 
                  type="button"
                  className="toggle-password"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <div className="form-actions">
              <Link className="forgot-link" to="/recovery">
                Forgot password?
              </Link>
            </div>

            <button type="submit" className="submit-btn" disabled={isLockedOut || isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Login'}
            </button>
          </form>

          <div className="login-footer">
            <a href="/" className="back-link">
              <ArrowLeft size={16} />
              <span>Go back to Home Page</span>
            </a>
          </div>
        </div>

        {/* Right Side: Slideshow */}
        <div className="login-slideshow-section" role="region" aria-label="Hospital highlights">
          {slides.map((slide, index) => (
            <div 
              key={index} 
              className={`login-slide ${index === currentSlide ? "active" : ""}`}
            >
              <img 
                src={index === 0 || index === currentSlide ? process.env.PUBLIC_URL + slide.image : undefined}
                alt=""
                aria-hidden="true"
                loading={index === 0 ? 'eager' : 'lazy'}
                fetchPriority={index === 0 ? 'high' : 'auto'}
                decoding="async"
                className="login-slide-img" 
              />
              <div className="login-slide-overlay">
                <div className="login-slide-content">
                  <h2>{slide.title}</h2>
                  <p>{slide.subtitle}</p>
                </div>
              </div>
            </div>
          ))}
          <div className="login-slide-indicators" role="group" aria-label="Choose a hospital highlight">
            <button
              type="button"
              className="slideshow-toggle"
              aria-label={isSlidePaused ? 'Play hospital highlights' : 'Pause hospital highlights'}
              aria-pressed={isSlidePaused}
              onClick={() => setIsSlidePaused((paused) => !paused)}
            >
              {isSlidePaused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
            </button>
            {slides.map((slide, index) => (
              <button
                key={index} 
                className={`indicator ${index === currentSlide ? "active" : ""}`}
                type="button"
                aria-label={`Show slide ${index + 1}: ${slide.title}`}
                aria-pressed={index === currentSlide}
                onClick={() => setCurrentSlide(index)}
              />
            ))}
          </div>
        </div>
      </div>
      <PrivacyConsentModal
        open={privacyOpen}
        onAccept={() => setPrivacyOpen(false)}
        onDecline={() => navigate('/', { replace: true })}
      />
    </div>
  );
};

export default Login;
