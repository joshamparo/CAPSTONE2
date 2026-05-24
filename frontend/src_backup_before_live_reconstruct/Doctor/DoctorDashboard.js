import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Calendar, ClipboardList, User, Activity, Stethoscope } from 'lucide-react';
import '../Admin/AdminDashboard.css'; 

function DoctorDashboard() {
  const navigate = useNavigate();
  const [view, setView] = React.useState('overview');
  const [user, setUser] = React.useState({ name: 'Doctor' });

  React.useEffect(() => {
    try {
        const currentUser = JSON.parse(localStorage.getItem('currentUser'));
        if (currentUser && currentUser.name) {
            setUser({ name: currentUser.name });
        }
    } catch (e) {
        // ignore
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('tempLoginEmail');
    localStorage.removeItem('tempLoginRole');
    localStorage.removeItem('currentUser');
    navigate('/login');
  };

  return (
    <div className="admin-container">
      <aside className="admin-sidebar">
        <div className="admin-logo">
           <img src="/images/pgh logo.png" alt="PGH Logo" className="logo-img" />
           <div className="logo-text">
               <div>Pascual General</div>
               <div>Hospital</div>
           </div>
        </div>
        
        <nav className="admin-nav">
          <div className={`nav-item ${view === 'overview' ? 'active' : ''}`} onClick={() => setView('overview')}>
            <Activity size={26} />
            <span>Overview</span>
          </div>
          <div className={`nav-item ${view === 'appointments' ? 'active' : ''}`} onClick={() => setView('appointments')}>
            <Calendar size={26} />
            <span>Appointments</span>
          </div>
          <div className={`nav-item ${view === 'patients' ? 'active' : ''}`} onClick={() => setView('patients')}>
            <User size={26} />
            <span>My Patients</span>
          </div>
        </nav>

        <div className="admin-sidebar-footer">
          <div className="nav-item" onClick={handleLogout}>
            <LogOut size={26} />
            <span>Logout</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="admin-header">
            <h2>Doctor Dashboard</h2>
            <div className="header-profile-wrapper">
                <div className="header-profile-info">
                    <span className="header-profile-name">Dr. {user.name}</span>
                </div>
                <div className="header-avatar-circle">
                    <User size={20} color="#555" />
                </div>
            </div>
        </header>
        <section className="content-body">
            {view === 'overview' && (
                <div>
                    <h3>Welcome back, Dr. {user.name}</h3>
                    <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginTop: '20px'}}>
                        <div className="stat-card">
                            <h4>Today's Appointments</h4>
                            <p className="stat-number">8</p>
                        </div>
                        <div className="stat-card">
                            <h4>Total Patients</h4>
                            <p className="stat-number">145</p>
                        </div>
                    </div>
                </div>
            )}
            {view === 'appointments' && (
                <div>
                    <h3>Appointments</h3>
                    <p>No appointments scheduled.</p>
                </div>
            )}
            {view === 'patients' && (
                <div>
                    <h3>My Patients</h3>
                    <p>No patients found.</p>
                </div>
            )}
        </section>
      </main>
    </div>
  );
}

export default DoctorDashboard;