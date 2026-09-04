import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { User, Lock, ArrowLeft, Eye, EyeOff, ShieldCheck, CheckCircle2, XCircle } from 'lucide-react';
import './Login.css';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

const slides = [
  {
    image: "/images/IMG_20260126_104733_949.jpg",
    title: "PASCUALINGA",
    subtitle: "Trusted care, guided by compassion and innovation."
  },
  {
    image: "/images/IMG_20260126_112706_079.jpg",
    title: "Inside the Hospital",
    subtitle: "Dedicated professionals, your health partners."
  },
  {
    image: "/images/IMG_20260126_112858_791.jpg",
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
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [isLockedOut, setIsLockedOut] = useState(false);
  const [lockoutTimer, setLockoutTimer] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

    const slideInterval = setInterval(() => {
      setCurrentSlide((prev) => (prev === slides.length - 1 ? 0 : prev + 1));
    }, 5000);
    return () => clearInterval(slideInterval);
  }, []);

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
              src={process.env.PUBLIC_URL + "/images/pgh logo.png"} 
              alt="PGH Logo" 
              className="brand-logo" 
            />
            <h2>Welcome Back</h2>
            <p className="subtitle">Please sign in to continue</p>
          </div>

          <div className="alerts-slot">
            {error && (
              <div className="alert error">
                <p>{error}</p>
              </div>
            )}
            {success && (
              <div className="alert success">
                <p>{success}</p>
              </div>
            )}
          </div>

          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <div className="label-row">
                <label>Email Address</label>
                {firstCharNotice && (
                  <span className="login-field-notice">{firstCharNotice}</span>
                )}
              </div>
              <div className="input-wrapper">
                <User className="field-icon" size={20} />
                <input 
                  type="text" 
                  placeholder="Enter your email" 
                  value={email}
                  onChange={handleEmailChange}
                  disabled={isLockedOut}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Password</label>
              <div className="input-wrapper">
                <Lock className="field-icon" size={20} />
                <input 
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLockedOut}
                />
                <button 
                  type="button"
                  className="toggle-password"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <div className="form-actions">
              <span className="forgot-link" onClick={() => navigate('/recovery')}>
                Forgot password?
              </span>
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
        <div className="login-slideshow-section">
          {slides.map((slide, index) => (
            <div 
              key={index} 
              className={`login-slide ${index === currentSlide ? "active" : ""}`}
            >
              <img 
                src={process.env.PUBLIC_URL + slide.image} 
                alt={slide.title} 
                className="login-slide-img" 
              />
              <div className="login-slide-overlay">
                <div className="login-slide-content">
                  <h3>{slide.title}</h3>
                  <p>{slide.subtitle}</p>
                </div>
              </div>
            </div>
          ))}
          <div className="login-slide-indicators">
            {slides.map((_, index) => (
              <span 
                key={index} 
                className={`indicator ${index === currentSlide ? "active" : ""}`}
                onClick={() => setCurrentSlide(index)}
              ></span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
