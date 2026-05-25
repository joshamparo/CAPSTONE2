import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { User, Lock, ArrowLeft, Eye, EyeOff, ShieldCheck, CheckCircle2, XCircle } from 'lucide-react';
import './Login.css';
import { sendOTPEmail } from '../utils/emailService';

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
  
  // First Login Change Password State
  const [isFirstLogin, setIsFirstLogin] = useState(false);
  const [tempPassword, setTempPassword] = useState('');
  
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('mode') === 'first-login') {
      setIsFirstLogin(true);
      const emailParam = params.get('email');
      if (emailParam) {
        setEmail(decodeURIComponent(emailParam));
      }
    }
  }, [location]);

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

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!tempPassword || !newPassword || !confirmNewPassword) {
      setError("Please fill in all fields.");
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setError("New passwords do not match.");
      return;
    }

    if (newPassword.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }

    setIsSubmittingPassword(true);
    try {
      const res = await fetch(`${API_BASE}/api/staff/first-login-change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          tempPassword: tempPassword.trim(),
          newPassword: newPassword.trim()
        })
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess("Password updated successfully! You can now login.");
        setTimeout(() => {
          setIsFirstLogin(false);
          setTempPassword('');
          setNewPassword('');
          setConfirmNewPassword('');
          // Clear URL params
          navigate('/login', { replace: true });
        }, 2000);
      } else {
        setError(data.message || "Failed to update password.");
      }
    } catch (err) {
      console.error("Change password error:", err);
      setError("Cannot connect to the server.");
    } finally {
      setIsSubmittingPassword(false);
    }
  };

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

    // 1. Check Testing/Mock Accounts First (Fail-safes)
    if (email === 'pascualgenhospi@gmail.com' && password === 'admin123.') {
        role = 'admin';
        isValid = true;
    } else if (email === 'pascualdoctors@gmail.com' && password === 'admin123.') {
        role = 'doctor';
        isValid = true;
    } else if (email === 'pascualnurses@gmail.com' && password === 'admin123.') {
        role = 'nurse';
        isValid = true;
        localStorage.setItem('tempUserDetails', JSON.stringify({
          email,
          account_type: 'nurse',
          department: 'ER',
          specialization: 'ER',
          firstName: 'Pascual',
          first_name: 'Pascual',
          last_name: 'Nurse'
        }));
    } else {
        // 2. Fallback to Real Backend Authentication
        try {
          const res = await fetch(`${API_BASE}/api/staff/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim(), password: password.trim() })
          });
    
          if (res.ok) {
            const data = await res.json();
            role = (data.account_type || data.accountType || '').toLowerCase(); // Ensures routing doesn't break
            isValid = true;
            localStorage.setItem('tempUserDetails', JSON.stringify(data));
          } else {
            const errorData = await res.json();
            if (res.status === 403 && errorData.mustChangePassword) {
              // Force change password mode
              setError("Security update required: Please set your new password before logging in.");
              setIsFirstLogin(true);
              setEmail(errorData.email || email);
              setTempPassword(password); // Pre-fill temp password with what they just tried
              return;
            }
            setError(errorData.message || 'Invalid Email or Password.');
          }
        } catch (err) {
          console.error("Login API connection error:", err);
          setError("Cannot connect to the server. Please try again later.");
          return; 
        }
    }

    if (isValid) {
      // Log Admin/Staff Login to Database
      if (['admin', 'staff', 'cashier', 'doctor_secretary', 'doctor', 'nurse', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist'].includes(role)) {
        try {
          // Log to Admin Log (Security Audit)
          fetch(`${API_BASE}/api/admin-log`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email }),
          }).catch(err => console.error('Error logging admin login:', err));

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

      if (role !== 'doctor' && role !== 'pharmacist' && bypassData && bypassData.expiresAt > Date.now()) {
          setSuccess("Device recognized. Logging in...");
          
          // Set Session Data (Mirrored from OtpPage.js)
          let userSession = {
            email: email,
            role: role,
            name: email.split('@')[0]
          };
          
          // 1. Check for Backend Details (from Login.js fetch)
          // Note: If we just logged in via backend, tempUserDetails should be set
          let tempUser = null;
          try {
             tempUser = JSON.parse(localStorage.getItem('tempUserDetails'));
          } catch(e) {}

          if (tempUser) {
              // Merge ALL backend details (including _id) into session
              userSession = { ...userSession, ...tempUser };
              
              if (tempUser.first_name || tempUser.firstName) {
                  userSession.name = tempUser.first_name || tempUser.firstName;
              }
              // Make sure to capture correct role from backend
              if (tempUser.account_type || tempUser.accountType) {
                  role = tempUser.account_type || tempUser.accountType;
                  userSession.role = role;
              }
              localStorage.removeItem('tempUserDetails');
          } else {
             // 2. Fallback to LocalStorage (Legacy/Offline)
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
             
             // Ensure admin role is preserved even in fallback
             if (!role && email === 'pascualgenhospi@gmail.com') {
                 role = 'admin';
                 userSession.role = 'admin';
             }
          }

          localStorage.setItem('currentUser', JSON.stringify(userSession));
          // Note: We don't set tempLoginEmail here as we are skipping OTP
          
          setTimeout(() => {
              if (role === 'admin' || role === 'staff') navigate('/admin');
              else if (role === 'patient') navigate('/patient');
              else if (role === 'doctor') navigate('/doctor');
              else if (role === 'nurse') navigate('/nurse');
              else if (role === 'pharmacist') navigate('/pharmacist');
              else if (role === 'cashier') navigate('/cashier');
              else if (role === 'doctor_secretary') navigate('/doctor-secretary');
              else if (role === 'medtech') navigate('/medtech');
              else if (role === 'radiographer') navigate('/radiographer');
              else if (role === 'ecg_operator') navigate('/ecg');
              else if (role === 'physical_therapist') navigate('/pt');
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
    let recipientEmail = email;
    if (role === 'admin' || email === 'pascualgenhospi@gmail.com') {
        recipientEmail = "pascualgenhospi@gmail.com";
    }

    // Send Email
    try {
      console.log(`Attempting to send OTP ${otp} to ${recipientEmail}...`);
      let sent = await sendOTPEmail(recipientEmail, otp);

      if (!sent) {
        console.log("OTP Email failed to send. Check console for details.");
        console.log("Dev OTP:", otp);
        alert(`System Warning: Failed to send OTP email.\n\n[Developer Bypass] Your OTP is: ${otp}`);
      } else {
        console.log("OTP Email sent successfully to " + recipientEmail);
      }
    } catch (error) {
      console.error("Error sending OTP:", error);
      console.log("Dev OTP:", otp);
      alert(`System Warning: Server connection failed.\n\n[Developer Bypass] Your OTP is: ${otp}`);
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
            {isFirstLogin ? (
              <>
                <h2>Security Update</h2>
                <p className="subtitle">Please set your new account password</p>
              </>
            ) : (
              <>
                <h2>Welcome Back</h2>
                <p className="subtitle">Please sign in to continue</p>
              </>
            )}
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

          {isFirstLogin ? (
            <form onSubmit={handleChangePassword} className="login-form">
              <div className="form-group">
                <label>Email Address</label>
                <div className="input-wrapper disabled">
                  <User className="field-icon" size={20} />
                  <input 
                    type="text" 
                    value={email}
                    disabled={true}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Temporary Password</label>
                <div className="input-wrapper">
                  <Lock className="field-icon" size={20} />
                  <input 
                    type={showTempPassword ? "text" : "password"}
                    placeholder="Enter temporary password" 
                    value={tempPassword}
                    onChange={(e) => setTempPassword(e.target.value)}
                    required
                  />
                  <button 
                    type="button"
                    className="toggle-password"
                    onClick={() => setShowTempPassword(!showTempPassword)}
                  >
                    {showTempPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label>New Password</label>
                <div className="input-wrapper">
                  <ShieldCheck className="field-icon" size={20} />
                  <input 
                    type={showNewPassword ? "text" : "password"}
                    placeholder="Enter new password" 
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                  <button 
                    type="button"
                    className="toggle-password"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                  >
                    {showNewPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
                <div className="password-requirements">
                  <p className={newPassword.length >= 6 ? 'valid' : ''}>
                    {newPassword.length >= 6 ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                    At least 6 characters
                  </p>
                </div>
              </div>

              <div className="form-group">
                <label>Confirm New Password</label>
                <div className="input-wrapper">
                  <ShieldCheck className="field-icon" size={20} />
                  <input 
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Confirm new password" 
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    required
                  />
                  <button 
                    type="button"
                    className="toggle-password"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
                {confirmNewPassword && (
                  <div className="password-requirements">
                    <p className={newPassword === confirmNewPassword ? 'valid' : 'invalid'}>
                      {newPassword === confirmNewPassword ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                      Passwords match
                    </p>
                  </div>
                )}
              </div>

              <button type="submit" className="submit-btn" disabled={isSubmittingPassword}>
                {isSubmittingPassword ? "Updating Password..." : "Update Password & Continue"}
              </button>

              <div className="form-actions center">
                <span className="forgot-link" onClick={() => setIsFirstLogin(false)}>
                  Back to standard login
                </span>
              </div>
            </form>
          ) : (
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

              <button type="submit" className="submit-btn" disabled={isLockedOut}>
                Login
              </button>
            </form>
          )}

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
