import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  LogOut, 
  Calendar, 
  ClipboardList, 
  User, 
  Activity, 
  LayoutDashboard, 
  Users, 
  FileText, 
  MessageSquare, 
  ChevronDown, 
  ChevronUp, 
  Bell, 
  Settings,
  AlertCircle,
  Bed,
  UserCheck,
  Search,
  Eye,
  Trash2,
  Edit,
  ArrowLeft,
  QrCode,
  BedDouble,
  Stethoscope,
  Clipboard,
  UserPlus,
  LogIn,
  Edit2,
  Info
} from 'lucide-react';
import '../Admin/AdminDashboard.css'; 

function NurseDashboard() {
  const navigate = useNavigate();
  const [view, setView] = useState('overview');
  const [user, setUser] = useState({ name: 'Nurse' });
  const [isSchedulesOpen, setIsSchedulesOpen] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // Admission State
  const [showAdmissionModal, setShowAdmissionModal] = useState(false);
  const [selectedPatientForAdmission, setSelectedPatientForAdmission] = useState(null);
  const [admissionFormData, setAdmissionFormData] = useState({
    wardNumber: '',
    diagnosis: '',
    attendingDoctor: ''
  });

  // Clinical Update State
  const [showClinicalUpdateModal, setShowClinicalUpdateModal] = useState(false);
  const [selectedPatientForClinicalUpdate, setSelectedPatientForClinicalUpdate] = useState(null);
  const [clinicalUpdateFormData, setClinicalUpdateFormData] = useState({
    type: 'Vitals',
    bloodPressure: '',
    heartRate: '',
    temperature: '',
    respiratoryRate: '',
    notes: ''
  });

  // Stats State
  const [stats, setStats] = useState({
    patients: 0,
    inpatients: 0,
    accounts: 0
  });

  // Patients Data State
  const [patientsList, setPatientsList] = useState([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [loadingPatients, setLoadingPatients] = useState(false);

  // Edit Patient State
  const [editingPatient, setEditingPatient] = useState(null);
  const [editFormData, setEditFormData] = useState({});
  const [updatePatientError, setUpdatePatientError] = useState("");

  // Patient Detail View State
  const [selectedPatientDetail, setSelectedPatientDetail] = useState(null);

  // Request Correction State
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestMessage, setRequestMessage] = useState("");
  const [requestStatus, setRequestStatus] = useState(null);

  // Validation State
  const [nameNotice, setNameNotice] = useState("");
  const [nameNoticeField, setNameNoticeField] = useState(null);
  const [ageNotice, setAgeNotice] = useState("");
  const [ageNoticeField, setAgeNoticeField] = useState(null);
  const [phoneNotice, setPhoneNotice] = useState("");
  const [phoneNoticeField, setPhoneNoticeField] = useState(null);
  const [emailNotice, setEmailNotice] = useState("");
  const [emailNoticeField, setEmailNoticeField] = useState(null);
  const [addressNotice, setAddressNotice] = useState("");
  const [addressNoticeField, setAddressNoticeField] = useState(null);
  const [countryNotice, setCountryNotice] = useState("");
  const [countryNoticeField, setCountryNoticeField] = useState(null);
  
  // Location Data
  const [selectedCity, setSelectedCity] = useState("");
  const [selectedProvince, setSelectedProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");

  const ncrCalabarzonCities = [
    // NCR
    { city: "Caloocan", province: "Metro Manila", zip: "1400" },
    { city: "Las Piñas", province: "Metro Manila", zip: "1740" },
    { city: "Makati", province: "Metro Manila", zip: "1200" },
    { city: "Malabon", province: "Metro Manila", zip: "1470" },
    { city: "Mandaluyong", province: "Metro Manila", zip: "1550" },
    { city: "Manila", province: "Metro Manila", zip: "1000" },
    { city: "Marikina", province: "Metro Manila", zip: "1800" },
    { city: "Muntinlupa", province: "Metro Manila", zip: "1770" },
    { city: "Navotas", province: "Metro Manila", zip: "1485" },
    { city: "Parañaque", province: "Metro Manila", zip: "1700" },
    { city: "Pasay", province: "Metro Manila", zip: "1300" },
    { city: "Pasig", province: "Metro Manila", zip: "1600" },
    { city: "Pateros", province: "Metro Manila", zip: "1620" },
    { city: "Quezon City", province: "Metro Manila", zip: "1100" },
    { city: "San Juan", province: "Metro Manila", zip: "1500" },
    { city: "Taguig", province: "Metro Manila", zip: "1630" },
    { city: "Valenzuela", province: "Metro Manila", zip: "1440" },
    // Cavite
    { city: "Bacoor", province: "Cavite", zip: "4102" },
    { city: "Cavite City", province: "Cavite", zip: "4100" },
    { city: "Dasmariñas", province: "Cavite", zip: "4114" },
    { city: "Imus", province: "Cavite", zip: "4103" },
    { city: "Tagaytay", province: "Cavite", zip: "4120" },
    { city: "General Trias", province: "Cavite", zip: "4107" },
    // Laguna
    { city: "Biñan", province: "Laguna", zip: "4024" },
    { city: "Cabuyao", province: "Laguna", zip: "4025" },
    { city: "Calamba", province: "Laguna", zip: "4027" },
    { city: "San Pablo", province: "Laguna", zip: "4000" },
    { city: "Santa Rosa", province: "Laguna", zip: "4026" },
    { city: "San Pedro", province: "Laguna", zip: "4023" },
    // Batangas
    { city: "Batangas City", province: "Batangas", zip: "4200" },
    { city: "Lipa", province: "Batangas", zip: "4217" },
    { city: "Tanauan", province: "Batangas", zip: "4232" },
    { city: "Santo Tomas", province: "Batangas", zip: "4234" },
    // Rizal
    { city: "Antipolo", province: "Rizal", zip: "1870" },
    { city: "Cainta", province: "Rizal", zip: "1900" },
    { city: "Taytay", province: "Rizal", zip: "1920" },
    { city: "Binangonan", province: "Rizal", zip: "1940" },
    // Quezon
    { city: "Lucena", province: "Quezon", zip: "4301" },
    { city: "Tayabas", province: "Quezon", zip: "4327" },
  ];

  // Profile Form State
  const [profileData, setProfileData] = useState({
    username: '',
    email: '',
    phone: '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [profileErrors, setProfileErrors] = useState({});
  const [profileSuccess, setProfileSuccess] = useState('');
  const [formError, setFormError] = useState('');

  // Notifications Data
  const [notifications, setNotifications] = useState([
    { id: 1, title: 'System Login', message: 'You logged in successfully.', time: 'Just now', type: 'info', unread: true },
    { id: 2, title: 'New Protocol', message: 'Updated safety protocols available.', time: '2 hours ago', type: 'alert', unread: true },
    { id: 3, title: 'Shift Reminder', message: 'Upcoming shift tomorrow at 8 AM.', time: '5 hours ago', type: 'reminder', unread: true }
  ]);

  const handleMarkAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, unread: false })));
  };

  const unreadCount = notifications.filter(n => n.unread).length;

  const [isFormValid, setIsFormValid] = useState(false);

  React.useEffect(() => {
    try {
        const currentUser = JSON.parse(localStorage.getItem('currentUser'));
        if (currentUser && currentUser.name) {
            setUser({ name: currentUser.name });
            setProfileData(prev => ({
                ...prev,
                username: currentUser.name,
                email: currentUser.email || 'nurse@hospital.com', // fallback
                phone: currentUser.phone || '09123456789' // fallback
            }));
        }
    } catch (e) {
        // ignore
    }
  }, []);

  React.useEffect(() => {
    // Validation Logic
    const isValid = () => {
        if (!profileData.username || !profileData.email || !profileData.phone) return false;
        
        if (profileData.newPassword) {
            if (profileData.newPassword.length < 6) return false;
            if (profileData.newPassword !== profileData.confirmPassword) return false;
            if (!profileData.currentPassword) return false;
        }
        return true;
    };
    setIsFormValid(isValid());
  }, [profileData]);

  // Fetch Dashboard Stats
  React.useEffect(() => {
    const fetchStats = async () => {
        try {
            const res = await fetch('http://localhost:5000/api/stats/overview');
            const data = await res.json();
            if (res.ok) {
                setStats(data);
            }
        } catch (error) {
            console.error('Error fetching stats:', error);
        }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 10000); // Poll every 10s for real-time updates
    return () => clearInterval(interval);
  }, []);

  // Fetch Patients List
  React.useEffect(() => {
    if (view === 'patients') {
        const fetchPatients = async () => {
            setLoadingPatients(true);
            try {
                const res = await fetch('http://localhost:5000/api/patients');
                if (res.ok) {
                    const data = await res.json();
                    setPatientsList(data);
                }
            } catch (error) {
                console.error("Error fetching patients:", error);
            } finally {
                setLoadingPatients(false);
            }
        };
        fetchPatients();
    }
  }, [view]);

  const handleProfileUpdate = (e) => {
    e.preventDefault();
    
    const errors = {};
    if (!profileData.username) errors.username = "Username is required";
    if (!profileData.email) errors.email = "Email is required";
    if (!profileData.phone) errors.phone = "Phone is required";
    
    if (profileData.newPassword) {
        if (profileData.newPassword.length < 6) errors.newPassword = "Password must be at least 6 characters";
        if (profileData.newPassword !== profileData.confirmPassword) errors.confirmPassword = "Passwords do not match";
        if (!profileData.currentPassword) errors.currentPassword = "Current password is required";
    }

    // Strict validation per user request: "nurse cant just click the save changes button without entering the current password..."
    // Enforcing password fields as required for any update in this view
    if (!profileData.currentPassword) errors.currentPassword = "Current password is required";
    if (!profileData.newPassword) errors.newPassword = "New password is required";
    if (!profileData.confirmPassword) errors.confirmPassword = "Confirm password is required";
    
    setProfileErrors(errors);
    
    if (Object.keys(errors).length > 0) {
        setFormError("Fill out the form");
        return;
    }

    // Simulate API call and success
    // Update local user display
    setUser(prev => ({ ...prev, name: profileData.username }));
    
    // Update localStorage to persist changes
    try {
        const currentUser = JSON.parse(localStorage.getItem('currentUser')) || {};
        const updatedUser = {
            ...currentUser,
            name: profileData.username,
            email: profileData.email,
            phone: profileData.phone
        };
        localStorage.setItem('currentUser', JSON.stringify(updatedUser));
        
        // Dispatch a storage event to notify other components if needed
        window.dispatchEvent(new Event('storage'));
    } catch (e) {
        console.error("Error updating local storage:", e);
    }
    
    // Automatically close without message
    setView('overview');
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setProfileData(prev => ({ ...prev, [name]: value }));
    // Clear error when user types
    if (profileErrors[name]) {
        setProfileErrors(prev => ({ ...prev, [name]: null }));
    }
    if (formError) setFormError('');
  };

  const handleRequestSubmit = async (e) => {
    e.preventDefault();
    setRequestStatus('submitting');
    
    try {
        const response = await fetch('http://localhost:5000/api/requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                patientId: editingPatient._id,
                patientName: `${editingPatient.firstName} ${editingPatient.lastName}`,
                requestedBy: user.name || 'Nurse',
                message: requestMessage
            })
        });

        if (response.ok) {
            setRequestStatus('success');
            setTimeout(() => {
                setShowRequestModal(false);
                setRequestMessage("");
                setRequestStatus(null);
            }, 2000);
        } else {
            setRequestStatus('error');
        }
    } catch (error) {
        console.error("Error submitting request:", error);
        setRequestStatus('error');
    }
  };

  const handleLogout = async () => {
    try {
        const currentUser = JSON.parse(localStorage.getItem('currentUser'));
        if (currentUser && currentUser._id) {
            await fetch('http://localhost:5000/api/staff/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    id: currentUser._id, 
                    accountType: currentUser.accountType || 'nurse' 
                })
            });
        }
    } catch (error) {
        console.error("Logout error:", error);
    }

    localStorage.removeItem('tempLoginEmail');
    localStorage.removeItem('tempLoginRole');
    localStorage.removeItem('currentUser');
    navigate('/login');
  };

  // --- Validation Functions (Reused from Admin) ---

  const handleCityChange = (e) => {
    const city = e.target.value;
    setSelectedCity(city);
    const data = ncrCalabarzonCities.find(c => c.city === city);
    if (data) {
      setSelectedProvince(data.province);
      setPostalCode(data.zip);
      setEditFormData(prev => ({
        ...prev,
        city: city,
        province: data.province,
        postalCode: data.zip
      }));
    } else {
      setSelectedProvince("");
      setPostalCode("");
      setEditFormData(prev => ({
        ...prev,
        city: city,
        province: "",
        postalCode: ""
      }));
    }
  };

  const handleNameInput = (e, fieldId) => {
    const allowedKeys = ["Backspace", "Tab", "ArrowLeft", "ArrowRight", "Delete", "Enter", "Escape", " "];
    const isLetter = /^[a-zA-Z]$/.test(e.key);

    if (!isLetter && !allowedKeys.includes(e.key)) {
      e.preventDefault();
      setNameNoticeField(fieldId);
      setNameNotice("Numbers and special characters are not allowed.");
    } else if (isLetter && nameNoticeField === fieldId) {
      setNameNotice("");
      setNameNoticeField(null);
    }
  };

  const handlePhoneInput = (e, fieldId) => {
    const allowedKeys = ["Backspace", "Tab", "ArrowLeft", "ArrowRight", "Delete", "Enter", "Escape"];
    const isNumber = /^[0-9]$/.test(e.key);
    const currentVal = e.target.value;
    const currentLength = currentVal.length;

    if (!isNumber && !allowedKeys.includes(e.key)) {
      e.preventDefault();
      setPhoneNoticeField(fieldId);
      setPhoneNotice("Only numbers are allowed.");
    } else if (isNumber) {
      if (currentLength === 0 && e.key !== "0") {
         e.preventDefault();
         setPhoneNoticeField(fieldId);
         setPhoneNotice("Phone number must start with 0.");
      } else if (currentLength === 1 && e.key !== "9") {
         e.preventDefault();
         setPhoneNoticeField(fieldId);
         setPhoneNotice("Phone number must start with 09.");
      } else if (currentLength >= 11) {
        e.preventDefault();
        setPhoneNoticeField(fieldId);
        setPhoneNotice("Maximum of 11 numbers only.");
      } else if (phoneNoticeField === fieldId) {
        setPhoneNotice("");
        setPhoneNoticeField(null);
      }
    } else if (allowedKeys.includes(e.key)) {
      if (phoneNoticeField === fieldId) {
        setPhoneNotice("");
        setPhoneNoticeField(null);
      }
    }
  };

  const handleCountryInput = (e, fieldId) => {
    const allowedKeys = ["Backspace", "Tab", "ArrowLeft", "ArrowRight", "Delete", "Enter", "Escape", " "];
    const isLetter = /^[a-zA-Z]$/.test(e.key);

    if (!isLetter && !allowedKeys.includes(e.key)) {
      e.preventDefault();
      setCountryNoticeField(fieldId);
      setCountryNotice("Special characters/numbers not allowed.");
    } else if (isLetter && countryNoticeField === fieldId) {
      setCountryNotice("");
      setCountryNoticeField(null);
    }
  };

  const handleDateChange = (e, fieldId) => {
    const val = e.target.value;
    setEditFormData(prev => ({ ...prev, dateOfBirth: val }));
    
    const selectedDate = new Date(val);
    const today = new Date();
    
    if (selectedDate.getFullYear() >= today.getFullYear()) {
        setAgeNoticeField(fieldId);
        setAgeNotice("Invalid birth year. Cannot be the current or future year.");
        return;
    }
    
    // Clear error if valid
    if (ageNoticeField === fieldId) {
        setAgeNotice("");
        setAgeNoticeField(null);
    }
  };

  const handleAddressInput = (e, fieldId) => {
    // Basic check for dangerous chars or whatever requirement
    // Admin uses specific logic, simplifying here to allow most chars but block some if needed
    // Or just clear errors on type
    if (addressNoticeField === fieldId) {
        setAddressNotice("");
        setAddressNoticeField(null);
    }
  };

  // --- Edit Handlers ---

  const handleEditClick = (patient) => {
    // Map patient data to form structure
    // Handle emergency contacts array -> individual fields
    const ec1 = patient.emergencyContacts?.[0] || {};
    const ec2 = patient.emergencyContacts?.[1] || {};
    const ec3 = patient.emergencyContacts?.[2] || {};

    setEditFormData({
        ...patient,
        // Ensure dates are formatted for input type="date"
        dateOfBirth: patient.dateOfBirth ? new Date(patient.dateOfBirth).toISOString().split('T')[0] : '',
        dateHired: patient.dateHired ? new Date(patient.dateHired).toISOString().split('T')[0] : '',
        
        // Flatten emergency contacts
        emergencyName1: ec1.name || '',
        emergencyRel1: ec1.relationship || '',
        emergencyContact1: ec1.phone || '',
        
        emergencyName2: ec2.name || '',
        emergencyRel2: ec2.relationship || '',
        emergencyContact2: ec2.phone || '',
        
        emergencyName3: ec3.name || '',
        emergencyRel3: ec3.relationship || '',
        emergencyContact3: ec3.phone || '',
    });
    
    setSelectedCity(patient.city || "");
    setSelectedProvince(patient.province || "");
    setPostalCode(patient.postalCode || "");
    
    setEditingPatient(patient);
    setView('patients'); // Ensure we switch to the view where the edit form is rendered
  };

  const handleEditFormChange = (e) => {
    const { name, value } = e.target;
    setEditFormData(prev => ({
        ...prev,
        [name]: value
    }));
  };

  const handleCancelEdit = () => {
    setEditingPatient(null);
    setEditFormData({});
    setUpdatePatientError("");
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    setUpdatePatientError("");

    // Validate
    if (!editFormData.firstName || !editFormData.lastName) {
        setUpdatePatientError("Name fields are required.");
        return;
    }
    
    // Reconstruct emergency contacts array
    const emergencyContacts = [];
    if (editFormData.emergencyName1) emergencyContacts.push({ name: editFormData.emergencyName1, relationship: editFormData.emergencyRel1, phone: editFormData.emergencyContact1 });
    if (editFormData.emergencyName2) emergencyContacts.push({ name: editFormData.emergencyName2, relationship: editFormData.emergencyRel2, phone: editFormData.emergencyContact2 });
    if (editFormData.emergencyName3) emergencyContacts.push({ name: editFormData.emergencyName3, relationship: editFormData.emergencyRel3, phone: editFormData.emergencyContact3 });
    
    const payload = {
        ...editFormData,
        emergencyContacts
    };

    try {
        const response = await fetch(`http://localhost:5000/api/patients/${editingPatient._id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (response.ok) {
            const updatedPatient = await response.json();
            // Update list
            setPatientsList(prev => prev.map(p => p._id === updatedPatient._id ? updatedPatient : p));
            setEditingPatient(null);
            alert("Patient updated successfully!");
        } else {
            const err = await response.json();
            setUpdatePatientError(err.message || "Failed to update patient.");
        }
    } catch (error) {
        console.error("Error updating patient:", error);
        setUpdatePatientError("Network error.");
    }
  };

  // Admission Handlers
  const handleAdmitClick = (patient) => {
    setSelectedPatientForAdmission(patient);
    setAdmissionFormData({
      wardNumber: '',
      diagnosis: '',
      attendingDoctor: ''
    });
    setShowAdmissionModal(true);
  };

  const handleAdmissionChange = (e) => {
    const { name, value } = e.target;
    setAdmissionFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleAdmissionSubmit = async (e) => {
    e.preventDefault();
    if (!selectedPatientForAdmission) return;

    try {
      const response = await fetch(`http://localhost:5000/api/patients/${selectedPatientForAdmission._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...selectedPatientForAdmission, // Keep existing data
          admissionStatus: 'Inpatient',
          wardNumber: admissionFormData.wardNumber,
          diagnosis: admissionFormData.diagnosis,
          attendingDoctor: admissionFormData.attendingDoctor,
          admissionDate: new Date()
        }),
      });

      if (response.ok) {
        const updatedPatient = await response.json();
        // Update list
        setPatientsList(prev => prev.map(p => p._id === updatedPatient._id ? updatedPatient : p));
        
        // Update stats
        setStats(prev => ({
          ...prev,
          inpatients: prev.inpatients + 1
        }));

        setShowAdmissionModal(false);
        setSelectedPatientForAdmission(null);
        alert("Patient admitted successfully!");
        setView('inpatients'); // Switch to inpatients view
      } else {
        alert("Failed to admit patient.");
      }
    } catch (error) {
      console.error("Error admitting patient:", error);
      alert("Network error.");
    }
  };

  // Clinical Update Handlers
  const handleClinicalUpdateClick = (patient) => {
    setSelectedPatientForClinicalUpdate(patient);
    setClinicalUpdateFormData({
      type: 'Vitals',
      bloodPressure: '',
      heartRate: '',
      temperature: '',
      respiratoryRate: '',
      notes: ''
    });
    setShowClinicalUpdateModal(true);
  };

  const handleClinicalUpdateChange = (e) => {
    const { name, value } = e.target;
    setClinicalUpdateFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleClinicalUpdateSubmit = async (e) => {
    e.preventDefault();
    if (!selectedPatientForClinicalUpdate) return;

    try {
      const response = await fetch(`http://localhost:5000/api/patients/${selectedPatientForClinicalUpdate._id}/clinical-records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...clinicalUpdateFormData,
          nurseName: user.name
        }),
      });

      if (response.ok) {
        const updatedPatient = await response.json();
        // Update list
        setPatientsList(prev => prev.map(p => p._id === updatedPatient._id ? updatedPatient : p));
        
        setShowClinicalUpdateModal(false);
        setSelectedPatientForClinicalUpdate(null);
        alert("Clinical update recorded successfully!");
      } else {
        alert("Failed to record update.");
      }
    } catch (error) {
      console.error("Error recording update:", error);
      alert("Network error.");
    }
  };

  const handlePatientClick = (patient) => {
    setSelectedPatientDetail(patient);
    setView('patient-details');
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
        
        <nav className="admin-sidebar-nav">
          <div className={`nav-item ${view === 'overview' ? 'active' : ''}`} onClick={() => setView('overview')}>
            <LayoutDashboard size={26} />
            <span className="nav-text">Dashboard</span>
          </div>
          
          <div className={`nav-item ${view === 'patients' ? 'active' : ''}`} onClick={() => setView('patients')}>
            <Users size={26} />
            <span className="nav-text">Patients Record</span>
          </div>

          <div className={`nav-item ${view === 'vitals' ? 'active' : ''}`} onClick={() => setView('vitals')}>
            <Activity size={26} />
            <span className="nav-text">Vitals</span>
          </div>

          <div className={`nav-item ${view === 'orders' ? 'active' : ''}`} onClick={() => setView('orders')}>
            <FileText size={26} />
            <span className="nav-text">Orders</span>
          </div>

          <div className={`nav-item ${view === 'messages' ? 'active' : ''}`} onClick={() => setView('messages')}>
            <MessageSquare size={26} />
            <span className="nav-text">Messages</span>
          </div>

          {/* Schedules Dropdown */}
          <div className={`nav-item ${['schedules', 'tasks', 'calendar'].includes(view) ? 'active' : ''}`} onClick={() => setIsSchedulesOpen(!isSchedulesOpen)}>
            <Calendar size={26} />
            <span className="nav-text" style={{flex: 1}}>Schedules</span>
            {isSchedulesOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </div>
          
          {isSchedulesOpen && (
            <div className="nav-sub-menu">
                <div className={`nav-item sub-item ${view === 'tasks' ? 'active' : ''}`} onClick={() => setView('tasks')}>
                    <ClipboardList size={20} />
                    <span className="nav-text">Tasks</span>
                </div>
                <div className={`nav-item sub-item ${view === 'calendar' ? 'active' : ''}`} onClick={() => setView('calendar')}>
                    <Calendar size={20} />
                    <span className="nav-text">Calendar</span>
                </div>
            </div>
          )}
        </nav>
      </aside>

      <main className="main-content">
        <header className="admin-header">
            <h2>Nurse Dashboard</h2>
            <div style={{display: 'flex', alignItems: 'center', gap: '20px'}}>
                <div className="header-actions" style={{display: 'flex', gap: '15px', alignItems: 'center'}}>
                    {/* Notifications */}
                    <div className="header-icon-btn" style={{position: 'relative', cursor: 'pointer'}} onClick={() => {setShowNotifications(!showNotifications); setShowSettings(false);}}>
                        <Bell size={22} color={showNotifications ? "#ea580c" : "#64748b"} />
                        {unreadCount > 0 && (
                            <span style={{
                                position: 'absolute', 
                                top: -2, 
                                right: -2, 
                                width: '18px', 
                                height: '18px', 
                                background: '#ef4444', 
                                borderRadius: '50%',
                                color: 'white',
                                fontSize: '10px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 'bold',
                                border: '2px solid white'
                            }}>
                                {unreadCount}
                            </span>
                        )}
                        
                        {showNotifications && (
                            <div className="dropdown-menu-card notifications-card" onClick={(e) => e.stopPropagation()}>
                                <div className="dropdown-header">
                                    <h4>Notifications</h4>
                                    {unreadCount > 0 && (
                                        <span className="mark-read" onClick={handleMarkAllRead}>Mark all as read</span>
                                    )}
                                </div>
                                <div className="notifications-list">
                                    {notifications.length === 0 ? (
                                        <div style={{padding: '20px', textAlign: 'center', color: '#64748b'}}>
                                            <p>No notifications</p>
                                        </div>
                                    ) : (
                                        notifications.map(notif => (
                                            <div key={notif.id} className={`notification-item ${notif.type}`} style={{opacity: notif.unread ? 1 : 0.7}}>
                                                <div className="notif-icon-box">
                                                    {notif.type === 'info' && <Info size={18} />}
                                                    {notif.type === 'alert' && <AlertCircle size={18} />}
                                                    {notif.type === 'reminder' && <Calendar size={18} />}
                                                </div>
                                                <div className="notif-content">
                                                    <p className="notif-title" style={{color: notif.unread ? '#1e293b' : '#64748b'}}>
                                                        {notif.title}
                                                        {notif.unread && <span style={{
                                                            display: 'inline-block', 
                                                            width: '8px', 
                                                            height: '8px', 
                                                            background: '#ea580c', 
                                                            borderRadius: '50%', 
                                                            marginLeft: '8px'
                                                        }}></span>}
                                                    </p>
                                                    <p className="notif-message">{notif.message}</p>
                                                    <span className="notif-time">{notif.time}</span>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Settings */}
                    <div className="header-icon-btn" style={{position: 'relative', cursor: 'pointer'}} onClick={() => {setShowSettings(!showSettings); setShowNotifications(false);}}>
                        <Settings size={22} color="#64748b" />
                        
                        {showSettings && (
                            <div className="dropdown-menu-card settings-card" onClick={(e) => e.stopPropagation()}>
                                <div className="dropdown-header">
                                    <h4>Settings</h4>
                                </div>
                                <div className="settings-list">
                                    <div className="setting-item">
                                        <div className="setting-info">
                                            <p className="setting-label">Email Notifications</p>
                                            <p className="setting-desc">Receive daily summaries</p>
                                        </div>
                                        <label className="switch">
                                            <input type="checkbox" defaultChecked />
                                            <span className="slider round"></span>
                                        </label>
                                    </div>
                                    <div className="setting-item">
                                        <div className="setting-info">
                                            <p className="setting-label">Dark Mode</p>
                                            <p className="setting-desc">Reduce eye strain</p>
                                        </div>
                                        <label className="switch">
                                            <input type="checkbox" />
                                            <span className="slider round"></span>
                                        </label>
                                    </div>
                                    <div className="setting-item">
                                        <div className="setting-info">
                                            <p className="setting-label">Compact View</p>
                                            <p className="setting-desc">Show more content</p>
                                        </div>
                                        <label className="switch">
                                            <input type="checkbox" />
                                            <span className="slider round"></span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                
                <div style={{width: '1px', height: '24px', background: '#e2e8f0'}}></div>

                <div 
                    className="header-profile-wrapper" 
                    onClick={() => setShowProfileMenu(!showProfileMenu)}
                    style={{position: 'relative'}}
                >
                    <div className="header-avatar-circle">
                        <User size={20} color="#555" />
                    </div>
                    <div className="header-profile-info">
                        <span className="header-profile-name">{user.name}</span>
                        <ChevronDown size={16} color="#94a3b8" />
                    </div>
                    
                    {showProfileMenu && (
                        <div className="header-dropdown-menu">
                            <div className="dropdown-item" onClick={(e) => {
                                e.stopPropagation();
                                setShowProfileMenu(false);
                                setView('profile');
                            }}>
                                <User size={16} />
                                <span>Profile</span>
                            </div>
                            <div className="dropdown-item" onClick={(e) => {
                                e.stopPropagation();
                                setShowLogoutConfirm(true);
                                setShowProfileMenu(false);
                            }}>
                                <LogOut size={16} />
                                <span>Logout</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
        <section className="content-body">
            {view === 'overview' && (
                <div>
                    <h3>Welcome back, {user.name}</h3>
                    <div className="stats-grid-modern" style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '25px', marginTop: '25px'}}>
                        {/* Patients Card */}
                        <div className="modern-stat-card" style={{
                            background: 'white', 
                            padding: '25px', 
                            borderRadius: '16px', 
                            boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '20px',
                            borderLeft: '5px solid #3b82f6',
                            transition: 'transform 0.2s ease'
                        }}>
                            <div className="icon-wrapper" style={{
                                background: '#eff6ff', 
                                padding: '15px', 
                                borderRadius: '12px',
                                color: '#3b82f6'
                            }}>
                                <Users size={32} />
                            </div>
                            <div className="stat-details">
                                <span className="stat-label" style={{color: '#64748b', fontSize: '0.9rem', fontWeight: '600', display: 'block'}}>Total Patients</span>
                                <h4 className="stat-value" style={{fontSize: '2rem', margin: '5px 0', color: '#1e293b'}}>{stats.patients}</h4>
                                <span className="stat-sub" style={{fontSize: '0.8rem', color: '#94a3b8'}}>Registered Database</span>
                            </div>
                        </div>

                        {/* Inpatients Card */}
                        <div className="modern-stat-card" style={{
                            background: 'white', 
                            padding: '25px', 
                            borderRadius: '16px', 
                            boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '20px',
                            borderLeft: '5px solid #f97316',
                            transition: 'transform 0.2s ease'
                        }}>
                            <div className="icon-wrapper" style={{
                                background: '#fff7ed', 
                                padding: '15px', 
                                borderRadius: '12px',
                                color: '#f97316'
                            }}>
                                <Bed size={32} />
                            </div>
                            <div className="stat-details">
                                <span className="stat-label" style={{color: '#64748b', fontSize: '0.9rem', fontWeight: '600', display: 'block'}}>Inpatients</span>
                                <h4 className="stat-value" style={{fontSize: '2rem', margin: '5px 0', color: '#1e293b'}}>{stats.inpatients}</h4>
                                <span className="stat-sub" style={{fontSize: '0.8rem', color: '#94a3b8'}}>Admitted in Ward</span>
                            </div>
                        </div>

                        {/* Accounts Card */}
                        <div className="modern-stat-card" style={{
                            background: 'white', 
                            padding: '25px', 
                            borderRadius: '16px', 
                            boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '20px',
                            borderLeft: '5px solid #22c55e',
                            transition: 'transform 0.2s ease'
                        }}>
                            <div className="icon-wrapper" style={{
                                background: '#f0fdf4', 
                                padding: '15px', 
                                borderRadius: '12px',
                                color: '#22c55e'
                            }}>
                                <UserCheck size={32} />
                            </div>
                            <div className="stat-details">
                                <span className="stat-label" style={{color: '#64748b', fontSize: '0.9rem', fontWeight: '600', display: 'block'}}>Nurse Accounts</span>
                                <h4 className="stat-value" style={{fontSize: '2rem', margin: '5px 0', color: '#1e293b'}}>{stats.accounts}</h4>
                                <span className="stat-sub" style={{fontSize: '0.8rem', color: '#94a3b8'}}>Active Staff</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {view === 'shifts' && (
                <div>
                    <h3>My Shifts</h3>
                    <p>No upcoming shifts.</p>
                </div>
            )}
            {view === 'patients' && (
                <div style={{padding: '20px'}}>
                    {editingPatient ? (
                        <div className="patient-form-container">
                          <header className="form-inner-header">
                            <button className="back-link" onClick={handleCancelEdit}>
                              <ArrowLeft size={24} /> Back
                            </button>
                            <h1 className="form-main-title">Edit Patient Information</h1>
                          </header>

                          <form className="compact-form" onSubmit={handleSaveEdit}>
                            <div className="form-section-container">
                              <div className="form-grid-main">
                                <div className="form-left-col">
                                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px'}}>
                                    <h3 className="section-title" style={{margin: 0}}>Personal Information</h3>
                                    <button 
                                      type="button" 
                                      onClick={() => setShowRequestModal(true)}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        padding: '6px 12px',
                                        background: '#fff7ed',
                                        color: '#c2410c',
                                        border: '1px solid #c2410c',
                                        borderRadius: '6px',
                                        fontSize: '0.85rem',
                                        fontWeight: '600',
                                        cursor: 'pointer'
                                      }}
                                    >
                                      <AlertCircle size={16} />
                                      Request Correction
                                    </button>
                                  </div>
                                  <div className="form-grid-2-col">
                                    <div className="input-group">
                                      <label>First Name</label>
                                      <input
                                        type="text"
                                        name="firstName"
                                        value={editFormData.firstName || ''}
                                        readOnly
                                        style={{backgroundColor: '#f3f4f6', cursor: 'not-allowed'}}
                                      />
                                    </div>
                                    <div className="input-group">
                                      <label>Last Name</label>
                                      <input
                                        type="text"
                                        name="lastName"
                                        value={editFormData.lastName || ''}
                                        readOnly
                                        style={{backgroundColor: '#f3f4f6', cursor: 'not-allowed'}}
                                      />
                                    </div>
                                    <div className="input-group">
                                      <label>Middle Name</label>
                                      <input
                                        type="text"
                                        name="middleName"
                                        value={editFormData.middleName || ''}
                                        readOnly
                                        style={{backgroundColor: '#f3f4f6', cursor: 'not-allowed'}}
                                      />
                                    </div>
                                    <div className="input-group">
                                      <label>Date of Birth</label>
                                      <input 
                                        type="date" 
                                        name="dateOfBirth" 
                                        className="white-input" 
                                        value={editFormData.dateOfBirth || ''}
                                        readOnly
                                        style={{backgroundColor: '#f3f4f6', cursor: 'not-allowed'}}
                                      />
                                    </div>
                                    <div className="input-group">
                                      <label>Age</label>
                                      <input type="number" name="age" className="white-input" value={editFormData.age || ''} readOnly style={{backgroundColor: '#f3f4f6', cursor: 'not-allowed'}} />
                                    </div>
                                    <div className="input-group">
                                      <label>Sex</label>
                                      <select 
                                        className="white-input" 
                                        name="sex" 
                                        value={editFormData.sex || ''} 
                                        disabled
                                        style={{backgroundColor: '#f3f4f6', cursor: 'not-allowed'}}
                                      >
                                        <option value="">Select Sex</option>
                                        <option value="Male">Male</option>
                                        <option value="Female">Female</option>
                                      </select>
                                    </div>
                                    <div className="input-group">
                                      <label>Phone Number</label>
                                      <input
                                        type="text"
                                        name="phone"
                                        value={editFormData.phone || ''}
                                        readOnly
                                        style={{backgroundColor: '#f3f4f6', cursor: 'not-allowed'}}
                                      />
                                    </div>
                                    <div className="input-group">
                                      <label>Street Address</label>
                                      <input
                                        type="text"
                                        name="streetAddress"
                                        value={editFormData.streetAddress || ''}
                                        readOnly
                                        style={{backgroundColor: '#f3f4f6', cursor: 'not-allowed'}}
                                      />
                                    </div>
                                    <div className="input-group">
                                      <label>City / Municipality</label>
                                      <select 
                                        className="white-input" 
                                        name="city" 
                                        value={selectedCity}
                                        disabled
                                        style={{backgroundColor: '#f3f4f6', cursor: 'not-allowed'}}
                                      >
                                        <option value="">Select City</option>
                                        {ncrCalabarzonCities.map((item, index) => (
                                          <option key={index} value={item.city}>{item.city}</option>
                                        ))}
                                      </select>
                                    </div>
                                    <div className="input-group">
                                      <label>Patient ID (Employee ID)</label>
                                      <input
                                        type="text" 
                                        name="employeeId"
                                        value={editFormData.employeeId || ''}
                                        readOnly
                                        style={{backgroundColor: '#f3f4f6', cursor: 'not-allowed'}}
                                      />
                                    </div>
                                    <div className="input-group">
                                      <label>Civil Status</label>
                                      <select 
                                        className="white-input" 
                                        name="civilStatus" 
                                        value={editFormData.civilStatus || ''}
                                        disabled
                                        style={{backgroundColor: '#f3f4f6', cursor: 'not-allowed'}}
                                      >
                                        <option value="">Select Status</option>
                                        <option value="Single">Single</option>
                                        <option value="Married">Married</option>
                                        <option value="Widowed">Widowed</option>
                                        <option value="Separated">Separated</option>
                                      </select>
                                    </div>
                                    <div className="input-group">
                                      <label>Nationality</label>
                                      <select 
                                        className="white-input" 
                                        name="nationality" 
                                        value={editFormData.nationality || ''}
                                        disabled
                                        style={{backgroundColor: '#f3f4f6', cursor: 'not-allowed'}}
                                      >
                                        <option value="">Select Nationality</option>
                                        <option value="Filipino">Filipino</option>
                                        <option value="American">American</option>
                                        <option value="Chinese">Chinese</option>
                                        <option value="Japanese">Japanese</option>
                                        <option value="Indian">Indian</option>
                                        <option value="Others">Others</option>
                                      </select>
                                    </div>
                                    <div className="input-group">
                                      <label>Province</label>
                                      <input type="text" name="province" className="white-input" value={selectedProvince} readOnly style={{backgroundColor: '#f3f4f6', cursor: 'not-allowed'}} />
                                    </div>
                                    <div className="input-group">
                                      <label>Postal Code</label>
                                      <input type="text" name="postalCode" className="white-input" value={postalCode} readOnly style={{backgroundColor: '#f3f4f6', cursor: 'not-allowed'}} />
                                    </div>
                                    <div className="input-group">
                                      <label>Country</label>
                                      <input
                                        type="text"
                                        name="country"
                                        value={editFormData.country || ''}
                                        readOnly
                                        style={{backgroundColor: '#f3f4f6', cursor: 'not-allowed'}}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="form-section-container">
                              <h3 className="section-title">Emergency Contact</h3>
                              <div className="form-grid-3-col">
                                <div className="emergency-col">
                                  <div className="input-group">
                                    <label>Emergency Contact Name</label>
                                    <input
                                      type="text"
                                      name="emergencyName1"
                                      value={editFormData.emergencyName1 || ''}
                                      onChange={handleEditFormChange}
                                      required
                                      onKeyDown={(e) => handleNameInput(e, "emergency-name-1")}
                                    />
                                    {nameNoticeField === "emergency-name-1" && nameNotice && (
                                      <p className="field-notice">{nameNotice}</p>
                                    )}
                                  </div>

                                  <div className="input-group">
                                    <label>Relationship</label>
                                    <input 
                                      type="text" 
                                      name="emergencyRel1"
                                      value={editFormData.emergencyRel1 || ''}
                                      onChange={handleEditFormChange}
                                      required
                                      onKeyDown={(e) => handleNameInput(e, "emergency-rel-1")}
                                    />
                                    {nameNoticeField === "emergency-rel-1" && nameNotice && (
                                      <p className="field-notice">{nameNotice}</p>
                                    )}
                                  </div>

                                  <div className="input-group">
                                    <label>Contact Number</label>
                                    <input 
                                      type="text" 
                                      name="emergencyContact1"
                                      value={editFormData.emergencyContact1 || ''}
                                      onChange={handleEditFormChange}
                                      required
                                      onKeyDown={(e) => handlePhoneInput(e, "emergency-contact-1")}
                                    />
                                    {phoneNoticeField === "emergency-contact-1" && phoneNotice && (
                                      <p className="field-notice">{phoneNotice}</p>
                                    )}
                                  </div>
                                </div>

                                <div className="emergency-col">
                                  <div className="input-group">
                                    <label>Emergency Contact Name</label>
                                    <input
                                      type="text"
                                      name="emergencyName2"
                                      value={editFormData.emergencyName2 || ''}
                                      onChange={handleEditFormChange}
                                      onKeyDown={(e) => handleNameInput(e, "emergency-name-2")}
                                    />
                                    {nameNoticeField === "emergency-name-2" && nameNotice && (
                                      <p className="field-notice">{nameNotice}</p>
                                    )}
                                  </div>

                                  <div className="input-group">
                                    <label>Relationship</label>
                                    <input 
                                      type="text" 
                                      name="emergencyRel2"
                                      value={editFormData.emergencyRel2 || ''}
                                      onChange={handleEditFormChange}
                                      onKeyDown={(e) => handleNameInput(e, "emergency-rel-2")}
                                    />
                                    {nameNoticeField === "emergency-rel-2" && nameNotice && (
                                      <p className="field-notice">{nameNotice}</p>
                                    )}
                                  </div>

                                  <div className="input-group">
                                    <label>Contact Number</label>
                                    <input 
                                      type="text" 
                                      name="emergencyContact2"
                                      value={editFormData.emergencyContact2 || ''}
                                      onChange={handleEditFormChange}
                                      onKeyDown={(e) => handlePhoneInput(e, "emergency-contact-2")}
                                    />
                                    {phoneNoticeField === "emergency-contact-2" && phoneNotice && (
                                      <p className="field-notice">{phoneNotice}</p>
                                    )}
                                  </div>
                                </div>

                                <div className="emergency-col">
                                  <div className="input-group">
                                    <label>Emergency Contact Name</label>
                                    <input
                                      type="text"
                                      name="emergencyName3"
                                      value={editFormData.emergencyName3 || ''}
                                      onChange={handleEditFormChange}
                                      onKeyDown={(e) => handleNameInput(e, "emergency-name-3")}
                                    />
                                    {nameNoticeField === "emergency-name-3" && nameNotice && (
                                      <p className="field-notice">{nameNotice}</p>
                                    )}
                                  </div>

                                  <div className="input-group">
                                    <label>Relationship</label>
                                    <input 
                                      type="text" 
                                      name="emergencyRel3"
                                      value={editFormData.emergencyRel3 || ''}
                                      onChange={handleEditFormChange}
                                      onKeyDown={(e) => handleNameInput(e, "emergency-rel-3")}
                                    />
                                    {nameNoticeField === "emergency-rel-3" && nameNotice && (
                                      <p className="field-notice">{nameNotice}</p>
                                    )}
                                  </div>

                                  <div className="input-group">
                                    <label>Contact Number</label>
                                    <input 
                                      type="text" 
                                      name="emergencyContact3"
                                      value={editFormData.emergencyContact3 || ''}
                                      onChange={handleEditFormChange}
                                      onKeyDown={(e) => handlePhoneInput(e, "emergency-contact-3")}
                                    />
                                    {phoneNoticeField === "emergency-contact-3" && phoneNotice && (
                                      <p className="field-notice">{phoneNotice}</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="form-section-container">
                              <h3 className="section-title">Medical Record (Optional)</h3>
                              <div className="form-grid-3-col">
                                <div className="input-group">
                                  <label>Blood Type</label>
                                  <input 
                                    type="text" 
                                    name="bloodType" 
                                    value={editFormData.bloodType || ''}
                                    onChange={handleEditFormChange}
                                  />
                                </div>
                                <div className="input-group">
                                  <label>Allergies</label>
                                  <input 
                                    type="text" 
                                    name="allergies" 
                                    value={editFormData.allergies || ''}
                                    onChange={handleEditFormChange}
                                  />
                                </div>
                                <div className="input-group">
                                  <label>PhilHealth Number</label>
                                  <input 
                                    type="text" 
                                    name="philHealthNumber" 
                                    value={editFormData.philHealthNumber || ''}
                                    onChange={handleEditFormChange}
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="form-actions-row">
                              <button type="submit" className="btn-orange-large shadow-btn">Save Changes</button>
                              <button type="button" className="btn-gray shadow-btn" onClick={handleCancelEdit}>Cancel</button>
                            </div>
                            {updatePatientError && (
                                <div style={{color: '#ef4444', marginTop: '10px', textAlign: 'left', fontWeight: 'bold'}}>
                                    {updatePatientError}
                                </div>
                            )}
                          </form>
                        </div>
                    ) : (
                        <div style={{maxWidth: '1200px', margin: '0 auto'}}>
                            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px'}}>
                                <div>
                                    <h1 style={{fontSize: '2rem', fontWeight: '800', color: '#1e293b', marginBottom: '8px', letterSpacing: '-0.5px'}}>Patient Management</h1>
                                    <p style={{color: '#64748b', fontSize: '1rem'}}>Manage patient records, admissions, and clinical updates</p>
                                </div>
                            </div>
                            
                            <div style={{background: 'white', borderRadius: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', overflow: 'hidden', border: '1px solid #e2e8f0'}}>
                                {/* Search and Filter */}
                                <div style={{padding: '24px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc'}}>
                                    <div style={{position: 'relative', width: '400px'}}>
                                        <Search style={{position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8'}} size={20} />
                                        <input 
                                            type="text" 
                                            placeholder="Search by name, ID, or diagnosis..." 
                                            value={patientSearch}
                                            onChange={(e) => setPatientSearch(e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: '14px 20px 14px 48px',
                                                borderRadius: '12px',
                                                border: '1px solid #e2e8f0',
                                                outline: 'none',
                                                fontSize: '0.95rem',
                                                transition: 'border-color 0.2s',
                                                color: '#334155'
                                            }}
                                            onFocus={(e) => e.target.style.borderColor = '#f97316'}
                                            onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                                        />
                                    </div>
                                    <div style={{display: 'flex', gap: '15px'}}>
                                        <span style={{background: '#e0f2fe', color: '#0369a1', padding: '6px 12px', borderRadius: '20px', fontSize: '0.85rem', fontWeight: '600'}}>
                                            Total: {patientsList.length}
                                        </span>
                                        <span style={{background: '#ffedd5', color: '#c2410c', padding: '6px 12px', borderRadius: '20px', fontSize: '0.85rem', fontWeight: '600'}}>
                                            Inpatient: {patientsList.filter(p => p.admissionStatus === 'Inpatient').length}
                                        </span>
                                    </div>
                                </div>

                                {/* Table */}
                                <div style={{overflowX: 'auto'}}>
                                    <table style={{width: '100%', borderCollapse: 'collapse'}}>
                                        <thead>
                                            <tr style={{background: '#fff', borderBottom: '2px solid #f1f5f9'}}>
                                                <th style={{padding: '20px', textAlign: 'left', fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#64748b'}}>Patient Name</th>
                                                <th style={{padding: '20px', textAlign: 'left', fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#64748b'}}>ID</th>
                                                <th style={{padding: '20px', textAlign: 'left', fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#64748b'}}>Status</th>
                                                <th style={{padding: '20px', textAlign: 'left', fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#64748b'}}>Ward</th>
                                                <th style={{padding: '20px', textAlign: 'left', fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#64748b'}}>Diagnosis</th>
                                                <th style={{padding: '20px', textAlign: 'left', fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#64748b'}}>Doctor</th>
                                                <th style={{padding: '20px', textAlign: 'center', fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#64748b'}}>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {loadingPatients ? (
                                                <tr>
                                                    <td colSpan="7" style={{padding: '60px', textAlign: 'center', color: '#64748b'}}>
                                                        Loading patients...
                                                    </td>
                                                </tr>
                                            ) : patientsList.filter(p => 
                                                p.firstName.toLowerCase().includes(patientSearch.toLowerCase()) || 
                                                p.lastName.toLowerCase().includes(patientSearch.toLowerCase()) ||
                                                (p._id && p._id.toLowerCase().includes(patientSearch.toLowerCase()))
                                            ).length === 0 ? (
                                                <tr>
                                                    <td colSpan="7" style={{padding: '60px', textAlign: 'center', color: '#64748b'}}>
                                                        No patients found matching your search.
                                                    </td>
                                                </tr>
                                            ) : (
                                                patientsList.filter(p => 
                                                    p.firstName.toLowerCase().includes(patientSearch.toLowerCase()) || 
                                                    p.lastName.toLowerCase().includes(patientSearch.toLowerCase()) ||
                                                    (p._id && p._id.toLowerCase().includes(patientSearch.toLowerCase()))
                                                ).map((patient) => (
                                                    <tr 
                                                        key={patient._id} 
                                                        onClick={() => handlePatientClick(patient)} 
                                                        style={{borderBottom: '1px solid #f1f5f9', cursor: 'pointer', transition: 'background 0.2s'}}
                                                        onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                                                        onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                                                    >
                                                        <td style={{padding: '20px'}}>
                                                            <div style={{display: 'flex', alignItems: 'center', gap: '15px'}}>
                                                                <div style={{width: '40px', height: '40px', borderRadius: '50%', background: '#f1f5f9', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '0.9rem'}}>
                                                                    {patient.firstName[0]}{patient.lastName[0]}
                                                                </div>
                                                                <div>
                                                                    <div style={{fontWeight: '600', color: '#334155', fontSize: '0.95rem'}}>{patient.firstName} {patient.lastName}</div>
                                                                    <div style={{color: '#94a3b8', fontSize: '0.8rem'}}>{patient.gender}, {new Date().getFullYear() - new Date(patient.dateOfBirth).getFullYear()}y</div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td style={{padding: '20px'}}><span style={{background: '#f1f5f9', padding: '4px 8px', borderRadius: '6px', color: '#64748b', fontSize: '0.8rem', fontFamily: 'monospace'}}>#{patient._id.slice(-6)}</span></td>
                                                        <td style={{padding: '20px'}}>
                                                            <span style={{
                                                                background: patient.admissionStatus === 'Inpatient' ? '#ffedd5' : '#dcfce7',
                                                                color: patient.admissionStatus === 'Inpatient' ? '#c2410c' : '#15803d',
                                                                padding: '6px 12px',
                                                                borderRadius: '20px',
                                                                fontSize: '0.8rem',
                                                                fontWeight: '700'
                                                            }}>
                                                                {patient.admissionStatus || 'Outpatient'}
                                                            </span>
                                                        </td>
                                                        <td style={{padding: '20px'}}>{patient.wardNumber ? <span style={{display: 'flex', alignItems: 'center', gap: '6px', color: '#475569', fontWeight: '500'}}><Bed size={16} color="#f97316"/> {patient.wardNumber}</span> : <span style={{color: '#cbd5e1'}}>-</span>}</td>
                                                        <td style={{padding: '20px', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#475569'}}>{patient.diagnosis}</td>
                                                        <td style={{padding: '20px', color: '#475569'}}>{patient.attendingDoctor}</td>
                                                        <td style={{padding: '20px', textAlign: 'center'}} onClick={(e) => e.stopPropagation()}>
                                                            <div style={{display: 'flex', justifyContent: 'center', gap: '8px'}}>
                                                                {patient.admissionStatus !== 'Inpatient' && (
                                                                  <button 
                                                                      onClick={(e) => { e.stopPropagation(); handleAdmitClick(patient); }}
                                                                      title="Admit Patient"
                                                                      style={{padding: '8px', borderRadius: '8px', border: 'none', background: '#dcfce7', color: '#15803d', cursor: 'pointer', transition: 'background 0.2s'}}
                                                                      onMouseEnter={(e) => e.currentTarget.style.background = '#bbf7d0'}
                                                                      onMouseLeave={(e) => e.currentTarget.style.background = '#dcfce7'}
                                                                  >
                                                                      <LogIn size={18} />
                                                                  </button>
                                                                )}
                                                                <button 
                                                                    onClick={(e) => { e.stopPropagation(); handleEditClick(patient); }}
                                                                    title="Edit Patient"
                                                                    style={{padding: '8px', borderRadius: '8px', border: 'none', background: '#e0f2fe', color: '#0369a1', cursor: 'pointer', transition: 'background 0.2s'}}
                                                                    onMouseEnter={(e) => e.currentTarget.style.background = '#bae6fd'}
                                                                    onMouseLeave={(e) => e.currentTarget.style.background = '#e0f2fe'}
                                                                >
                                                                    <Edit2 size={18} />
                                                                </button>
                                                                <button 
                                                                    title="Delete Patient"
                                                                    onClick={(e) => { e.stopPropagation(); /* Add delete logic */ }}
                                                                    style={{padding: '8px', borderRadius: '8px', border: 'none', background: '#fee2e2', color: '#b91c1c', cursor: 'pointer', transition: 'background 0.2s'}}
                                                                    onMouseEnter={(e) => e.currentTarget.style.background = '#fecaca'}
                                                                    onMouseLeave={(e) => e.currentTarget.style.background = '#fee2e2'}
                                                                >
                                                                    <Trash2 size={18} />
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
            
            {view === 'patient-details' && selectedPatientDetail && (
                <div style={{padding: '20px', maxWidth: '1200px', margin: '0 auto'}}>
                    {/* Header & Back */}
                    <button 
                        onClick={() => setView('patients')}
                        style={{
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '8px', 
                            background: 'none', 
                            border: 'none', 
                            color: '#64748b', 
                            cursor: 'pointer', 
                            fontSize: '0.95rem',
                            marginBottom: '20px',
                            fontWeight: '600'
                        }}
                    >
                        <ArrowLeft size={20} /> Back to Patients
                    </button>

                    {/* Patient Profile Header */}
                    <div style={{
                        background: 'white', 
                        borderRadius: '20px', 
                        padding: '30px', 
                        boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
                        marginBottom: '30px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start'
                    }}>
                        <div style={{display: 'flex', gap: '25px'}}>
                            <div style={{
                                width: '100px', 
                                height: '100px', 
                                borderRadius: '50%', 
                                background: '#f1f5f9', 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center',
                                fontSize: '2.5rem',
                                fontWeight: '700',
                                color: '#64748b'
                            }}>
                                {selectedPatientDetail.firstName[0]}{selectedPatientDetail.lastName[0]}
                            </div>
                            <div>
                                <h1 style={{fontSize: '2rem', fontWeight: '800', color: '#1e293b', marginBottom: '8px'}}>
                                    {selectedPatientDetail.firstName} {selectedPatientDetail.lastName}
                                </h1>
                                <div style={{display: 'flex', gap: '15px', color: '#64748b', fontSize: '0.95rem', marginBottom: '15px'}}>
                                    <span style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
                                        <User size={16} /> {selectedPatientDetail.gender}, {new Date().getFullYear() - new Date(selectedPatientDetail.dateOfBirth).getFullYear()} Years Old
                                    </span>
                                    <span style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
                                        <QrCode size={16} /> ID: {selectedPatientDetail._id.slice(-6).toUpperCase()}
                                    </span>
                                </div>
                                <div style={{display: 'flex', gap: '10px'}}>
                                    <span style={{
                                        background: selectedPatientDetail.admissionStatus === 'Inpatient' ? '#ffedd5' : '#dcfce7',
                                        color: selectedPatientDetail.admissionStatus === 'Inpatient' ? '#c2410c' : '#15803d',
                                        padding: '6px 16px',
                                        borderRadius: '20px',
                                        fontWeight: '700',
                                        fontSize: '0.85rem'
                                    }}>
                                        {selectedPatientDetail.admissionStatus || 'Outpatient'}
                                    </span>
                                    {selectedPatientDetail.wardNumber && (
                                        <span style={{
                                            background: '#f1f5f9',
                                            color: '#475569',
                                            padding: '6px 16px',
                                            borderRadius: '20px',
                                            fontWeight: '600',
                                            fontSize: '0.85rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px'
                                        }}>
                                            <Bed size={14} /> {selectedPatientDetail.wardNumber}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                        <button 
                            onClick={() => handleEditClick(selectedPatientDetail)}
                            style={{
                                padding: '12px 20px',
                                borderRadius: '12px',
                                border: '1px solid #e2e8f0',
                                background: 'white',
                                color: '#475569',
                                fontWeight: '600',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                            onMouseLeave={e => e.currentTarget.style.background = 'white'}
                        >
                            <Edit2 size={18} /> Edit Profile
                        </button>
                    </div>

                    {/* Tabs Navigation */}
                    <div style={{
                        display: 'flex', 
                        gap: '30px', 
                        borderBottom: '1px solid #e2e8f0', 
                        marginBottom: '30px',
                        paddingLeft: '10px'
                    }}>
                        {['Overview', 'Medical History', 'Lab Results'].map((tab, idx) => (
                            <div key={idx} style={{
                                padding: '15px 0',
                                color: idx === 0 ? '#f97316' : '#64748b',
                                borderBottom: idx === 0 ? '3px solid #f97316' : '3px solid transparent',
                                fontWeight: idx === 0 ? '700' : '500',
                                cursor: 'pointer',
                                fontSize: '1rem'
                            }}>
                                {tab}
                            </div>
                        ))}
                    </div>

                    {/* Content Grid */}
                    <div style={{display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '25px'}}>
                        
                        {/* Left Column */}
                        <div style={{display: 'flex', flexDirection: 'column', gap: '25px'}}>
                            
                            {/* Vitals Summary Card */}
                            <div style={{background: 'white', borderRadius: '16px', padding: '25px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)'}}>
                                <h3 style={{fontSize: '1.2rem', fontWeight: '700', color: '#1e293b', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px'}}>
                                    <Activity color="#f97316" /> Recent Vitals
                                </h3>
                                <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px'}}>
                                    <div style={{background: '#f8fafc', padding: '15px', borderRadius: '12px', textAlign: 'center'}}>
                                        <span style={{display: 'block', fontSize: '0.85rem', color: '#64748b', marginBottom: '5px'}}>Blood Pressure</span>
                                        <strong style={{fontSize: '1.2rem', color: '#1e293b'}}>120/80</strong>
                                        <span style={{display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginTop: '5px'}}>mmHg</span>
                                    </div>
                                    <div style={{background: '#f8fafc', padding: '15px', borderRadius: '12px', textAlign: 'center'}}>
                                        <span style={{display: 'block', fontSize: '0.85rem', color: '#64748b', marginBottom: '5px'}}>Heart Rate</span>
                                        <strong style={{fontSize: '1.2rem', color: '#1e293b'}}>72</strong>
                                        <span style={{display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginTop: '5px'}}>bpm</span>
                                    </div>
                                    <div style={{background: '#f8fafc', padding: '15px', borderRadius: '12px', textAlign: 'center'}}>
                                        <span style={{display: 'block', fontSize: '0.85rem', color: '#64748b', marginBottom: '5px'}}>Temp</span>
                                        <strong style={{fontSize: '1.2rem', color: '#1e293b'}}>36.6</strong>
                                        <span style={{display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginTop: '5px'}}>°C</span>
                                    </div>
                                    <div style={{background: '#f8fafc', padding: '15px', borderRadius: '12px', textAlign: 'center'}}>
                                        <span style={{display: 'block', fontSize: '0.85rem', color: '#64748b', marginBottom: '5px'}}>Resp. Rate</span>
                                        <strong style={{fontSize: '1.2rem', color: '#1e293b'}}>16</strong>
                                        <span style={{display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginTop: '5px'}}>bpm</span>
                                    </div>
                                </div>
                            </div>

                            {/* Allergies & Medical Info */}
                            <div style={{background: 'white', borderRadius: '16px', padding: '25px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)'}}>
                                <h3 style={{fontSize: '1.2rem', fontWeight: '700', color: '#1e293b', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px'}}>
                                    <ClipboardList color="#3b82f6" /> Medical Information
                                </h3>
                                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px'}}>
                                    <div>
                                        <span style={{display: 'block', fontSize: '0.85rem', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', marginBottom: '8px'}}>Allergies</span>
                                        <div style={{display: 'flex', flexWrap: 'wrap', gap: '8px'}}>
                                            {selectedPatientDetail.allergies ? (
                                                selectedPatientDetail.allergies.split(',').map((allergy, i) => (
                                                    <span key={i} style={{background: '#fee2e2', color: '#991b1b', padding: '4px 10px', borderRadius: '15px', fontSize: '0.85rem', fontWeight: '600'}}>
                                                        {allergy.trim()}
                                                    </span>
                                                ))
                                            ) : (
                                                <span style={{color: '#64748b'}}>No known allergies</span>
                                            )}
                                        </div>
                                    </div>
                                    <div>
                                        <span style={{display: 'block', fontSize: '0.85rem', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', marginBottom: '8px'}}>Blood Type</span>
                                        <span style={{fontSize: '1.1rem', fontWeight: '600', color: '#1e293b'}}>{selectedPatientDetail.bloodType || 'Unknown'}</span>
                                    </div>
                                    <div style={{gridColumn: '1/-1'}}>
                                        <span style={{display: 'block', fontSize: '0.85rem', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', marginBottom: '8px'}}>Current Diagnosis</span>
                                        <p style={{background: '#f0f9ff', padding: '15px', borderRadius: '8px', color: '#0369a1', lineHeight: '1.5', margin: 0}}>
                                            {selectedPatientDetail.diagnosis || 'No active diagnosis recorded.'}
                                        </p>
                                    </div>
                                </div>
                            </div>

                        </div>

                        {/* Right Column */}
                        <div style={{display: 'flex', flexDirection: 'column', gap: '25px'}}>
                            
                            {/* Contact Info */}
                            <div style={{background: 'white', borderRadius: '16px', padding: '25px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)'}}>
                                <h3 style={{fontSize: '1.2rem', fontWeight: '700', color: '#1e293b', marginBottom: '20px'}}>Contact Information</h3>
                                <div style={{display: 'flex', flexDirection: 'column', gap: '15px'}}>
                                    <div>
                                        <span style={{display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px'}}>Phone Number</span>
                                        <span style={{fontSize: '0.95rem', color: '#334155', fontWeight: '500'}}>{selectedPatientDetail.phone}</span>
                                    </div>
                                    <div>
                                        <span style={{display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px'}}>Email Address</span>
                                        <span style={{fontSize: '0.95rem', color: '#334155', fontWeight: '500'}}>{selectedPatientDetail.email || 'N/A'}</span>
                                    </div>
                                    <div>
                                        <span style={{display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px'}}>Address</span>
                                        <span style={{fontSize: '0.95rem', color: '#334155', fontWeight: '500'}}>
                                            {selectedPatientDetail.streetAddress}, {selectedPatientDetail.city}, {selectedPatientDetail.province}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Emergency Contacts */}
                            <div style={{background: 'white', borderRadius: '16px', padding: '25px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)'}}>
                                <h3 style={{fontSize: '1.2rem', fontWeight: '700', color: '#1e293b', marginBottom: '20px'}}>Emergency Contacts</h3>
                                {selectedPatientDetail.emergencyContacts && selectedPatientDetail.emergencyContacts.length > 0 ? (
                                    selectedPatientDetail.emergencyContacts.map((contact, idx) => (
                                        <div key={idx} style={{paddingBottom: '15px', marginBottom: '15px', borderBottom: idx < selectedPatientDetail.emergencyContacts.length - 1 ? '1px solid #f1f5f9' : 'none'}}>
                                            <strong style={{display: 'block', color: '#1e293b', marginBottom: '4px'}}>{contact.name}</strong>
                                            <span style={{fontSize: '0.85rem', color: '#64748b', display: 'block'}}>{contact.relationship}</span>
                                            <span style={{fontSize: '0.9rem', color: '#f97316', fontWeight: '500', display: 'block', marginTop: '4px'}}>{contact.phone}</span>
                                        </div>
                                    ))
                                ) : (
                                    <span style={{color: '#94a3b8'}}>No emergency contacts listed.</span>
                                )}
                            </div>

                        </div>
                    </div>
                </div>
            )}
            {view === 'inpatients' && (
                <div style={{padding: '20px'}}>
                    <h2 style={{fontSize: '1.8rem', fontWeight: 'bold', color: '#1e293b', marginBottom: '25px', display: 'flex', alignItems: 'center', gap: '12px'}}>
                        <Bed size={32} color="#f97316" />
                        Inpatient Ward
                    </h2>

                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
                        gap: '25px'
                    }}>
                        {patientsList.filter(p => p.admissionStatus === 'Inpatient').length === 0 ? (
                            <div style={{gridColumn: '1/-1', textAlign: 'center', padding: '60px', background: 'white', borderRadius: '16px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)'}}>
                                <div style={{background: '#fff7ed', width: '80px', height: '80px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px'}}>
                                    <BedDouble size={40} color="#f97316" />
                                </div>
                                <h3 style={{color: '#1e293b', marginBottom: '10px'}}>No Inpatients Currently Admitted</h3>
                                <p style={{color: '#64748b'}}>Use the Patients list to admit new patients to the ward.</p>
                            </div>
                        ) : (
                            patientsList.filter(p => p.admissionStatus === 'Inpatient').map(patient => (
                                <div key={patient._id} style={{
                                    background: 'white',
                                    borderRadius: '16px',
                                    boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
                                    overflow: 'hidden',
                                    border: '1px solid #f1f5f9',
                                    transition: 'transform 0.2s, box-shadow 0.2s',
                                    cursor: 'pointer'
                                }}
                                onMouseEnter={e => {
                                    e.currentTarget.style.transform = 'translateY(-5px)';
                                    e.currentTarget.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.1)';
                                }}
                                onMouseLeave={e => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.05)';
                                }}
                                >
                                    <div style={{
                                        padding: '20px',
                                        borderBottom: '1px solid #f1f5f9',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        background: 'linear-gradient(to right, #fff, #f8fafc)'
                                    }}>
                                        <div>
                                            <h3 style={{fontSize: '1.2rem', fontWeight: 'bold', color: '#1e293b', marginBottom: '4px'}}>
                                                {patient.firstName} {patient.lastName}
                                            </h3>
                                            <span style={{fontSize: '0.9rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px'}}>
                                                <User size={14} /> {patient.gender}, {new Date().getFullYear() - new Date(patient.dateOfBirth).getFullYear()} yrs
                                            </span>
                                        </div>
                                        <div style={{
                                            background: '#ffedd5',
                                            color: '#c2410c',
                                            padding: '6px 12px',
                                            borderRadius: '20px',
                                            fontWeight: 'bold',
                                            fontSize: '0.85rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px'
                                        }}>
                                            <BedDouble size={16} />
                                            {patient.wardNumber || 'Unassigned'}
                                        </div>
                                    </div>
                                    
                                    <div style={{padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px'}}>
                                        <div style={{display: 'flex', gap: '12px'}}>
                                            <div style={{minWidth: '24px', paddingTop: '2px'}}>
                                                <Stethoscope size={20} color="#3b82f6" />
                                            </div>
                                            <div>
                                                <span style={{display: 'block', fontSize: '0.8rem', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px'}}>Diagnosis</span>
                                                <p style={{color: '#334155', fontWeight: '500', lineHeight: '1.4'}}>{patient.diagnosis}</p>
                                            </div>
                                        </div>

                                        <div style={{display: 'flex', gap: '12px'}}>
                                            <div style={{minWidth: '24px', paddingTop: '2px'}}>
                                                <UserCheck size={20} color="#10b981" />
                                            </div>
                                            <div>
                                                <span style={{display: 'block', fontSize: '0.8rem', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px'}}>Attending Doctor</span>
                                                <p style={{color: '#334155', fontWeight: '500'}}>{patient.attendingDoctor}</p>
                                            </div>
                                        </div>

                                        <div style={{display: 'flex', gap: '12px'}}>
                                            <div style={{minWidth: '24px', paddingTop: '2px'}}>
                                                <Clipboard size={20} color="#8b5cf6" />
                                            </div>
                                            <div>
                                                <span style={{display: 'block', fontSize: '0.8rem', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px'}}>Admission Date</span>
                                                <p style={{color: '#334155', fontWeight: '500'}}>{new Date(patient.admissionDate).toLocaleDateString()}</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{
                                        padding: '15px 20px',
                                        background: '#f8fafc',
                                        borderTop: '1px solid #f1f5f9',
                                        display: 'flex',
                                        gap: '10px'
                                    }}>
                                        <button style={{
                                            flex: 1,
                                            padding: '10px',
                                            borderRadius: '8px',
                                            border: '1px solid #cbd5e1',
                                            background: 'white',
                                            color: '#475569',
                                            fontWeight: '600',
                                            fontSize: '0.9rem',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseOver={e => e.currentTarget.style.background = '#f1f5f9'}
                                        onMouseOut={e => e.currentTarget.style.background = 'white'}
                                        >
                                            View Vitals
                                        </button>
                                        <button 
                                            onClick={() => handleClinicalUpdateClick(patient)}
                                            style={{
                                            flex: 1,
                                            padding: '10px',
                                            borderRadius: '8px',
                                            border: 'none',
                                            background: '#3b82f6',
                                            color: 'white',
                                            fontWeight: '600',
                                            fontSize: '0.9rem',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s',
                                            boxShadow: '0 2px 4px rgba(59, 130, 246, 0.3)'
                                        }}
                                        onMouseOver={e => e.currentTarget.style.background = '#2563eb'}
                                        onMouseOut={e => e.currentTarget.style.background = '#3b82f6'}
                                        >
                                            Update
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
            {view === 'vitals' && (
                <div>
                    <h3>Vitals Monitoring</h3>
                    <p>Vitals monitoring interface will go here.</p>
                </div>
            )}
            {view === 'orders' && (
                <div>
                    <h3>Medical Orders</h3>
                    <p>Orders management interface will go here.</p>
                </div>
            )}
            {view === 'messages' && (
                <div>
                    <h3>Messages</h3>
                    <p>Messaging interface will go here.</p>
                </div>
            )}
            {view === 'tasks' && (
                <div>
                    <h3>Tasks</h3>
                    <p>Task management interface will go here.</p>
                </div>
            )}
            {view === 'calendar' && (
                <div>
                    <h3>Calendar</h3>
                    <p>Calendar view will go here.</p>
                </div>
            )}
            
            {view === 'profile' && (
                <div className="admin-profile-container">
                    <div className="admin-profile-header-card">
                        <div className="large-avatar-circle">
                            <User size={48} color="#94a3b8" />
                        </div>
                        <div className="profile-info-text">
                            <h3>{user.name}</h3>
                            <span className="role-badge">Nurse</span>
                        </div>
                    </div>

                    <div className="admin-profile-form-card">
                        <div className="form-section-title">Personal Information</div>
                        <form onSubmit={handleProfileUpdate}>
                            <div className="profile-form-grid">
                                <div className="profile-input-group">
                                    <label>Username</label>
                                    <input 
                                        type="text" 
                                        name="username"
                                        className="profile-input" 
                                        value={profileData.username} 
                                        onChange={handleInputChange}
                                    />
                                    {profileErrors.username && <span className="field-notice">{profileErrors.username}</span>}
                                </div>
                                <div className="profile-input-group">
                                    <label>Email Address</label>
                                    <input 
                                        type="email" 
                                        name="email"
                                        className="profile-input" 
                                        value={profileData.email} 
                                        onChange={handleInputChange}
                                    />
                                </div>
                                <div className="profile-input-group">
                                    <label>Phone Number</label>
                                    <input 
                                        type="text" 
                                        name="phone"
                                        className="profile-input" 
                                        value={profileData.phone} 
                                        onChange={handleInputChange}
                                    />
                                </div>
                            </div>

                            <div className="form-section-title">Security</div>
                            <div className="profile-form-grid">
                                <div className="profile-input-group full-width">
                                    <label>Current Password</label>
                                    <input 
                                        type="password" 
                                        name="currentPassword"
                                        className="profile-input" 
                                        value={profileData.currentPassword}
                                        onChange={handleInputChange}
                                        placeholder="Enter current password to change"
                                    />
                                    {profileErrors.currentPassword && <span className="field-notice">{profileErrors.currentPassword}</span>}
                                </div>
                                <div className="profile-input-group">
                                    <label>New Password</label>
                                    <input 
                                        type="password" 
                                        name="newPassword"
                                        className="profile-input" 
                                        value={profileData.newPassword}
                                        onChange={handleInputChange}
                                    />
                                    {profileErrors.newPassword && <span className="field-notice">{profileErrors.newPassword}</span>}
                                </div>
                                <div className="profile-input-group">
                                    <label>Confirm New Password</label>
                                    <input 
                                        type="password" 
                                        name="confirmPassword"
                                        className="profile-input" 
                                        value={profileData.confirmPassword}
                                        onChange={handleInputChange}
                                    />
                                    {/* Real-time Password Match Feedback */}
                                    {profileData.confirmPassword && (
                                        <div style={{marginTop: '5px', fontSize: '0.85rem'}}>
                                            {profileData.newPassword === profileData.confirmPassword ? (
                                                <span style={{color: '#22c55e'}}>Passwords match</span>
                                            ) : (
                                                <span style={{color: '#ef4444'}}>Passwords do not match</span>
                                            )}
                                        </div>
                                    )}
                                    {profileErrors.confirmPassword && <span className="field-notice">{profileErrors.confirmPassword}</span>}
                                </div>
                            </div>

                            <div className="form-actions-row" style={{flexDirection: 'column', gap: '10px'}}>
                                {formError && <div style={{color: '#ef4444', fontSize: '0.9rem', marginBottom: '10px', fontWeight: '500'}}>{formError}</div>}
                                <div style={{display: 'flex', gap: '15px', width: '100%', justifyContent: 'flex-end'}}>
                                    <button type="button" className="btn-gray" onClick={() => setView('overview')}>Cancel</button>
                                    <button 
                                        type="submit" 
                                        className="btn-orange-large"
                                    >
                                        Save Changes
                                    </button>
                                </div>
                            </div>
                            
                            {profileSuccess && (
                                <div style={{marginTop: '20px', padding: '10px', background: '#dcfce7', color: '#166534', borderRadius: '8px', textAlign: 'center'}}>
                                    {profileSuccess}
                                </div>
                            )}
                        </form>
                    </div>
                </div>
            )}
        </section>
      </main>

      {/* Request Correction Modal */}
      {showRequestModal && (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
        }}>
            <div style={{
                background: 'white',
                padding: '25px',
                borderRadius: '12px',
                width: '100%',
                maxWidth: '500px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
            }}>
                <h3 style={{fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '15px', color: '#1f2937'}}>Request Data Correction</h3>
                <p style={{color: '#4b5563', marginBottom: '20px', fontSize: '0.95rem'}}>
                    Since personal information is locked, please describe the correction needed. 
                    An admin will review and update the record.
                </p>
                
                <form onSubmit={handleRequestSubmit}>
                    <textarea
                        value={requestMessage}
                        onChange={(e) => setRequestMessage(e.target.value)}
                        placeholder="E.g., Spelling error in First Name: 'Jon' should be 'John'"
                        required
                        style={{
                            width: '100%',
                            minHeight: '120px',
                            padding: '12px',
                            borderRadius: '8px',
                            border: '1px solid #d1d5db',
                            marginBottom: '20px',
                            fontSize: '0.95rem',
                            resize: 'vertical'
                        }}
                    />
                    
                    {requestStatus === 'success' && (
                        <div style={{color: '#16a34a', marginBottom: '15px', fontSize: '0.9rem', fontWeight: '600'}}>
                            Request submitted successfully!
                        </div>
                    )}
                    
                    {requestStatus === 'error' && (
                        <div style={{color: '#dc2626', marginBottom: '15px', fontSize: '0.9rem', fontWeight: '600'}}>
                            Failed to submit request. Please try again.
                        </div>
                    )}

                    <div style={{display: 'flex', justifyContent: 'flex-end', gap: '10px'}}>
                        <button 
                            type="button" 
                            onClick={() => {setShowRequestModal(false); setRequestMessage(""); setRequestStatus(null);}}
                            style={{
                                padding: '8px 16px',
                                borderRadius: '6px',
                                background: '#f3f4f6',
                                color: '#4b5563',
                                border: 'none',
                                fontWeight: '600',
                                cursor: 'pointer'
                            }}
                        >
                            Cancel
                        </button>
                        <button 
                            type="submit"
                            disabled={requestStatus === 'submitting' || requestStatus === 'success'}
                            style={{
                                padding: '8px 16px',
                                borderRadius: '6px',
                                background: requestStatus === 'success' ? '#16a34a' : '#ea580c',
                                color: 'white',
                                border: 'none',
                                fontWeight: '600',
                                cursor: requestStatus === 'success' ? 'default' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                            }}
                        >
                            {requestStatus === 'submitting' ? 'Sending...' : 'Submit Request'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
      )}

      {showLogoutConfirm && (
        <div className="modal-overlay">
            <div className="logout-confirm-card">
                <div className="logout-header" style={{marginBottom: '20px'}}>
                    <div className="logout-icon-wrapper">
                        <LogOut size={40} color="#ef4444" />
                    </div>
                    <h3 className="logout-title">Sign Out</h3>
                </div>
                <div className="logout-body">
                    <p className="logout-text">Are you sure you want to end your session?</p>
                </div>
                <div className="logout-footer">
                    <button 
                        className="btn-logout-cancel"
                        onClick={() => setShowLogoutConfirm(false)}
                    >
                        Cancel
                    </button>
                    <button 
                        className="btn-logout-confirm"
                        onClick={handleLogout}
                    >
                        Sign Out
                    </button>
                </div>
            </div>
        </div>
      )}
      {showAdmissionModal && (
        <div className="modal-overlay">
          <div className="logout-card" style={{
            background: 'white',
            padding: '30px',
            borderRadius: '16px',
            width: '500px',
            maxWidth: '90%',
            textAlign: 'left',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '25px', borderBottom: '1px solid #f1f5f9', paddingBottom: '20px'}}>
              <div style={{
                width: '50px', 
                height: '50px', 
                background: '#dcfce7', 
                borderRadius: '12px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center'
              }}>
                <Bed size={28} color="#16a34a" />
              </div>
              <div>
                <h3 style={{fontSize: '1.4rem', fontWeight: 'bold', color: '#1e293b', margin: 0}}>Admit Patient</h3>
                <p style={{color: '#64748b', fontSize: '0.9rem', margin: '4px 0 0 0'}}>Assign ward and clinical details</p>
              </div>
            </div>

            <form onSubmit={handleAdmissionSubmit}>
              <div style={{marginBottom: '20px'}}>
                <label style={{display: 'block', marginBottom: '8px', fontWeight: '600', color: '#334151', fontSize: '0.95rem'}}>Ward & Room Number</label>
                <div style={{position: 'relative'}}>
                  <BedDouble size={18} color="#94a3b8" style={{position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)'}} />
                  <input
                    type="text"
                    name="wardNumber"
                    value={admissionFormData.wardNumber}
                    onChange={handleAdmissionChange}
                    placeholder="e.g. ICU - Room 304"
                    required
                    style={{
                      width: '100%',
                      padding: '12px 12px 12px 40px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '1rem',
                      outline: 'none',
                      transition: 'border-color 0.2s'
                    }}
                    onFocus={e => e.target.style.borderColor = '#3b82f6'}
                    onBlur={e => e.target.style.borderColor = '#cbd5e1'}
                  />
                </div>
              </div>

              <div style={{marginBottom: '20px'}}>
                <label style={{display: 'block', marginBottom: '8px', fontWeight: '600', color: '#334151', fontSize: '0.95rem'}}>Attending Doctor</label>
                <div style={{position: 'relative'}}>
                  <UserCheck size={18} color="#94a3b8" style={{position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)'}} />
                  <input
                    type="text"
                    name="attendingDoctor"
                    value={admissionFormData.attendingDoctor}
                    onChange={handleAdmissionChange}
                    placeholder="e.g. Dr. Sarah Smith"
                    required
                    style={{
                      width: '100%',
                      padding: '12px 12px 12px 40px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '1rem',
                      outline: 'none',
                      transition: 'border-color 0.2s'
                    }}
                    onFocus={e => e.target.style.borderColor = '#3b82f6'}
                    onBlur={e => e.target.style.borderColor = '#cbd5e1'}
                  />
                </div>
              </div>

              <div style={{marginBottom: '30px'}}>
                <label style={{display: 'block', marginBottom: '8px', fontWeight: '600', color: '#334151', fontSize: '0.95rem'}}>Initial Diagnosis</label>
                <div style={{position: 'relative'}}>
                  <Stethoscope size={18} color="#94a3b8" style={{position: 'absolute', left: '12px', top: '15px'}} />
                  <textarea
                    name="diagnosis"
                    value={admissionFormData.diagnosis}
                    onChange={handleAdmissionChange}
                    placeholder="Describe the reason for admission..."
                    required
                    style={{
                      width: '100%',
                      padding: '12px 12px 12px 40px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '1rem',
                      minHeight: '100px',
                      resize: 'vertical',
                      outline: 'none',
                      fontFamily: 'inherit'
                    }}
                    onFocus={e => e.target.style.borderColor = '#3b82f6'}
                    onBlur={e => e.target.style.borderColor = '#cbd5e1'}
                  />
                </div>
              </div>

              <div style={{display: 'flex', gap: '15px'}}>
                <button 
                  type="button"
                  onClick={() => setShowAdmissionModal(false)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: 'white',
                    color: '#64748b',
                    fontWeight: '600',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={e => e.currentTarget.style.background = '#f8fafc'}
                  onMouseOut={e => e.currentTarget.style.background = 'white'}
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '8px',
                    border: 'none',
                    background: '#16a34a',
                    color: 'white',
                    fontWeight: '600',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    boxShadow: '0 4px 6px -1px rgba(22, 163, 74, 0.2)',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={e => e.currentTarget.style.background = '#15803d'}
                  onMouseOut={e => e.currentTarget.style.background = '#16a34a'}
                >
                  Confirm Admission
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showClinicalUpdateModal && (
        <div className="modal-overlay">
          <div className="logout-card" style={{
            background: 'white',
            padding: '30px',
            borderRadius: '16px',
            width: '500px',
            maxWidth: '90%',
            textAlign: 'left',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '25px', borderBottom: '1px solid #f1f5f9', paddingBottom: '20px'}}>
              <div style={{
                width: '50px', 
                height: '50px', 
                background: '#dbeafe', 
                borderRadius: '12px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center'
              }}>
                <Activity size={28} color="#3b82f6" />
              </div>
              <div>
                <h3 style={{fontSize: '1.4rem', fontWeight: 'bold', color: '#1e293b', margin: 0}}>Clinical Update</h3>
                <p style={{color: '#64748b', fontSize: '0.9rem', margin: '4px 0 0 0'}}>Record patient vitals and notes</p>
              </div>
            </div>

            <form onSubmit={handleClinicalUpdateSubmit}>
              <div style={{marginBottom: '20px'}}>
                <label style={{display: 'block', marginBottom: '8px', fontWeight: '600', color: '#334151', fontSize: '0.95rem'}}>Update Type</label>
                <select
                  name="type"
                  value={clinicalUpdateFormData.type}
                  onChange={handleClinicalUpdateChange}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '1rem',
                    outline: 'none',
                    background: 'white'
                  }}
                >
                  <option value="Vitals">Vitals Check</option>
                  <option value="Note">Nursing Note</option>
                  <option value="Medication">Medication Admin</option>
                </select>
              </div>

              {clinicalUpdateFormData.type === 'Vitals' && (
                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '20px'}}>
                  <div>
                    <label style={{display: 'block', marginBottom: '8px', fontWeight: '600', color: '#334151', fontSize: '0.85rem'}}>Blood Pressure</label>
                    <input
                      type="text"
                      name="bloodPressure"
                      value={clinicalUpdateFormData.bloodPressure}
                      onChange={handleClinicalUpdateChange}
                      placeholder="e.g. 120/80"
                      style={{
                        width: '100%',
                        padding: '10px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.95rem',
                        outline: 'none'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{display: 'block', marginBottom: '8px', fontWeight: '600', color: '#334151', fontSize: '0.85rem'}}>Heart Rate (bpm)</label>
                    <input
                      type="text"
                      name="heartRate"
                      value={clinicalUpdateFormData.heartRate}
                      onChange={handleClinicalUpdateChange}
                      placeholder="e.g. 75"
                      style={{
                        width: '100%',
                        padding: '10px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.95rem',
                        outline: 'none'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{display: 'block', marginBottom: '8px', fontWeight: '600', color: '#334151', fontSize: '0.85rem'}}>Temperature (°C)</label>
                    <input
                      type="text"
                      name="temperature"
                      value={clinicalUpdateFormData.temperature}
                      onChange={handleClinicalUpdateChange}
                      placeholder="e.g. 36.5"
                      style={{
                        width: '100%',
                        padding: '10px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.95rem',
                        outline: 'none'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{display: 'block', marginBottom: '8px', fontWeight: '600', color: '#334151', fontSize: '0.85rem'}}>Resp. Rate (bpm)</label>
                    <input
                      type="text"
                      name="respiratoryRate"
                      value={clinicalUpdateFormData.respiratoryRate}
                      onChange={handleClinicalUpdateChange}
                      placeholder="e.g. 16"
                      style={{
                        width: '100%',
                        padding: '10px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.95rem',
                        outline: 'none'
                      }}
                    />
                  </div>
                </div>
              )}

              <div style={{marginBottom: '30px'}}>
                <label style={{display: 'block', marginBottom: '8px', fontWeight: '600', color: '#334151', fontSize: '0.95rem'}}>Clinical Notes</label>
                <textarea
                  name="notes"
                  value={clinicalUpdateFormData.notes}
                  onChange={handleClinicalUpdateChange}
                  placeholder="Enter observation details..."
                  required
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '1rem',
                    minHeight: '100px',
                    resize: 'vertical',
                    outline: 'none',
                    fontFamily: 'inherit'
                  }}
                  onFocus={e => e.target.style.borderColor = '#3b82f6'}
                  onBlur={e => e.target.style.borderColor = '#cbd5e1'}
                />
              </div>

              <div style={{display: 'flex', gap: '15px'}}>
                <button 
                  type="button"
                  onClick={() => setShowClinicalUpdateModal(false)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: 'white',
                    color: '#64748b',
                    fontWeight: '600',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={e => e.currentTarget.style.background = '#f8fafc'}
                  onMouseOut={e => e.currentTarget.style.background = 'white'}
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '8px',
                    border: 'none',
                    background: '#3b82f6',
                    color: 'white',
                    fontWeight: '600',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.3)',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={e => e.currentTarget.style.background = '#2563eb'}
                  onMouseOut={e => e.currentTarget.style.background = '#3b82f6'}
                >
                  Save Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default NurseDashboard;
