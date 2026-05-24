import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { UserPlus, Users, ChevronLeft, ChevronRight, LogOut, ArrowLeft, Camera, QrCode, AlertCircle, User, Eye, EyeOff, Check, X, Activity, MessageSquare, Calendar, ChevronDown, History, LayoutDashboard, Phone, MapPin, Trash2, Key, Save, Mail, Briefcase, Shield, Edit, Search, Printer } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import "./AdminDashboard.css";

function AdminDashboard() {
  const navigate = useNavigate();
  // Dashboard Stats
  const [dashboardStats, setDashboardStats] = useState(null);

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [view, setView] = useState("dashboard");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [nameNotice, setNameNotice] = useState("");
  const [nameNoticeField, setNameNoticeField] = useState(null);

  // Age Validation State
  const [ageNotice, setAgeNotice] = useState("");
  const [ageNoticeField, setAgeNoticeField] = useState(null);

  // Address Validation State
  const [addressNotice, setAddressNotice] = useState("");
  const [addressNoticeField, setAddressNoticeField] = useState(null);

  // Phone & Country Validation State
  const [phoneNotice, setPhoneNotice] = useState("");
  const [phoneNoticeField, setPhoneNoticeField] = useState(null);
  const [countryNotice, setCountryNotice] = useState("");
  const [countryNoticeField, setCountryNoticeField] = useState(null);

  // Employee ID Validation State
  const [employeeIdNotice, setEmployeeIdNotice] = useState("");
  const [employeeIdNoticeField, setEmployeeIdNoticeField] = useState(null);

  // Medical License Validation State
  const [medicalLicenseNotice, setMedicalLicenseNotice] = useState("");
  const [medicalLicenseNoticeField, setMedicalLicenseNoticeField] = useState(null);

  // Email Validation State
  const [emailNotice, setEmailNotice] = useState("");
  const [emailNoticeField, setEmailNoticeField] = useState(null);

  // Update Notice State
  const [updateNotice, setUpdateNotice] = useState("");
  const [createStaffError, setCreateStaffError] = useState(""); // General error for Create Staff form
  const [createPatientError, setCreatePatientError] = useState(""); // General error for Create Patient form
  const [showSuccessModal, setShowSuccessModal] = useState(false); // Success modal state
  const [successMessage, setSuccessMessage] = useState("Account created successfully."); // Dynamic success message
  const [showProfileMenu, setShowProfileMenu] = useState(false); // Profile dropdown toggle
  const [isShiftsOpen, setIsShiftsOpen] = useState(false); // Shifts and Tasks dropdown toggle
  const [isDashboardOpen, setIsDashboardOpen] = useState(false); // Dashboard dropdown toggle
  const [selectedRole, setSelectedRole] = useState(""); // Track role in staff creation form

  // Staff Management State
  const [staffList, setStaffList] = useState([]);
  const [staffSearchTerm, setStaffSearchTerm] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState(null); // ID of staff to delete
  
  // Requests State
  const [requests, setRequests] = useState([]);
  const [requestFilter, setRequestFilter] = useState('All'); // All, Pending, Resolved, Rejected
  const [requestReview, setRequestReview] = useState(null);

  // Patient Management State
  const [patientList, setPatientList] = useState([]);
  const [patientSearchTerm, setPatientSearchTerm] = useState("");
  const [editingPatient, setEditingPatient] = useState(null);
  const [patientPage, setPatientPage] = useState(1);
  const [recentAppointments, setRecentAppointments] = useState([]);

  const fetchDashboardStats = async () => {
    try {
        const response = await fetch('http://localhost:5000/api/stats/admin-overview');
        if (response.ok) {
            setDashboardStats(await response.json());
        }
    } catch (error) {
        console.error("Error fetching dashboard stats:", error);
    }
  };

  const fetchRecentAppointments = async () => {
    try {
        const response = await fetch('http://localhost:5000/api/appointments');
        if (response.ok) {
            const data = await response.json();
            const sorted = data.sort((a, b) => new Date(b.appointmentDate || b.createdAt) - new Date(a.appointmentDate || a.createdAt));
            setRecentAppointments(sorted.slice(0, 5));
        }
    } catch (error) {
        console.error("Error fetching recent appointments:", error);
    }
  };

  // Fetch Staff from Backend
  const fetchStaff = async () => {
    try {
      const response = await fetch('http://localhost:5000/api/staff');
      if (response.ok) {
        const data = await response.json();
        // Map backend fields to frontend table fields if necessary
        // Assuming backend returns matching fields or we adjust display
        setStaffList(data.map(item => ({
            id: item._id, // MongoDB ID
            firstName: item.firstName,
            lastName: item.lastName,
            role: item.accountType === 'staff' ? item.specialization || 'Staff' : item.accountType,
            status: item.status || 'Offline',
            email: item.email,
            phone: item.phone,
            ...item
        })));
      }
    } catch (error) {
      console.error("Error fetching staff:", error);
    }
  };

  // Fetch Requests
  const fetchRequests = async () => {
      try {
          const response = await fetch('http://localhost:5000/api/requests');
          if (response.ok) {
              const data = await response.json();
              setRequests(data);
          }
      } catch (error) {
          console.error("Error fetching requests:", error);
      }
  };

  // Fetch Patients
  const fetchPatients = async () => {
    try {
        const response = await fetch('http://localhost:5000/api/patients');
        if (response.ok) {
            const data = await response.json();
            setPatientList(data);
        }
    } catch (error) {
        console.error("Error fetching patients:", error);
    }
  };

  const handleEditPatient = (patient) => {
    setEditingPatient(patient);
    // Reuse existing form handlers/state or create new ones? 
    // To keep it clean, let's map to the editFormData structure used by staff but adaptable
    // Or simpler: just populate editFormData with patient fields
    setEditFormData({
        firstName: patient.firstName,
        lastName: patient.lastName,
        middleName: patient.middleName || '',
        dateOfBirth: patient.dateOfBirth ? patient.dateOfBirth.split('T')[0] : '',
        gender: patient.gender,
        phone: patient.contactNumber,
        email: patient.email,
        streetAddress: patient.address?.street || '',
        city: patient.address?.city || '',
        province: patient.address?.province || '',
        postalCode: patient.address?.postalCode || '',
        country: patient.address?.country || '',
        civilStatus: patient.civilStatus || '',
        nationality: patient.nationality || '',
        bloodType: patient.bloodType || '',
        allergies: patient.allergies || '',
        philHealthNumber: patient.philHealthNumber || ''
    });
  };

  const handleUpdatePatient = async (e) => {
      e.preventDefault();
      try {
          const response = await fetch(`http://localhost:5000/api/patients/${editingPatient._id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(editFormData)
          });

          if (response.ok) {
              setSuccessMessage("Patient record updated successfully!");
              setShowSuccessModal(true);
              setEditingPatient(null);
              fetchPatients(); // Refresh list
          } else {
              const err = await response.json();
              alert("Failed to update: " + err.message);
          }
      } catch (error) {
          console.error("Error updating patient:", error);
          alert("Error updating patient");
      }
  };

  const handleUpdateRequestStatus = async (id, newStatus) => {
      try {
          const response = await fetch(`http://localhost:5000/api/requests/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: newStatus })
          });
          
          if (response.ok) {
              // Update local state
              setRequests(requests.map(req => 
                  req._id === id ? { ...req, status: newStatus } : req
              ));
          }
      } catch (error) {
          console.error("Error updating request:", error);
      }
  };

  useEffect(() => {
    fetchStaff();
    fetchRequests();
    fetchPatients();
    fetchDashboardStats();
    fetchRecentAppointments();
    // Poll for new requests every 30 seconds
    const interval = setInterval(() => {
        fetchStaff();
        fetchRequests();
        fetchPatients();
        fetchDashboardStats();
        fetchRecentAppointments();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const [editingStaff, setEditingStaff] = useState(null);
  const [editFormData, setEditFormData] = useState({
    firstName: "",
    lastName: "",
    role: "",
    email: "",
    phone: ""
  });

  // Password Validation State
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordCriteria, setPasswordCriteria] = useState({
    length: false,
    hasNumber: false,
    hasSpecial: false
  });
  const [passwordsMatch, setPasswordsMatch] = useState(null);
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);

  // Password Visibility State
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Location State
  const [selectedCity, setSelectedCity] = useState("");
  const [selectedProvince, setSelectedProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");

  // Admin Profile State
  const [adminProfile, setAdminProfile] = useState(() => {
    // 1. Try to get current user from localStorage
    let currentUserEmail = localStorage.getItem('tempLoginEmail');

    // Fallback to currentUser session if tempLoginEmail is gone (e.g. after OTP bypass or cleanup)
    if (!currentUserEmail) {
        try {
            const currentUser = JSON.parse(localStorage.getItem('currentUser'));
            if (currentUser && currentUser.email) {
                currentUserEmail = currentUser.email;
            }
        } catch (e) {
            // Ignore error
        }
    }
    
    // Default profile (Populated so it's not empty)
    let initialProfile = {
      name: "Admin Name",
      role: "Admin",
      email: "admin@pgh.com",
      department: "General Administration",
      phone: "0912 345 6789",
      currentPassword: "",
      newPassword: "",
      confirmNewPassword: ""
    };

    if (currentUserEmail === "admin@pgh.com") {
        initialProfile.email = "pascualgenhospi@gmail.com"; // Display the REAL Gmail account
        initialProfile.name = "Pascual General Hospital"; // Match the Google Account Name
        initialProfile.role = "Administrator";
        initialProfile.department = "Hospital Administration";
    } else if (currentUserEmail) {
        // If it's another user (unlikely for AdminDashboard but possible if shared)
        initialProfile.email = currentUserEmail;
    }

    return initialProfile;
  });

  const handleUpdateAdminProfile = (e) => {
    e.preventDefault();
    
    // Basic Validation
    if (adminProfile.newPassword && adminProfile.newPassword !== adminProfile.confirmNewPassword) {
      setUpdateNotice("New passwords do not match.");
      return;
    }

    if (adminProfile.newPassword && (
        !passwordCriteria.length || 
        !passwordCriteria.hasNumber || 
        !passwordCriteria.hasSpecial
    )) {
        setUpdateNotice("Password does not meet all criteria.");
        return;
    }

    // Success logic
    alert("Admin Profile Updated Successfully! (This is a simulation)");
    
    // In a real app, you would update the backend or localStorage here
    // For now, we just clear the password fields
    setAdminProfile(prev => ({
        ...prev,
        currentPassword: "",
        newPassword: "",
        confirmNewPassword: ""
    }));
    setUpdateNotice("");
  };

  const handleAdminProfileChange = (e) => {
    const { name, value } = e.target;

    // Strict Email Validation for Controlled Component
    if (name === "email") {
      if (value.length > 0) {
        // 1. Check if first character is a letter
        if (!/^[a-zA-Z]/.test(value[0])) {
          setEmailNoticeField("admin-email");
          setEmailNotice("Email must start with a letter (no numbers or special characters).");
          return; // Block the update, effectively preventing the input
        }

        // 2. Check for invalid characters in the rest of the string
        // Allowed: letters, numbers, @, ., _, -
        if (!/^[a-zA-Z0-9@._-]*$/.test(value)) {
          setEmailNoticeField("admin-email");
          setEmailNotice("Special characters are not allowed.");
          return; // Block the update
        }

        // 3. Domain Check (Strict @gmail.com)
        if (value.includes("@")) {
          const parts = value.split("@");
          // Prevent multiple @ symbols
          if (parts.length > 2) {
             setEmailNoticeField("admin-email");
             setEmailNotice("Only one @ symbol is allowed.");
             return;
          }
          
          const domain = parts[1];
          const expected = "gmail.com";
          
          // Allow typing strictly only if it matches the prefix of "gmail.com"
          if (domain.length > 0 && !expected.startsWith(domain)) {
             setEmailNoticeField("admin-email");
             setEmailNotice("Only @gmail.com domain is allowed.");
             return; // Block
          }
        }
      }

      // If valid (or empty), clear any previous notice
      if (emailNoticeField === "admin-email") {
        setEmailNotice("");
        setEmailNoticeField(null);
      }
    }

    setAdminProfile(prev => ({
      ...prev,
      [name]: value
    }));

    if (name === "newPassword") {
      setPasswordCriteria({
        length: value.length >= 11,
        hasNumber: /\d/.test(value),
        hasSpecial: /[!@#$%^&*(),.?":{}|<>]/.test(value)
      });
    }
  };

  const handleUpdateAccount = (e) => {
    e.preventDefault();
    setUpdateNotice("");

    // 1. Check Personal Information
    if (!adminProfile.email.trim() || !adminProfile.department.trim() || !adminProfile.phone.trim()) {
      setUpdateNotice("Please fill in all personal information fields.");
      return;
    }

    // 2. Check Password Change Logic
    // If ANY password field is filled, ALL must be filled
    const { currentPassword, newPassword, confirmNewPassword } = adminProfile;
    const isChangingPassword = currentPassword || newPassword || confirmNewPassword;

    if (isChangingPassword) {
      if (!currentPassword || !newPassword || !confirmNewPassword) {
        setUpdateNotice("Please fill in all password fields to change your password.");
        return;
      }
      
      if (newPassword !== confirmNewPassword) {
         setUpdateNotice("New passwords do not match.");
         return;
      }
    }

    // Add logic to update account details here
    alert("Account details updated successfully!");
  };

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

  const handleCityChange = (e) => {
    const city = e.target.value;
    setSelectedCity(city);
    const data = ncrCalabarzonCities.find(c => c.city === city);
    if (data) {
      setSelectedProvince(data.province);
      setPostalCode(data.zip);
    } else {
      setSelectedProvince("");
      setPostalCode("");
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

  const handleEmployeeIdInput = (e, fieldId) => {
    const allowedKeys = ["Backspace", "Tab", "ArrowLeft", "ArrowRight", "Delete", "Enter", "Escape"];
    const isNumber = /^[0-9]$/.test(e.key);
    const currentLength = e.target.value.length;

    if (!isNumber && !allowedKeys.includes(e.key)) {
      e.preventDefault();
      setEmployeeIdNoticeField(fieldId);
      setEmployeeIdNotice("Letters and special characters are not allowed.");
    } else if (isNumber) {
      if (currentLength >= 16) {
        e.preventDefault();
        setEmployeeIdNoticeField(fieldId);
        setEmployeeIdNotice("Maximum of 16 characters only.");
      } else if (employeeIdNoticeField === fieldId) {
        setEmployeeIdNotice("");
        setEmployeeIdNoticeField(null);
      }
    } else if (allowedKeys.includes(e.key)) {
      if (employeeIdNoticeField === fieldId) {
        setEmployeeIdNotice("");
        setEmployeeIdNoticeField(null);
      }
    }
  };

  const handleMedicalLicenseInput = (e, fieldId) => {
    const allowedKeys = ["Backspace", "Tab", "ArrowLeft", "ArrowRight", "Delete", "Enter", "Escape"];
    const isNumber = /^[0-9]$/.test(e.key);
    const currentLength = e.target.value.length;

    if (!isNumber && !allowedKeys.includes(e.key)) {
      e.preventDefault();
      setMedicalLicenseNoticeField(fieldId);
      setMedicalLicenseNotice("Only numbers are allowed.");
    } else if (isNumber) {
      if (currentLength >= 7) {
        e.preventDefault();
        setMedicalLicenseNoticeField(fieldId);
        setMedicalLicenseNotice("Maximum of 7 digits only.");
      } else if (medicalLicenseNoticeField === fieldId) {
        setMedicalLicenseNotice("");
        setMedicalLicenseNoticeField(null);
      }
    } else if (allowedKeys.includes(e.key)) {
      if (medicalLicenseNoticeField === fieldId) {
        setMedicalLicenseNotice("");
        setMedicalLicenseNoticeField(null);
      }
    }
  };

  const handleEmailInput = (e, fieldId) => {
    const allowedKeys = ["Backspace", "Tab", "ArrowLeft", "ArrowRight", "Delete", "Enter", "Escape"];
    const isLetter = /^[a-zA-Z]$/.test(e.key);
    const isNumber = /^[0-9]$/.test(e.key);
    // Allowed special characters in email body (excluding start)
    const isEmailSpecial = /^[@._-]$/.test(e.key);
    
    const currentVal = e.target.value;

    // Check if key is allowed (e.g. Backspace), if so, clear error if it exists
    if (allowedKeys.includes(e.key)) {
      if (emailNoticeField === fieldId) {
        setEmailNotice("");
        setEmailNoticeField(null);
      }
      return;
    }

    if (currentVal.length === 0) {
      if (!isLetter) {
        e.preventDefault();
        setEmailNoticeField(fieldId);
        setEmailNotice("Email must start with a letter (no numbers or special characters).");
      } else {
        // Valid first char
        if (emailNoticeField === fieldId) {
          setEmailNotice("");
          setEmailNoticeField(null);
        }
      }
    } else {
       if (!isLetter && !isNumber && !isEmailSpecial) {
          e.preventDefault();
          setEmailNoticeField(fieldId);
          setEmailNotice("Special characters are not allowed.");
       } else if (emailNoticeField === fieldId) {
          setEmailNotice("");
          setEmailNoticeField(null);
       }
    }
   };

   const handleUncontrolledEmailChange = (e, fieldId) => {
    const value = e.target.value;
    
    if (value.includes("@")) {
       const parts = value.split("@");
       const domain = parts[1];
       const expectedGmail = "gmail.com";
       const expectedYahoo = "yahoo.com";
       
       if (parts.length > 2) {
           setEmailNoticeField(fieldId);
           setEmailNotice("Only one @ symbol is allowed.");
       } else if (domain && !expectedGmail.startsWith(domain) && !expectedYahoo.startsWith(domain)) {
           setEmailNoticeField(fieldId);
           setEmailNotice("Only @gmail.com or @yahoo.com domains are allowed.");
       } else {
           // If it matches so far (or is empty after @), clear strict domain error
           if (emailNoticeField === fieldId && (emailNotice.includes("domain is allowed") || emailNotice === "Only one @ symbol is allowed.")) {
               setEmailNotice("");
               setEmailNoticeField(null);
           }
       }
    } else {
        // Clear domain error if backspaced
        if (emailNoticeField === fieldId && (emailNotice.includes("domain is allowed") || emailNotice === "Only one @ symbol is allowed.")) {
             setEmailNotice("");
             setEmailNoticeField(null);
        }
    }
  };
 
   const handlePasswordInput = (e) => {
    const val = e.target.value;
    setPassword(val);
    
    setPasswordCriteria({
      length: val.length >= 8,
      hasNumber: /\d/.test(val),
      hasSpecial: /[!@#$%^&*(),.?":{}|<>]/.test(val)
    });

    if (confirmPassword) {
        setPasswordsMatch(val === confirmPassword);
    }
  };

  const handleConfirmPasswordInput = (e) => {
    const val = e.target.value;
    setConfirmPassword(val);
    setPasswordsMatch(val === password);
  };

   const handleReset = () => {
     setSelectedCity("");
     setSelectedProvince("");
     setPostalCode("");
     // Clear validation notices
     setNameNotice("");
     setNameNoticeField(null);
     setAgeNotice("");
     setAgeNoticeField(null);
     setAddressNotice("");
     setAddressNoticeField(null);
     setPhoneNotice("");
     setPhoneNoticeField(null);
     setCountryNotice("");
     setCountryNoticeField(null);
     setEmployeeIdNotice("");
     setEmployeeIdNoticeField(null);
     setMedicalLicenseNotice("");
     setMedicalLicenseNoticeField(null);
     setEmailNotice("");
     setEmailNoticeField(null);
     setCreateStaffError(""); // Clear general error
     setCreatePatientError(""); // Clear general error
     // Clear password state
     setPassword("");
     setConfirmPassword("");
     setPasswordCriteria({ length: false, hasNumber: false, hasSpecial: false });
     setPasswordsMatch(null);
   };

  const confirmLogout = async () => {
    try {
        const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
        // If we have a user and it's NOT the hardcoded simulated admin
        if (currentUser && currentUser._id && localStorage.getItem('tempLoginEmail') !== "admin@pgh.com") {
            await fetch('http://localhost:5000/api/staff/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    id: currentUser._id, 
                    accountType: currentUser.accountType || 'staff' 
                })
            });
        }
    } catch (error) {
        console.error("Logout error:", error);
    }

    localStorage.removeItem('currentUser');
    localStorage.removeItem('tempLoginEmail');
    localStorage.removeItem('tempLoginRole');
    localStorage.removeItem('generatedOTP');
    navigate('/login');
  };

  const handleNameInput = (e, fieldId) => {
    const allowedKeys = [
      "Backspace", "Tab", "ArrowLeft", "ArrowRight", "Delete", " ", 
      "Shift", "Control", "Alt", "CapsLock", "Meta", "Enter", "Escape"
    ];
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

  const handleAddressInput = (e, fieldId) => {
    const allowedKeys = [
      "Backspace", "Tab", "ArrowLeft", "ArrowRight", "Delete", " ", 
      "Shift", "Control", "Alt", "CapsLock", "Meta", "Enter", "Escape"
    ];
    // Allow alphanumeric and common address characters (comma, period, hyphen, hash, slash)
    const isAllowedChar = /^[a-zA-Z0-9\-\.\,\#\/]$/.test(e.key);

    if (!isAllowedChar && !allowedKeys.includes(e.key)) {
      e.preventDefault();
      setAddressNoticeField(fieldId);
      setAddressNotice("Special characters are not allowed.");
    } else if (isAllowedChar && addressNoticeField === fieldId) {
      setAddressNotice("");
      setAddressNoticeField(null);
    }
  };

  // Date/Age Validation Handler
  const handleDateChange = (e, fieldId) => {
    const selectedDate = new Date(e.target.value);
    const today = new Date();
    
    // 1. Check for Future/Current Year (User Request)
    if (selectedDate.getFullYear() >= today.getFullYear()) {
        setAgeNoticeField(fieldId);
        setAgeNotice("Invalid birth year. Cannot be the current or future year.");
        return;
    }

    let age = today.getFullYear() - selectedDate.getFullYear();
    const m = today.getMonth() - selectedDate.getMonth();
    
    // Adjust age if birthday hasn't occurred yet this year
    if (m < 0 || (m === 0 && today.getDate() < selectedDate.getDate())) {
      age--;
    }

    // Validation: Must be at least 18 years old (Only for Staff/Admin)
    // We only enforce 18+ for staff accounts, not patients (who can be children)
    const isStaffRegistration = fieldId.includes("staff") || fieldId.includes("admin");
    
    if (isStaffRegistration && age < 18) {
      setAgeNoticeField(fieldId);
      setAgeNotice("Must be at least 18 years old.");
    } else {
      if (ageNoticeField === fieldId) {
        setAgeNotice("");
        setAgeNoticeField(null);
      }
    }
  };

  const handleEditStaff = (staff) => {
    setEditingStaff(staff);
    setEditFormData({
      firstName: staff.firstName,
      lastName: staff.lastName,
      role: staff.role,
      email: staff.email,
      phone: staff.phone
    });
  };

  const handleDeleteStaff = (id) => {
    setDeleteConfirmation(id);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmation) return;
    
    try {
        const response = await fetch(`http://localhost:5000/api/staff/${deleteConfirmation}`, {
            method: 'DELETE',
        });
        if (response.ok) {
            setStaffList(staffList.filter(staff => staff.id !== deleteConfirmation));
            setDeleteConfirmation(null);
        } else {
            alert("Failed to delete staff.");
        }
    } catch (error) {
        console.error("Error deleting staff:", error);
    }
  };

  const cancelDelete = () => {
    setDeleteConfirmation(null);
  };

  const handleEditFormChange = (e) => {
    const { name, value } = e.target;

    // City Change Handler for Edit Form
    if (name === "city" && typeof ncrCalabarzonCities !== 'undefined') {
        const selectedCityData = ncrCalabarzonCities.find(c => c.city === value);
        if (selectedCityData) {
            setEditFormData(prev => ({
                ...prev,
                city: value,
                province: selectedCityData.province
            }));
            return;
        }
    }

    // Email Validation for Edit Form
    if (name === "email") {
      if (value.length > 0) {
        // 1. Check if first character is a letter
        if (!/^[a-zA-Z]/.test(value[0])) {
          setEmailNoticeField("edit-email");
          setEmailNotice("Email must start with a letter (no numbers or special characters).");
          return; // Block the update
        }

        // 2. Check for invalid characters in the rest of the string
        if (!/^[a-zA-Z0-9@._-]*$/.test(value)) {
          setEmailNoticeField("edit-email");
          setEmailNotice("Special characters are not allowed.");
          return; // Block the update
        }

        // 3. Domain Check (Strict @gmail.com or @yahoo.com)
        if (value.includes("@")) {
          const parts = value.split("@");
          // Prevent multiple @ symbols
          if (parts.length > 2) {
             setEmailNoticeField("edit-email");
             setEmailNotice("Only one @ symbol is allowed.");
             return;
          }
          
          const domain = parts[1];
          const expectedGmail = "gmail.com";
          const expectedYahoo = "yahoo.com";
          
          // Allow typing strictly only if it matches the prefix of "gmail.com" or "yahoo.com"
          if (domain.length > 0 && !expectedGmail.startsWith(domain) && !expectedYahoo.startsWith(domain)) {
             setEmailNoticeField("edit-email");
             setEmailNotice("Only @gmail.com or @yahoo.com domains are allowed.");
             return; // Block
          }
        }
      }

      // If valid (or empty), clear any previous notice
      if (emailNoticeField === "edit-email") {
        setEmailNotice("");
        setEmailNoticeField(null);
      }
    }

    setEditFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSaveStaff = async (e) => {
    e.preventDefault();

    // Final Validation before Saving
    if (!editFormData.email.endsWith("@gmail.com") && !editFormData.email.endsWith("@yahoo.com")) {
      setEmailNoticeField("edit-email");
      setEmailNotice("Email must end with @gmail.com or @yahoo.com");
      return;
    }

    try {
        const response = await fetch(`http://localhost:5000/api/staff/${editingStaff.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(editFormData),
        });

        if (response.ok) {
            const updatedStaff = await response.json();
            setStaffList(staffList.map(staff => 
                staff.id === editingStaff.id ? { ...staff, ...updatedStaff, id: updatedStaff._id } : staff
            ));
            setEditingStaff(null);
        } else {
            alert("Failed to update staff.");
        }
    } catch (error) {
        console.error("Error updating staff:", error);
    }
  };

  const handleCancelEdit = () => {
    setEditingStaff(null);
  };

  const handleCreateStaff = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const newUser = Object.fromEntries(formData.entries());
    
    // Map role to accountType
    if (newUser.role === 'Nurse') newUser.accountType = 'nurse';
    else if (newUser.role === 'Doctor') newUser.accountType = 'doctor';
    else if (newUser.role === 'Admin') newUser.accountType = 'admin';
    else if (newUser.role === 'Pharmacist') newUser.accountType = 'pharmacist';
    else newUser.accountType = 'staff'; // Fallback

    const errors = [];
    const clean = (v) => String(v || "").trim();
    const isValidPHPhone = (v) => /^09\d{9}$/.test(clean(v));
    const isValidEmail = (v) => /^[A-Za-z][A-Za-z0-9._-]*@(gmail\.com|yahoo\.com)$/.test(clean(v));
    if (!newUser.country) newUser.country = "Philippines";

    const dobStr = clean(newUser.dateOfBirth);
    if (!dobStr) {
      errors.push("Date of Birth is required.");
    } else {
      const dob = new Date(dobStr);
      const today = new Date();
      if (Number.isNaN(dob.getTime())) {
        errors.push("Date of Birth is invalid.");
      } else if (dob > today) {
        errors.push("Date of Birth cannot be in the future.");
      } else {
        let age = today.getFullYear() - dob.getFullYear();
        const m = today.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age -= 1;
        if (age < 18) errors.push("Staff must be at least 18 years old.");
      }
    }

    if (!clean(newUser.firstName) || clean(newUser.firstName).length < 2) errors.push("First Name must be at least 2 characters.");
    if (!clean(newUser.lastName) || clean(newUser.lastName).length < 2) errors.push("Last Name must be at least 2 characters.");
    if (!clean(newUser.middleName) || clean(newUser.middleName).length < 2) errors.push("Middle Name must be at least 2 characters.");
    if (!clean(newUser.gender)) errors.push("Gender is required.");
    if (!clean(newUser.civilStatus)) errors.push("Civil Status is required.");
    if (!clean(newUser.nationality)) errors.push("Nationality is required.");
    if (!clean(newUser.role)) errors.push("Role is required.");
    if (!clean(newUser.specialization) || clean(newUser.specialization).length < 2) errors.push("Specialization must be at least 2 characters.");
    const hiredStr = clean(newUser.dateHired);
    if (!hiredStr) {
      errors.push("Date Hired is required.");
    } else {
      const hired = new Date(hiredStr);
      const today = new Date();
      if (Number.isNaN(hired.getTime())) errors.push("Date Hired is invalid.");
      else if (hired > today) errors.push("Date Hired cannot be in the future.");
    }
    if (!clean(newUser.employeeId) || clean(newUser.employeeId).length < 5 || clean(newUser.employeeId).length > 16) {
      errors.push("Employee ID must be between 5 and 16 characters.");
    }
    if (!clean(newUser.medicalLicenseNumber) || !/^\d{7}$/.test(clean(newUser.medicalLicenseNumber))) {
      errors.push("Medical License Number must be exactly 7 digits.");
    }
    if (!isValidEmail(newUser.email)) errors.push("Email must start with a letter and end with @gmail.com or @yahoo.com.");
    if (!isValidPHPhone(newUser.phone)) errors.push("Phone number must start with 09 and be 11 digits.");
    if (!clean(newUser.streetAddress) || clean(newUser.streetAddress).length < 5) errors.push("Street Address must be at least 5 characters.");
    if (!clean(newUser.city)) errors.push("City / Municipality is required.");
    if (!clean(newUser.province)) errors.push("Province is required (select a City).");
    if (!clean(newUser.postalCode)) errors.push("Postal Code is required (select a City).");

    // Generate a secure temporary password to pass backend requirements
    // The user will receive this in the email and can change it later
    const tempPassword = Math.random().toString(36).slice(-8) + "Temp1!";
    newUser.password = tempPassword;

    if (errors.length > 0) {
      setCreateStaffError(errors.join("\n"));
      return;
    }
    
    try {
        const response = await fetch('http://localhost:5000/api/staff', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(newUser),
        });

        if (response.ok) {
            // Success
            
            // Send Welcome Email using EmailJS REST API
            try {
                await fetch('https://api.emailjs.com/api/v1.0/email/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        service_id: 'YOUR_SERVICE_ID', // TODO: Replace with your actual EmailJS Service ID
                        template_id: 'template_zkps5b8',
                        user_id: 'YOUR_PUBLIC_KEY', // TODO: Replace with your actual EmailJS Public Key
                        template_params: {
                            to_email: newUser.email,
                            to_name: newUser.firstName,
                            temp_password: tempPassword,
                            login_link: window.location.origin + '/login'
                        }
                    })
                });
            } catch (emailErr) {
                console.error("Failed to send welcome email:", emailErr);
            }

            setSuccessMessage("Staff account created successfully. An email with login details has been sent.");
            setShowSuccessModal(true); // Show success modal
            e.target.reset();
            setPassword("");
            setConfirmPassword("");
            handleReset(); // This clears createStaffError
            fetchStaff(); 
        } else {
            const errorData = await response.json();
            // Show all validation errors under the button
            setCreateStaffError(errorData.message || JSON.stringify(errorData));
        }
    } catch (error) {
        console.error("Error:", error);
        setCreateStaffError("Failed to connect to server.");
    }
  };

  const closeSuccessModal = () => {
    setShowSuccessModal(false);
  };

  const handleCreatePatient = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const newUser = Object.fromEntries(formData.entries());
    
    newUser.accountType = 'patient';
    newUser.password = password;
    if (!newUser.country) newUser.country = "Philippines";

    const errors = [];
    const clean = (v) => String(v || "").trim();
    const isValidPHPhone = (v) => /^09\d{9}$/.test(clean(v));
    const isValidEmail = (v) => /^[A-Za-z][A-Za-z0-9._-]*@(gmail\.com|yahoo\.com)$/.test(clean(v));

    if (!clean(newUser.firstName) || clean(newUser.firstName).length < 2) errors.push("First Name must be at least 2 characters.");
    if (!clean(newUser.lastName) || clean(newUser.lastName).length < 2) errors.push("Last Name must be at least 2 characters.");
    if (!clean(newUser.middleName) || clean(newUser.middleName).length < 2) errors.push("Middle Name must be at least 2 characters.");

    const dobStr = clean(newUser.dateOfBirth);
    if (!dobStr) {
      errors.push("Date of Birth is required.");
    } else {
      const dob = new Date(dobStr);
      const today = new Date();
      if (Number.isNaN(dob.getTime())) {
        errors.push("Date of Birth is invalid.");
      } else if (dob > today) {
        errors.push("Date of Birth cannot be in the future.");
      }
    }

    if (!clean(newUser.gender)) errors.push("Gender is required.");
    if (!isValidEmail(newUser.email)) errors.push("Email must start with a letter and end with @gmail.com or @yahoo.com.");
    if (!isValidPHPhone(newUser.phone)) errors.push("Phone number must start with 09 and be 11 digits.");

    if (!clean(newUser.streetAddress) || clean(newUser.streetAddress).length < 5) errors.push("Street Address must be at least 5 characters.");
    if (!clean(newUser.city)) errors.push("City / Municipality is required.");
    if (!clean(newUser.province)) errors.push("Province is required (select a City).");
    if (!clean(newUser.postalCode)) errors.push("Postal Code is required (select a City).");

    const validateEmergencyGroup = (idx, required) => {
      const name = clean(newUser[`emergencyName${idx}`]);
      const rel = clean(newUser[`emergencyRel${idx}`]);
      const phone = clean(newUser[`emergencyContact${idx}`]);
      const any = Boolean(name || rel || phone);
      if (!required && !any) return;
      if (!name) errors.push(`Emergency Contact ${idx}: Name is required.`);
      if (!rel) errors.push(`Emergency Contact ${idx}: Relationship is required.`);
      if (!phone) errors.push(`Emergency Contact ${idx}: Contact Number is required.`);
      if (phone && !isValidPHPhone(phone)) errors.push(`Emergency Contact ${idx}: Contact Number must start with 09 and be 11 digits.`);
    };

    validateEmergencyGroup(1, true);
    validateEmergencyGroup(2, false);
    validateEmergencyGroup(3, false);

    if (clean(newUser.philHealthNumber) && !/^\d{12}$/.test(clean(newUser.philHealthNumber))) {
      errors.push("PhilHealth Number must be exactly 12 digits.");
    }

    if (!password) errors.push("Password is required.");
    if (!passwordCriteria.length || !passwordCriteria.hasNumber || !passwordCriteria.hasSpecial) {
      errors.push("Password must meet all requirements (min length, number, special character).");
    }
    if (password !== confirmPassword) errors.push("Passwords do not match.");

    if (errors.length > 0) {
      setCreatePatientError(errors.join("\n"));
      return;
    }
    
    try {
        const response = await fetch('http://localhost:5000/api/patients', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(newUser),
        });

        if (response.ok) {
            setSuccessMessage("Patient account created successfully!");
            setShowSuccessModal(true);
            e.target.reset();
            setPassword("");
            setConfirmPassword("");
            handleReset();
        } else {
            const errorData = await response.json();
            setCreatePatientError(errorData.message || JSON.stringify(errorData));
        }
    } catch (error) {
        console.error("Error:", error);
        setCreatePatientError("Failed to connect to server.");
    }
  };

  const renderContent = () => {
    // -1. DASHBOARD VIEW (Main)
    if (view === "dashboard") {
      // Calculate Stats
      const safePatientList = Array.isArray(patientList) ? patientList : [];

      // Prepare Chart Data for Patient Registration Trend (Last 7 Days)
      const last7Days = [...Array(7)].map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - i);
        return {
           year: d.getFullYear(),
           month: d.getMonth(),
           day: d.getDate()
        };
      }).reverse();

      const patientTrendData = last7Days.map(targetDate => {
        const count = safePatientList.filter(p => {
            if (!p.createdAt) return false;
            const pDate = new Date(p.createdAt);
            if (isNaN(pDate.getTime())) return false; // Prevents the crash!
            return pDate.getFullYear() === targetDate.year &&
                   pDate.getMonth() === targetDate.month &&
                   pDate.getDate() === targetDate.day;
        }).length;
        
        const dummyDate = new Date(targetDate.year, targetDate.month, targetDate.day);
        
        return { date: dummyDate.toLocaleDateString(undefined, {weekday: 'short'}), count };
      });

      // Get Recent Data
      const recentPatients = [...safePatientList]
          .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
          .slice(0, 5);

      return (
        <div className="staff-management-container">
           {/* Stats Row */}
           <div className="dashboard-stats-grid">
              <div className="stat-card">
                  <div className="stat-icon stat-icon-green">
                      <UserPlus size={32} />
                  </div>
                  <div className="stat-info">
                      <h3>{dashboardStats?.newPatients ?? '...'}</h3>
                      <p>New Patients (30d)</p>
                  </div>
              </div>

              <div className="stat-card">
                  <div className="stat-icon stat-icon-blue">
                      <Users size={32} />
                  </div>
                  <div className="stat-info">
                      <h3>{dashboardStats?.totalPatients ?? '...'}</h3>
                      <p>Total Patients</p>
                  </div>
              </div>

              <div className="stat-card">
                  <div className="stat-icon stat-icon-purple">
                      <Calendar size={32} />
                  </div>
                  <div className="stat-info">
                      <h3>{dashboardStats?.totalAppointments ?? '...'}</h3>
                      <p>Total Appointments</p>
                  </div>
              </div>

              <div className="stat-card">
                  <div className="stat-icon stat-icon-orange">
                      <Users size={32} />
                  </div>
                  <div className="stat-info">
                      <h3>{dashboardStats?.onlineStaff ?? '...'}</h3>
                      <p>Staff Online</p>
                  </div>
              </div>
           </div>

           {/* Patient Trend Chart */}
           <div className="dashboard-section-card" style={{ marginTop: '20px' }}>
                <div className="dashboard-section-header">
                  <h3 className="dashboard-section-title">
                    <Activity size={20} className="text-orange-600" style={{color: '#ea580c'}} /> Patient Registrations (Last 7 Days)
                  </h3>
                </div>
                <div style={{ width: '100%', height: 250, marginTop: '1.5rem', padding: '0 20px 20px 0' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={patientTrendData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        allowDecimals={false} 
                        tick={{ fill: '#64748b', fontSize: 12 }} 
                      />
                      <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }} />
                      <Bar dataKey="count" name="New Patients" radius={[4, 4, 0, 0]} maxBarSize={40}>
                        {patientTrendData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.count > 0 ? '#ea580c' : '#fdba74'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
            </div>

           {/* Recent Activity Grid */}
           <div className="dashboard-activity-grid">
              {/* Recent Patients Section */}
              <div className="dashboard-section-card">
                  <div className="dashboard-section-header">
                      <h3 className="dashboard-section-title">
                        <UserPlus size={20} className="text-orange-600" style={{color: '#ea580c'}} /> Newest Patients
                      </h3>
                  </div>
                  <div className="modern-list">
                      {recentPatients.length === 0 ? (
                          <div className="empty-state-container">
                            <User size={40} strokeWidth={1.5} className="empty-state-icon" />
                            <p>No recent patients found.</p>
                          </div>
                      ) : (
                          recentPatients.map((patient, idx) => (
                              <div key={idx} className="modern-list-item">
                                  <div className="item-avatar-circle" style={{background: `hsl(${Math.random() * 360}, 70%, 90%)`, color: '#475569'}}>
                                      {patient.first_name ? patient.first_name[0].toUpperCase() : 'U'}
                                  </div>
                                  <div className="item-content">
                                      <div className="item-title">{patient.firstName} {patient.lastName}</div>
                                      <div className="item-subtitle">
                                        <Mail size={12} /> {patient.email}
                                      </div>
                                  </div>
                                  <div className="item-meta">
                                      <span className="meta-date">
                                          {patient.createdAt ? new Date(patient.createdAt).toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) : 'N/A'}
                                      </span>
                                  </div>
                              </div>
                          ))
                      )}
                  </div>
              </div>

              {/* Recent Appointments Section */}
              <div className="dashboard-section-card">
                  <div className="dashboard-section-header">
                      <h3 className="dashboard-section-title">
                        <Calendar size={20} className="text-blue-600" style={{color: '#0284c7'}} /> Recent Appointments
                      </h3>
                  </div>
                  <div className="modern-list">
                    {recentAppointments.length === 0 ? (
                      <div className="empty-state-container">
                        <Calendar size={40} strokeWidth={1.5} className="empty-state-icon" />
                        <p>No recent appointments.</p>
                      </div>
                    ) : (
                      recentAppointments.map((appt, idx) => (
                        <div key={idx} className="modern-list-item">
                          <div className="item-avatar-circle" style={{background: '#e0f2fe', color: '#0284c7'}}>
                              <Calendar size={18} />
                          </div>
                          <div className="item-content">
                            <div className="item-title">{appt.title}</div>
                            <div className="item-subtitle">
                                {new Date(appt.appointmentDate || appt.createdAt).toLocaleString(undefined, {
                                    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                })}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
              </div>
           </div>
        </div>
      );
    }

    // 0. ADMIN SETTINGS VIEW
    if (view === "admin-settings") {
      return (
        <div className="admin-profile-container">
          <div className="admin-profile-header-card">
            <div className="profile-image-section">
              <div className="large-avatar-circle">
                <User size={64} color="#cbd5e1" />
              </div>
              <button type="button" className="btn-orange-sm shadow-btn">Insert Image</button>
            </div>
            <div className="profile-info-section">
              <h1>{adminProfile.name}</h1>
              <p className="admin-role-badge">{adminProfile.role}</p>
            </div>
          </div>

          <form className="admin-profile-form" onSubmit={handleUpdateAdminProfile}>
            <div className="profile-form-grid">
              <div className="profile-column">
                <div className="profile-card">
                  <h3 className="column-title">
                    <User size={20} color="#ea580c" />
                    Personal Information
                  </h3>
                  
                  <div className="profile-input-group">
                    <label>Email Address</label>
                    {emailNoticeField === "admin-email" && emailNotice && (
                      <p className="field-notice" style={{color: '#ef4444', fontSize: '0.85rem', marginTop: '-5px', marginBottom: '5px'}}>{emailNotice}</p>
                    )}
                    <div className="input-wrapper-relative">
                      <Mail size={18} style={{position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8'}} />
                      <input 
                        type="email" 
                        name="email"
                        value={adminProfile.email}
                        readOnly
                        className="profile-input"
                        style={{backgroundColor: '#f3f4f6', cursor: 'not-allowed', paddingLeft: '40px'}}
                      />
                    </div>
                  </div>

                  <div className="profile-input-group">
                    <label>Department / Role</label>
                    {nameNoticeField === "admin-department" && nameNotice && (
                      <p className="field-notice" style={{color: '#ef4444', fontSize: '0.85rem', marginTop: '-5px', marginBottom: '5px'}}>{nameNotice}</p>
                    )}
                    <div className="input-wrapper-relative">
                      <Briefcase size={18} style={{position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8'}} />
                      <input 
                        type="text" 
                        name="department"
                        value={adminProfile.department}
                        onChange={handleAdminProfileChange}
                        onKeyDown={(e) => handleNameInput(e, "admin-department")}
                        className="profile-input"
                        style={{paddingLeft: '40px'}}
                        placeholder="e.g. Administration"
                      />
                    </div>
                  </div>

                  <div className="profile-input-group">
                    <label>Phone Number</label>
                    {phoneNoticeField === "admin-phone" && phoneNotice && (
                      <p className="field-notice" style={{color: '#ef4444', fontSize: '0.85rem', marginTop: '-5px', marginBottom: '5px'}}>{phoneNotice}</p>
                    )}
                    <div className="input-wrapper-relative">
                      <Phone size={18} style={{position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8'}} />
                      <input 
                        type="tel" 
                        name="phone"
                        value={adminProfile.phone}
                        onChange={handleAdminProfileChange}
                        onKeyDown={(e) => handlePhoneInput(e, "admin-phone")}
                        className="profile-input"
                        style={{paddingLeft: '40px'}}
                        placeholder="+63 900 000 0000"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="profile-column">
                <div className="profile-card">
                  <h3 className="column-title">
                    <Shield size={20} color="#ea580c" />
                    Security & Password
                  </h3>
                  
                  <div className="profile-input-group">
                    <label>Current Password</label>
                    <div className="input-wrapper-relative">
                      <Key size={18} style={{position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8'}} />
                      <input 
                        type={showCurrentPassword ? "text" : "password"}
                        name="currentPassword"
                        value={adminProfile.currentPassword}
                        onChange={handleAdminProfileChange}
                        className="profile-input"
                        style={{paddingLeft: '40px'}}
                        placeholder="Enter current password"
                      />
                      <button 
                        type="button"
                        className="toggle-password-btn"
                        onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      >
                        {showCurrentPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                      </button>
                    </div>
                  </div>

                  <div className="profile-input-group">
                    <label>New Password</label>
                    <div className="input-wrapper-relative">
                      <Key size={18} style={{position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8'}} />
                      <input 
                        type={showNewPassword ? "text" : "password"}
                        name="newPassword"
                        value={adminProfile.newPassword}
                        onChange={handleAdminProfileChange}
                        className="profile-input"
                        style={{paddingLeft: '40px'}}
                        placeholder="Enter new password"
                      />
                      <button 
                        type="button"
                        className="toggle-password-btn"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                      >
                        {showNewPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                      </button>
                    </div>
                    
                    <div className="password-checklist">
                      <div className={`checklist-item ${passwordCriteria.length ? 'valid' : ''}`}>
                        {passwordCriteria.length ? <Check size={14} /> : <X size={14} />}
                        <span>At least 11 characters</span>
                      </div>
                      <div className={`checklist-item ${passwordCriteria.hasSpecial ? 'valid' : ''}`}>
                        {passwordCriteria.hasSpecial ? <Check size={14} /> : <X size={14} />}
                        <span>Contains special characters</span>
                      </div>
                      <div className={`checklist-item ${passwordCriteria.hasNumber ? 'valid' : ''}`}>
                        {passwordCriteria.hasNumber ? <Check size={14} /> : <X size={14} />}
                        <span>Contains numbers</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="form-actions-floating">
              <button type="submit" className="btn-orange-large">
                <Save size={20} />
                Save Changes
              </button>
            </div>
          </form>
        </div>
      );
    }

    // 1. INITIAL SELECTION VIEW
    if (view === "selection") {
      return (
        <div className="registration-container">
          <h3>Register User</h3>
          <div className="selection-grid">
            <div className="selection-card" onClick={() => setView("register-patient")}>
              <div className="icon-wrapper">
                <UserPlus size={48} strokeWidth={1.5} />
              </div>
              <h4>Patient</h4>
            </div>
            <div className="selection-card" onClick={() => setView("register-staff")}>
              <div className="icon-wrapper">
                <Users size={48} strokeWidth={1.5} />
              </div>
              <h4>Staff</h4>
            </div>
          </div>
        </div>
      );
    }

    // 2. STAFF REGISTRATION VIEW
    if (view === "register-staff") {
      return (
        <div className="patient-form-container">
          <header className="form-inner-header">
            <button className="back-link" onClick={() => setView("selection")}>
              <ArrowLeft size={24} /> Back
            </button>
            <h1 className="form-main-title">Register a Staff</h1>
          </header>

          <form className="compact-form" onSubmit={handleCreateStaff}>
            <div className="form-section-container">
              <div className="form-grid-main">
                <div className="form-left-col">
                  <h3 className="section-title">Personal Information</h3>
                  <div className="form-grid-2-col">
                    <div className="input-group">
                      <label>First Name</label>
                      {nameNoticeField === "staff-first-name" && nameNotice && (
                        <p className="field-notice">{nameNotice}</p>
                      )}
                      <input
                        type="text"
                        name="firstName"
                        required
                        onKeyDown={(e) => handleNameInput(e, "staff-first-name")}
                      />
                    </div>
                    <div className="input-group">
                      <label>Last Name</label>
                      {nameNoticeField === "staff-last-name" && nameNotice && (
                        <p className="field-notice">{nameNotice}</p>
                      )}
                      <input
                        type="text"
                        name="lastName"
                        required
                        onKeyDown={(e) => handleNameInput(e, "staff-last-name")}
                      />
                    </div>
                    <div className="input-group">
                      <label>Middle Name</label>
                      {nameNoticeField === "staff-middle-name" && nameNotice && (
                        <p className="field-notice">{nameNotice}</p>
                      )}
                      <input
                        type="text"
                        name="middleName"
                        required
                        onKeyDown={(e) => handleNameInput(e, "staff-middle-name")}
                      />
                    </div>
                    <div className="input-group">
                      <label>Date of Birth</label>
                      {ageNoticeField === "staff-dob" && ageNotice && (
                        <p className="field-notice">{ageNotice}</p>
                      )}
                      <input 
                        type="date" 
                        name="dateOfBirth"
                        className="white-input" 
                        required 
                        onChange={(e) => handleDateChange(e, "staff-dob")}
                      />
                    </div>
                    <div className="input-group">
                      <label>Gender</label>
                      <select className="white-input" name="gender" required>
                        <option value="">Select Gender</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div className="input-group">
                      <label>Employee ID</label>
                      {employeeIdNoticeField === "staff-employee-id" && employeeIdNotice && (
                        <p className="field-notice">{employeeIdNotice}</p>
                      )}
                      <input 
                        type="text" 
                        name="employeeId"
                        required 
                        onKeyDown={(e) => handleEmployeeIdInput(e, "staff-employee-id")}
                      />
                    </div>
                    <div className="input-group">
                      <label>Civil Status</label>
                      <select className="white-input" name="civilStatus" required>
                        <option value="">Select Status</option>
                        <option value="Single">Single</option>
                        <option value="Married">Married</option>
                        <option value="Widowed">Widowed</option>
                        <option value="Separated">Separated</option>
                      </select>
                    </div>
                    <div className="input-group">
                      <label>Nationality</label>
                      <select className="white-input" name="nationality" required>
                        <option value="">Select Nationality</option>
                        <option value="Filipino">Filipino</option>
                        <option value="American">American</option>
                        <option value="Chinese">Chinese</option>
                        <option value="Japanese">Japanese</option>
                        <option value="Korean">Korean</option>
                        <option value="Indian">Indian</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="profile-card-mini">
                  <p className="card-label">Profile Picture</p>
                  <div className="avatar-circle"><Camera size={40} color="#bbb" /></div>
                  <button type="button" className="btn-orange-sm shadow-btn">Insert Image</button>
                </div>
              </div>
            </div>

            <div className="form-section-container">
              <div className="form-grid-staff">
                <div className="form-section-group">
                  <h3 className="section-title">Professional Information</h3>
                  <div className="form-grid-2-col">
                    <div className="input-group">
                      <label>Medical License Number</label>
                      {medicalLicenseNoticeField === "medical-license" && medicalLicenseNotice && (
                        <p className="field-notice">{medicalLicenseNotice}</p>
                      )}
                      <input 
                        type="text" 
                        name="medicalLicenseNumber"
                        required 
                        onKeyDown={(e) => handleMedicalLicenseInput(e, "medical-license")}
                      />
                    </div>
                    <div className="input-group">
                      <label>Specialization</label>
                      {nameNoticeField === "staff-specialization" && nameNotice && (
                        <p className="field-notice">{nameNotice}</p>
                      )}
                      <input 
                        type="text" 
                        name="specialization"
                        className={`white-input ${selectedRole === 'Doctor' ? 'read-only-input' : ''}`}
                        required 
                        value={selectedRole === 'Doctor' ? 'ER' : undefined}
                        readOnly={selectedRole === 'Doctor'}
                        onKeyDown={selectedRole === 'Doctor' ? undefined : (e) => handleNameInput(e, "staff-specialization")}
                      />
                    </div>
                    <div className="input-group">
                      <label>Date Hired</label>
                      <input 
                        type="date" 
                        name="dateHired" 
                        className="white-input" 
                        required 
                        max={new Date().toISOString().split("T")[0]}
                      />
                    </div>
                    <div className="input-group">
                      <label>Role</label>
                      <select 
                        className="white-input" 
                        name="role" 
                        required 
                        value={selectedRole}
                        onChange={(e) => setSelectedRole(e.target.value)}
                      >
                        <option value="">Select Role</option>
                        <option value="Nurse">Nurse</option>
                        <option value="Doctor">Doctor</option>
                        <option value="Admin">Admin</option>
                        <option value="Pharmacist">Pharmacist</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="form-section-group">
                  <h3 className="section-title">Account Credentials</h3>
                  <div className="input-group">
                    <label>Email</label>
                    {emailNoticeField === "staff-email" && emailNotice && (
                      <p className="field-notice">{emailNotice}</p>
                    )}
                    <input 
                      type="email" 
                      name="email"
                      required 
                      onKeyDown={(e) => handleEmailInput(e, "staff-email")}
                      onChange={(e) => handleUncontrolledEmailChange(e, "staff-email")}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="form-section-container">
              <h3 className="section-title">Contact Information</h3>
              <div className="form-grid-3-col">
                <div className="input-group">
                  <label>Phone Number</label>
                  {phoneNoticeField === "staff-phone" && phoneNotice && (
                    <p className="field-notice">{phoneNotice}</p>
                  )}
                  <input
                    type="text"
                    name="phone"
                    required
                    onKeyDown={(e) => handlePhoneInput(e, "staff-phone")}
                  />
                </div>
                <div className="input-group">
                  <label>Street Address</label>
                  {addressNoticeField === "staff-address" && addressNotice && (
                    <p className="field-notice">{addressNotice}</p>
                  )}
                  <input
                    type="text"
                    name="streetAddress"
                    required
                    onKeyDown={(e) => handleAddressInput(e, "staff-address")}
                  />
                </div>
                <div className="input-group">
                  <label>City / Municipality</label>
                  <select className="white-input" name="city" required onChange={handleCityChange} value={selectedCity}>
                    <option value="">Select City</option>
                    {ncrCalabarzonCities.map((item, index) => (
                      <option key={index} value={item.city}>{item.city}</option>
                    ))}
                  </select>
                </div>
                <div className="input-group">
                  <label>Province</label>
                  <input type="text" name="province" className="white-input" value={selectedProvince} readOnly />
                </div>
                <div className="input-group">
                  <label>Postal Code</label>
                  <input type="text" name="postalCode" className="white-input" value={postalCode} readOnly />
                </div>
                <div className="input-group">
                  <label>Country</label>
                  {countryNoticeField === "staff-country" && countryNotice && (
                    <p className="field-notice">{countryNotice}</p>
                  )}
                  <input
                    type="text"
                    name="country"
                    required
                    onKeyDown={(e) => handleCountryInput(e, "staff-country")}
                  />
                </div>
              </div>
            </div>

            <div className="form-actions-row">
              <button type="submit" className="btn-orange-large shadow-btn">Create Staff Account</button>
              <button type="reset" className="btn-gray shadow-btn" onClick={handleReset}>Remove All</button>
            </div>
            {createStaffError && (
                <div style={{color: '#ef4444', marginTop: '10px', textAlign: 'left', fontWeight: 'bold'}}>
                    {createStaffError}
                </div>
            )}
          </form>
        </div>
      );
    }

    // 3. PATIENT REGISTRATION VIEW
    if (view === "register-patient") {
      return (
        <div className="patient-form-container">
          <header className="form-inner-header">
            <button className="back-link" onClick={() => setView("selection")}>
              <ArrowLeft size={24} /> Back
            </button>
            <h1 className="form-main-title">Register a New Patient</h1>
          </header>

          <form className="compact-form" onSubmit={handleCreatePatient}>
            <div className="form-section-container">
              <div className="form-grid-main">
                <div className="form-left-col">
                  <h3 className="section-title">Personal Information</h3>
                  <div className="form-grid-2-col">
                    <div className="input-group">
                      <label>First Name</label>
                      {nameNoticeField === "patient-first-name" && nameNotice && (
                        <p className="field-notice">{nameNotice}</p>
                      )}
                      <input
                        type="text"
                        name="firstName"
                        required
                        onKeyDown={(e) => handleNameInput(e, "patient-first-name")}
                      />
                    </div>
                    <div className="input-group">
                      <label>Last Name</label>
                      {nameNoticeField === "patient-last-name" && nameNotice && (
                        <p className="field-notice">{nameNotice}</p>
                      )}
                      <input
                        type="text"
                        name="lastName"
                        required
                        onKeyDown={(e) => handleNameInput(e, "patient-last-name")}
                      />
                    </div>
                    <div className="input-group">
                      <label>Middle Name</label>
                      {nameNoticeField === "patient-middle-name" && nameNotice && (
                        <p className="field-notice">{nameNotice}</p>
                      )}
                      <input
                        type="text"
                        name="middleName"
                        required
                        onKeyDown={(e) => handleNameInput(e, "patient-middle-name")}
                      />
                    </div>
                    <div className="input-group">
                      <label>Date of Birth</label>
                      {ageNoticeField === "patient-dob" && ageNotice && (
                        <p className="field-notice">{ageNotice}</p>
                      )}
                      <input 
                        type="date" 
                        name="dateOfBirth" 
                        className="white-input" 
                        required 
                        onChange={(e) => handleDateChange(e, "patient-dob")}
                      />
                    </div>
                    <div className="input-group">
                      <label>Gender</label>
                      <select className="white-input" name="gender" required>
                        <option value="">Select Gender</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="profile-card-mini">
                  <p className="card-label">Profile Picture</p>
                  <div className="avatar-circle"><Camera size={40} color="#bbb" /></div>
                  <button type="button" className="btn-orange-sm shadow-btn">Insert Image</button>
                </div>
              </div>
            </div>

            <div className="form-section-container">
              <div className="form-grid-staff">
                <div className="form-section-group">
                  <h3 className="section-title">Account Credentials</h3>
                  <div className="input-group">
                    <label>Email</label>
                    {emailNoticeField === "patient-email" && emailNotice && (
                      <p className="field-notice">{emailNotice}</p>
                    )}
                    <input
                      type="email"
                      name="email"
                      required
                      onKeyDown={(e) => handleEmailInput(e, "patient-email")}
                      onChange={(e) => handleUncontrolledEmailChange(e, "patient-email")}
                    />
                  </div>
                  <div className="input-group">
                    <label>Create a Password</label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={handlePasswordInput}
                      onFocus={() => setIsPasswordFocused(true)}
                      onBlur={() => setIsPasswordFocused(false)}
                    />
                    <div className={`password-checker ${isPasswordFocused ? "visible" : ""}`}>
                      <div className="checker-arrow"></div>
                      <div className={`checker-item ${passwordCriteria.length ? "valid" : "invalid"}`}>
                        <span className="checker-icon">{passwordCriteria.length ? "✔" : "○"}</span> Minimum 8 characters
                      </div>
                      <div className={`checker-item ${passwordCriteria.hasNumber ? "valid" : "invalid"}`}>
                        <span className="checker-icon">{passwordCriteria.hasNumber ? "✔" : "○"}</span> At least one number
                      </div>
                      <div className={`checker-item ${passwordCriteria.hasSpecial ? "valid" : "invalid"}`}>
                        <span className="checker-icon">{passwordCriteria.hasSpecial ? "✔" : "○"}</span> At least one special character
                      </div>
                    </div>
                  </div>
                  <div className="input-group">
                    <label>Confirm Password</label>
                    <input
                      type="password"
                      required
                      value={confirmPassword}
                      onChange={handleConfirmPasswordInput}
                    />
                    {confirmPassword && (
                      <p className={`match-indicator ${passwordsMatch ? "match-success" : "match-error"}`}>
                        {passwordsMatch ? "Passwords match" : "Passwords do not match"}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="form-section-container">
              <div className="form-grid-main">
                <div className="form-left-col">
                  <h3 className="section-title">Contact Information</h3>
                  <div className="form-grid-2-col">
                    <div className="input-group">
                      <label>Phone Number</label>
                      {phoneNoticeField === "patient-phone" && phoneNotice && (
                        <p className="field-notice">{phoneNotice}</p>
                      )}
                      <input
                        type="text"
                        name="phone"
                        required
                        onKeyDown={(e) => handlePhoneInput(e, "patient-phone")}
                      />
                    </div>
                    <div className="input-group">
                      <label>Street Address</label>
                      {addressNoticeField === "patient-address" && addressNotice && (
                        <p className="field-notice">{addressNotice}</p>
                      )}
                      <input
                        type="text"
                        name="streetAddress"
                        required
                        onKeyDown={(e) => handleAddressInput(e, "patient-address")}
                      />
                    </div>
                    <div className="input-group">
                      <label>City / Municipality</label>
                      <select className="white-input" name="city" required onChange={handleCityChange} value={selectedCity}>
                        <option value="">Select City</option>
                        {ncrCalabarzonCities.map((item, index) => (
                          <option key={index} value={item.city}>{item.city}</option>
                        ))}
                      </select>
                    </div>
                    <div className="input-group">
                      <label>Province</label>
                      <input type="text" name="province" className="white-input" value={selectedProvince} readOnly />
                    </div>
                    <div className="input-group">
                      <label>Postal Code</label>
                      <input type="text" name="postalCode" className="white-input" value={postalCode} readOnly />
                    </div>
                    <div className="input-group">
                      <label>Country</label>
                      {countryNoticeField === "patient-country" && countryNotice && (
                        <p className="field-notice">{countryNotice}</p>
                      )}
                      <input
                        type="text"
                        name="country"
                        required
                        onKeyDown={(e) => handleCountryInput(e, "patient-country")}
                      />
                    </div>
                  </div>
                </div>
                <div className="scanner-card-mini">
                  <h3 className="scanner-title">Generate Scanner</h3>
                  <p className="scanner-text">Instead manually inserting information. Input information through a scanner.</p>
                  <button type="button" className="btn-orange-full shadow-btn"><QrCode size={18} /> Open Scanner</button>
                </div>
              </div>
            </div>

            <div className="form-section-container">
              <h3 className="section-title">Emergency Contact</h3>
              <div className="form-grid-3-col">
                <div className="emergency-col">
                  <div className="input-group">
                    <label>Emergency Contact Name</label>
                    {nameNoticeField === "emergency-name-1" && nameNotice && (
                      <p className="field-notice">{nameNotice}</p>
                    )}
                    <input
                      type="text"
                      name="emergencyName1"
                      required
                      onKeyDown={(e) => handleNameInput(e, "emergency-name-1")}
                    />
                  </div>
                  
                  <div className="input-group">
                    <label>Relationship</label>
                    {nameNoticeField === "emergency-rel-1" && nameNotice && (
                      <p className="field-notice">{nameNotice}</p>
                    )}
                    <input 
                      type="text" 
                      name="emergencyRel1"
                      required 
                      onKeyDown={(e) => handleNameInput(e, "emergency-rel-1")}
                    />
                  </div>

                  <div className="input-group">
                    <label>Contact Number</label>
                    {phoneNoticeField === "emergency-contact-1" && phoneNotice && (
                      <p className="field-notice">{phoneNotice}</p>
                    )}
                    <input 
                      type="text" 
                      name="emergencyContact1"
                      required 
                      onKeyDown={(e) => handlePhoneInput(e, "emergency-contact-1")}
                    />
                  </div>
                </div>

                <div className="emergency-col">
                  <div className="input-group">
                    <label>Emergency Contact Name</label>
                    {nameNoticeField === "emergency-name-2" && nameNotice && (
                      <p className="field-notice">{nameNotice}</p>
                    )}
                    <input
                      type="text"
                      name="emergencyName2"
                      onKeyDown={(e) => handleNameInput(e, "emergency-name-2")}
                    />
                  </div>

                  <div className="input-group">
                    <label>Relationship</label>
                    {nameNoticeField === "emergency-rel-2" && nameNotice && (
                      <p className="field-notice">{nameNotice}</p>
                    )}
                    <input 
                      type="text" 
                      name="emergencyRel2"
                      onKeyDown={(e) => handleNameInput(e, "emergency-rel-2")}
                    />
                  </div>

                  <div className="input-group">
                    <label>Contact Number</label>
                    {phoneNoticeField === "emergency-contact-2" && phoneNotice && (
                      <p className="field-notice">{phoneNotice}</p>
                    )}
                    <input 
                      type="text" 
                      name="emergencyContact2"
                      onKeyDown={(e) => handlePhoneInput(e, "emergency-contact-2")}
                    />
                  </div>
                </div>

                <div className="emergency-col">
                  <div className="input-group">
                    <label>Emergency Contact Name</label>
                    {nameNoticeField === "emergency-name-3" && nameNotice && (
                      <p className="field-notice">{nameNotice}</p>
                    )}
                    <input
                      type="text"
                      name="emergencyName3"
                      onKeyDown={(e) => handleNameInput(e, "emergency-name-3")}
                    />
                  </div>

                  <div className="input-group">
                    <label>Relationship</label>
                    {nameNoticeField === "emergency-rel-3" && nameNotice && (
                      <p className="field-notice">{nameNotice}</p>
                    )}
                    <input 
                      type="text" 
                      name="emergencyRel3"
                      onKeyDown={(e) => handleNameInput(e, "emergency-rel-3")}
                    />
                  </div>

                  <div className="input-group">
                    <label>Contact Number</label>
                    {phoneNoticeField === "emergency-contact-3" && phoneNotice && (
                      <p className="field-notice">{phoneNotice}</p>
                    )}
                    <input 
                      type="text" 
                      name="emergencyContact3"
                      onKeyDown={(e) => handlePhoneInput(e, "emergency-contact-3")}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="form-section-container">
              <h3 className="section-title">Medical Record (Optional)</h3>
              <div className="form-grid-3-col">
                <div className="input-group"><label>Blood Type</label><input type="text" name="bloodType" /></div>
                <div className="input-group"><label>Allergies</label><input type="text" name="allergies" /></div>
                <div className="input-group"><label>PhilHealth Number</label><input type="text" name="philHealthNumber" /></div>
              </div>
            </div>

            <div className="form-actions-row">
              <button type="submit" className="btn-orange-large shadow-btn">Create Patient Account</button>
              <button type="reset" className="btn-gray shadow-btn" onClick={handleReset}>Remove All</button>
            </div>
            {createPatientError && (
                <div style={{color: '#ef4444', marginTop: '10px', textAlign: 'left', fontWeight: 'bold'}}>
                    {createPatientError}
                </div>
            )}
          </form>
        </div>
      );
    }

    // 4. PATIENT MANAGEMENT VIEW
    if (view === "patient-management") {
      const PATIENTS_PER_PAGE = 9;
      const filteredPatients = patientList.filter((p) => {
        const query = patientSearchTerm.trim().toLowerCase();
        if (!query) return true;
        const fullName = `${p.first_name || ""} ${p.last_name || ""}`.trim().toLowerCase();
        const email = (p.email || "").toLowerCase();
        const contact = (p.contactNumber || p.phone || "").toString().toLowerCase();
        return fullName.includes(query) || email.includes(query) || contact.includes(query);
      });

      const totalPages = Math.max(1, Math.ceil(filteredPatients.length / PATIENTS_PER_PAGE));
      const currentPage = Math.min(Math.max(1, patientPage), totalPages);
      const startIndex = (currentPage - 1) * PATIENTS_PER_PAGE;
      const pagedPatients = filteredPatients.slice(startIndex, startIndex + PATIENTS_PER_PAGE);

      return (
        <div className="staff-management-container patient-management-container">
           <div className="pm-header">
              <div className="pm-title-block">
                <h3 className="pm-title">Patient Management</h3>
                <p className="pm-subtitle">Manage and monitor patient records</p>
              </div>
              <div className="pm-toolbar">
                <div className="pm-search">
                  <Search size={18} className="pm-search-icon" />
                  <input
                    type="text"
                    value={patientSearchTerm}
                    onChange={(e) => {
                      setPatientSearchTerm(e.target.value);
                      setPatientPage(1);
                    }}
                    placeholder="Search patients..."
                    className="pm-search-input"
                  />
                </div>
                <div className="patient-pagination">
                  <button
                    type="button"
                    className="patient-page-btn"
                    onClick={() => setPatientPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <div className="patient-page-indicator">
                    <span className="patient-page-strong">{currentPage}</span>
                    <span className="patient-page-muted">/ {totalPages}</span>
                  </div>
                  <button
                    type="button"
                    className="patient-page-btn"
                    onClick={() => setPatientPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    aria-label="Next page"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
                <button className="btn-print" onClick={() => window.print()} title="Print List">
                  <Printer size={20} />
                </button>
              </div>
           </div>

           <div className="print-only-table">
              <h2>Patient List</h2>
              <table>
                  <thead>
                      <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Contact</th>
                          <th>Gender</th>
                          <th>Date of Birth</th>
                      </tr>
                  </thead>
                  <tbody>
                      {filteredPatients.map(p => (
                          <tr key={p.id}>
                              <td>{p.first_name} {p.last_name}</td>
                              <td>{p.email}</td>
                              <td>{p.contactNumber || p.phone}</td>
                              <td>{p.gender}</td>
                              <td>{p.date_of_birth ? new Date(p.date_of_birth).toLocaleDateString() : 'N/A'}</td>
                          </tr>
                      ))}
                  </tbody>
              </table>
           </div>

           <div className="patient-card-grid">
              {pagedPatients.length === 0 ? (
                <div className="pm-empty-state">
                  <User size={52} color="#cbd5e1" />
                  <p>No patients found matching your search.</p>
                </div>
              ) : (
                  pagedPatients.map((patient) => {
                      const age = patient.date_of_birth ? new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear() : 'N/A';
                      const avatarColor = `hsl(${(patient.first_name ? patient.first_name.length : 0) * 40}, 70%, 90%)`;
                      
                      return (
                        <div key={patient.id} className="patient-card">
                          <div className="patient-card-header">
                            <div className="patient-identity">
                              <div className="patient-card-avatar" style={{background: avatarColor}}>
                                {patient.first_name ? patient.first_name[0].toUpperCase() : 'P'}
                              </div>
                              <div>
                                <div className="patient-name-large">{patient.first_name} {patient.last_name}</div>
                                <div className="card-value">
                                  <Mail size={14} />
                                  {patient.email || 'No email'}
                                </div>
                              </div>
                            </div>
                          </div>
                          
                          <div className="patient-card-body">
                            <div className="card-info-item">
                                <span className="card-label">Age / Gender</span>
                                <span className="card-data">{age} yrs • {patient.gender || 'N/A'}</span>
                            </div>
                            <div className="card-info-item">
                                <span className="card-label">Contact</span>
                                <span className="card-data">{patient.contact_number || 'N/A'}</span>
                            </div>
                            <div className="card-info-item" style={{gridColumn: 'span 2'}}>
                                <span className="card-label">Address</span>
                                <span className="card-data text-ellipsis">
                                  {[patient.street, patient.city, patient.province].filter(Boolean).join(', ') || 'N/A'}
                                </span>
                            </div>
                          </div>
                        </div>
                      );
                  })
              )}
           </div>
           
           {editingPatient && (
            <div className="modal-overlay">
              <div className="modal-card patient-edit-modal" style={{maxWidth: '800px'}}>
                <div className="patient-edit-header">
                  <div className="patient-edit-header-left">
                    <div className="patient-edit-icon">
                      <Edit size={22} />
                    </div>
                    <div>
                      <h3 className="patient-edit-title">Edit Patient Record</h3>
                      <p className="patient-edit-subtitle">Review and update the patient information</p>
                    </div>
                  </div>
                  <div className="patient-edit-header-actions">
                    <button onClick={() => setEditingPatient(null)} className="modal-action-cancel" type="button">
                      Cancel
                    </button>
                    <button type="submit" form="patient-edit-form" className="patient-edit-save-btn">
                      Save Changes
                    </button>
                  </div>
                </div>

                <form id="patient-edit-form" onSubmit={handleUpdatePatient}>
                  <div className="patient-edit-body">
                    <div className="patient-edit-section">
                      <div className="patient-edit-section-title">Personal Information</div>
                      <div className="form-grid-3-col">
                        <div>
                          <label className="form-label">First Name</label>
                          {nameNoticeField === "edit-firstName" && nameNotice && (
                            <p className="field-notice">{nameNotice}</p>
                          )}
                          <input
                            type="text"
                            name="firstName"
                            value={editFormData.firstName}
                            onChange={handleEditFormChange}
                            onKeyDown={(e) => handleNameInput(e, "edit-firstName")}
                            required
                            className="white-input"
                          />
                        </div>
                        <div>
                          <label className="form-label">Middle Name</label>
                          {nameNoticeField === "edit-middleName" && nameNotice && (
                            <p className="field-notice">{nameNotice}</p>
                          )}
                          <input
                            type="text"
                            name="middleName"
                            value={editFormData.middleName}
                            onChange={handleEditFormChange}
                            onKeyDown={(e) => handleNameInput(e, "edit-middleName")}
                            className="white-input"
                          />
                        </div>
                        <div>
                          <label className="form-label">Last Name</label>
                          {nameNoticeField === "edit-lastName" && nameNotice && (
                            <p className="field-notice">{nameNotice}</p>
                          )}
                          <input
                            type="text"
                            name="lastName"
                            value={editFormData.lastName}
                            onChange={handleEditFormChange}
                            onKeyDown={(e) => handleNameInput(e, "edit-lastName")}
                            required
                            className="white-input"
                          />
                        </div>
                      </div>
                      <div className="form-grid-3-col mt-20">
                        <div>
                          <label className="form-label">Date of Birth</label>
                          {ageNoticeField === "edit-dob" && ageNotice && (
                            <p className="field-notice">{ageNotice}</p>
                          )}
                          <input
                            type="date"
                            name="dateOfBirth"
                            value={editFormData.dateOfBirth}
                            onChange={(e) => {
                              handleEditFormChange(e);
                              handleDateChange(e, "edit-dob");
                            }}
                            required
                            className="white-input"
                          />
                        </div>
                        <div>
                          <label className="form-label">Gender</label>
                          <select name="gender" value={editFormData.gender} onChange={handleEditFormChange} required className="white-input">
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="patient-edit-section">
                      <div className="patient-edit-section-title">Contact Information</div>
                      <div className="form-grid-2-col">
                        <div>
                          <label className="form-label">Phone Number</label>
                          {phoneNoticeField === "edit-phone" && phoneNotice && (
                            <p className="field-notice">{phoneNotice}</p>
                          )}
                          <input
                            type="text"
                            name="phone"
                            value={editFormData.phone}
                            onChange={handleEditFormChange}
                            onKeyDown={(e) => handlePhoneInput(e, "edit-phone")}
                            required
                            className="white-input"
                          />
                        </div>
                        <div>
                          <label className="form-label">Email</label>
                          {emailNoticeField === "edit-email" && emailNotice && (
                            <p className="field-notice">{emailNotice}</p>
                          )}
                          <input
                            type="email"
                            name="email"
                            value={editFormData.email}
                            onChange={handleEditFormChange}
                            onKeyDown={(e) => handleEmailInput(e, "edit-email")}
                            required
                            className="white-input"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="form-label">Street Address</label>
                          {addressNoticeField === "edit-address" && addressNotice && (
                            <p className="field-notice">{addressNotice}</p>
                          )}
                          <input
                            type="text"
                            name="streetAddress"
                            value={editFormData.streetAddress}
                            onChange={handleEditFormChange}
                            onKeyDown={(e) => handleAddressInput(e, "edit-address")}
                            required
                            className="white-input"
                          />
                        </div>
                        <div>
                          <label className="form-label">City</label>
                          <select name="city" value={editFormData.city} onChange={handleEditFormChange} required className="white-input">
                            <option value="">Select City</option>
                            {ncrCalabarzonCities.map((item, index) => (
                              <option key={index} value={item.city}>{item.city}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="form-label">Province</label>
                          <input type="text" name="province" value={editFormData.province || ''} readOnly className="white-input input-disabled-bg" />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="patient-edit-footer">
                    <button type="button" className="btn-logout-cancel" onClick={() => setEditingPatient(null)}>Cancel</button>
                    <button type="submit" className="btn-logout-confirm">Save Changes</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      );
    }

    // 5. STAFF MANAGEMENT VIEW
    if (view === "staff-management") {
      const filteredStaff = staffList.filter((s) => {
        const query = staffSearchTerm.trim().toLowerCase();
        if (!query) return true;
        const fullName = `${s.firstName || ""} ${s.lastName || ""}`.trim().toLowerCase();
        const email = (s.email || "").toLowerCase();
        const role = (s.role || "").toLowerCase();
        const empId = (s.employeeId || "").toString().toLowerCase();
        const phone = (s.phone || "").toString().toLowerCase();
        return (
          fullName.includes(query) ||
          email.includes(query) ||
          role.includes(query) ||
          empId.includes(query) ||
          phone.includes(query)
        );
      });

      return (
        <div className="staff-management-container staff-management-cards">
          <div className="sm-header">
            <div className="sm-title-block">
              <h3 className="sm-title">Staff Management</h3>
              <p className="sm-subtitle">Manage staff accounts and contact details</p>
            </div>
            <div className="sm-toolbar">
              <div className="sm-search">
                <Search size={18} className="sm-search-icon" />
                <input
                  type="text"
                  value={staffSearchTerm}
                  onChange={(e) => setStaffSearchTerm(e.target.value)}
                  placeholder="Search staff..."
                  className="sm-search-input"
                />
              </div>
              <button className="btn-print" onClick={() => window.print()} title="Print List">
                <Printer size={20} />
              </button>
            </div>
          </div>

          <div className="print-only-table">
            <h2>Staff List</h2>
            <table>
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Email</th>
                        <th>Contact</th>
                        <th>Employee ID</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    {filteredStaff.map(s => (
                        <tr key={s.id}>
                            <td>{s.firstName} {s.lastName}</td>
                            <td>{s.role}</td>
                            <td>{s.email}</td>
                            <td>{s.phone}</td>
                            <td>{s.employeeId}</td>
                            <td>{s.status}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
         </div>

          <div className="staff-card-grid">
            {filteredStaff.length === 0 ? (
              <div className="sm-empty-state">
                <Users size={52} color="#cbd5e1" />
                <p>No staff members found.</p>
              </div>
            ) : (
              filteredStaff.map((staff) => {
                const avatarColor = `hsl(${(staff.firstName ? staff.firstName.length : 0) * 36}, 70%, 90%)`;
                const fullName = `${staff.firstName || ""} ${staff.lastName || ""}`.trim() || "Staff Member";
                const roleText = staff.role || "Staff";
                const employeeId = staff.employeeId || "N/A";
                const phone = staff.phone || "N/A";
                const email = staff.email || "No email";
                const status = staff.status || "Offline";

                return (
                  <div key={staff.id} className="staff-card">
                    <div className="staff-card-header">
                      <div className="staff-identity">
                        <div className="staff-card-avatar" style={{ background: avatarColor }}>
                          {(staff.firstName ? staff.firstName[0] : "S").toUpperCase()}
                        </div>
                        <div className="staff-info">
                          <div className="staff-name">{fullName}</div>
                          <div className="staff-email">
                            <Mail size={14} />
                            <span title={email}>{email}</span>
                          </div>
                        </div>
                      </div>
                      <div className="staff-card-actions">
                        <button
                          className="staff-icon-btn"
                          title="Edit Staff"
                          onClick={() => handleEditStaff(staff)}
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          className="staff-icon-btn danger"
                          title="Delete Staff"
                          onClick={() => handleDeleteStaff(staff.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    <div className="staff-card-body">
                      <div className="staff-row">
                        <div className="staff-icon-box">
                          <Briefcase size={16} />
                        </div>
                        <div className="staff-content">
                          <div className="staff-label">Role</div>
                          <div className="staff-value">{roleText}</div>
                        </div>
                      </div>
                      <div className="staff-row">
                        <div className="staff-icon-box">
                          <Key size={16} />
                        </div>
                        <div className="staff-content">
                          <div className="staff-label">Employee ID</div>
                          <div className="staff-value">ID: {employeeId}</div>
                        </div>
                      </div>
                      <div className="staff-row">
                        <div className="staff-icon-box">
                          <Phone size={16} />
                        </div>
                        <div className="staff-content">
                          <div className="staff-label">Contact</div>
                          <div className="staff-value">{phone}</div>
                        </div>
                      </div>
                      <div className="staff-row">
                        <div className="staff-icon-box">
                          <Activity size={16} />
                        </div>
                        <div className="staff-content">
                          <div className="staff-label">Status</div>
                          <div className="staff-value">
                            <span className={`status-badge ${status === "Online" ? "status-online" : "status-offline"}`}>
                              {status}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                  </div>
                );
              })
            )}
          </div>

           {editingStaff && (
            <div className="modal-overlay">
              <div className="modal-card staff-edit-modal">
                <div className="staff-edit-header">
                  <div className="staff-edit-header-left">
                    <div className="staff-edit-icon">
                      <Edit size={22} />
                    </div>
                    <div>
                      <h3 className="staff-edit-title">Edit Staff Member</h3>
                      <p className="staff-edit-subtitle">Update staff account and contact information</p>
                    </div>
                  </div>
                  <div className="staff-edit-header-actions">
                    <button onClick={handleCancelEdit} className="modal-action-cancel" type="button">
                      Cancel
                    </button>
                    <button type="submit" form="staff-edit-form" className="patient-edit-save-btn">
                      Save Changes
                    </button>
                  </div>
                </div>

                <form id="staff-edit-form" onSubmit={handleSaveStaff}>
                  <div className="staff-edit-body">
                    <div className="staff-edit-section">
                      <div className="staff-edit-section-title">Staff Details</div>
                      <div className="form-grid-2-col">
                        <div className="staff-field">
                          <label className="form-label">First Name</label>
                          {nameNoticeField === "edit-firstName" && nameNotice && (
                            <p className="field-notice">{nameNotice}</p>
                          )}
                          <input
                            type="text"
                            name="firstName"
                            value={editFormData.firstName}
                            onChange={handleEditFormChange}
                            onKeyDown={(e) => handleNameInput(e, "edit-firstName")}
                            required
                            className="white-input"
                          />
                        </div>
                        <div className="staff-field">
                          <label className="form-label">Last Name</label>
                          {nameNoticeField === "edit-lastName" && nameNotice && (
                            <p className="field-notice">{nameNotice}</p>
                          )}
                          <input
                            type="text"
                            name="lastName"
                            value={editFormData.lastName}
                            onChange={handleEditFormChange}
                            onKeyDown={(e) => handleNameInput(e, "edit-lastName")}
                            required
                            className="white-input"
                          />
                        </div>
                      </div>

                      <div className="staff-field mt-20">
                        <label className="form-label">Role / Position</label>
                        <select
                          name="role"
                          value={editFormData.role}
                          onChange={handleEditFormChange}
                          required
                          className="white-input"
                        >
                          <option value="">Select Role</option>
                          <option value="Admin">Admin</option>
                          <option value="Doctor">Doctor</option>
                          <option value="Nurse">Nurse</option>
                          <option value="Staff">Staff</option>
                        </select>
                      </div>
                    </div>

                    <div className="staff-edit-section">
                      <div className="staff-edit-section-title">Contact</div>
                      <div className="form-grid-2-col">
                        <div className="staff-field">
                          <label className="form-label">Email</label>
                          {emailNoticeField === "edit-email" && emailNotice && (
                            <p className="field-notice">{emailNotice}</p>
                          )}
                          <input
                            type="email"
                            name="email"
                            value={editFormData.email}
                            onChange={handleEditFormChange}
                            onKeyDown={(e) => handleEmailInput(e, "edit-email")}
                            required
                            className="white-input"
                          />
                        </div>
                        <div className="staff-field">
                          <label className="form-label">Phone Number</label>
                          {phoneNoticeField === "edit-phone" && phoneNotice && (
                            <p className="field-notice">{phoneNotice}</p>
                          )}
                          <input
                            type="tel"
                            name="phone"
                            value={editFormData.phone}
                            onChange={handleEditFormChange}
                            onKeyDown={(e) => handlePhoneInput(e, "edit-phone")}
                            required
                            className="white-input"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      );
    }

    // 5. NURSE DASHBOARD VIEW
    if (view === "dashboard-nurse") {
      return (
        <div className="staff-management-container">
           <div className="dashboard-grid-layout">
              {/* Shift Roster */}
              <div className="table-card" style={{padding: '20px'}}>
                  <div className="card-header-flex">
                      <h3 className="card-header-title">Nurse Shift Roster (Today)</h3>
                      <span className="badge-today">Today</span>
                  </div>
                  <table className="staff-table">
                      <thead>
                          <tr>
                              <th>Name</th>
                              <th>Shift</th>
                              <th>Area</th>
                              <th>Status</th>
                          </tr>
                      </thead>
                      <tbody>
                          <tr>
                              <td>Jane Doe</td>
                              <td>6:00 AM - 2:00 PM</td>
                              <td>ER</td>
                              <td><span className="status-badge-onduty">On Duty</span></td>
                          </tr>
                          <tr>
                              <td>John Smith</td>
                              <td>6:00 AM - 2:00 PM</td>
                              <td>ICU</td>
                              <td><span className="status-badge-onduty">On Duty</span></td>
                          </tr>
                          <tr>
                              <td>Maria Garcia</td>
                              <td>2:00 PM - 10:00 PM</td>
                              <td>Ward A</td>
                              <td><span className="status-badge-upcoming">Upcoming</span></td>
                          </tr>
                          <tr>
                              <td>Alex Brown</td>
                              <td>10:00 PM - 6:00 AM</td>
                              <td>Pediatrics</td>
                              <td><span className="status-badge-scheduled">Scheduled</span></td>
                          </tr>
                      </tbody>
                  </table>
              </div>

              {/* Quick Announcements/Tasks */}
              <div className="flex-column gap-20">
                  <div className="table-card" style={{padding: '20px', flex: 1}}>
                      <h3 className="card-header-title card-header-mb">Announcements</h3>
                      <div className="announcement-list">
                          <div className="announcement-card-orange">
                              <p className="announcement-title-orange">Staff Meeting</p>
                              <p className="announcement-text">General assembly at 3:00 PM in Conference Room B.</p>
                          </div>
                          <div className="announcement-card-blue">
                              <p className="announcement-title-blue">Protocol Update</p>
                              <p className="announcement-text">New sanitation guidelines effective immediately.</p>
                          </div>
                      </div>
                  </div>
                  
                  <div className="table-card" style={{padding: '20px', flex: 1}}>
                      <h3 className="card-header-title card-header-mb">Pending Requests</h3>
                      <div className="flex-column gap-10">
                          <div className="request-item">
                              <div>
                                  <p className="request-title">Leave Request</p>
                                  <p className="request-subtitle">Sarah Connor • Sick Leave</p>
                              </div>
                              <button className="btn-view-sm">View</button>
                          </div>
                          <div className="request-item">
                              <div>
                                  <p className="request-title">Supply Restock</p>
                                  <p className="request-subtitle">Ward B • Bandages</p>
                              </div>
                              <button className="btn-view-sm">View</button>
                          </div>
                      </div>
                  </div>
              </div>
           </div>
        </div>
      );
    }

    // 6. ACTIVITY LOGS VIEW
    if (view === "activity-logs") {
        return (
            <div className="staff-management-container">
                <div className="table-card" style={{padding: '20px'}}>
                    <h3 className="card-header-title-lg mb-20">Activity Logs</h3>
                    <div className="flex-column gap-0">
                        {/* Content removed as requested */}
                    </div>
                </div>
            </div>
        );
    }

    // 7. REQUESTS VIEW
    if (view === "requests") {
        const filteredRequests = requestFilter === 'All' 
            ? requests 
            : requests.filter(req => req.status === requestFilter);

        return (
            <div className="staff-management-container">
                <div className="table-card" style={{padding: '25px'}}>
                    <div className="flex-row-between-center mb-25">
                        <h3 className="card-header-title-lg">Correction Requests</h3>
                        
                        <div className="flex-row gap-10">
                            {[
                                { label: 'All', icon: <MessageSquare size={16} /> },
                                { label: 'Pending', icon: <Activity size={16} /> },
                                { label: 'Resolved', icon: <Check size={16} /> },
                                { label: 'Rejected', icon: <X size={16} /> }
                            ].map(filter => (
                                <button 
                                    key={filter.label}
                                    onClick={() => setRequestFilter(filter.label)}
                                    className={`btn-filter ${requestFilter === filter.label ? 'active' : ''}`}
                                >
                                    {filter.icon}
                                    {filter.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {filteredRequests.length === 0 ? (
                        <div style={{textAlign: 'center', padding: '40px', color: '#94a3b8'}}>
                            <MessageSquare size={48} style={{marginBottom: '15px', opacity: 0.5}} />
                            <p>No requests found matching this filter.</p>
                        </div>
                    ) : (
                        <div style={{display: 'flex', flexDirection: 'column', gap: '15px'}}>
                            {filteredRequests.map(req => (
                                <div key={req._id} style={{
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '12px',
                                    padding: '20px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '15px',
                                    background: 'white',
                                    position: 'relative',
                                    overflow: 'hidden'
                                }}>
                                    {/* Status Stripe */}
                                    <div style={{
                                        position: 'absolute',
                                        left: 0,
                                        top: 0,
                                        bottom: 0,
                                        width: '4px',
                                        background: req.status === 'Pending' ? '#f59e0b' : req.status === 'Resolved' ? '#22c55e' : '#ef4444'
                                    }} />

                                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
                                        <div>
                                            <div style={{display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px'}}>
                                                <h4 style={{fontSize: '1.1rem', fontWeight: 'bold', color: '#1e293b'}}>{req.patientName}</h4>
                                                <span style={{
                                                    fontSize: '0.75rem',
                                                    padding: '2px 8px',
                                                    borderRadius: '12px',
                                                    background: '#f1f5f9',
                                                    color: '#64748b',
                                                    fontWeight: '500'
                                                }}>
                                                    ID: {req.patientId.substring(req.patientId.length - 6)}
                                                </span>
                                            </div>
                                            <p style={{fontSize: '0.9rem', color: '#64748b'}}>
                                                Requested by <span style={{fontWeight: '600', color: '#475569'}}>{req.requestedBy}</span> • {new Date(req.createdAt).toLocaleString()}
                                            </p>
                                        </div>
                                        
                                        <span style={{
                                            padding: '6px 12px',
                                            borderRadius: '20px',
                                            fontSize: '0.85rem',
                                            fontWeight: '600',
                                            background: req.status === 'Pending' ? '#fef3c7' : req.status === 'Resolved' ? '#dcfce7' : '#fee2e2',
                                            color: req.status === 'Pending' ? '#d97706' : req.status === 'Resolved' ? '#16a34a' : '#dc2626'
                                        }}>
                                            {req.status}
                                        </span>
                                    </div>

                                    <div style={{background: '#f8fafc', padding: '15px', borderRadius: '8px', border: '1px solid #f1f5f9'}}>
                                        <p style={{fontSize: '0.95rem', color: '#334155', lineHeight: '1.5'}}>
                                            <span style={{fontWeight: '600', color: '#475569', marginRight: '5px'}}>Request:</span>
                                            {req.message}
                                        </p>
                                    </div>

                                    {req.status === 'Pending' && (
                                        <div style={{display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '5px'}}>
                                            <button
                                                onClick={() => {
                                                    const patient = patientList.find(p => p._id === req.patientId);
                                                    if (patient) {
                                                        setRequestReview({ patient, req });
                                                    } else {
                                                        alert("Patient record not found. They may have been deleted.");
                                                    }
                                                }}
                                                className="btn-review"
                                            >
                                                <User size={16} /> Review Patient
                                            </button>
                                            <button 
                                                onClick={() => handleUpdateRequestStatus(req._id, 'Rejected')}
                                                className="btn-reject"
                                            >
                                                <X size={16} /> Reject
                                            </button>
                                            <button 
                                                onClick={() => handleUpdateRequestStatus(req._id, 'Resolved')}
                                                className="btn-resolve"
                                            >
                                                <Check size={16} /> Mark as Resolved
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {requestReview && (
                      <div className="modal-overlay">
                        <div className="modal-card request-review-card">
                          <div className="request-review-header">
                            <div className="request-review-title-block">
                              <h3 className="request-review-title">Review Patient</h3>
                              <p className="request-review-subtitle">
                                {requestReview.req?.patientName || `${requestReview.patient?.firstName || ""} ${requestReview.patient?.lastName || ""}`.trim()}
                              </p>
                            </div>
                            <button className="modal-close-btn" onClick={() => setRequestReview(null)} type="button">
                              <X size={22} />
                            </button>
                          </div>

                          <div className="request-review-body">
                            <div className="request-review-section">
                              <div className="request-review-section-title">Patient Details</div>
                              <div className="request-review-grid">
                                <div className="request-review-item">
                                  <div className="request-review-label">Email</div>
                                  <div className="request-review-value">{requestReview.patient?.email || "N/A"}</div>
                                </div>
                                <div className="request-review-item">
                                  <div className="request-review-label">Contact</div>
                                  <div className="request-review-value">{requestReview.patient?.contactNumber || requestReview.patient?.phone || "N/A"}</div>
                                </div>
                                <div className="request-review-item">
                                  <div className="request-review-label">Gender</div>
                                  <div className="request-review-value">{requestReview.patient?.gender || "N/A"}</div>
                                </div>
                                <div className="request-review-item">
                                  <div className="request-review-label">Date of Birth</div>
                                  <div className="request-review-value">
                                    {requestReview.patient?.dateOfBirth ? new Date(requestReview.patient.dateOfBirth).toLocaleDateString() : "N/A"}
                                  </div>
                                </div>
                                <div className="request-review-item request-review-span-2">
                                  <div className="request-review-label">Address</div>
                                  <div className="request-review-value">
                                    {requestReview.patient?.address
                                      ? [requestReview.patient.address.street, requestReview.patient.address.city, requestReview.patient.address.province]
                                          .filter(Boolean)
                                          .join(", ")
                                      : "N/A"}
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="request-review-section">
                              <div className="request-review-section-title">Request Message</div>
                              <div className="request-review-message">
                                {requestReview.req?.message || "No message provided."}
                              </div>
                            </div>
                          </div>

                          <div className="request-review-footer">
                            <button type="button" className="btn-logout-cancel" onClick={() => setRequestReview(null)}>
                              Close
                            </button>
                            <button
                              type="button"
                              className="btn-logout-confirm"
                              onClick={() => {
                                const patient = requestReview.patient;
                                setRequestReview(null);
                                if (patient) {
                                  handleEditPatient(patient);
                                  setView("patient-management");
                                }
                              }}
                            >
                              Edit Patient
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                </div>
            </div>
        );
    }
  };

  return (
    <div className="admin-layout admin-plain-text">
      {/* SIDEBAR */}
      <aside className={`admin-sidebar ${isCollapsed ? "collapsed" : ""}`}>
        <div className="admin-sidebar-header">
          <span className="sidebar-title">Admin Panel</span>
          <button onClick={() => setIsCollapsed(!isCollapsed)} className="toggle-btn">
            {isCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
          </button>
        </div>

        <div 
          className={`admin-sidebar-profile ${view === "admin-settings" ? "active" : ""}`}
          onClick={() => setView("admin-settings")}
        >
          <div className="profile-icon-wrapper">
             <User size={24} />
          </div>
          <div className="profile-info-container">
            <div className="admin-profile-name">{adminProfile.name || "Admin User"}</div>
            <div className="admin-profile-role">Administrator</div>
            <div className="view-profile-text">View Profile</div>
          </div>
        </div>

        <nav className="admin-sidebar-nav">
          <div 
            className={`nav-item ${view === "dashboard" ? "active" : ""}`} 
            onClick={() => setView("dashboard")}
          >
            <LayoutDashboard size={26} />
            <span className="nav-text">Dashboard</span>
          </div>

          <div 
            className={`nav-item ${["selection", "register-staff", "register-patient"].includes(view) ? "active" : ""}`} 
            onClick={() => setView("selection")}
          >
            <UserPlus size={26} />
            <span className="nav-text">Register</span>
          </div>

          <div 
            className={`nav-item ${view === "patient-management" ? "active" : ""}`}
            onClick={() => setView("patient-management")}
          >
            <User size={26} />
            <span className="nav-text">Patients</span>
          </div>

          <div 
            className={`nav-item ${view === "staff-management" ? "active" : ""}`}
            onClick={() => setView("staff-management")}
          >
            <Users size={26} />
            <span className="nav-text">Staffs</span>
          </div>

          <div 
            className={`nav-item ${view === "requests" ? "active" : ""}`}
            onClick={() => setView("requests")}
            style={{position: 'relative'}}
          >
            <MessageSquare size={26} />
            <span className="nav-text">Requests</span>
            {requests.filter(r => r.status === 'Pending').length > 0 && (
                <span style={{
                    position: 'absolute',
                    top: '8px',
                    right: '10px',
                    background: '#ef4444',
                    color: 'white',
                    fontSize: '0.7rem',
                    fontWeight: 'bold',
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '2px solid white'
                }}>
                    {requests.filter(r => r.status === 'Pending').length}
                </span>
            )}
          </div>

          <div 
            className={`nav-item ${view === "activity-logs" ? "active" : ""}`}
            onClick={() => setView("activity-logs")}
          >
            <History size={26} />
            <span className="nav-text">Activity Logs</span>
          </div>
        </nav>
        

      </aside>

      <main className="main-content">
        <header className="admin-header">
          <h2>
            {view === "dashboard" && "Dashboard"}
            {view === "admin-settings" && "Admin Profile"}
            {["selection", "register-staff", "register-patient"].includes(view) && "Admin (Register Account)"}
            {view === "patient-management" && "Patient Management"}
            {view === "staff-management" && "Staff Management"}
            {view === "requests" && "Data Correction Requests"}
            {view === "activity-logs" && "Activity Logs"}
          </h2>
          
          <div className="header-profile-wrapper" onClick={() => setShowProfileMenu(!showProfileMenu)}>
            <div className="header-profile-info">
              <span className="header-profile-name">{adminProfile.name || "Admin User"}</span>
              <ChevronDown size={16} className={`header-chevron ${showProfileMenu ? 'rotated' : ''}`} />
            </div>
            <div className="header-avatar-circle">
               <User size={20} color="#555" />
            </div>
            
            {showProfileMenu && (
              <div className="header-dropdown-menu">
                <div className="dropdown-item" onClick={() => setView("admin-settings")}>
                  <User size={16} />
                  <span>Profile</span>
                </div>
                <div className="dropdown-item" onClick={() => setShowLogoutConfirm(true)}>
                  <LogOut size={16} />
                  <span>Logout</span>
                </div>
              </div>
            )}
          </div>
        </header>
        <section className="content-body">
          {renderContent()}
        </section>
      </main>

      {showLogoutConfirm && (
        <div className="modal-overlay">
            <div className="logout-card logout-confirm-card">
                <div className="logout-header">
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
                        onClick={() => setShowLogoutConfirm(false)}
                        className="btn-logout-cancel"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={confirmLogout}
                        className="btn-logout-confirm"
                    >
                        Sign Out
                    </button>
                </div>
            </div>
        </div>
      )}

      {deleteConfirmation && (
        <div className="modal-overlay">
          <div className="delete-modal-card">
            <div className="delete-modal-icon">
              <Trash2 size={32} />
            </div>
            <h3 className="delete-modal-title">Delete Staff Member?</h3>
            <p className="delete-modal-text">
              Are you sure you want to delete this staff member? This action cannot be undone and their data will be permanently removed.
            </p>
            <div className="delete-modal-actions">
              <button className="btn-modal-cancel" onClick={cancelDelete}>Cancel</button>
              <button className="btn-modal-delete" onClick={confirmDelete}>Delete Member</button>
            </div>
          </div>
        </div>
      )}

      {showSuccessModal && (
        <div className="modal-overlay">
          <div className="success-modal-card">
            <div className="success-modal-icon success">
              <Check size={48} strokeWidth={3} />
            </div>
            <h3 className="success-modal-title">Success!</h3>
            <p className="success-modal-text">{successMessage}</p>
            <button className="btn-modal-success" onClick={closeSuccessModal}>
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminDashboard;
