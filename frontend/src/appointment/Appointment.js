import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Appointment.css';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

const LAB_SERVICE_LIST = [
  'Complete Blood Count (CBC)',
  'Urinalysis',
  'Blood Chemistry',
  'Fecalysis',
  'Hepa Screening',
  'Dengue Duo + NS1 Antigen (Package)'
];

const IMAGING_SERVICE_LIST = [
  'Chest X-Ray',
  'Standard 12-Lead ECG',
  'Stress Test',
  'Holter Monitoring'
];

const CATEGORIES = [
  { value: 'clinic', label: 'Clinic Consultation' },
  { value: 'laboratory', label: 'Laboratory Services (₱100 Flat)' },
  { value: 'imaging', label: 'Imaging / ECG (₱100 Flat)' }
];

const Appointment = () => {
  const navigate = useNavigate();
  
  // State for form fields
  const [formData, setFormData] = useState({
    reason: '',
    specialization: '',
    serviceCategory: 'clinic',
    specificService: '',
    firstName: '',
    middleName: '',
    lastName: '',
    email: '',
    phone: '',
    dob: '',
    mainConcern: '',
    symptomsStart: '',
    severity: '',
    bodyParts: {},
    otherBodyPart: '',
    description: '',
    symptoms: {},
    emergencySymptoms: {}
  });

  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const todayISO = useMemo(() => new Date().toISOString().split("T")[0], []);

  const setField = (name, value) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const setFieldError = (name, message) => {
    setErrors((prev) => {
      if (!message) {
        if (!prev[name]) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      }
      return { ...prev, [name]: message };
    });
  };

  const handleNameKeyDown = (e, fieldName) => {
    const allowedKeys = ["Backspace", "Tab", "ArrowLeft", "ArrowRight", "Delete", "Enter", "Escape", " "];
    const isLetter = /^[a-zA-Z]$/.test(e.key);
    if (!isLetter && !allowedKeys.includes(e.key)) {
      e.preventDefault();
      setFieldError(fieldName, "Letters only");
    } else if (errors[fieldName] === "Letters only") {
      setFieldError(fieldName, "");
    }
  };

  const handlePhoneKeyDown = (e) => {
    const allowedKeys = ["Backspace", "Tab", "ArrowLeft", "ArrowRight", "Delete", "Enter", "Escape"];
    const isNumber = /^[0-9]$/.test(e.key);
    const currentVal = e.currentTarget.value || "";
    const currentLength = currentVal.length;

    if (!isNumber && !allowedKeys.includes(e.key)) {
      e.preventDefault();
      setFieldError("phone", "Numbers only");
      return;
    }

    if (isNumber) {
      if (currentLength === 0 && e.key !== "0") {
        e.preventDefault();
        setFieldError("phone", "Must start with 0");
      } else if (currentLength === 1 && e.key !== "9") {
        e.preventDefault();
        setFieldError("phone", "Must start with 09");
      } else if (currentLength >= 11) {
        e.preventDefault();
        setFieldError("phone", "Max 11 digits");
      } else {
        if (errors.phone && ["Numbers only", "Must start with 0", "Must start with 09", "Max 11 digits"].includes(errors.phone)) {
          setFieldError("phone", "");
        }
      }
    } else if (allowedKeys.includes(e.key) && errors.phone && ["Numbers only", "Must start with 0", "Must start with 09", "Max 11 digits"].includes(errors.phone)) {
      setFieldError("phone", "");
    }
  };

  const handleEmailChange = (e) => {
    const value = String(e.target.value || "").replace(/\s+/g, "");

    // Enforce start with letter logic strictly by preventing update if invalid start
    if (value.length > 0 && !/^[A-Za-z]/.test(value[0])) {
      setFieldError("email", "Must start with a letter");
      // Do not update state, effectively blocking the input
      return;
    }

    setField("email", value);

    if (!value) {
      if (errors.email && errors.email !== "Required") setFieldError("email", "");
      return;
    }

    if (!/^[A-Za-z]/.test(value[0])) {
      setFieldError("email", "Must start with a letter");
      return;
    }

    if (!/^[A-Za-z0-9@._-]*$/.test(value)) {
      setFieldError("email", "Invalid character");
      return;
    }

    if ((value.match(/@/g) || []).length > 1) {
      setFieldError("email", "Only one @");
      return;
    }

    if (value.includes("@")) {
      const domain = value.split("@")[1] || "";
      if (domain) {
        const isGmail = "gmail.com".startsWith(domain);
        const isYahoo = "yahoo.com".startsWith(domain);
        if (!isGmail && !isYahoo) {
          setFieldError("email", "Use @gmail.com or @yahoo.com");
          return;
        }
      }
    }

    if (errors.email && errors.email !== "Required") setFieldError("email", "");
  };

  const handleDateChange = (e, field) => {
      const value = e.target.value;
      setField(field, value);
      
      if (value > todayISO) {
          setFieldError(field, "Future dates not allowed");
      } else {
          if (errors[field] === "Future dates not allowed" || errors[field] === "Invalid date") {
              setFieldError(field, "");
          }
      }
  };

  const toggleGroup = (groupKey, key) => {
    setFormData((prev) => ({
      ...prev,
      [groupKey]: { ...prev[groupKey], [key]: !prev[groupKey][key] },
    }));
  };

  const validate = () => {
    const next = {};
    const clean = (v) => String(v || "").trim();
    const email = clean(formData.email);
    const phone = clean(formData.phone);
    const isClinic = String(formData.serviceCategory || 'clinic').toLowerCase() === 'clinic';
    const isClinical = String(formData.serviceCategory || 'clinic').toLowerCase() !== 'clinic';

    if (!clean(formData.reason)) next.reason = "Required";
    if (isClinic && !clean(formData.specialization)) next.specialization = "Required";
    if (isClinical && !clean(formData.specificService)) next.specificService = "Required";
    if (!clean(formData.firstName)) next.firstName = "Required";
    if (!clean(formData.lastName)) next.lastName = "Required";
    if (!email) next.email = "Required";
    else if (!/^[A-Za-z][A-Za-z0-9._-]*@(gmail\.com|yahoo\.com)$/.test(email)) next.email = "Use @gmail.com or @yahoo.com";
    if (!phone) next.phone = "Required";
    else if (!/^09\d{9}$/.test(phone)) next.phone = "Use 09xxxxxxxxx";
    if (!clean(formData.dob)) next.dob = "Required";
    else if (clean(formData.dob) > todayISO) next.dob = "Invalid date";
    if (!clean(formData.mainConcern)) next.mainConcern = "Required";
    if (!clean(formData.symptomsStart)) next.symptomsStart = "Required";
    else if (clean(formData.symptomsStart) > todayISO) next.symptomsStart = "Invalid date";
    if (!clean(formData.severity)) next.severity = "Required";

    return next;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setSubmitted(false);
      return;
    }
    
    try {
      const category = String(formData.serviceCategory || 'clinic').toLowerCase();
      const specific = String(formData.specificService || '').trim();
      const isClinic = category === 'clinic';

      const payload = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        middleName: formData.middleName,
        email: formData.email,
        phone: formData.phone,
        reason: formData.reason,
        specialization: isClinic ? formData.specialization : null,
        serviceCategory: category,
        specificService: isClinic ? null : specific,
        mainConcern: isClinic ? formData.mainConcern : specific,
        status: isClinic ? 'Pending' : null,
        appointmentDate: todayISO,
        appointmentTime: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
        description: [
          formData.mainConcern ? `Concern: ${formData.mainConcern}` : null,
          formData.description ? `Notes: ${formData.description}` : null,
          `Severity: ${formData.severity || '—'}`
        ].filter(Boolean).join('\n')
      };

      const endpoint = isClinic ? `/api/appointments` : `/api/patients/walk-in-intake`;
      let backendPayload = payload;

      if (!isClinic) {
        backendPayload = {
          patientMode: 'new',
          routeType: category === 'laboratory' ? 'lab' : 'imaging',
          existingPatientId: null,
          doctorId: null,
          doctorName: null,
          selectedSpecialization: null,
          consultTiming: null,
          preferredDate: null,
          preferredTime: null,
          firstName: formData.firstName,
          middleName: formData.middleName,
          lastName: formData.lastName,
          dateOfBirth: formData.dob,
          gender: null,
          contactNumber: formData.phone,
          email: formData.email,
          address: null,
          bloodType: null,
          temperature: null,
          bp_systolic: null,
          bp_diastolic: null,
          heartRate: null,
          respiratoryRate: null,
          spo2: null,
          weight: null,
          height: null,
          severity: null,
          triageLevel: null,
          triageNote: payload.description,
          mainConcern: specific,
          existingConditions: null,
          routeNote: `[Public Appointment Form] ${formData.mainConcern ? 'Symptoms: ' + formData.mainConcern : ''} Severity: ${formData.severity || '—'}`,
          painLevel: null,
          selectedLabServices: category === 'laboratory' ? [specific] : [],
          selectedImagingServices: category === 'imaging' ? [specific] : []
        };
      }

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backendPayload)
      });

      if (res.ok) {
        setSubmitted(true);
        setTimeout(() => window.location.reload(), 3000); // Reset after 3 seconds
      }
    } catch (err) {
      console.error("Failed to book appointment:", err);
    }
  };

  return (
    <div className="appointment-page-container">
      {/* Header */}
      <header className="appt-header">
        <div className="appt-header-container">
          <div className="appt-logo-section" onClick={() => navigate('/')}>
            <img src={process.env.PUBLIC_URL + "/pgh-logo.png"} alt="PGH Logo" className="appt-logo-img" />
            <div className="appt-logo-text">
              <h1>PASCUALINGA</h1>
              <span>Pascual General Hospital</span>
            </div>
          </div>
          <nav className="appt-nav">
            <div className="appt-nav-links">
              <a href="/#about">About Us</a>
              <a href="/#news">News</a>
              <a href="/#contact">Contact Us</a>
            </div>
            <div className="appt-nav-actions">
              <a href="/#services" className="appt-link-highlight">Our Services</a>
              <a href="/login" className="appt-link-highlight">Login</a>
              <button className="appt-find-doctor-btn">Find a Doctor</button>
            </div>
          </nav>
        </div>
      </header>

      <main className="appt-main-content">
        <div className="appt-title-section">
          <h1 className="appt-main-title">Appointment</h1>
          <p className="appt-subtitle">Share your details and we’ll contact you to confirm.</p>
        </div>

        <form className="appt-form-container" onSubmit={handleSubmit} noValidate>
          <section className="appt-section">
            <h2 className="appt-section-title">Personal Information</h2>

            <div className="form-row two-col">
              <div className="form-group">
                <div className="label-row">
                  <label>Reason for contacting *</label>
                  {errors.reason && <span className="validation-notice">{errors.reason}</span>}
                </div>
                <select className={`appt-input ${errors.reason ? "input-error" : ""}`} value={formData.reason} onChange={(e) => setField("reason", e.target.value)}>
                  <option value="">Select a reason</option>
                  <option value="consultation">General Consultation</option>
                  <option value="checkup">Annual Checkup</option>
                  <option value="specialist">Specialist Visit</option>
                  <option value="laboratory">Laboratory Request</option>
                  <option value="imaging">Imaging / ECG Request</option>
                </select>
              </div>
              <div className="form-group">
                <div className="label-row">
                  <label>Service Category *</label>
                </div>
                <select className="appt-input" value={formData.serviceCategory} onChange={(e) => setField("specificService", "") || setField("serviceCategory", e.target.value)}>
                  {CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-row two-col">
              {String(formData.serviceCategory || 'clinic').toLowerCase() === 'clinic' ? (
                <div className="form-group">
                  <div className="label-row">
                    <label>Department / Specialization *</label>
                    {errors.specialization && <span className="validation-notice">{errors.specialization}</span>}
                  </div>
                  <select className={`appt-input ${errors.specialization ? "input-error" : ""}`} value={formData.specialization} onChange={(e) => setField("specialization", e.target.value)}>
                    <option value="">Select specialization</option>
                    <option value="General Practice">General Practice</option>
                    <option value="Pediatrics">Pediatrics</option>
                    <option value="Cardiology">Cardiology</option>
                    <option value="Dermatology">Dermatology</option>
                    <option value="Orthopedics">Orthopedics</option>
                    <option value="Obstetrics & Gynecology">Obstetrics & Gynecology</option>
                    <option value="Ophthalmology">Ophthalmology</option>
                    <option value="Surgery">Surgery</option>
                  </select>
                </div>
              ) : (
                <div className="form-group">
                  <div className="label-row">
                    <label>{String(formData.serviceCategory).toLowerCase() === 'laboratory' ? 'Laboratory Test *' : 'Imaging / ECG Test *'}</label>
                    {errors.specificService && <span className="validation-notice">{errors.specificService}</span>}
                  </div>
                  <select className={`appt-input ${errors.specificService ? "input-error" : ""}`} value={formData.specificService} onChange={(e) => setField("specificService", e.target.value)}>
                    <option value="">Select a service</option>
                    {(String(formData.serviceCategory).toLowerCase() === 'laboratory' ? LAB_SERVICE_LIST : IMAGING_SERVICE_LIST).map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-group">
                <div className="label-row">
                  <label>{String(formData.serviceCategory || 'clinic').toLowerCase() === 'clinic' ? 'First Name *' : 'First Name *'}</label>
                  {errors.firstName && <span className="validation-notice">{errors.firstName}</span>}
                </div>
                <input className={`appt-input ${errors.firstName ? "input-error" : ""}`} value={formData.firstName} onChange={(e) => setField("firstName", e.target.value)} onKeyDown={(e) => handleNameKeyDown(e, "firstName")} />
              </div>
            </div>

            <div className="form-row three-col">
              <div className="form-group">
                <div className="label-row">
                  <label>Middle Name</label>
                  <span />
                </div>
                <input className="appt-input" value={formData.middleName} onChange={(e) => setField("middleName", e.target.value)} onKeyDown={(e) => handleNameKeyDown(e, "middleName")} />
              </div>
              <div className="form-group">
                <div className="label-row">
                  <label>Last Name *</label>
                  {errors.lastName && <span className="validation-notice">{errors.lastName}</span>}
                </div>
                <input className={`appt-input ${errors.lastName ? "input-error" : ""}`} value={formData.lastName} onChange={(e) => setField("lastName", e.target.value)} onKeyDown={(e) => handleNameKeyDown(e, "lastName")} />
              </div>
            </div>

            <div className="form-row three-col">
              <div className="form-group">
                <div className="label-row">
                  <label>Email *</label>
                  {errors.email && <span className="validation-notice">{errors.email}</span>}
                </div>
                <input className={`appt-input ${errors.email ? "input-error" : ""}`} value={formData.email} onChange={handleEmailChange} />
              </div>
              <div className="form-group">
                <div className="label-row">
                  <label>Phone Number *</label>
                  {errors.phone && <span className="validation-notice">{errors.phone}</span>}
                </div>
                <input
                  className={`appt-input ${errors.phone ? "input-error" : ""}`}
                  value={formData.phone}
                  onChange={(e) => setField("phone", e.target.value.replace(/[^\d]/g, "").slice(0, 11))}
                  onKeyDown={handlePhoneKeyDown}
                  placeholder="09xxxxxxxxx"
                />
              </div>
              <div className="form-group">
                <div className="label-row">
                  <label>Date of Birth *</label>
                  {errors.dob && <span className="validation-notice">{errors.dob}</span>}
                </div>
                <input type="date" className={`appt-input ${errors.dob ? "input-error" : ""}`} value={formData.dob} onChange={(e) => handleDateChange(e, "dob")} max={todayISO} />
              </div>
            </div>
          </section>

          <section className="appt-section">
            <h2 className="appt-section-title">Symptoms</h2>

            <div className="form-row two-col">
              <div className="form-group">
                <div className="label-row">
                  <label>Main concern *</label>
                  {errors.mainConcern && <span className="validation-notice">{errors.mainConcern}</span>}
                </div>
                <input className={`appt-input ${errors.mainConcern ? "input-error" : ""}`} value={formData.mainConcern} onChange={(e) => setField("mainConcern", e.target.value)} placeholder="e.g., fever and cough" />
              </div>
              <div className="form-group">
                <div className="label-row">
                  <label>Severity *</label>
                  {errors.severity && <span className="validation-notice">{errors.severity}</span>}
                </div>
                <select className={`appt-input ${errors.severity ? "input-error" : ""}`} value={formData.severity} onChange={(e) => setField("severity", e.target.value)}>
                  <option value="">Select severity</option>
                  <option value="mild">Mild</option>
                  <option value="moderate">Moderate</option>
                  <option value="severe">Severe</option>
                </select>
              </div>
            </div>

            <div className="form-row two-col">
              <div className="form-group">
                <div className="label-row">
                  <label>Symptoms start *</label>
                  {errors.symptomsStart && <span className="validation-notice">{errors.symptomsStart}</span>}
                </div>
                <input type="date" className={`appt-input ${errors.symptomsStart ? "input-error" : ""}`} value={formData.symptomsStart} onChange={(e) => handleDateChange(e, "symptomsStart")} max={todayISO} />
              </div>
              <div className="form-group">
                <div className="label-row">
                  <label>Description</label>
                  <span />
                </div>
                <input className="appt-input" value={formData.description} onChange={(e) => setField("description", e.target.value)} placeholder="Optional" />
              </div>
            </div>

            <div className="form-row two-col align-top">
              <div className="form-group soft-card">
                <label className="soft-title">Body part affected</label>
                <div className="checkbox-grid">
                  {[
                    "Head",
                    "Chest",
                    "Abdomen",
                    "Skin",
                    "Lungs/Breathing",
                    "Whole Body",
                    "Back",
                    "Arms",
                    "Joints/Muscles",
                    "Legs",
                    "Urinary/Genital Problems",
                    "Others",
                  ].map((p) => (
                    <label key={p}>
                      <input type="checkbox" checked={Boolean(formData.bodyParts[p])} onChange={() => toggleGroup("bodyParts", p)} /> {p}
                    </label>
                  ))}
                </div>
                <input className="appt-input mt-10" value={formData.otherBodyPart} onChange={(e) => setField("otherBodyPart", e.target.value)} placeholder="If Others, specify" />
              </div>

              <div className="form-group soft-card">
                <label className="soft-title">Common symptoms</label>
                <div className="checkbox-grid">
                  {[
                    "Fever",
                    "Chestpain",
                    "Cough",
                    "Headache",
                    "Shortness of breath",
                    "Dizziness",
                    "Nausea / Vomiting",
                    "Fatigue",
                    "Diarrhea",
                    "Body Pain",
                    "Others",
                  ].map((s) => (
                    <label key={s}>
                      <input type="checkbox" checked={Boolean(formData.symptoms[s])} onChange={() => toggleGroup("symptoms", s)} /> {s}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="form-group soft-card">
              <label className="soft-title">Emergency symptoms</label>
              <div className="checkbox-grid three">
                {[
                  "Difficulty of breathing",
                  "Sudden weakness / numbness",
                  "Severe chest pain",
                  "Uncontrolled breathing",
                  "Loss of consciousness",
                ].map((s) => (
                  <label key={s}>
                    <input type="checkbox" checked={Boolean(formData.emergencySymptoms[s])} onChange={() => toggleGroup("emergencySymptoms", s)} /> {s}
                  </label>
                ))}
              </div>
            </div>
          </section>

          <div className="form-actions">
            {submitted && <div className="appt-success">Submitted. Please wait for confirmation.</div>}
            <button type="button" className="cancel-appt-btn" onClick={() => navigate('/')}>Cancel</button>
            <button type="submit" className="submit-appt-btn">Submit</button>
          </div>
        </form>
      </main>
    </div>
  );
};

export default Appointment;
