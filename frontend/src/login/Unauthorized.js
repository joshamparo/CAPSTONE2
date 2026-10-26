import { useNavigate } from 'react-router-dom';
import './Login.css';

export default function Unauthorized() {
  const navigate = useNavigate();

  return (
    <div className="login-container">
      <div className="auth-card">
        <div className="login-header">
          <img
            src={process.env.PUBLIC_URL + '/images/pgh logo.png'}
            alt="PGH Logo"
            className="brand-logo"
          />
          <h2>Access Denied</h2>
          <p className="subtitle">
            Your account does not have permission to open this page. Protected information was not displayed.
          </p>
        </div>
        <button type="button" className="submit-btn" onClick={() => navigate('/', { replace: true })}>
          Return to Home
        </button>
      </div>
    </div>
  );
}
