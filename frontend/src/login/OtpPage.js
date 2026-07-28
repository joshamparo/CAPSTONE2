import React, { useState, useRef, useEffect } from 'react';
import './OtpPage.css';
import { useNavigate } from 'react-router-dom';
import { sendOTPEmail } from '../utils/emailService';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

const OtpPage = () => {
  const [otp, setOtp] = useState(new Array(6).fill(""));
  const [displayEmail, setDisplayEmail] = useState("");
  const [displayRole, setDisplayRole] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const [entryTimer, setEntryTimer] = useState(60);
  const [otpEmailFailed, setOtpEmailFailed] = useState(false);
  const [displayOtp, setDisplayOtp] = useState("");
  const inputRefs = useRef([]);
  const navigate = useNavigate();

  useEffect(() => {
    // Entry Timer Countdown
    const timer = setInterval(() => {
      setEntryTimer((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Navigate when timer reaches 0
  useEffect(() => {
    if (entryTimer === 0) {
      navigate('/login');
    }
  }, [entryTimer, navigate]);

  useEffect(() => {
    // Get the email that was just used to log in
    const email = localStorage.getItem('tempLoginEmail');
    if (email) setDisplayEmail(email);
    const role = localStorage.getItem('tempLoginRole');
    if (role) setDisplayRole(role);

    // Check if previous email send failed and show the OTP on screen
    const failed = localStorage.getItem('otpEmailFailed') === 'true';
    const savedOtp = localStorage.getItem('displayOtpCode');
    if (failed && savedOtp) {
      setOtpEmailFailed(true);
      setDisplayOtp(savedOtp);
    }
  }, []);

  useEffect(() => {
    let interval;
    if (resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [resendTimer]);

  const handleResendOtp = async () => {
    if (resendTimer > 0) return;

    const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
    console.log("Resend OTP Generated:", newOtp); // For development/testing
    
    // Save new OTP to localStorage so verification works against the NEW code
    localStorage.setItem('generatedOTP', newOtp);
    
    // Ensure the resent email correctly targets the admin inbox if it's an admin account
    let targetEmail = displayEmail;
    const role = localStorage.getItem('tempLoginRole');
    if (role === 'admin' || displayEmail === 'pascualgenhospi@gmail.com') {
        targetEmail = 'pascualgenhospi@gmail.com';
    }

    // Send email
    let sent = false;
    try {
      sent = await sendOTPEmail(targetEmail, newOtp);
    } catch (_) {
      sent = false;
    }

    if (sent) {
      setResendTimer(60); // Start 60s cooldown
      setEntryTimer(60); // Reset entry timer for the new code
      setError(""); // Clear any previous errors
      setSuccess(`New code sent to ${displayEmail}`);
      setTimeout(() => setSuccess(""), 5000); // Clear success message after 5 seconds
      setOtpEmailFailed(false);
      setDisplayOtp("");
      localStorage.removeItem('otpEmailFailed');
      localStorage.removeItem('displayOtpCode');
    } else {
      setError("Failed to resend OTP. Check your connection.");
      setOtpEmailFailed(true);
      setDisplayOtp(newOtp);
      localStorage.setItem('otpEmailFailed', 'true');
      localStorage.setItem('displayOtpCode', newOtp);
      alert(`System Notice: OTP email could not be delivered.\n\nFor testing/demo purposes, your new one-time passcode is:\n\n    OTP: ${newOtp}`);
    }
  };

  const handleChange = (element, index) => {
    if (isNaN(element.value)) return false;

    let newOtp = [...otp];
    newOtp[index] = element.value;
    setOtp(newOtp);

    // Auto-focus next input
    if (element.value !== "" && index < 5) {
      inputRefs.current[index + 1].focus();
    }

    // Auto-submit when last digit is entered
    if (newOtp.every(digit => digit !== "")) {
      handleVerify(newOtp.join(""));
    }
  };

  const handleKeyDown = (e, index) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1].focus();
    }
  };

  const handleVerify = (code) => {
    // Get the generated OTP from localStorage
    const generatedOTP = localStorage.getItem('generatedOTP');
    
    // Check if the entered code matches the generated OTP
    // Also keeping "123456" as a fallback/backdoor for testing if needed (optional, but good for dev)
    // Removing backdoor as per user request for "strict matching"
    if (code === generatedOTP) {
      // Identity verified - clear temp storage and set verified session
      const role = localStorage.getItem('tempLoginRole');
      const email = localStorage.getItem('tempLoginEmail');
      
      // Save verified session
      let userSession = {
        email: email,
        role: role,
        name: email.split('@')[0] // Use part of email as name for now
      };
      
      // 1. Check for Backend Details (from Login.js)
      const tempUserDetails = localStorage.getItem('tempUserDetails');
      if (tempUserDetails) {
          try {
              const parsedDetails = JSON.parse(tempUserDetails);
              // Merge ALL backend details (including _id) into session
              userSession = { ...userSession, ...parsedDetails };
              
              // Ensure name is set correctly from backend data
              if (parsedDetails.firstName) {
                  userSession.name = parsedDetails.firstName;
              }
              
              // Clean up
              localStorage.removeItem('tempUserDetails');
          } catch (e) {
              console.error("Error parsing tempUserDetails:", e);
          }
      } else {
          // 2. Fallback to LocalStorage (Legacy/Offline)
          const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
          const registeredUser = users.find(u => u.email === email);
          if (registeredUser && registeredUser.firstName) {
            userSession.name = registeredUser.firstName;
            // Note: Legacy registeredUsers might not have _id, causing the issue for Admin if not from backend
          }
      }

      // Handle "Don't ask again for 4 days"
      if (dontAskAgain && role !== 'doctor' && role !== 'pharmacist') {
          const expirationDate = new Date();
          expirationDate.setDate(expirationDate.getDate() + 4);
          
          const bypassData = {
              email: email,
              expiresAt: expirationDate.getTime()
          };
          
          localStorage.setItem(`otp_bypass_${email}`, JSON.stringify(bypassData));
      }

      localStorage.setItem('currentUser', JSON.stringify(userSession));

      // Cleanup temp items
      localStorage.removeItem('tempLoginEmail');
      localStorage.removeItem('tempLoginRole');
      localStorage.removeItem('generatedOTP');
      localStorage.removeItem('otpEmailFailed');
      localStorage.removeItem('displayOtpCode'); 
      
      // Redirect based on role
      if (role === 'admin' || role === 'staff') {
        navigate('/admin');
      } else if (role === 'patient') {
        navigate('/patient');
      } else if (role === 'doctor') {
        navigate('/doctor');
      } else if (role === 'nurse') {
        navigate('/nurse');
      } else if (role === 'pharmacist') {
        navigate('/pharmacist');
      } else if (role === 'cashier') {
        navigate('/cashier');
      } else if (role === 'doctor_secretary') {
        navigate('/doctor-secretary');
      } else if (role === 'medtech') {
        navigate('/medtech');
      } else if (role === 'radiographer') {
        navigate('/radiographer');
      } else if (role === 'ecg_operator') {
        navigate('/ecg');
      } else if (role === 'physical_therapist') {
        navigate('/pt');
      } else {
        navigate('/');
      }
    } else {
      // Set error message instead of alert
      setError("Invalid OTP. Please try again.");
      setOtp(new Array(6).fill(""));
      inputRefs.current[0].focus();
    }
  };

  return (
    <div className="background-container">
      <div className="login-card">
        <div className="logo-container">
          <img
            src={process.env.PUBLIC_URL + "/images/pgh logo.png"}
            alt="PGH Logo"
            className="logo"
          />
        </div>

        {error && (
          <div className="error-card">
            <p className="error-message">{error}</p>
          </div>
        )}

        {success && (
          <div className="success-card">
            <p className="success-message">{success}</p>
          </div>
        )}

        <p className="email-display">{displayEmail || "admin@pascualcare.com"}</p>
        <h1 className="title">Approve Sign in Request</h1>

        {otpEmailFailed && displayOtp ? (
          <div style={{
            border: '1px solid #9ca3af',
            backgroundColor: '#f9fafb',
            borderRadius: '12px',
            padding: '1rem 1.25rem',
            marginBottom: '1.25rem',
            textAlign: 'center'
          }}>
            <p style={{ color: '#374151', fontWeight: 600, marginBottom: '0.5rem' }}>
              Email delivery is temporarily unavailable
            </p>
            <p style={{ color: '#4b5563', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              Use the code below to complete verification. We'll email your OTP once the service is restored.
            </p>
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '0.5rem',
              backgroundColor: 'white',
              border: '1px solid #d1d5db',
              borderRadius: '10px',
              padding: '0.75rem 1rem',
              fontSize: '1.75rem',
              fontWeight: 800,
              letterSpacing: '0.35em',
              color: '#111827',
              fontFamily: 'monospace',
              userSelect: 'all'
            }}>
              {displayOtp}
            </div>
          </div>
        ) : (
          <p className="instruction">
            An OTP code has been sent to your registered email. 
            Please check your inbox (and spam/junk folder) then enter the 6-digit code below.
          </p>
        )}

        <p className="entry-timer" style={{ textAlign: 'center', color: 'black', fontWeight: 'bold', marginBottom: '1rem' }}>
          {Math.floor(entryTimer / 60)}:{String(entryTimer % 60).padStart(2, '0')}
        </p>

        <div className="otp-inputs">
          {otp.map((data, index) => (
            <input
              key={index}
              type="text"
              maxLength="1"
              ref={(el) => (inputRefs.current[index] = el)}
              value={data}
              onChange={(e) => handleChange(e.target, index)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              inputMode="numeric"
              pattern="\d*"
            />
          ))}
        </div>

        <div className="refresh-section">
          <p>Didn't receive a sign-in request?</p>
          {resendTimer > 0 ? (
             <p className="resend-timer">
               Resend code in <strong style={{color: '#ea580c'}}>{resendTimer}s</strong>
             </p>
          ) : (
             <button 
               className="resend-link" 
               onClick={handleResendOtp}
             >
               Resend Code
             </button>
          )}
        </div>

        {displayRole !== 'doctor' && displayRole !== 'pharmacist' && (
          <div className="checkbox-container">
            <input 
              type="checkbox" 
              id="remember" 
              checked={dontAskAgain}
              onChange={(e) => setDontAskAgain(e.target.checked)}
            />
            <label htmlFor="remember">Don't ask again for 4 days</label>
          </div>
        )}

        <button className="reset-btn" onClick={() => navigate('/recovery')}>Reset your password</button>
      </div>
    </div>
  );
};

export default OtpPage;
