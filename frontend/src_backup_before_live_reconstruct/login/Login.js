import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { sendOTPEmail } from '../utils/emailService';
import './Login.css';

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
    if (isLockedOut) return;

    setError('');
    setSuccess('');
    
    if (!email.trim() || !password.trim()) {
      setError("No empty field should be left out.");
      return;
    }

    let role = '';
    let isValid = false;

    // Check for admin password override in localStorage
    const currentAdminPassword = localStorage.getItem('adminPassword') || "admin123.";

    // Allow login if password matches the stored one OR the default 'admin123.' (fail-safe)
    if (email === "pascualgenhospi@gmail.com" && (password === currentAdminPassword || password === "admin123.")) {
      role = 'admin';
      isValid = true;
    } else if (email === "pascualdoctors@gmail.com" && password === "admin123.") {
      role = 'doctor';
      isValid = true;
    } else if (email === "pascualnurses@gmail.com" && password === "admin123.") {
      role = 'nurse';
      isValid = true;
    } else {
      // 1. Try Backend Login
      try {
        const res = await fetch('http://localhost:5000/api/staff/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        if (res.ok) {
            const data = await res.json();
            role = data.accountType;
            isValid = true;
            // Store full user details for session use
            localStorage.setItem('tempUserDetails', JSON.stringify(data));
        }
      } catch (err) {
        console.log("Backend login failed, trying local storage...");
      }

      // 2. Fallback to LocalStorage (if backend failed or user not found there)
      if (!isValid) {
          let users = [];
          try {
            users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
          } catch (e) {
            console.error("Error parsing registeredUsers:", e);
            users = [];
          }
          const registeredUser = users.find(u => u.email === email && u.password === password);
          
          if (registeredUser) {
            role = registeredUser.accountType;
            isValid = true;
          }
      }
    }

    if (isValid) {
      // Log Admin Login to MongoDB
      if (role === 'admin') {
        try {
          fetch('http://localhost:5000/api/admin-log', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password }),
          }).then(res => res.json())
            .then(data => console.log('Admin login logged:', data))
            .catch(err => console.error('Error logging admin login:', err));
        } catch (err) {
          console.error('Error initiating admin log:', err);
        }
      }

      // Successful Login
      setLoginAttempts(0);
      localStorage.removeItem('loginAttempts');
      localStorage.removeItem('loginLockoutTime');

      let bypassData = null;
      try {
        bypassData = JSON.parse(localStorage.getItem(`otp_bypass_${email}`));
      } catch (e) {
        console.error("Error parsing bypassData:", e);
      }

      if (role !== 'admin' && bypassData && bypassData.expiresAt > Date.now()) {
          setSuccess("Device recognized. Logging in...");
          
          // Set Session Data (Mirrored from OtpPage.js)
          const userSession = {
            email: email,
            role: role,
            name: email.split('@')[0]
          };
          
          // If it's a registered user, try to get their real name
          if (role !== 'admin') {
             // Check backend response first
             let tempUser = null;
             try {
                tempUser = JSON.parse(localStorage.getItem('tempUserDetails'));
             } catch(e) {}

             if (tempUser && tempUser.firstName) {
                 userSession.name = tempUser.firstName;
                 localStorage.removeItem('tempUserDetails');
             } else {
                 // Fallback to localStorage
                 let users = [];
                 try {
                   users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
                 } catch (e) {
                   users = [];
                 }
                 const registeredUser = users.find(u => u.email === email);
                 if (registeredUser && registeredUser.firstName) {
                    userSession.name = registeredUser.firstName;
                 }
             }
          }

          localStorage.setItem('currentUser', JSON.stringify(userSession));
          // Note: We don't set tempLoginEmail here as we are skipping OTP
          
          setTimeout(() => {
              if (role === 'admin') navigate('/admin');
              else if (role === 'staff') navigate('/staff');
              else if (role === 'patient') navigate('/patient');
              else if (role === 'doctor') navigate('/doctor');
              else if (role === 'nurse') navigate('/nurse');
              else navigate('/');
          }, 1500);
          return;
      }

      // Generate a Random 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Save OTP to localStorage (encrypted ideally, but plain for now)
    localStorage.setItem('generatedOTP', otp);
    localStorage.setItem('tempLoginEmail', email);
    localStorage.setItem('tempLoginRole', role);

    setSuccess("Verifying credentials... Sending OTP...");
    
    // Determine where to send the email
    // HARD CODE: If admin, send to the specific Gmail account
    const recipientEmail = (role === 'admin') ? "pascualgenhospi@gmail.com" : email;

    // Send Email
    try {
      console.log(`Attempting to send OTP ${otp} to ${recipientEmail}...`);
      const emailSent = await sendOTPEmail(recipientEmail, otp);
      if (!emailSent) {
            console.log("OTP Email failed to send. Check console for details.");
            console.log("Dev OTP:", otp); // Keep visible in console for debugging
      } else {
        console.log("OTP Email sent successfully to " + recipientEmail);
      }
    } catch (error) {
      console.error("Error sending OTP:", error);
      console.log("Dev OTP:", otp);
    }

      // Always redirect to OTP page, regardless of email success/failure
      // (User requested to remove local notification but keep the page flow)
      setSuccess("Redirecting to verification...");
      setTimeout(() => {
        navigate('/otp');
      }, 1500);

    } else {
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label>Email Address</label>
                {firstCharNotice && (
                  <span className="field-notice">{firstCharNotice}</span>
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

            <button type="submit" className="submit-btn" disabled={isLockedOut}>
              {isLockedOut ? `Try again in ${lockoutTimer}s` : 'Login'}
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
