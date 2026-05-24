import React, { useState, useRef, useEffect } from 'react';
import './OtpPage.css';
import { useNavigate } from 'react-router-dom';
import { sendOTPEmail } from '../utils/emailService';

const OtpPage = () => {
  const [otp, setOtp] = useState(new Array(6).fill(""));
  const [displayEmail, setDisplayEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const [entryTimer, setEntryTimer] = useState(60);
  const [showEntryTimer, setShowEntryTimer] = useState(true);
  const inputRefs = useRef([]);
  const navigate = useNavigate();

  useEffect(() => {
    // Entry Timer Countdown
    if (!showEntryTimer) return;

    const timer = setInterval(() => {
      setEntryTimer((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          navigate('/login'); // Redirect to login when time is up
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [navigate, showEntryTimer]);

  useEffect(() => {
    // Get the email that was just used to log in
    const email = localStorage.getItem('tempLoginEmail');
    if (email) setDisplayEmail(email);
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

    // Hide the initial entry timer when user requests a new code
    setShowEntryTimer(false);

    const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
    console.log("Resend OTP Generated:", newOtp); // For development/testing
    
    // Save new OTP to localStorage so verification works against the NEW code
    localStorage.setItem('generatedOTP', newOtp);
    
    // Send email
    // Note: In a real app, you might want to handle the loading state here
    const emailSent = await sendOTPEmail(displayEmail, newOtp);
    
    if (emailSent) {
      setResendTimer(60); // Start 60s cooldown
      setError(""); // Clear any previous errors
      setSuccess(`New code sent to ${displayEmail}`);
      setTimeout(() => setSuccess(""), 5000); // Clear success message after 5 seconds
    } else {
      setError("Failed to resend OTP. Please try again.");
    }
  };

  const handleChange = (element, index) => {
    if (isNaN(element.value)) return false;

    let newOtp = [...otp];
    newOtp[index] = element.value;
    setOtp(newOtp);

    // Auto-focus next input
    if (element.value !== "" && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when last digit is entered
    if (newOtp.every(digit => digit !== "")) {
      handleVerify(newOtp.join(""));
    }
  };

  const handleKeyDown = (e, index) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
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
      const userSession = {
        email: email,
        role: role,
        name: email.split('@')[0] // Use part of email as name for now, or fetch from registeredUsers
      };
      
      // Handle "Don't ask again for 30 days"
      if (dontAskAgain) {
          const expirationDate = new Date();
          expirationDate.setDate(expirationDate.getDate() + 30);
          
          const bypassData = {
              email: email,
              expiresAt: expirationDate.getTime()
          };
          
          localStorage.setItem(`otp_bypass_${email}`, JSON.stringify(bypassData));
      }

      // If it's a registered user, try to get their real name
      let users = [];
      try {
        users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      } catch (e) {
        console.error("Error parsing registeredUsers in OtpPage:", e);
        users = [];
      }
      const registeredUser = users.find(u => u.email === email);
      if (registeredUser && registeredUser.firstName) {
        userSession.name = registeredUser.firstName;
      }

      localStorage.setItem('currentUser', JSON.stringify(userSession));

      // Cleanup temp items
      localStorage.removeItem('tempLoginEmail');
      localStorage.removeItem('tempLoginRole');
      localStorage.removeItem('generatedOTP'); 
      
      // Redirect based on role
      if (role === 'admin') {
        navigate('/admin');
      } else if (role === 'staff') {
        navigate('/staff');
      } else if (role === 'patient') {
        navigate('/patient');
      } else if (role === 'doctor') {
        navigate('/doctor');
      } else if (role === 'nurse') {
        navigate('/nurse');
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

        <p className="email-display">{displayEmail || "admin@pascualinga.com"}</p>
        <h1 className="title">Approve Sign in Request</h1>

        <p className="instruction">
          An OTP code has been sent to your registered device. 
          Please enter the 6-digit code below to access the Admin Panel.
        </p>

        {showEntryTimer && (
          <p className="entry-timer" style={{ textAlign: 'center', color: 'black', fontWeight: 'bold', marginBottom: '1rem' }}>
            {Math.floor(entryTimer / 60)}:{String(entryTimer % 60).padStart(2, '0')}
          </p>
        )}

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

        <div className="checkbox-container">
          <input 
            type="checkbox" 
            id="remember" 
            checked={dontAskAgain}
            onChange={(e) => setDontAskAgain(e.target.checked)}
          />
          <label htmlFor="remember">Don't ask again for 30 days</label>
        </div>

        <button className="reset-btn" onClick={() => navigate('/recovery')}>Reset your password</button>
      </div>
    </div>
  );
};

export default OtpPage;
