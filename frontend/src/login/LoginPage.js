
import React, { useState } from 'react';
import './LoginPage.css';
import { User, Lock, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

  const handleLogin = (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    
    if (!email.trim() || !password.trim()) {
      setError("No empty field should be left out.");
      return;
    }

    if (email === "admin@pgh.com" && password === "12345") {
      setSuccess("Login Successful! Redirecting...");
      localStorage.setItem('tempLoginEmail', email);
      setTimeout(() => {
        navigate('/otp');
      }, 1500);
    } else {
      setError("Invalid Email or Password.");
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <button className="back-button" onClick={() => navigate('/')}>
          <ArrowLeft size={20} /> Back to Home
        </button>
        
        <div className="login-header">
          <img 
             src={process.env.PUBLIC_URL + "/images/logo.png"} 
             alt="Logo" 
             className="login-logo"
             onError={(e) => e.target.style.display = 'none'} 
          />
          <h2>Welcome Back</h2>
          <p>Please sign in to your account</p>
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
        
        <form onSubmit={handleLogin} className="login-form">
          <div className="form-group">
            <label>Email Address</label>
            <div className="input-wrapper">
              <User size={18} className="input-icon" />
              <input 
                type="email" 
                placeholder="Enter your email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>Password</label>
            <div className="input-wrapper">
              <Lock size={18} className="input-icon" />
              <input 
                type="password" 
                placeholder="Enter your password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-options">
            <label className="checkbox-label">
              <input type="checkbox" /> Remember me
            </label>
            <a href="#" className="forgot-password">Forgot Password?</a>
          </div>

          <button type="submit" className="login-btn">Sign In</button>
        </form>
        
        <div className="login-footer">
          <p>Don't have an account? <a href="#">Sign up</a></p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
