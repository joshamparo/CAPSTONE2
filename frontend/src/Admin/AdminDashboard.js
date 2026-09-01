import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Settings, UserPlus, Users, ChevronLeft, ChevronRight, LogOut, ArrowLeft, QrCode, AlertCircle, User, Eye, EyeOff, Check, X, ClipboardList, Activity, FileText, MessageSquare, Calendar, ChevronDown, History, LayoutDashboard, Phone, MapPin, Trash2, Key, Save, Mail, Briefcase, Shield, Edit, Search, Megaphone, Clock, ListTodo, Plus, Pill, SlidersHorizontal, Eye as EyeIcon, Download, Upload, ShieldCheck, UserCog, Layers, Bell, ArrowRight, RefreshCw, IdCard, Stethoscope, Award, Menu } from "lucide-react";
import { BarChart, Bar, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import "./AdminDashboard.css";
import { supabase } from "../lib/supabaseClient";
import AccountHeaderActions from "../components/AccountHeaderActions";
import ConfirmModal from "../components/ConfirmModal";
import { checkBackendHealth, fetchJson } from "../utils/api";

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';
const WEB_ORIGIN = String(process.env.REACT_APP_WEB_ORIGIN || '').trim() || 'https://pascualinga.com';

const ADMIN_WARD_ROOM_PLAN = [
  { id: 'icu', name: 'ICU', total: 5, color: '#ef4444', shortCode: 'ICU', aliases: ['icu'] },
  { id: 'general', name: 'General Ward', total: 12, color: '#3b82f6', shortCode: 'GW', aliases: ['general ward', 'general'] },
  { id: 'pediatrics', name: 'Pediatrics', total: 5, color: '#10b981', shortCode: 'PD', aliases: ['pediatrics', 'pedia', 'pediatric'] },
  { id: 'emergency', name: 'Emergency', total: 3, color: '#f59e0b', shortCode: 'ER', aliases: ['emergency', 'er'] }
];

function normalizeWardName(value) {
  return String(value || '').trim().toLowerCase();
}

function getWardStatusLabel(occupied, total) {
  if (total <= 0) return 'No capacity';
  const ratio = occupied / total;
  if (ratio >= 1) return 'Full';
  if (ratio >= 0.8) return 'Near full';
  if (ratio >= 0.5) return 'Steady';
  return 'Available';
}

function defaultColorForWard(name) {
  const normalized = normalizeWardName(name);
  const matched = ADMIN_WARD_ROOM_PLAN.find((ward) => normalizeWardName(ward.name) === normalized);
  return matched?.color || '#64748b';
}

function AdminDashboard() {
  const navigate = useNavigate();
  const getAuthHeaders = () => {
    try {
      const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
      const role = String(currentUser?.role || currentUser?.roles || currentUser?.account_type || currentUser?.accountType || 'admin').toLowerCase();
      const email = String(currentUser?.email || '').trim();
      const name = String(currentUser?.name || '').trim();
      return {
        'x-user-role': role,
        ...(email ? { 'x-user-email': email } : {}),
        ...(name ? { 'x-user-name': name } : {})
      };
    } catch (_) {
      return { 'x-user-role': 'admin' };
    }
  };

  const sendStaffWelcomeEmail = ({ email, name, temporaryPassword }) => fetchJson('/api/email/send-staff-welcome', {
    apiBase: API_BASE,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ email, name, temporaryPassword })
  });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const r = await checkBackendHealth(API_BASE);
      if (cancelled) return;
      setBackendHealth({ checked: true, ok: r.ok, error: r.ok ? '' : (r.error || 'Backend offline') });
    };
    run();
    const t = setInterval(run, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // Dashboard Stats
  const [dashboardStats, setDashboardStats] = useState(null);
  const [dashboardStatsLoading, setDashboardStatsLoading] = useState(false);
  const [dashboardStatsError, setDashboardStatsError] = useState('');
  const [dashboardRange, setDashboardRange] = useState(7);
  const [backendHealth, setBackendHealth] = useState({ checked: false, ok: true, error: '' });

  const [symptomMonth, setSymptomMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [symptomInsights, setSymptomInsights] = useState(null);
  const [symptomInsightsLoading, setSymptomInsightsLoading] = useState(false);
  const [symptomInsightsError, setSymptomInsightsError] = useState('');

  const specializationOptionsByRole = {
    Doctor: [
      'Surgery',
      'Orthopedics',
      'Anesthesia',
      'Ophthalmology',
      'Obstetrics-Gynecology',
      'Pediatrics',
      'Dermatology',
      'Otolaryngology',
      'Urology',
      'Pathology',
      'Radiology',
      'Dental Medicine',
      'Medicine'
    ],
    Nurse: [
      'ER',
      'OPD',
      'PEDIA',
      'MEDICINE',
      'Laboratory',
      'Video Consultation',
      'ECG',
      'Radiology',
      'Physical Therapy',
      'Dental Clinic',
      'Surgery (Minor)',
      'Anesthesia',
      'Otolaryngology (ENT)',
      'Pathology',
      'Orthopedics'
    ],
    Pharmacist: ['Pharmacy Management'],
    'Office Staff': ['Cashier', 'Doctor Secretary'],
    'Clinical Staff': ['MedTech', 'Radiographer', 'ECG Operator', 'Physical Therapist'],
    Staff: ['Cashier', 'Doctor Secretary']
  };

  const STAFF_ROLE_LABEL_BY_KEY = {
    doctor: 'Doctor',
    nurse: 'Nurse',
    pharmacist: 'Pharmacist',
    cashier: 'Cashier',
    doctor_secretary: 'Doctor Secretary',
    medtech: 'MedTech',
    radiographer: 'Radiographer',
    ecg_operator: 'ECG Operator',
    physical_therapist: 'Physical Therapist',
    admin: 'Admin',
    staff: 'Staff'
  };
  function getStaffRoleInfo(staff) {
    const s = staff || {};
    let key = '';
    const accountType = String(s.accountType || s.account_type || '').trim().toLowerCase();
    if (accountType && STAFF_ROLE_LABEL_BY_KEY[accountType]) {
      key = accountType;
    }
    if (!key) {
      const roleRaw = String(s.role || '').trim();
      const specRaw = String(s.specialization || '').trim();
      if (roleRaw === 'Doctor') key = 'doctor';
      else if (roleRaw === 'Nurse') key = 'nurse';
      else if (roleRaw === 'Pharmacist') key = 'pharmacist';
      else if (roleRaw === 'Admin') key = 'admin';
      else if (roleRaw === 'Clinical Staff') {
        if (specRaw === 'MedTech' || specRaw === 'Medtechs') key = 'medtech';
        else if (specRaw === 'Radiographer' || specRaw === 'Radiographer (X-ray)') key = 'radiographer';
        else if (specRaw === 'ECG Operator') key = 'ecg_operator';
        else if (specRaw === 'Physical Therapist') key = 'physical_therapist';
        else key = 'staff';
      } else if (roleRaw === 'Office Staff' || roleRaw === 'Staff') {
        if (specRaw === 'Cashier') key = 'cashier';
        else if (specRaw === 'Doctor Secretary' || specRaw === "Doctor's Secretary") key = 'doctor_secretary';
        else key = 'staff';
      } else key = 'staff';
    }
    if (!key || !STAFF_ROLE_LABEL_BY_KEY[key]) key = 'staff';
    return { key, label: STAFF_ROLE_LABEL_BY_KEY[key] };
  }

  function getStaffEditClassification(staff) {
    const info = getStaffRoleInfo(staff);
    const existingSpecialization = String(staff?.specialization || '').trim();
    const classificationByKey = {
      admin: { role: 'Admin', specialization: 'System Administrator' },
      doctor: { role: 'Doctor', specialization: existingSpecialization || 'General Doctor' },
      nurse: { role: 'Nurse', specialization: existingSpecialization || String(staff?.department || '').trim() || 'General Nursing' },
      pharmacist: { role: 'Pharmacist', specialization: 'Pharmacy Management' },
      cashier: { role: 'Office Staff', specialization: 'Cashier' },
      doctor_secretary: { role: 'Office Staff', specialization: 'Doctor Secretary' },
      medtech: { role: 'Clinical Staff', specialization: 'MedTech' },
      radiographer: { role: 'Clinical Staff', specialization: 'Radiographer' },
      ecg_operator: { role: 'Clinical Staff', specialization: 'ECG Operator' },
      physical_therapist: { role: 'Clinical Staff', specialization: 'Physical Therapist' },
      staff: { role: String(staff?.role || 'Staff').trim() || 'Staff', specialization: existingSpecialization || info.label }
    };
    return classificationByKey[info.key] || classificationByKey.staff;
  }

  const fetchDashboardStats = async () => {
    setDashboardStatsLoading(true);
    try {
      setDashboardStatsError('');
      const data = await fetchJson(`/api/stats/admin-overview`, {
        apiBase: API_BASE,
        headers: { ...getAuthHeaders() }
      });
      setDashboardStats(data);
    } catch (error) {
      setDashboardStats(null);
      setDashboardStatsError(String(error?.message || 'Unable to load dashboard stats.'));
    } finally {
      setDashboardStatsLoading(false);
    }
  };

  const fetchSymptomInsights = async ({ refresh = false } = {}) => {
    setSymptomInsightsLoading(true);
    setSymptomInsightsError('');
    try {
      const params = new URLSearchParams();
      if (symptomMonth) params.set('month', symptomMonth);
      if (refresh) params.set('refresh', 'true');
      const data = await fetchJson(`/api/stats/symptom-insights?${params.toString()}`, {
        apiBase: API_BASE,
        headers: { ...getAuthHeaders(), 'x-user-role': 'admin' }
      });
      setSymptomInsights(data);
    } catch (e) {
      setSymptomInsights(null);
      setSymptomInsightsError(String(e?.message || 'Unable to load symptom insights.'));
    } finally {
      setSymptomInsightsLoading(false);
    }
  };

  // Staff Registration Wizard State
  const [registrationStep, setRegistrationStep] = useState(3);
  const initialStaffFormData = {
    firstName: '',
    lastName: '',
    middleName: '',
    dateOfBirth: '',
    gender: '',
    civilStatus: '',
    nationality: 'Filipino',
    role: '',
    employeeId: '',
    medicalLicenseNumber: '',
    specialization: '',
    department: '',
    linkedDoctorId: '',
    dateHired: '',
    email: '',
    phone: '',
    streetAddress: '',
    city: '',
    province: '',
    postalCode: '',
  };
  const [staffFormData, setStaffFormData] = useState(initialStaffFormData);

  const handleStaffFormChange = (e) => {
    const { name, value } = e.target;
    setStaffFormData((prev) => {
      const next = { ...prev, [name]: value };
      if (name === 'role') {
        const opts = specializationOptionsByRole[value] || [];
        const current = String(prev.specialization || '').trim();
        if (opts.length === 1) next.specialization = opts[0];
        else if (current && opts.includes(current)) next.specialization = current;
        else next.specialization = '';
        next.linkedDoctorId = '';
        next.department = '';
      }
      if (name === 'specialization' && (value !== "Doctor's Secretary" && value !== 'Doctor Secretary')) {
        next.linkedDoctorId = '';
      }
      if (name === 'specialization') {
        const isMedicineDoctor = String(next.role || '').trim() === 'Doctor' && String(value || '').trim() === 'Medicine';
        if (!isMedicineDoctor) next.department = '';
      }
      return next;
    });
  };

  const [secretaryDoctors, setSecretaryDoctors] = useState([]);
  const [secretaryDoctorsLoading, setSecretaryDoctorsLoading] = useState(false);
  const [secretaryDoctorsError, setSecretaryDoctorsError] = useState('');
  const selectedLinkedDoctor = useMemo(() => {
    const id = String(staffFormData.linkedDoctorId || '').trim();
    if (!id) return null;
    return (Array.isArray(secretaryDoctors) ? secretaryDoctors : []).find((d) => String(d?.id || '') === id) || null;
  }, [secretaryDoctors, staffFormData.linkedDoctorId]);

  useEffect(() => {
    const spec = String(staffFormData.specialization || '').trim();
    const isDoctorSecretary = ['Office Staff', 'Staff'].includes(String(staffFormData.role || '').trim()) &&
      (spec === "Doctor's Secretary" || spec === 'Doctor Secretary');
    if (!isDoctorSecretary) return;

    let cancelled = false;
    const run = async () => {
      setSecretaryDoctorsLoading(true);
      setSecretaryDoctorsError('');
      try {
        const data = await fetchJson(`/api/video-consults/doctors`, {
          apiBase: API_BASE,
          headers: { ...getAuthHeaders(), 'x-user-role': 'admin' }
        });
        const list = Array.isArray(data) ? data : [];
        if (cancelled) return;
        setSecretaryDoctors(list);
        const current = String(staffFormData.linkedDoctorId || '').trim();
        if (current && list.every((d) => String(d?.id || '') !== current)) {
          setStaffFormData((prev) => ({ ...prev, linkedDoctorId: '' }));
        }
      } catch (e) {
        if (cancelled) return;
        setSecretaryDoctors([]);
        setSecretaryDoctorsError(String(e.message || 'Failed to load doctors.'));
      } finally {
        if (!cancelled) setSecretaryDoctorsLoading(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [staffFormData.role, staffFormData.specialization]);
  // Admin To-Do List State
  const [adminTodos, setAdminTodos] = useState(() => {
    const saved = localStorage.getItem('adminTodos');
    return saved ? JSON.parse(saved) : [
      { id: 1, text: 'Review new staff applications', completed: false },
      { id: 2, text: 'Update system security policies', completed: true },
      { id: 3, text: 'Prepare monthly report', completed: false }
    ];
  });
  const [newTodo, setNewTodo] = useState("");
  const [newTodoError, setNewTodoError] = useState("");
  useEffect(() => { localStorage.setItem('adminTodos', JSON.stringify(adminTodos)); }, [adminTodos]);
  const focusTodoInputWithShake = () => {
    try {
      const todoInputEl = document.getElementById('admin-todo-input');
      if (todoInputEl) {
        todoInputEl.focus({ preventScroll: false });
        todoInputEl.classList.remove("todo-input-shake");
        void todoInputEl.offsetWidth;
        todoInputEl.classList.add("todo-input-shake");
      }
    } catch (_) {}
  };
  const handleAddTodo = (e) => {
    e.preventDefault();
    const trimmed = String(newTodo || "").trim();
    if (!trimmed) {
      setNewTodoError("Task cannot be empty. Type something you need to do.");
      focusTodoInputWithShake();
      return;
    }
    if (trimmed.length < 3) {
      setNewTodoError("Task is too short. Add at least 3 characters.");
      focusTodoInputWithShake();
      return;
    }
    if (trimmed.length > 220) {
      setNewTodoError("Task is too long. Max 220 characters allowed.");
      focusTodoInputWithShake();
      return;
    }
    setNewTodoError("");
    setAdminTodos([...adminTodos, { id: Date.now(), text: trimmed, completed: false }]);
    setNewTodo("");
  };
  const handleToggleTodo = (id) => setAdminTodos(adminTodos.map(todo => todo.id === id ? { ...todo, completed: !todo.completed } : todo));
  const handleDeleteTodo = (id) => setAdminTodos(adminTodos.filter(todo => todo.id !== id));

  const [view, setView] = useState("dashboard");

  const toDateInput = (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toISOString().slice(0, 10);
  };

  const normalizeTimeInput = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const m = raw.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return '';
    const hh = Math.max(0, Math.min(23, parseInt(m[1], 10)));
    const mm = Math.max(0, Math.min(59, parseInt(m[2], 10)));
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };

  const ADMIN_DOCTOR_AVAIL_STORAGE = {
    mode: 'adminDoctorAvailMode',
    specialization: 'adminDoctorAvailSpecialization',
    query: 'adminDoctorAvailQuery',
    doctorId: 'adminDoctorAvailDoctorId',
    doctorName: 'adminDoctorAvailDoctorName'
  };

  const [doctorAvailQuery, setDoctorAvailQuery] = useState('');
  const [doctorAvailSpecialization, setDoctorAvailSpecialization] = useState('');
  const [doctorAvailSpecializations, setDoctorAvailSpecializations] = useState([]);
  const [doctorAvailDoctors, setDoctorAvailDoctors] = useState([]);
  const [doctorAvailDoctorsLoading, setDoctorAvailDoctorsLoading] = useState(false);
  const [doctorAvailDoctorId, setDoctorAvailDoctorId] = useState('');
  const [doctorAvailDoctorName, setDoctorAvailDoctorName] = useState('');
  const [doctorAvailMode, setDoctorAvailMode] = useState('onsite');
  const [doctorAvailRules, setDoctorAvailRules] = useState([]);
  const [doctorAvailExceptions, setDoctorAvailExceptions] = useState([]);
  const [doctorAvailDayOffs, setDoctorAvailDayOffs] = useState([]);
  const [doctorAvailLoadedForDoctorId, setDoctorAvailLoadedForDoctorId] = useState('');
  const [doctorAvailLoading, setDoctorAvailLoading] = useState(false);
  const [doctorAvailSaving, setDoctorAvailSaving] = useState(false);
  const [doctorAvailError, setDoctorAvailError] = useState('');
  const [doctorAvailSuccess, setDoctorAvailSuccess] = useState('');
  const doctorAvailSuccessRef = useRef(null);
  const doctorAvailCacheRef = useRef({});
  const doctorAvailReqSeqRef = useRef(0);
  const doctorAvailDidHydrateRef = useRef(false);
  const doctorAvailAutoLoadedRef = useRef(false);
  const [doctorAvailAddRule, setDoctorAvailAddRule] = useState({ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', slotMinutes: 30, maxPerSlot: 1, active: true });
  const [doctorAvailAddException, setDoctorAvailAddException] = useState({ date: toDateInput(new Date()), startTime: '', endTime: '', note: '' });
  const [doctorAvailCalendarMonth, setDoctorAvailCalendarMonth] = useState(toDateInput(new Date()).slice(0, 7));
  const [doctorAvailApplyToSpecialization, setDoctorAvailApplyToSpecialization] = useState(false);

  const fetchDoctorSpecializations = async () => {
    try {
      const data = await fetchJson(`/api/doctors/specializations`, {
        apiBase: API_BASE,
        headers: { ...getAuthHeaders(), 'x-user-role': 'admin' }
      });
      const list = (Array.isArray(data) ? data : []).map((x) => String(x || '').trim()).filter(Boolean);
      setDoctorAvailSpecializations(list);
    } catch (_) {
      setDoctorAvailSpecializations([]);
    }
  };

  const fetchDoctorsForAvailability = async () => {
    setDoctorAvailDoctorsLoading(true);
    setDoctorAvailError('');
    try {
      const params = new URLSearchParams();
      const spec = String(doctorAvailSpecialization || '').trim();
      const q = String(doctorAvailQuery || '').trim();
      if (spec) params.set('specialization', spec);
      if (q) params.set('q', q);
      params.set('take', '200');
      const data = await fetchJson(`/api/doctors?${params.toString()}`, {
        apiBase: API_BASE,
        headers: { ...getAuthHeaders(), 'x-user-role': 'admin' }
      });
      setDoctorAvailDoctors(Array.isArray(data) ? data : []);
    } catch (e) {
      setDoctorAvailDoctors([]);
      setDoctorAvailError(String(e?.message || 'Failed to load doctors.'));
    } finally {
      setDoctorAvailDoctorsLoading(false);
    }
  };

  useEffect(() => {
    if (view !== 'doctor-availability') return;
    fetchDoctorSpecializations();
  }, [view]);

  useEffect(() => {
    if (view !== 'doctor-availability') {
      doctorAvailDidHydrateRef.current = false;
      doctorAvailAutoLoadedRef.current = false;
      return;
    }

    if (doctorAvailDidHydrateRef.current) return;
    doctorAvailDidHydrateRef.current = true;

    try {
      const storedMode = String(localStorage.getItem(ADMIN_DOCTOR_AVAIL_STORAGE.mode) || '').trim();
      const storedSpec = String(localStorage.getItem(ADMIN_DOCTOR_AVAIL_STORAGE.specialization) || '').trim();
      const storedQuery = String(localStorage.getItem(ADMIN_DOCTOR_AVAIL_STORAGE.query) || '').trim();
      const storedDoctorId = String(localStorage.getItem(ADMIN_DOCTOR_AVAIL_STORAGE.doctorId) || '').trim();
      const storedDoctorName = String(localStorage.getItem(ADMIN_DOCTOR_AVAIL_STORAGE.doctorName) || '').trim();

      if (storedMode) setDoctorAvailMode(storedMode);
      if (storedSpec) setDoctorAvailSpecialization(storedSpec);
      if (storedQuery) setDoctorAvailQuery(storedQuery);
      if (storedDoctorId) setDoctorAvailDoctorId(storedDoctorId);
      if (storedDoctorName) setDoctorAvailDoctorName(storedDoctorName);
    } catch (_) {
    }
  }, [view]);

  useEffect(() => {
    if (view !== 'doctor-availability') return;
    try {
      localStorage.setItem(ADMIN_DOCTOR_AVAIL_STORAGE.mode, String(doctorAvailMode || '').trim());
      localStorage.setItem(ADMIN_DOCTOR_AVAIL_STORAGE.specialization, String(doctorAvailSpecialization || '').trim());
      localStorage.setItem(ADMIN_DOCTOR_AVAIL_STORAGE.query, String(doctorAvailQuery || '').trim());
      localStorage.setItem(ADMIN_DOCTOR_AVAIL_STORAGE.doctorId, String(doctorAvailDoctorId || '').trim());
      localStorage.setItem(ADMIN_DOCTOR_AVAIL_STORAGE.doctorName, String(doctorAvailDoctorName || '').trim());
    } catch (_) {
    }
  }, [view, doctorAvailMode, doctorAvailSpecialization, doctorAvailQuery, doctorAvailDoctorId, doctorAvailDoctorName]);

  useEffect(() => {
    if (view !== 'doctor-availability') return;
    const t = setTimeout(() => {
      fetchDoctorsForAvailability();
    }, 250);
    return () => clearTimeout(t);
  }, [view, doctorAvailQuery, doctorAvailSpecialization]);

  const refreshDoctorAvailability = async ({ silent, suppressError, timeoutMs, doctorId } = {}) => {
    const targetDoctorId = String(doctorId || doctorAvailDoctorId || '').trim();
    const seq = ++doctorAvailReqSeqRef.current;
    if (!targetDoctorId) {
      if (!silent) setDoctorAvailError('Select a doctor first.');
      return;
    }
    const mode = String(doctorAvailMode || 'onsite').trim().toLowerCase() || 'onsite';
    const from = toDateInput(new Date());
    const to = toDateInput(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
    if (!silent) setDoctorAvailLoading(true);
    setDoctorAvailError('');
    setDoctorAvailSuccess('');
    try {
      const effectiveTimeoutMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : 15000;
      const requestOptions = { apiBase: API_BASE, timeoutMs: effectiveTimeoutMs, headers: { ...getAuthHeaders(), 'x-user-role': 'admin' } };
      const [rules, exceptions, dayOffData] = await Promise.all([
        fetchJson(`/api/doctors/${encodeURIComponent(targetDoctorId)}/availability/rules?mode=${encodeURIComponent(mode)}`, requestOptions),
        fetchJson(`/api/doctors/${encodeURIComponent(targetDoctorId)}/availability/exceptions?mode=${encodeURIComponent(mode)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, requestOptions),
        fetchJson(`/api/doctors/${encodeURIComponent(targetDoctorId)}/availability/day-offs?mode=${encodeURIComponent(mode)}`, requestOptions)
      ]);
      if (seq !== doctorAvailReqSeqRef.current) return;

      const next = {
        rules: Array.isArray(rules) ? rules : [],
        exceptions: Array.isArray(exceptions) ? exceptions : [],
        dayOffs: Array.isArray(dayOffData?.days) ? dayOffData.days : [],
        loadedAt: Date.now()
      };

      doctorAvailCacheRef.current[String(targetDoctorId)] = next;

      setDoctorAvailRules(next.rules);
      setDoctorAvailExceptions(next.exceptions);
      setDoctorAvailDayOffs(next.dayOffs);
      setDoctorAvailLoadedForDoctorId(String(targetDoctorId));
    } catch (e) {
      if (seq !== doctorAvailReqSeqRef.current) return;

      const cached = doctorAvailCacheRef.current[String(targetDoctorId)];
      if (cached && typeof cached === 'object') {
        setDoctorAvailRules(Array.isArray(cached.rules) ? cached.rules : []);
        setDoctorAvailExceptions(Array.isArray(cached.exceptions) ? cached.exceptions : []);
        setDoctorAvailDayOffs(Array.isArray(cached.dayOffs) ? cached.dayOffs : []);
        setDoctorAvailLoadedForDoctorId(String(targetDoctorId));
      }
      if (!suppressError) setDoctorAvailError(String(e?.message || 'Failed to load doctor availability.'));
      throw e;
    } finally {
      if (!silent) setDoctorAvailLoading(false);
    }
  };

  useEffect(() => {
    if (view !== 'doctor-availability') return;
    if (!doctorAvailDoctorId) return;
    if (doctorAvailAutoLoadedRef.current) return;
    doctorAvailAutoLoadedRef.current = true;

    const cached = doctorAvailCacheRef.current[String(doctorAvailDoctorId)];
    if (cached && typeof cached === 'object') {
      setDoctorAvailRules(Array.isArray(cached.rules) ? cached.rules : []);
      setDoctorAvailExceptions(Array.isArray(cached.exceptions) ? cached.exceptions : []);
      setDoctorAvailDayOffs(Array.isArray(cached.dayOffs) ? cached.dayOffs : []);
      setDoctorAvailLoadedForDoctorId(String(doctorAvailDoctorId));
    }

    refreshDoctorAvailability({ silent: true, suppressError: true, timeoutMs: 60000, doctorId: doctorAvailDoctorId }).catch(() => {});
  }, [view, doctorAvailDoctorId, doctorAvailMode]);

  const saveDoctorAvailabilityRules = async ({ skipRefresh } = {}) => {
    const doctorId = String(doctorAvailDoctorId || '').trim();
    if (!doctorId) {
      setDoctorAvailError('Select a doctor first.');
      throw new Error('Select a doctor first.');
    }
    const mode = String(doctorAvailMode || 'onsite').trim().toLowerCase() || 'onsite';
    setDoctorAvailSaving(true);
    setDoctorAvailError('');
    setDoctorAvailSuccess('');
    try {
      const dowLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const timeToMinutes = (t) => {
        const norm = normalizeTimeInput(t);
        if (!norm) return null;
        const [hh, mm] = norm.split(':').map((v) => parseInt(v, 10));
        if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
        return hh * 60 + mm;
      };

      const normalized = (Array.isArray(doctorAvailRules) ? doctorAvailRules : []).map((r, idx) => {
        const dayOfWeek = Number(r?.dayOfWeek);
        const startTime = normalizeTimeInput(r?.startTime);
        const endTime = normalizeTimeInput(r?.endTime);
        const slotMinutes = Number(r?.slotMinutes || 30);
        const maxPerSlot = Number(r?.maxPerSlot || 1);
        const active = r?.active === false ? false : true;
        return { dayOfWeek, startTime, endTime, slotMinutes, maxPerSlot, active, _idx: idx };
      });

      const invalid = normalized.find((r) => {
        if (!Number.isFinite(r.dayOfWeek) || r.dayOfWeek < 0 || r.dayOfWeek > 6) return 'Invalid day';
        if (!r.startTime || !r.endTime) return 'Missing time';
        const s = timeToMinutes(r.startTime);
        const e = timeToMinutes(r.endTime);
        if (s === null || e === null) return 'Invalid time';
        if (e <= s) return 'End must be after start';
        if (!Number.isFinite(r.slotMinutes) || r.slotMinutes < 5) return 'Slot minutes must be at least 5';
        if (!Number.isFinite(r.maxPerSlot) || r.maxPerSlot < 1) return 'Max per slot must be at least 1';
        return '';
      });

      if (invalid) {
        const label = dowLabels[Number(invalid.dayOfWeek)] || 'Day';
        const row = Number(invalid._idx) + 1;
        const msg = `Fix Weekly Rule #${row} (${label}): End time must be after start time.`;
        setDoctorAvailError(msg);
        throw new Error(msg);
      }

      const rules = normalized.map(({ dayOfWeek, startTime, endTime, slotMinutes, maxPerSlot, active }) => ({
        dayOfWeek,
        startTime,
        endTime,
        slotMinutes,
        maxPerSlot,
        active
      }));
      await fetchJson(`/api/doctors/${encodeURIComponent(doctorId)}/availability/rules`, {
        apiBase: API_BASE,
        method: 'PUT',
        timeoutMs: 60000,
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), 'x-user-role': 'admin' },
        body: JSON.stringify({ mode, rules })
      });
      if (!skipRefresh) await refreshDoctorAvailability({ silent: true, timeoutMs: 60000 });
    } catch (e) {
      setDoctorAvailError(String(e?.message || 'Failed to save rules.'));
      throw e;
    } finally {
      setDoctorAvailSaving(false);
    }
  };

  const addDoctorAvailabilityRule = () => {
    const s = normalizeTimeInput(doctorAvailAddRule.startTime) || '09:00';
    const e = normalizeTimeInput(doctorAvailAddRule.endTime) || '17:00';
    const sMin = s ? parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3, 5), 10) : null;
    const eMin = e ? parseInt(e.slice(0, 2), 10) * 60 + parseInt(e.slice(3, 5), 10) : null;
    if (sMin === null || eMin === null || eMin <= sMin) {
      setDoctorAvailError('End time must be after start time.');
      return;
    }
    const next = {
      id: `tmp_${Date.now()}`,
      doctorId: doctorAvailDoctorId,
      mode: doctorAvailMode,
      dayOfWeek: Math.max(0, Math.min(6, Math.trunc(Number(doctorAvailAddRule.dayOfWeek)) || 0)),
      startTime: s,
      endTime: e,
      slotMinutes: Math.max(5, Math.min(240, Math.trunc(Number(doctorAvailAddRule.slotMinutes || 30) || 30))),
      maxPerSlot: Math.max(1, Math.min(20, Math.trunc(Number(doctorAvailAddRule.maxPerSlot || 1) || 1))),
      active: doctorAvailAddRule.active === false ? false : true
    };
    setDoctorAvailRules((prev) => [...(Array.isArray(prev) ? prev : []), next]);
  };

  const removeDoctorAvailabilityRule = (id) => {
    setDoctorAvailRules((prev) => (Array.isArray(prev) ? prev : []).filter((r) => String(r.id) !== String(id)));
  };

  const saveDoctorAvailabilityDayOffs = async ({ skipRefresh } = {}) => {
    const doctorId = String(doctorAvailDoctorId || '').trim();
    if (!doctorId) {
      setDoctorAvailError('Select a doctor first.');
      throw new Error('Select a doctor first.');
    }
    const mode = String(doctorAvailMode || 'onsite').trim().toLowerCase() || 'onsite';
    const days = Array.isArray(doctorAvailDayOffs) ? doctorAvailDayOffs : [];
    const normalized = days
      .map((d) => Math.trunc(Number(d)))
      .filter((d) => Number.isFinite(d) && d >= 0 && d <= 6);
    const uniq = Array.from(new Set(normalized)).sort((a, b) => a - b);

    setDoctorAvailSaving(true);
    setDoctorAvailError('');
    setDoctorAvailSuccess('');
    try {
      await fetchJson(`/api/doctors/${encodeURIComponent(doctorId)}/availability/day-offs`, {
        apiBase: API_BASE,
        method: 'PUT',
        timeoutMs: 60000,
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), 'x-user-role': 'admin' },
        body: JSON.stringify({ mode, days: uniq })
      });
      if (!skipRefresh) await refreshDoctorAvailability({ silent: true, timeoutMs: 60000 });
    } catch (e) {
      setDoctorAvailError(String(e?.message || 'Failed to save day-offs.'));
      throw e;
    } finally {
      setDoctorAvailSaving(false);
    }
  };

  const saveDoctorAvailabilitySchedule = async () => {
    const doctorId = String(doctorAvailDoctorId || '').trim();
    if (!doctorId) {
      setDoctorAvailError('Select a doctor first.');
      return;
    }
    setDoctorAvailError('');
    setDoctorAvailSuccess('');
    if (doctorAvailSuccessRef.current) {
      clearTimeout(doctorAvailSuccessRef.current);
      doctorAvailSuccessRef.current = null;
    }
    try {
      await Promise.all([
        saveDoctorAvailabilityRules({ skipRefresh: true }),
        saveDoctorAvailabilityDayOffs({ skipRefresh: true })
      ]);
      setDoctorAvailError('');
      try {
        await refreshDoctorAvailability({ silent: true, suppressError: true, timeoutMs: 60000 });
      } catch (_) {
      }
      setDoctorAvailSuccess('Schedule saved successfully. If you don’t see changes yet, click Refresh.');
      doctorAvailSuccessRef.current = setTimeout(() => {
        setDoctorAvailSuccess('');
        doctorAvailSuccessRef.current = null;
      }, 5000);
    } catch (_) {
    }
  };

  const addDoctorAvailabilityException = async () => {
    const mode = String(doctorAvailMode || 'onsite').trim().toLowerCase() || 'onsite';
    const date = String(doctorAvailAddException.date || '').trim();
    if (!date) {
      setDoctorAvailError('Pick a date for the exception.');
      return;
    }
    const startTime = normalizeTimeInput(doctorAvailAddException.startTime);
    const endTime = normalizeTimeInput(doctorAvailAddException.endTime);
    if ((startTime && !endTime) || (!startTime && endTime)) {
      setDoctorAvailError('Provide both start and end time for partial blocks, or leave both blank for full-day block.');
      return;
    }
    setDoctorAvailSaving(true);
    setDoctorAvailError('');
    try {
      const note = String(doctorAvailAddException.note || '').trim() || null;
      const specialization = String(doctorAvailSpecialization || '').trim();

      if (doctorAvailApplyToSpecialization) {
        if (!specialization) {
          setDoctorAvailError('Select a specialization first if you want to block all doctors in that department.');
          return;
        }
        await fetchJson(`/api/availability/exceptions/bulk`, {
          apiBase: API_BASE,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), 'x-user-role': 'admin' },
          body: JSON.stringify({
            mode,
            specialization,
            date,
            startTime: startTime || null,
            endTime: endTime || null,
            note
          })
        });
      } else {
        const doctorId = String(doctorAvailDoctorId || '').trim();
        if (!doctorId) {
          setDoctorAvailError('Select a doctor first.');
          return;
        }
        await fetchJson(`/api/doctors/${encodeURIComponent(doctorId)}/availability/exceptions`, {
          apiBase: API_BASE,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), 'x-user-role': 'admin' },
          body: JSON.stringify({
            mode,
            date,
            startTime: startTime || null,
            endTime: endTime || null,
            note
          })
        });
      }

      setDoctorAvailAddException({ date, startTime: '', endTime: '', note: '' });
      if (doctorAvailDoctorId) await refreshDoctorAvailability({ silent: true });
    } catch (e) {
      setDoctorAvailError(String(e?.message || 'Failed to add exception.'));
    } finally {
      setDoctorAvailSaving(false);
    }
  };

  const deleteDoctorAvailabilityExceptionsBulk = async ({ date }) => {
    const mode = String(doctorAvailMode || 'onsite').trim().toLowerCase() || 'onsite';
    const specialization = String(doctorAvailSpecialization || '').trim();
    if (!specialization) {
      setDoctorAvailError('Select a specialization first.');
      return;
    }
    if (!date) {
      setDoctorAvailError('Pick a date first.');
      return;
    }
    setDoctorAvailSaving(true);
    setDoctorAvailError('');
    try {
      await fetchJson(`/api/availability/exceptions/bulk`, {
        apiBase: API_BASE,
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), 'x-user-role': 'admin' },
        body: JSON.stringify({ mode, specialization, date })
      });
      if (doctorAvailDoctorId) await refreshDoctorAvailability({ silent: true });
    } catch (e) {
      setDoctorAvailError(String(e?.message || 'Failed to delete exceptions.'));
    } finally {
      setDoctorAvailSaving(false);
    }
  };

  const deleteDoctorAvailabilityException = async (id) => {
    const doctorId = String(doctorAvailDoctorId || '').trim();
    if (!doctorId) return;
    setDoctorAvailSaving(true);
    setDoctorAvailError('');
    try {
      await fetchJson(`/api/doctors/${encodeURIComponent(doctorId)}/availability/exceptions/${encodeURIComponent(String(id))}`, {
        apiBase: API_BASE,
        method: 'DELETE',
        headers: { ...getAuthHeaders(), 'x-user-role': 'admin' }
      });
      await refreshDoctorAvailability({ silent: true });
    } catch (e) {
      setDoctorAvailError(String(e?.message || 'Failed to delete exception.'));
    } finally {
      setDoctorAvailSaving(false);
    }
  };

  useEffect(() => {
    if (view !== 'dashboard') return;
    if (!symptomMonth) return;
    fetchSymptomInsights({ refresh: false });
  }, [symptomMonth, view]);

  // Role Management State
  const [showRoleMgmt, setShowRoleMgmt] = useState(false);
  const [roles, setRoles] = useState([
    { name: "Admin", permissions: ["all"] },
    { name: "Doctor", permissions: ["view_patients", "write_notes"] },
    { name: "Nurse", permissions: ["view_patients"] },
    { name: "Staff", permissions: [] },
  ]);
  const [selectedRole, setSelectedRole] = useState(null);
  const [roleEditPerms, setRoleEditPerms] = useState([]);
  const [announcementTargets, setAnnouncementTargets] = useState([]); 
  const [announcementReads, setAnnouncementReads] = useState({}); 
  const [systemSettingsLoading, setSystemSettingsLoading] = useState(false);
  const [systemSettingsSaving, setSystemSettingsSaving] = useState(false);
  const [systemSettingsError, setSystemSettingsError] = useState('');

  // System Settings State
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [departments, setDepartments] = useState(["General Administration", "Cardiology", "Pediatrics", "Emergency", "Surgery"]);
  const [newDepartment, setNewDepartment] = useState("");
  const [newWard, setNewWard] = useState("");

  
  const handleExport = (type) => { const data = type === 'staff' ? staffList : patientList; const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${type}_export_${Date.now()}.json`; a.click(); URL.revokeObjectURL(url); };
  const handleImport = (type, e) => { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (evt) => { try { const imported = JSON.parse(evt.target.result); if (type === 'staff') setStaffList((prev) => [...prev, ...imported]); else setPatientList((prev) => [...prev, ...imported]); } catch (err) { alert('Invalid file format.'); } }; reader.readAsText(file); };

  // Incident Reports State
  const [incidents, setIncidents] = useState([]);
  const [incidentsLoading, setIncidentsLoading] = useState(false);
  const [incidentSearch, setIncidentSearch] = useState("");
  const [incidentDateFrom, setIncidentDateFrom] = useState("");
  const [incidentDateTo, setIncidentDateTo] = useState("");
  const [incidentActionsOpen, setIncidentActionsOpen] = useState(false);
  const [incidentUpdatingId, setIncidentUpdatingId] = useState(null);
  const [incidentDetails, setIncidentDetails] = useState(null);
  const [incidentsError, setIncidentsError] = useState("");

  const fetchIncidents = async () => {
      setIncidentsLoading(true);
      try {
          setIncidentsError("");
          const data = await fetchJson(`/api/incidents`, { apiBase: API_BASE, headers: { ...getAuthHeaders() } });
          const mapped = Array.isArray(data) ? data.map((inc) => {
            const dateStr = inc.incident_date || inc.date;
            const timeStr = inc.incident_time || inc.time;

            const date = dateStr ? new Date(dateStr) : null;
            const time = timeStr ? new Date(timeStr) : null;

            const displayDate = date && !Number.isNaN(date.getTime())
              ? date.toLocaleDateString()
              : (inc.date || '—');
            const displayTime = time && !Number.isNaN(time.getTime())
              ? time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : (inc.time || '—');

            const rawStatus = String(inc.status || '').trim();
            const rawLower = rawStatus.toLowerCase();
            const status = rawStatus
              ? (rawLower === 'submitted' || rawLower === 'pending'
                  ? 'Pending'
                  : rawLower === 'reviewed' || rawLower === 'resolved'
                      ? 'Reviewed'
                          : rawStatus)
              : 'Pending';

            return {
              ...inc,
              reporter: inc.created_by_email || inc.reporter || '—',
              type: inc.incident_type || inc.type || '—',
              date: displayDate,
              time: displayTime,
              status
            };
          }) : [];

          setIncidents(mapped);
      } catch (err) {
          console.error("Failed to fetch incidents", err);
          setIncidents([]);
          setIncidentsError(String(err?.message || "Unable to load incident reports. Please check the server connection."));
      } finally {
          setIncidentsLoading(false);
      }
  };

  // Inventory State
  const [inventory, setInventory] = useState([]);
  const [inventoryError, setInventoryError] = useState("");
  const [inventoryCategory, setInventoryCategory] = useState("All");
  const [inventoryPage, setInventoryPage] = useState(1);
  const [restockRequests, setRestockRequests] = useState([]);
  const [restockModal, setRestockModal] = useState(null);
  const [restockQty, setRestockQty] = useState(10);
  const [restockPriority, setRestockPriority] = useState('Normal');
  const [restockNote, setRestockNote] = useState('');
  const [restockSubmitting, setRestockSubmitting] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [nameNotice, setNameNotice] = useState("");
  const [nameNoticeField, setNameNoticeField] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
      if (view === 'incidents' || view === 'reports') {
          fetchIncidents();
      }
  }, [view]);

  // Age Validation State
  const [ageNotice, setAgeNotice] = useState("");
  const [ageNoticeField, setAgeNoticeField] = useState(null);

  // Date Hired Validation State
  const [dateHiredNotice, setDateHiredNotice] = useState("");
  const [dateHiredNoticeField, setDateHiredNoticeField] = useState(null);

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

  // PhilHealth Validation State
  const [philHealthNotice, setPhilHealthNotice] = useState("");
  const [philHealthNoticeField, setPhilHealthNoticeField] = useState(null);

  // Email Validation State
  const [emailNotice, setEmailNotice] = useState("");
  const [emailNoticeField, setEmailNoticeField] = useState(null);

  // Update Notice State
  const [updateNotice, setUpdateNotice] = useState("");
  const [createStaffError, setCreateStaffError] = useState(""); // General error for Create Staff form
  const [createStaffSuccess, setCreateStaffSuccess] = useState(""); // Inline success for Create Staff form
  const [createStaffLoading, setCreateStaffLoading] = useState(false); // Loading state for Create button
  const [purgeEmailLoading, setPurgeEmailLoading] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false); // Success modal state
  const [modalType, setModalType] = useState("success"); // success or error
  const [showOnlineDropdown, setShowOnlineDropdown] = useState(false);
  const [onlineSearch, setOnlineSearch] = useState("");
  const [successMessage, setSuccessMessage] = useState("Account created successfully."); // Dynamic success message
  const [isShiftsOpen, setIsShiftsOpen] = useState(false); // Shifts and Tasks dropdown toggle
  const [isDashboardOpen, setIsDashboardOpen] = useState(false); // Dashboard dropdown toggle
  const [isReportsOpen, setIsReportsOpen] = useState(false); // Reports dropdown toggle

  // Staff Management State
  const [staffList, setStaffList] = useState([]);
  const [staffError, setStaffError] = useState("");
  const [staffSearchTerm, setStaffSearchTerm] = useState("");
  const [staffGenderFilter, setStaffGenderFilter] = useState('All');
  const [staffRoleFilter, setStaffRoleFilter] = useState('All');
  const [staffStatusFilter, setStaffStatusFilter] = useState('All');
  const [staffSort, setStaffSort] = useState('Newest');
  const [staffPage, setStaffPage] = useState(1);
  const [deleteConfirmation, setDeleteConfirmation] = useState(null); // ID of staff to delete
  const [viewingStaff, setViewingStaff] = useState(null);

  // Patient Management State
  const [patientList, setPatientList] = useState([]);
  const [appointmentEvents, setAppointmentEvents] = useState([]);
  const [editingPatient, setEditingPatient] = useState(null);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [patientGenderFilter, setPatientGenderFilter] = useState('All');
  const [patientPage, setPatientPage] = useState(1);

  // Activity Logs State
  const [activityLogs, setActivityLogs] = useState([]);
  const [logFilter, setLogFilter] = useState("All"); // All, Create, Update, Delete, Login, System
  const [logPage, setLogPage] = useState(1);
  const [activityLogsError, setActivityLogsError] = useState("");
  const [logDateFrom, setLogDateFrom] = useState("");
  const [logDateTo, setLogDateTo] = useState("");
  const [reportsDateFrom, setReportsDateFrom] = useState("");
  const [reportsDateTo, setReportsDateTo] = useState("");
  const [salesMonitorDate, setSalesMonitorDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [salesMonitor, setSalesMonitor] = useState(null);
  const [salesMonitorLoading, setSalesMonitorLoading] = useState(false);
  const [salesMonitorError, setSalesMonitorError] = useState('');

  // Announcement State
  const [announcements, setAnnouncements] = useState([]);
  const [newAnnouncement, setNewAnnouncement] = useState({ title: '', content: '', priority: 'Normal' });
  const [announcementPinned, setAnnouncementPinned] = useState(false);
  const [announcementExpiryDays, setAnnouncementExpiryDays] = useState('');
  const [announcementDeleteConfirmation, setAnnouncementDeleteConfirmation] = useState(null);
  const [viewingAnnouncement, setViewingAnnouncement] = useState(null);
  const [announcementsError, setAnnouncementsError] = useState("");
  const [announcementsPage, setAnnouncementsPage] = useState(1);

  const [opsSettings, setOpsSettings] = useState({ incidentOverdueHours: 24, lowStockThreshold: 5 });

  // Real-time Dashboard Data
  const [recentActivities, setRecentActivities] = useState([]);
  
  // Fetch Dashboard Data
  const fetchDashboardData = async () => {
    try {
        try {
            const logs = await fetchJson(`/api/activity-logs?take=1000`, { apiBase: API_BASE, headers: { ...getAuthHeaders() } });
            const mapped = Array.isArray(logs) ? logs.map((l) => ({
              ...l,
              id: String(l.id || l._id || ''),
              actorName: l.actorName || l.actor_name || '',
              timestamp: l.timestamp || l.created_at || l.time || l.timestamp,
              action: l.action || '',
              target: l.target || '',
              details: l.details || ''
            })) : [];
            setRecentActivities(mapped.slice(0, 8));
        } catch (_) {}

        try {
            await fetchWardRegistry();
        } catch (_) {}

        try {
            const rows = await fetchJson(`/api/appointments`, { apiBase: API_BASE, headers: { ...getAuthHeaders() } });
            setAppointmentEvents(Array.isArray(rows) ? rows : []);
        } catch (_) {
            setAppointmentEvents([]);
        }

        try {
            const rows = await fetchJson(`/api/patients?take=2000`, { apiBase: API_BASE, headers: { ...getAuthHeaders() } });
            setPatientList(Array.isArray(rows) ? rows : []);
        } catch (_) {
            setPatientList([]);
        }

        try {
            const rows = await fetchJson(`/api/incidents`, { apiBase: API_BASE, headers: { ...getAuthHeaders() } });
            const mapped = Array.isArray(rows) ? rows.map((inc) => {
              const dateStr = inc.incident_date || inc.date;
              const timeStr = inc.incident_time || inc.time;
              const date = dateStr ? new Date(dateStr) : null;
              const time = timeStr ? new Date(timeStr) : null;
              const displayDate = date && !Number.isNaN(date.getTime())
                ? date.toLocaleDateString()
                : (inc.date || '—');
              const displayTime = time && !Number.isNaN(time.getTime())
                ? time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : (inc.time || '—');
              const rawStatus = String(inc.status || '').trim();
              const rawLower = rawStatus.toLowerCase();
              const status = rawStatus
                ? (rawLower === 'submitted' || rawLower === 'pending'
                    ? 'Pending'
                    : rawLower === 'reviewed' || rawLower === 'resolved'
                        ? 'Reviewed'
                        : rawStatus)
                : 'Pending';

              return {
                ...inc,
                reporter: inc.created_by_email || inc.reporter || '—',
                type: inc.incident_type || inc.type || '—',
                date: displayDate,
                time: displayTime,
                status
              };
            }) : [];
            setIncidents(mapped);
            setIncidentsError("");
        } catch (err) {
            console.error("Failed to refresh incidents", err);
            setIncidents([]);
            setIncidentsError(String(err?.message || "Unable to load incident reports. Please check the server connection."));
        }

    } catch (error) {
        console.error("Error fetching dashboard data:", error);
        setAppointmentEvents([]);
        setPatientList([]);
        setIncidents([]);
    }
  };

  const fetchSalesMonitoring = async ({ date } = {}) => {
    const targetDate = String(date || salesMonitorDate || '').trim();
    if (!targetDate) return;
    setSalesMonitorLoading(true);
    setSalesMonitorError('');
    try {
      const params = new URLSearchParams();
      params.set('date', targetDate);
      const data = await fetchJson(`/api/stats/admin-sales-monitoring?${params.toString()}`, {
        apiBase: API_BASE,
        headers: { ...getAuthHeaders(), 'x-user-role': 'admin' }
      });
      setSalesMonitor(data);
    } catch (e) {
      setSalesMonitor(null);
      setSalesMonitorError(String(e.message || 'Unable to load sales monitoring.'));
    } finally {
      setSalesMonitorLoading(false);
    }
  };

  useEffect(() => {
    if (view !== 'reports') return;
    fetchSalesMonitoring({ date: salesMonitorDate });
  }, [salesMonitorDate, view]);

  useEffect(() => {
    fetchDashboardData(); // Initial fetch
    const interval = setInterval(fetchDashboardData, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, []); // Refetch when selectedDate changes

  useEffect(() => {
    fetchSystemSettings();
  }, []);

  // Ward/Bed Status State (Initialized empty, fetched from API)
  const [wardStatus, setWardStatus] = useState([]);
  const [selectedWardCapacity, setSelectedWardCapacity] = useState('all');
  const [wardCapacitySection, setWardCapacitySection] = useState('overview');
  const [wardRoomRegistry, setWardRoomRegistry] = useState({ wards: [], rooms: [], totals: null });
  const [selectedWardRoomId, setSelectedWardRoomId] = useState('');
  const [roomEditor, setRoomEditor] = useState({ roomCode: '', wardName: '', status: 'Available', note: '' });
  const [roomEditorError, setRoomEditorError] = useState('');
  const [roomEditorSuccess, setRoomEditorSuccess] = useState('');
  const [roomSaving, setRoomSaving] = useState(false);
  const [showAddRoomForm, setShowAddRoomForm] = useState(false);
  const [newRoomForm, setNewRoomForm] = useState({ roomCode: '', wardName: 'General Ward', status: 'Available', note: '' });
  const [newRoomError, setNewRoomError] = useState('');
  const [newRoomSaving, setNewRoomSaving] = useState(false);

  const fetchWardRegistry = async () => {
    const data = await fetchJson(`/api/wards/rooms`, { apiBase: API_BASE, headers: { ...getAuthHeaders() } });
    const normalized = {
      wards: Array.isArray(data?.wards) ? data.wards : [],
      rooms: Array.isArray(data?.rooms) ? data.rooms : [],
      totals: data?.totals || null
    };
    setWardRoomRegistry(normalized);
    if (normalized.wards.length > 0) {
      setWardStatus(normalized.wards);
    }
    return normalized;
  };

  const fetchSystemSettings = async () => {
    setSystemSettingsLoading(true);
    setSystemSettingsError('');
    try {
      const data = await fetchJson(`/api/system-settings`, { apiBase: API_BASE, headers: { ...getAuthHeaders() } });
      setMaintenanceMode(Boolean(data?.maintenanceMode));
      setDepartments(Array.isArray(data?.departments) ? data.departments : []);
      setRoles(Array.isArray(data?.roles) ? data.roles : []);
      setOpsSettings({
        incidentOverdueHours: Number(data?.opsSettings?.incidentOverdueHours) > 0 ? Number(data.opsSettings.incidentOverdueHours) : 24,
        lowStockThreshold: Number(data?.opsSettings?.lowStockThreshold) >= 0 ? Number(data.opsSettings.lowStockThreshold) : 5
      });
      return data;
    } catch (error) {
      setSystemSettingsError(String(error?.message || 'Unable to load system settings.'));
      return null;
    } finally {
      setSystemSettingsLoading(false);
    }
  };

  const persistSystemSettings = async (partial, successMessageText) => {
    setSystemSettingsSaving(true);
    setSystemSettingsError('');
    try {
      const data = await fetchJson(`/api/system-settings`, {
        apiBase: API_BASE,
        method: 'PUT',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(partial || {})
      });
      setMaintenanceMode(Boolean(data?.maintenanceMode));
      setDepartments(Array.isArray(data?.departments) ? data.departments : []);
      setRoles(Array.isArray(data?.roles) ? data.roles : []);
      setOpsSettings({
        incidentOverdueHours: Number(data?.opsSettings?.incidentOverdueHours) > 0 ? Number(data.opsSettings.incidentOverdueHours) : 24,
        lowStockThreshold: Number(data?.opsSettings?.lowStockThreshold) >= 0 ? Number(data.opsSettings.lowStockThreshold) : 5
      });
      if (successMessageText) {
        setModalType("success");
        setSuccessMessage(successMessageText);
        setShowSuccessModal(true);
      }
      return data;
    } catch (error) {
      const message = String(error?.message || 'Unable to save system settings.');
      setSystemSettingsError(message);
      setModalType("error");
      setSuccessMessage(message);
      setShowSuccessModal(true);
      return null;
    } finally {
      setSystemSettingsSaving(false);
    }
  };
  
  // Fetch Inventory
  const fetchInventory = async () => {
      try {
          setInventoryError("");
          const data = await fetchJson(`/api/inventory`, { apiBase: API_BASE, headers: { ...getAuthHeaders() } });
          setInventory(Array.isArray(data) ? data : []);
      } catch (error) {
          console.error("Error fetching inventory:", error);
          setInventory([]);
          setInventoryError(String(error?.message || "Unable to load inventory. Please check the server connection."));
      }
  };

  useEffect(() => {
    const selectedRoom = (Array.isArray(wardRoomRegistry.rooms) ? wardRoomRegistry.rooms : []).find((room) => room.id === selectedWardRoomId);
    if (!selectedRoom) return;
    setRoomEditor({
      roomCode: selectedRoom.roomCode || '',
      wardName: selectedRoom.wardName || 'General Ward',
      status: selectedRoom.manualStatus || 'Available',
      note: selectedRoom.note || ''
    });
    setRoomEditorError('');
    setRoomEditorSuccess('');
  }, [selectedWardRoomId, wardRoomRegistry.rooms]);

  const fetchRestockRequests = async () => {
      try {
          const data = await fetchJson(`/api/restock-requests?take=500`, { apiBase: API_BASE, headers: { ...getAuthHeaders() } });
          setRestockRequests(Array.isArray(data) ? data : []);
      } catch (_) {
          setRestockRequests([]);
      }
  };

  const handleSaveRoom = async () => {
    if (!selectedWardRoomId) {
      setRoomEditorError('Select a room first.');
      return;
    }
    const errors = [];
    const clean = (v) => String(v || "").trim();
    const roomCode = clean(roomEditor?.roomCode);
    const wardName = clean(roomEditor?.wardName);
    const status = clean(roomEditor?.status);
    const bedCountRaw = Number(roomEditor?.bedCount ?? roomEditor?.bed_count ?? NaN);
    const capacityRaw = Number(roomEditor?.capacity ?? NaN);

    if (!roomCode) errors.push('Room Code is required.');
    else if (roomCode.length > 32) errors.push('Room Code must be 32 characters or less.');
    if (!wardName) errors.push('Ward / Ward Name is required.');
    else if (wardName.length > 64) errors.push('Ward Name must be 64 characters or less.');
    if (!status) errors.push('Room Status is required.');
    else if (!['Available','Occupied','Dirty','Maintenance','Discharging'].includes(status)) {
      errors.push('Room Status must be one of: Available, Occupied, Dirty, Maintenance, Discharging.');
    }
    if (roomEditor?.bedCount !== undefined && roomEditor?.bedCount !== null && String(roomEditor.bedCount).trim() !== '') {
      if (!Number.isFinite(bedCountRaw) || !Number.isInteger(bedCountRaw) || bedCountRaw < 0) {
        errors.push('Bed Count must be zero or a positive whole number.');
      } else if (bedCountRaw > 999) {
        errors.push('Bed Count cannot exceed 999.');
      }
    }
    if (roomEditor?.capacity !== undefined && roomEditor?.capacity !== null && String(roomEditor.capacity).trim() !== '') {
      if (!Number.isFinite(capacityRaw) || !Number.isInteger(capacityRaw) || capacityRaw < 0) {
        errors.push('Capacity must be zero or a positive whole number.');
      } else if (capacityRaw > 999) {
        errors.push('Capacity cannot exceed 999.');
      }
    }
    if (errors.length > 0) {
      setRoomEditorError(errors.join('\n'));
      setModalType('error');
      setSuccessMessage(errors[0]);
      setShowSuccessModal(true);
      return;
    }

    setRoomSaving(true);
    setRoomEditorError('');
    setRoomEditorSuccess('');
    try {
      const payload = { ...roomEditor, roomCode, wardName, status };
      if (Number.isInteger(bedCountRaw) && bedCountRaw >= 0) payload.bedCount = bedCountRaw;
      if (Number.isInteger(capacityRaw) && capacityRaw >= 0) payload.capacity = capacityRaw;
      await fetchJson(`/api/wards/rooms/${selectedWardRoomId}`, {
        apiBase: API_BASE,
        method: 'PATCH',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      await fetchWardRegistry();
      setRoomEditorSuccess('Room details updated.');
    } catch (error) {
      setRoomEditorError(String(error?.message || 'Unable to update room.'));
    } finally {
      setRoomSaving(false);
    }
  };

  const handleCreateRoom = async () => {
    const errors = [];
    const clean = (v) => String(v || "").trim();
    const roomCode = clean(newRoomForm?.roomCode);
    const wardName = clean(newRoomForm?.wardName);
    const status = clean(newRoomForm?.status) || 'Available';
    const roomType = clean(newRoomForm?.roomType);
    const bedCountRaw = Number(newRoomForm?.bedCount ?? newRoomForm?.bed_count ?? NaN);
    const capacityRaw = Number(newRoomForm?.capacity ?? NaN);
    const wardId = clean(newRoomForm?.wardId || newRoomForm?.ward_id);

    if (!roomCode) errors.push('Room Code is required.');
    else if (roomCode.length > 32) errors.push('Room Code must be 32 characters or less.');
    if (!wardName) errors.push('Ward Name is required.');
    else if (wardName.length > 64) errors.push('Ward Name must be 64 characters or less.');
    if (!['Available','Occupied','Dirty','Maintenance','Discharging'].includes(status)) {
      errors.push('Room Status must be one of: Available, Occupied, Dirty, Maintenance, Discharging.');
    }
    if (roomType && roomType.length > 32) errors.push('Room Type must be 32 characters or less.');
    if (String(newRoomForm?.bedCount ?? '').trim() !== '' && newRoomForm?.bedCount !== undefined && newRoomForm?.bedCount !== null) {
      if (!Number.isFinite(bedCountRaw) || !Number.isInteger(bedCountRaw) || bedCountRaw < 0) {
        errors.push('Bed Count must be zero or a positive whole number.');
      } else if (bedCountRaw > 999) {
        errors.push('Bed Count cannot exceed 999.');
      }
    }
    if (String(newRoomForm?.capacity ?? '').trim() !== '' && newRoomForm?.capacity !== undefined && newRoomForm?.capacity !== null) {
      if (!Number.isFinite(capacityRaw) || !Number.isInteger(capacityRaw) || capacityRaw < 0) {
        errors.push('Capacity must be zero or a positive whole number.');
      } else if (capacityRaw > 999) {
        errors.push('Capacity cannot exceed 999.');
      }
    }
    if (errors.length > 0) {
      setNewRoomError(errors.join('\n'));
      setModalType('error');
      setSuccessMessage(errors[0]);
      setShowSuccessModal(true);
      return;
    }

    setNewRoomSaving(true);
    setNewRoomError('');
    try {
      const payload = { ...newRoomForm, roomCode, wardName, status };
      if (Number.isInteger(bedCountRaw) && bedCountRaw >= 0) payload.bedCount = bedCountRaw;
      if (Number.isInteger(capacityRaw) && capacityRaw >= 0) payload.capacity = capacityRaw;
      if (wardId) payload.wardId = wardId;
      if (roomType) payload.roomType = roomType;
      const created = await fetchJson(`/api/wards/rooms`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const registry = await fetchWardRegistry();
      setShowAddRoomForm(false);
      setNewRoomForm({
        roomCode: '',
        wardName: newRoomForm.wardName || 'General Ward',
        status: 'Available',
        note: ''
      });
      setWardCapacitySection('rooms');
      setSelectedWardRoomId(String(created?.id || ''));
      const createdWard = (Array.isArray(registry?.wards) ? registry.wards : []).find((ward) => normalizeWardName(ward.name) === normalizeWardName(created?.wardName));
      setSelectedWardCapacity(createdWard ? String(createdWard.id) : 'all');
    } catch (error) {
      setNewRoomError(String(error?.message || 'Unable to add room.'));
    } finally {
      setNewRoomSaving(false);
    }
  };

  const handleApproveRestock = async (req) => {
    try {
      await fetchJson(`/api/restock-requests/${req.id}`, {
        apiBase: API_BASE,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          status: 'Approved',
          fulfilledBy: (adminProfile && (adminProfile.name || adminProfile.email)) || 'Admin'
        })
      });
      setModalType('success');
      setSuccessMessage('Restock request approved and sent to Pharmacist.');
      setShowSuccessModal(true);
      fetchRestockRequests();
    } catch (_) {
      setModalType('error');
      setSuccessMessage('Failed to approve request.');
      setShowSuccessModal(true);
    }
  };

  const handleRejectRestock = async (req) => {
    try {
      await fetchJson(`/api/restock-requests/${req.id}`, {
        apiBase: API_BASE,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          status: 'Rejected',
          fulfilledBy: (adminProfile && (adminProfile.name || adminProfile.email)) || 'Admin'
        })
      });
      fetchRestockRequests();
    } catch (_) {}
  };

  const submitRestockRequest = async () => {
      if (!restockModal) return;
      const medId = restockModal.id || restockModal._id;
      if (!medId) return;
      const qty = Number(restockQty || 0);
      if (!Number.isFinite(qty) || qty <= 0) {
          setModalType('error');
          setSuccessMessage('Requested quantity must be greater than 0.');
          setShowSuccessModal(true);
          return;
      }

      setRestockSubmitting(true);
      try {
          const requestedBy = (adminProfile && (adminProfile.name || adminProfile.email)) || 'Admin';
          await fetchJson(`/api/restock-requests`, {
            apiBase: API_BASE,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({
              itemType: 'medicine',
              itemId: medId,
              requestedQty: qty,
              priority: restockPriority,
              note: restockNote,
              requestedBy
            })
          });
          setRestockModal(null);
          await fetchRestockRequests();
          setModalType('success');
          setSuccessMessage('Restock request sent to pharmacist.');
          setShowSuccessModal(true);
      } catch (e) {
          setModalType('error');
          setSuccessMessage(String(e?.message || 'Failed to send restock request.'));
          setShowSuccessModal(true);
      } finally {
          setRestockSubmitting(false);
      }
  };

  useEffect(() => {
    fetchInventory();
    fetchRestockRequests();
  }, []);
  // Activity Log Helper
  const logActivity = async (action, details, target, role = 'Admin') => {
      try {
          const actorName = adminProfile.name || "Admin";
          await fetchJson(`/api/activity-logs`, {
            apiBase: API_BASE,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({
              actorName,
              role,
              action,
              target,
              details
            })
          });
          fetchActivityLogs(); // Refresh logs if on that view
      } catch (error) {
          console.error("Failed to log activity:", error);
      }
  };

  const fetchActivityLogs = async () => {
      try {
          setActivityLogsError("");
          const data = await fetchJson(`/api/activity-logs?take=1000`, { apiBase: API_BASE, headers: { ...getAuthHeaders() } });
          const mapped = Array.isArray(data) ? data.map((l) => ({
            ...l,
            id: String(l.id || l._id || ''),
            actorName: l.actorName || l.actor_name || '',
            timestamp: l.timestamp || l.created_at || l.time || l.timestamp,
            action: l.action || '',
            target: l.target || '',
            details: l.details || ''
          })) : [];
          setActivityLogs(mapped);
      } catch (error) {
          console.error("Error fetching logs:", error);
          setActivityLogs([]);
          setActivityLogsError(String(error?.message || "Unable to load activity logs. Please check the server connection."));
      }
  };

  const fetchActivityLogsForExport = async (fromDate, toDate) => {
      const from = parseDateStart(fromDate);
      const to = parseDateEnd(toDate);
      const params = new URLSearchParams();
      params.set('take', '5000');
      if (from) params.set('start', from.toISOString());
      if (to) params.set('end', to.toISOString());
      const data = await fetchJson(`/api/activity-logs?${params.toString()}`, { apiBase: API_BASE, headers: { ...getAuthHeaders() } });
      return Array.isArray(data) ? data.map((l) => ({
        ...l,
        id: String(l.id || l._id || ''),
        actorName: l.actorName || l.actor_name || '',
        timestamp: l.timestamp || l.created_at || l.time || l.timestamp,
        action: l.action || '',
        target: l.target || '',
        details: l.details || ''
      })) : [];
  };

  // Fetch Announcements
  const fetchAnnouncements = async () => {
      try {
          setAnnouncementsError("");
          const data = await fetchJson(`/api/announcements`, { apiBase: API_BASE, headers: { ...getAuthHeaders() } });
          setAnnouncements(Array.isArray(data) ? data : []);
          setAnnouncementsPage(1); // Reset to page 1 when fetching new announcements
      } catch (error) {
          console.error("Error fetching announcements:", error);
          setAnnouncements([]);
          setAnnouncementsError(String(error?.message || "Unable to load announcements. Please check the server connection."));
          setAnnouncementsPage(1);
      }
  };

  const updateAnnouncement = async (id, patch) => {
      try {
          await fetchJson(`/api/announcements/${id}`, {
            apiBase: API_BASE,
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify(patch)
          });
          await fetchAnnouncements();
          return true;
      } catch (error) {
          console.error("Error updating announcement:", error);
          setModalType("error");
          setSuccessMessage("Failed to update announcement. Please check the server.");
          setShowSuccessModal(true);
          return false;
      }
  };

  const handlePostAnnouncement = async (e) => {
      e.preventDefault();
      if (!newAnnouncement.title || !newAnnouncement.content) {
          setModalType("error");
          setSuccessMessage("Please enter an announcement title and message.");
          setShowSuccessModal(true);
          return;
      }
      
      const targetRole = announcementTargets.length > 0 && announcementTargets[0] !== "" ? announcementTargets[0] : 'All';
      const days = Number(announcementExpiryDays);
      const expiresAt = Number.isFinite(days) && days > 0
        ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
        : null;

      try {
          let fallbackAuthor = 'Admin';
          try {
              const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
              fallbackAuthor = String(currentUser?.name || currentUser?.email || 'Admin') || 'Admin';
          } catch (_) {}

          await fetchJson(`/api/announcements`, {
            apiBase: API_BASE,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), 'x-user-role': 'admin' },
            body: JSON.stringify({
              ...newAnnouncement,
              author: (adminProfile && adminProfile.name) || fallbackAuthor,
              target: targetRole,
              pinned: announcementPinned,
              expiresAt
            })
          });
          setNewAnnouncement({ title: '', content: '', priority: 'Normal' });
          setAnnouncementPinned(false);
          setAnnouncementExpiryDays('');
          fetchAnnouncements();
          setModalType("success");
          setSuccessMessage("Announcement posted successfully!");
          setShowSuccessModal(true);
      } catch (error) {
          console.error("Error posting announcement:", error);
          setModalType("error");
          setSuccessMessage(String(error?.message || "Failed to post announcement. Please check the server."));
          setShowSuccessModal(true);
      }
  };

  const handleDeleteAnnouncement = async (id) => {
      try {
          await fetchJson(`/api/announcements/${id}`, { apiBase: API_BASE, method: 'DELETE', headers: { ...getAuthHeaders() } });
          fetchAnnouncements();
      } catch (error) {
          console.error("Error deleting announcement:", error);
      }
  };

  // Fetch Staff from Backend
  const fetchStaff = async () => {
    try {
      setStaffError("");
      const data = await fetchJson(`/api/staff`, { apiBase: API_BASE, headers: { ...getAuthHeaders() } });
      if (Array.isArray(data)) {
        setStaffList(data.map(item => ({
          id: item._id || item.id,
          firstName: item.first_name || item.firstName,
          lastName: item.last_name || item.lastName,
          role: item.account_type === 'staff' ? item.specialization || 'Staff' : item.account_type,
          status: item.status || 'Offline',
          email: item.email,
          phone: item.phone,
          ...item
        })));
      } else {
        setStaffList([]);
      }
    } catch (error) {
      console.error("Error fetching staff:", error);
      setStaffList([]);
      setStaffError(String(error?.message || "Unable to load staff list. Please check the server connection."));
    }
  };

  useEffect(() => {
    const sendHeartbeat = async () => {
      try {
        const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
        const email = localStorage.getItem('tempLoginEmail') || currentUser?.email;
        const accountType = localStorage.getItem('tempLoginRole') || currentUser?.role || currentUser?.accountType || currentUser?.account_type || 'admin';
        const id = currentUser?._id || currentUser?.id;

        if (email) {
          await fetchJson(`/api/staff/heartbeat`, {
            apiBase: API_BASE,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ id, email, accountType })
          });
        }
      } catch (err) {
        console.error('Heartbeat failed:', err);
      }
    };

    sendHeartbeat(); // Initial heartbeat
    const hbInterval = setInterval(sendHeartbeat, 30000); // Every 30 seconds

    fetchStaff();
    fetchActivityLogs();
    fetchAnnouncements();
    fetchDashboardStats();
    fetchInventory();
    // Poll for dashboard updates every 30 seconds
    const interval = setInterval(() => {
        fetchActivityLogs();
        fetchAnnouncements();
        fetchDashboardStats();
        fetchRestockRequests();
        fetchInventory();
    }, 30000);
    return () => {
      clearInterval(interval);
      clearInterval(hbInterval);
    };
  }, []);

  useEffect(() => {
    if (!supabase) {
      const t = setInterval(() => {
        fetchStaff();
        fetchDashboardStats();
      }, 20000);
      return () => clearInterval(t);
    }

    const t = setInterval(() => {
      fetchStaff();
      fetchDashboardStats();
    }, 20000);

    const channel = supabase
      .channel('presence-online')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff' }, () => {
        fetchStaff();
        fetchDashboardStats();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'nurses' }, () => {
        fetchStaff();
        fetchDashboardStats();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'doctors' }, () => {
        fetchStaff();
        fetchDashboardStats();
      })
      .subscribe();

    return () => {
      clearInterval(t);
      supabase.removeChannel(channel);
    };
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
    let currentUserAvatar = '';

    // Fallback to currentUser session if tempLoginEmail is gone (e.g. after OTP bypass or cleanup)
    if (!currentUserEmail) {
        try {
            const currentUser = JSON.parse(localStorage.getItem('currentUser'));
            if (currentUser && currentUser.email) {
                currentUserEmail = currentUser.email;
            }
            if (currentUser && (currentUser.avatarUrl || currentUser.avatar_url || currentUser.profilePicture)) {
                currentUserAvatar = currentUser.avatarUrl || currentUser.avatar_url || currentUser.profilePicture;
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
      profilePicture: currentUserAvatar || "",
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

  const adminAvatarInputRef = useRef(null);
  const [pendingAdminAvatarFile, setPendingAdminAvatarFile] = useState(null);

  const handleUpdateAdminProfile = async (e) => {
    e.preventDefault();
    setUpdateNotice("");
    
    // 1. Check Required Personal Fields
    if (!adminProfile.email || !adminProfile.department || !adminProfile.phone) {
        setUpdateNotice("Please fill in all personal information fields.");
        return;
    }

    // 2. Check for Validation Errors
    if (emailNotice || phoneNotice || nameNotice) {
        setUpdateNotice("Please fix the errors in the form before saving.");
        return;
    }

    // 3. Password Validation
    const { currentPassword, newPassword, confirmNewPassword } = adminProfile;
    const isChangingPassword = currentPassword || newPassword || confirmNewPassword;

    const localPw = String(newPassword || '');
    const localPwCriteria = {
      length: localPw.length >= 11,
      hasNumber: /\d/.test(localPw),
      hasSpecial: /[!@#$%^&*(),.?":{}|<>]/.test(localPw)
    };

    if (isChangingPassword) {
        // If trying to change password, ALL fields must be filled
        if (!currentPassword || !newPassword || !confirmNewPassword) {
            setUpdateNotice("To change password, please fill in Current, New, and Confirm Password fields.");
            return;
        }

        // Check Mismatch
        if (newPassword !== confirmNewPassword) {
            setUpdateNotice("New passwords do not match.");
            return;
        }

        // Check Complexity (min 11 chars, 1 number, 1 special
        if (!localPwCriteria.length || !localPwCriteria.hasNumber || !localPwCriteria.hasSpecial) {
            setUpdateNotice("New password does not meet all complexity requirements (at least 11 characters, 1 number, 1 special character).");
            return;
        }
    }

    // Success logic
    try {
        const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
        let resolvedUser = currentUser || null;
        let userId = currentUser?._id || currentUser?.id;

        if (!userId && adminProfile.email.trim()) {
            const lookedUpUser = await fetchJson(
              `/api/staff/by-email?email=${encodeURIComponent(adminProfile.email.trim())}`,
              {
                apiBase: API_BASE,
                headers: { ...getAuthHeaders() }
              }
            );

            if (lookedUpUser?.id) {
              userId = lookedUpUser.id;
              resolvedUser = {
                ...(currentUser || {}),
                ...lookedUpUser,
                _id: lookedUpUser._id || currentUser?._id || lookedUpUser.id,
                id: lookedUpUser.id,
                role: currentUser?.role || lookedUpUser.account_type || lookedUpUser.roles || currentUser?.accountType || 'admin',
                accountType: currentUser?.accountType || lookedUpUser.account_type || lookedUpUser.roles || 'admin'
              };
              localStorage.setItem('currentUser', JSON.stringify(resolvedUser));
            }
        }

        if (!resolvedUser || !userId) {
             setModalType("error");
             setSuccessMessage("Unable to resolve your admin session. Please login again.");
             setShowSuccessModal(true);
             return;
        }

        let savedAvatarUrl = adminProfile.profilePicture || '';
        if (pendingAdminAvatarFile) {
            const fd = new FormData();
            fd.append('avatar', pendingAdminAvatarFile);
            fd.append('id', userId);
            fd.append('email', adminProfile.email);
            fd.append('accountType', String(resolvedUser.role || resolvedUser.roles || resolvedUser.account_type || resolvedUser.accountType || 'admin'));

            const avatarData = await fetchJson(`/api/staff/avatar`, {
              apiBase: API_BASE,
              method: 'POST',
              headers: { ...getAuthHeaders() },
              body: fd,
              timeoutMs: 30000
            });
            savedAvatarUrl = avatarData?.avatarUrl || savedAvatarUrl;
        }

        const payload = {
            email: adminProfile.email,
            phone: adminProfile.phone,
            department: adminProfile.department, // Include department in update if backend supports it
            currentPassword: adminProfile.currentPassword,
            requiresPasswordAuth: true
        };
        
        if (adminProfile.newPassword) {
            payload.password = adminProfile.newPassword;
        }

        const data = await fetchJson(`/api/staff/${userId}`, {
          apiBase: API_BASE,
          method: 'PUT',
          headers: { 
            'Content-Type': 'application/json',
            ...getAuthHeaders()
          },
          body: JSON.stringify(payload),
          timeoutMs: 30000
        });

        setModalType("success");
        setSuccessMessage("Admin Profile Updated Successfully!");
        setShowSuccessModal(true);
        
        // Update local storage
        const updatedUser = { ...resolvedUser, email: data.email, phone: data.phone, avatarUrl: savedAvatarUrl || resolvedUser.avatarUrl || '' };
        localStorage.setItem('currentUser', JSON.stringify(updatedUser));
        setAdminProfile((prev) => ({ ...prev, profilePicture: savedAvatarUrl || prev.profilePicture }));
        setPendingAdminAvatarFile(null);

        // Clear password fields
        setAdminProfile(prev => ({
            ...prev,
            currentPassword: "",
            newPassword: "",
            confirmNewPassword: ""
        }));
        setUpdateNotice("");
    } catch (error) {
         console.error("Update error:", error);
         setModalType("error");
         setSuccessMessage(String(error?.message || "Network error. Please try again."));
         setShowSuccessModal(true);
    }
  };

  const handleAdminAvatarPick = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setPendingAdminAvatarFile(f);
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      setAdminProfile((prev) => ({ ...prev, profilePicture: url }));
    };
    reader.readAsDataURL(f);
  };

  useEffect(() => {
    const email = String(adminProfile.email || '').trim();
    if (!email) return;
    let cancelled = false;
    const run = async () => {
      try {
        const d = await fetchJson(`/api/staff/by-email?email=${encodeURIComponent(email)}`, { apiBase: API_BASE, headers: { ...getAuthHeaders() } });
        if (cancelled) return;
        const url = d?.avatarUrl || '';
        setAdminProfile((prev) => ({ ...prev, profilePicture: url || prev.profilePicture }));
        try {
          const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
          if (currentUser && currentUser.email && String(currentUser.email).toLowerCase() === email.toLowerCase()) {
            localStorage.setItem('currentUser', JSON.stringify({
              ...currentUser,
              ...d,
              _id: d?._id || currentUser?._id || d?.id,
              id: d?.id || currentUser?.id,
              role: currentUser?.role || d?.account_type || d?.roles || currentUser?.accountType || 'admin',
              accountType: currentUser?.accountType || d?.account_type || d?.roles || 'admin',
              avatarUrl: url || currentUser?.avatarUrl || ''
            }));
          }
        } catch (_) {}
      } catch (_) {}
    };
    run();
    return () => { cancelled = true; };
  }, [adminProfile.email]);

  const handleAdminProfileChange = (e) => {
    const { name, value } = e.target;

    // Strict Email Validation for Controlled Component
    if (name === "email") {
      if (value.length > 0) {
        // 1. Check if first character is a letter
        if (!/^[a-zA-Z]/.test(value[0])) {
          setEmailNoticeField("admin-email");
          setEmailNotice("Must start with a letter.");
          return; // Block the update, effectively preventing the input
        }

        // 2. Check for invalid characters in the rest of the string
        // Allowed: letters, numbers, @, ., _, -
        if (!/^[a-zA-Z0-9@._-]*$/.test(value)) {
          setEmailNoticeField("admin-email");
          setEmailNotice("No special characters.");
          return; // Block the update
        }

        // 3. Domain Check (Strict @gmail.com)
        if (value.includes("@")) {
          const parts = value.split("@");
          // Prevent multiple @ symbols
          if (parts.length > 2) {
             setEmailNoticeField("admin-email");
             setEmailNotice("One @ symbol only.");
             return;
          }
          
          const domain = parts[1];
          const expected = "gmail.com";
          
          // Allow typing strictly only if it matches the prefix of "gmail.com"
          if (domain.length > 0 && !expected.startsWith(domain)) {
             setEmailNoticeField("admin-email");
             setEmailNotice("Only @gmail.com allowed.");
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
    setSuccessMessage("Account details updated successfully!");
    setShowSuccessModal(true);
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
    let province = "";
    let zip = "";
    if (data) {
      province = data.province;
      zip = data.zip;
      setSelectedProvince(province);
      setPostalCode(zip);
    } else {
      setSelectedProvince("");
      setPostalCode("");
    }
    // ALSO sync staffFormData for city/province/postal so validators that read from staffFormData stay in sync
    setStaffFormData((prev) => ({ ...prev, city, province, postalCode: zip }));
  };

  const handlePhilHealthInput = (e, fieldId) => {
    // 1. Get only numbers
    let val = e.target.value.replace(/\D/g, '');
    
    // 2. Limit length to 12 digits
    if (val.length > 12) val = val.slice(0, 12);

    // 3. Update input value (No dashes)
    e.target.value = val;

    // 4. Validation Notice
    if (val.length > 0 && val.length < 12) {
        setPhilHealthNoticeField(fieldId);
        setPhilHealthNotice("Must be 12 digits.");
    } else {
        if (philHealthNoticeField === fieldId) {
            setPhilHealthNotice("");
            setPhilHealthNoticeField(null);
        }
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
      setPhoneNotice("Numbers only.");
    } else if (isNumber) {
      if (currentLength === 0 && e.key !== "0") {
         e.preventDefault();
         setPhoneNoticeField(fieldId);
         setPhoneNotice("Must start with 0.");
      } else if (currentLength === 1 && e.key !== "9") {
         e.preventDefault();
         setPhoneNoticeField(fieldId);
         setPhoneNotice("Must start with 09.");
      } else if (currentLength >= 11) {
        e.preventDefault();
        setPhoneNoticeField(fieldId);
        setPhoneNotice("Max 11 digits.");
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

  const handleAddressInput = (e, fieldId) => {
    const allowedKeys = ["Backspace", "Tab", "ArrowLeft", "ArrowRight", "Delete", "Enter", "Escape"];
    const isChar = e.key && e.key.length === 1;
    const currentVal = String(e.target.value || '');
    const currentLength = currentVal.length;

    if (allowedKeys.includes(e.key)) {
      if (addressNoticeField === fieldId) {
        setAddressNotice("");
        setAddressNoticeField(null);
      }
      return;
    }

    if (!isChar) return;

    if (currentLength === 0 && e.key === " ") {
      e.preventDefault();
      setAddressNoticeField(fieldId);
      setAddressNotice("Cannot start with space.");
      return;
    }

    if (currentLength >= 120) {
      e.preventDefault();
      setAddressNoticeField(fieldId);
      setAddressNotice("Max 120 characters.");
      return;
    }

    const ok = /^[a-zA-Z0-9\s.,'#\-\/]$/.test(e.key);
    if (!ok) {
      e.preventDefault();
      setAddressNoticeField(fieldId);
      setAddressNotice("Letters/numbers and . , - # / only.");
      return;
    }

    if (addressNoticeField === fieldId) {
      setAddressNotice("");
      setAddressNoticeField(null);
    }
  };

  const handleEmployeeIdInput = (e, fieldId) => {
    const allowedKeys = ["Backspace", "Tab", "ArrowLeft", "ArrowRight", "Delete", "Enter", "Escape"];
    const isNumber = /^[0-9]$/.test(e.key);
    const currentLength = e.target.value.length;

    if (!isNumber && !allowedKeys.includes(e.key)) {
      e.preventDefault();
      setEmployeeIdNoticeField(fieldId);
      setEmployeeIdNotice("Numbers only.");
    } else if (isNumber) {
      if (currentLength >= 16) {
        e.preventDefault();
        setEmployeeIdNoticeField(fieldId);
        setEmployeeIdNotice("Max 16 chars.");
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
        setEmailNotice("Must start with a letter.");
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
          setEmailNotice("No special characters.");
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
           setEmailNotice("One @ symbol only.");
       } else if (domain && !expectedGmail.startsWith(domain) && !expectedYahoo.startsWith(domain)) {
           setEmailNoticeField(fieldId);
           setEmailNotice("Only @gmail/@yahoo allowed.");
       } else {
           // If it matches so far (or is empty after @), clear strict domain error
           if (emailNoticeField === fieldId && (emailNotice.includes("allowed") || emailNotice === "One @ symbol only.")) {
               setEmailNotice("");
               setEmailNoticeField(null);
           }
       }
    } else {
        // Clear domain error if backspaced
        if (emailNoticeField === fieldId && (emailNotice.includes("allowed") || emailNotice === "One @ symbol only.")) {
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
     setDateHiredNotice("");
     setDateHiredNoticeField(null);
     setPhilHealthNotice("");
     setPhilHealthNoticeField(null);
     setEmailNotice("");
     setEmailNoticeField(null);
     setCreateStaffError(""); // Clear general error
     setCreateStaffSuccess(""); // Clear success message
     // Clear password state
     setRegistrationStep(3);
     setStaffFormData(initialStaffFormData);
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
            await fetchJson(`/api/staff/logout`, {
              apiBase: API_BASE,
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
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
      setNameNotice("Letters only.");
    } else if (isLetter && nameNoticeField === fieldId) {
      setNameNotice("");
      setNameNoticeField(null);
    }
  };

  // Date/Age Validation Handler
  const handleDateChange = (e, fieldId) => {
    // 1. Check Browser Validity First (Handles max attribute violation)
    if (e.target.validity.rangeOverflow) {
        setAgeNoticeField(fieldId);
        setAgeNotice("Date cannot be in the future.");
        return;
    }
    
    // 2. Check for bad input (e.g. invalid date parts)
    if (e.target.validity.badInput) {
        // Do not clear existing errors if input is bad/incomplete but not rangeOverflow
        return;
    }

    const value = e.target.value;
    if (!value) {
        // If empty but valid (not rangeOverflow or badInput), clear error
        setAgeNoticeField(null);
        setAgeNotice("");
        return;
    }

    const year = value.split('-')[0];
    
    // Strict Year Length Check: Must be exactly 4 digits
    if (year.length !== 4) {
       setAgeNoticeField(fieldId);
       setAgeNotice("Year must be exactly 4 digits.");
       return;
    }

    const [y, m, d] = value.split('-').map(Number);
    const selectedDate = new Date(y, m - 1, d);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // 2. Fallback Manual Check for Future Date
    if (selectedDate > today) {
        setAgeNoticeField(fieldId);
        setAgeNotice("Date cannot be in the future.");
        return;
    }

    let age = today.getFullYear() - selectedDate.getFullYear();
    const monthDiff = today.getMonth() - selectedDate.getMonth();
    
    // Adjust age if birthday hasn't occurred yet this year
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < selectedDate.getDate())) {
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

  // Date Hired Validation Handler
  const handleDateHiredChange = (e, fieldId) => {
    if (e.target.validity.rangeOverflow) {
        setDateHiredNoticeField(fieldId);
        setDateHiredNotice("Future year is not valid, only the past years and present year.");
        return;
    }
    
    if (e.target.validity.badInput) return;

    const value = e.target.value;
    if (!value) {
        setDateHiredNoticeField(null);
        setDateHiredNotice("");
        return;
    }

    const year = value.split('-')[0];
    if (year.length !== 4) {
       setDateHiredNoticeField(fieldId);
       setDateHiredNotice("Year must be exactly 4 digits.");
       return;
    }

    const [y, m, d] = value.split('-').map(Number);
    const selectedDate = new Date(y, m - 1, d);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (selectedDate > today) {
        setDateHiredNoticeField(fieldId);
        setDateHiredNotice("Future year is not valid, only the past years and present year.");
        return;
    }

    if (dateHiredNoticeField === fieldId) {
        setDateHiredNotice("");
        setDateHiredNoticeField(null);
    }
  };

  const handleEditStaff = (staff) => {
    const classification = getStaffEditClassification(staff);
    setEditingStaff(staff);
    setEditFormData({
      firstName: staff.firstName,
      lastName: staff.lastName,
      role: classification.role,
      specialization: classification.specialization,
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
        const staffToDelete = staffList.find(s => s.id === deleteConfirmation);
        await fetchJson(`/api/staff/${deleteConfirmation}`, { apiBase: API_BASE, method: 'DELETE', headers: { ...getAuthHeaders() } });
        await logActivity('Delete', `Deleted staff member ${staffToDelete ? staffToDelete.firstName + ' ' + staffToDelete.lastName : 'Unknown'}`, `Staff: ${staffToDelete ? staffToDelete.email : deleteConfirmation}`);
        setStaffList(staffList.filter(staff => staff.id !== deleteConfirmation));
        setDeleteConfirmation(null);
        setModalType("success");
        setSuccessMessage("Staff deleted successfully.");
        setShowSuccessModal(true);
    } catch (error) {
        console.error("Error deleting staff:", error);
        setModalType("error");
        setSuccessMessage(String(error?.message || "Failed to delete staff."));
        setShowSuccessModal(true);
    }
  };

  const cancelDelete = () => {
    setDeleteConfirmation(null);
  };

  const handleUpdateIncidentStatus = async (id, newStatus) => {
      const incidentId = String(id || '').trim();
      if (!incidentId) {
          setModalType("error");
          setSuccessMessage("Unable to update incident status (missing incident ID).");
          setShowSuccessModal(true);
          return;
      }

      const nextUiStatus = String(newStatus || '').trim();
      const nextLower = nextUiStatus.toLowerCase();
      const nextPayloadStatus = nextLower === 'reviewed' || nextLower === 'resolved'
        ? 'resolved'
        : nextLower === 'pending' || nextLower === 'submitted'
          ? 'submitted'
          : nextLower === 'in_progress' || nextLower === 'in progress' || nextLower === 'inprogress'
            ? 'in_progress'
            : nextUiStatus;

      setIncidentUpdatingId(incidentId);
      try {
          await fetchJson(`/api/incidents/${encodeURIComponent(incidentId)}/status`, {
            apiBase: API_BASE,
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ status: nextPayloadStatus })
          });
          setIncidents((prev) => prev.map((inc) => (String(inc.id || inc._id || '') === incidentId ? { ...inc, status: 'Reviewed' } : inc)));
          fetchIncidents();
      } catch (err) {
          console.error("Failed to update incident status", err);
          setModalType("error");
          setSuccessMessage(String(err?.message || "Failed to update incident status."));
          setShowSuccessModal(true);
      } finally {
          setIncidentUpdatingId(null);
      }
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
             setEmailNotice("One @ symbol only.");
             return;
          }
          
          const domain = parts[1];
          const expectedGmail = "gmail.com";
          const expectedYahoo = "yahoo.com";
          
          // Allow typing strictly only if it matches the prefix of "gmail.com" or "yahoo.com"
          if (domain.length > 0 && !expectedGmail.startsWith(domain) && !expectedYahoo.startsWith(domain)) {
             setEmailNoticeField("edit-email");
             setEmailNotice("Only @gmail/@yahoo allowed.");
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

    const errors = [];
    const clean = (v) => String(v || "").trim();
    const firstName = clean(editFormData.firstName);
    const lastName = clean(editFormData.lastName);
    const role = clean(editFormData.role || editFormData.accountType);
    const email = clean(editFormData.email);
    const phone = clean(editFormData.phone);
    const isValidEmail = (v) => /^[A-Za-z][A-Za-z0-9._-]*@(gmail\.com|yahoo\.com)$/.test(v);
    const isValidPHPhone = (v) => /^09\d{9}$/.test(v);

    if (!firstName || firstName.length < 2) errors.push("First Name is required (at least 2 characters).");
    if (!lastName || lastName.length < 2) errors.push("Last Name is required (at least 2 characters).");
    if (!role) errors.push("Role is required.");
    if (!email) {
      errors.push("Email is required.");
    } else if (!email.endsWith("@gmail.com") && !email.endsWith("@yahoo.com")) {
      errors.push("Email must end with @gmail.com or @yahoo.com");
    } else if (!isValidEmail(email)) {
      errors.push("Email must start with a letter and match allowed format.");
    }
    if (!phone) {
      errors.push("Phone number is required.");
    } else if (!isValidPHPhone(phone)) {
      errors.push("Phone number must start with 09 and be 11 digits.");
    }
    if (errors.length > 0) {
      setModalType("error");
      setSuccessMessage(errors.join(" "));
      setShowSuccessModal(true);
      return;
    }

    try {
        const payload = {
          ...editFormData,
          firstName,
          lastName,
          role,
          email,
          phone
        };
        delete payload.id;
        delete payload._id;
        // Account classification is displayed in this profile editor but is
        // intentionally not sent as a raw Prisma field. Role migration/reset
        // is a separate administrative operation.
        delete payload.role;
        delete payload.specialization;
        delete payload.accountType;
        const updatedStaff = await fetchJson(`/api/staff/${editingStaff.id}`, {
          apiBase: API_BASE,
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders()
          },
          body: JSON.stringify(payload)
        });
            await logActivity('Update', `Updated staff details for ${updatedStaff.firstName} ${updatedStaff.lastName}`, `Staff: ${updatedStaff.email}`);
            setStaffList(staffList.map(staff => 
                staff.id === editingStaff.id ? { ...staff, ...updatedStaff, id: updatedStaff._id } : staff
            ));
            setEditingStaff(null);
            setModalType("success");
            setSuccessMessage("Staff member updated successfully.");
            setShowSuccessModal(true);
    } catch (error) {
        console.error("Error updating staff:", error);
        setModalType("error");
        setSuccessMessage(String(error?.message || "Failed to update staff."));
        setShowSuccessModal(true);
    }
  };

  const handleCancelEdit = () => {
    setEditingStaff(null);
  };

  const handleCreateStaff = async (e) => {
    e.preventDefault();
    setCreateStaffError("");
    setCreateStaffSuccess("");
    setCreateStaffLoading(true);
    let newUser = null;
    let tempPassword = "";
    try {
      const clean = (v) => String(v || "").trim();
      const resolvedCity = clean(staffFormData.city) || clean(selectedCity);
      const matchedCity = ncrCalabarzonCities.find((item) => clean(item.city) === resolvedCity);
      const resolvedProvince = clean(staffFormData.province) || clean(selectedProvince) || clean(matchedCity?.province);
      const resolvedPostalCode = clean(staffFormData.postalCode) || clean(postalCode) || clean(matchedCity?.zip);
      newUser = { 
        ...staffFormData, 
        city: resolvedCity,
        province: resolvedProvince,
        postalCode: resolvedPostalCode
      };
      
      // Map role to accountType
      if (newUser.role === 'Nurse') newUser.accountType = 'nurse';
      else if (newUser.role === 'Doctor') newUser.accountType = 'doctor';
      else if (newUser.role === 'Admin') newUser.accountType = 'admin';
      else if (newUser.role === 'Pharmacist') newUser.accountType = 'pharmacist';
      else if (newUser.role === 'Clinical Staff') {
        const spec = String(newUser.specialization || '').trim();
        if (spec === 'MedTech' || spec === 'Medtechs') newUser.accountType = 'medtech';
        else if (spec === 'Radiographer' || spec === 'Radiographer (X-ray)') newUser.accountType = 'radiographer';
        else if (spec === 'ECG Operator') newUser.accountType = 'ecg_operator';
        else if (spec === 'Physical Therapist') newUser.accountType = 'physical_therapist';
        else newUser.accountType = 'staff';
      }
      else if (['Office Staff', 'Staff'].includes(newUser.role) && String(newUser.specialization || '').trim() === 'Cashier') newUser.accountType = 'cashier';
      else if (['Office Staff', 'Staff'].includes(newUser.role)) {
        const spec = String(newUser.specialization || '').trim();
        if (spec === 'Doctor Secretary' || spec === "Doctor's Secretary") newUser.accountType = 'doctor_secretary';
        else newUser.accountType = 'staff';
      }
      else newUser.accountType = 'staff'; // Fallback

      if (newUser.role === 'Nurse') {
        newUser.department = newUser.specialization;
      }

      const errors = [];
      const isValidPHPhone = (v) => /^(\+?63\s?|0)9\d{9}$/.test(String(clean(v)).replace(/[\s\-()]/g, ''));
      const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean(v));
      const isValidName = (v) => { const s = clean(v); return !!s && /^[A-Za-zÑñ][A-Za-zÑñ' .\-]*$/.test(s); };

      // Final validation for Step 1 / 2 / 3 fields (belt and suspenders — gate already checked, but double check)
      if (!clean(newUser.firstName) || clean(newUser.firstName).length < 2) errors.push("First Name is required (min 2 letters).");
      else if (!isValidName(newUser.firstName)) errors.push("First Name contains invalid characters.");
      if (!clean(newUser.lastName) || clean(newUser.lastName).length < 2) errors.push("Last Name is required (min 2 letters).");
      else if (!isValidName(newUser.lastName)) errors.push("Last Name contains invalid characters.");
      if (clean(newUser.middleName) && !isValidName(newUser.middleName)) errors.push("Middle Name contains invalid characters.");
      if (!clean(newUser.role)) errors.push("Role is required.");
      if (!clean(newUser.dateHired)) errors.push("Date Hired is required.");
      if (!isValidEmail(newUser.email)) errors.push("Invalid email address format.");
      if (!isValidPHPhone(newUser.phone)) errors.push("Invalid PH phone number. Use format: 09XX XXX XXXX or +63 9XX XXX XXXX.");
      if (!clean(newUser.streetAddress) || clean(newUser.streetAddress).length < 5) errors.push("Street Address must be at least 5 characters.");
      if (!clean(newUser.city)) errors.push("City / Municipality is required.");
      const medicalRolesForLic = ['doctor', 'nurse', 'pharmacist'];
      if (medicalRolesForLic.includes(String(newUser.accountType || '').toLowerCase())) {
        if (!/^\d{7}$/.test(clean(newUser.medicalLicenseNumber))) errors.push("Medical License Number must be exactly 7 digits.");
      }
      if (String(newUser.accountType || '').toLowerCase() === 'doctor' && clean(newUser.specialization).toLowerCase() === 'medicine') {
        if (!clean(newUser.department)) errors.push("Department is required for Medicine doctors (ER or OPD/Medicine).");
      }
      const specClean = clean(newUser.specialization);
      const isDocSec = ['Office Staff', 'Staff'].includes(String(newUser.role || '')) &&
        (specClean === "Doctor's Secretary" || specClean === 'Doctor Secretary');
      if (isDocSec && !clean(newUser.linkedDoctorId)) errors.push("Linked Doctor is required for Doctor Secretary.");

      // Auto-generate secure temporary password (strong 11+ chars: 8 rand + Temp1! = 14 chars)
      tempPassword = Math.random().toString(36).slice(-8) + "Temp1!";
      newUser.password = tempPassword;
      
      if (errors.length > 0) {
        setCreateStaffError(errors.join("\n"));
        return;
      }
      
      try {
          await fetchJson(`/api/staff`, {
            apiBase: API_BASE,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...getAuthHeaders(),
              'x-user-role': 'admin'
            },
            body: JSON.stringify(newUser)
          });
              await logActivity('Create', `Registered new staff: ${newUser.firstName} ${newUser.lastName}`, `Staff: ${newUser.email}`);
              setSuccessMessage("Staff account created successfully.");
              
              handleReset();
              let emailOk = false;
              let emailErr = '';
              try {
                const staffName = `${String(newUser.firstName || '').trim()} ${String(newUser.lastName || '').trim()}`.trim();
                const resp = await sendStaffWelcomeEmail({ email: newUser.email, name: staffName, temporaryPassword: tempPassword });
                emailOk = !!resp?.success;
              } catch (_) {
                emailOk = false;
                emailErr = String(_?.text || _?.message || '').trim();
              }

              setCreateStaffSuccess(
                emailOk
                  ? "Staff account created successfully. Credentials email has been sent."
                  : `Staff account created successfully. Credentials email was not sent${emailErr ? ` — ${emailErr}` : ' — please check the backend email configuration.'}`
              );
              fetchStaff(); 
      } catch (error) {
              const msg = String(error?.message || '');
              const looksDuplicate = /already\s+registered|already\s+exists|duplicate/i.test(msg);
              if (looksDuplicate && newUser.email) {
                  const ok = window.confirm(`Email "${newUser.email}" is already registered.\n\nDo you want to remove the existing account for this email and try again?`);
                  if (ok) {
                      try {
                          await fetchJson(`/api/staff/by-email`, {
                            apiBase: API_BASE,
                            method: 'DELETE',
                            headers: { 
                              'Content-Type': 'application/json',
                              ...getAuthHeaders(),
                              'x-user-role': 'admin'
                            },
                            body: JSON.stringify({ email: newUser.email })
                          });
                      } catch (e) {
                          setCreateStaffError(String(e?.message || msg || "Database rejected the registration. Check if email already exists."));
                          return;
                      }
                      try {
                          await fetchJson(`/api/staff`, {
                            apiBase: API_BASE,
                            method: 'POST',
                            headers: { 
                              'Content-Type': 'application/json',
                              ...getAuthHeaders(),
                              'x-user-role': 'admin'
                            },
                            body: JSON.stringify(newUser)
                          });
                          await logActivity('Create', `Registered new staff: ${newUser.firstName} ${newUser.lastName}`, `Staff: ${newUser.email}`);
                          setSuccessMessage("Staff account created successfully.");

                          handleReset();
                          let emailOk = false;
                          let emailErr = '';
                          try {
                            const staffName = `${String(newUser.firstName || '').trim()} ${String(newUser.lastName || '').trim()}`.trim();
                            const resp = await sendStaffWelcomeEmail({ email: newUser.email, name: staffName, temporaryPassword: tempPassword });
                            emailOk = !!resp?.success;
                          } catch (_) {
                            emailOk = false;
                            emailErr = String(_?.text || _?.message || '').trim();
                          }

                          setCreateStaffSuccess(
                            emailOk
                              ? "Staff account created successfully. Credentials email has been sent."
                              : `Staff account created successfully. Credentials email was not sent${emailErr ? ` — ${emailErr}` : ' — please check the backend email configuration.'}`
                          );
                          fetchStaff();
                          return;
                      } catch (e) {
                          const detail = e?.data?.field ? ` (field: ${e.data.field})` : '';
                          setCreateStaffError(String(e?.message || msg || "Database rejected the registration.") + detail);
                          return;
                      }
                  }
              }
              const detail = error?.data?.field ? `\n(Problem field: ${error.data.field})` : '';
              const codeStr = error?.data?.code || error?.data?.prismaCode ? `\n[${error.data.code || error.data.prismaCode}]` : '';
              setCreateStaffError((msg || "Database rejected the registration. Check if email/employee ID already exists.") + detail + codeStr);
      }
    } catch (outerErr) {
      // Top-level catch — any unexpected JS error before/during submission
      console.error("handleCreateStaff OUTER ERROR:", outerErr);
      const outerMsg = String(outerErr?.message || outerErr || "Unexpected error occurred — please refresh and try again.").slice(0, 400);
      setCreateStaffError(outerMsg);
    } finally {
      setCreateStaffLoading(false);
    }
  };

  const handleForceRemoveEmail = async () => {
    const email = String(staffFormData.email || '').trim();
    if (!email) return;

    setPurgeEmailLoading(true);
    setCreateStaffError("");
    setCreateStaffSuccess("");
    try {
      const ok = window.confirm(`Remove "${email}" from all accounts in the database?`);
      if (!ok) return;

      await fetchJson(`/api/staff/by-email`, {
        apiBase: API_BASE,
        method: 'DELETE',
        headers: { 
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
          'x-user-role': 'admin'
        },
        body: JSON.stringify({ email })
      });

      setCreateStaffSuccess(`Removed "${email}". You can register it again now.`);
    } catch (err) {
      setCreateStaffError(String(err?.message || 'Failed to remove email.'));
    } finally {
      setPurgeEmailLoading(false);
    }
  };

  const isValidRegisterStep = useMemo(() => {
    const clean = (v) => String(v || "").trim();
    {
      if (!clean(staffFormData.firstName) || clean(staffFormData.firstName).length < 2) return false;
      if (!clean(staffFormData.lastName) || clean(staffFormData.lastName).length < 2) return false;
      if (!clean(staffFormData.middleName) || clean(staffFormData.middleName).length < 2) return false;
      const dobStr = clean(staffFormData.dateOfBirth);
      if (!dobStr) return false;
      const dob = new Date(dobStr);
      if (Number.isNaN(dob.getTime())) return false;
      const today = new Date();
      if (dob > today) return false;
      let age = today.getFullYear() - dob.getFullYear();
      const m = today.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age -= 1;
      if (age < 18) return false;
      if (!clean(staffFormData.gender)) return false;
      if (!clean(staffFormData.civilStatus)) return false;
      if (!clean(staffFormData.nationality)) return false;
    }
    {
      if (!clean(staffFormData.role)) return false;
      const hiredStr = clean(staffFormData.dateHired);
      if (!hiredStr) return false;
      const hired = new Date(hiredStr);
      const today = new Date();
      if (Number.isNaN(hired.getTime()) || hired > today) return false;
      const medicalRoles = ['Doctor', 'Nurse', 'Pharmacist'];
      if (medicalRoles.includes(clean(staffFormData.role))) {
        if (!/^\d{7}$/.test(clean(staffFormData.medicalLicenseNumber))) return false;
      }
      if (clean(staffFormData.role) && !clean(staffFormData.specialization)) return false;
      const isMedicineDoctor = clean(staffFormData.role) === 'Doctor' && clean(staffFormData.specialization) === 'Medicine';
      if (isMedicineDoctor && !clean(staffFormData.department)) return false;
      const specClean = clean(staffFormData.specialization);
      const isDoctorSecretary = ['Office Staff', 'Staff'].includes(clean(staffFormData.role)) &&
        (specClean === "Doctor's Secretary" || specClean === 'Doctor Secretary');
      if (isDoctorSecretary && !clean(staffFormData.linkedDoctorId)) return false;
    }
    {
      // Step 3: accept whichever city source is already populated so the UI and payload stay aligned
      const emailClean = clean(staffFormData.email);
      const phoneDigits = clean(staffFormData.phone).replace(/[\s\-()]/g, '');
      const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
      const isValidPhone = (v) => /^(\+?63\s?|0)9\d{9}$/.test(v);
      const cityForStep = clean(staffFormData.city) || clean(selectedCity);
      const streetForStep = clean(staffFormData.streetAddress);
      if (!emailClean || !isValidEmail(emailClean)) return false;
      if (!clean(staffFormData.phone) || !isValidPhone(phoneDigits)) return false;
      if (!streetForStep || streetForStep.length < 5) return false;
      if (!cityForStep || cityForStep.length < 2) return false;
    }
    return true;
  }, [staffFormData, selectedCity]);

  // Dynamic UX: show EXACT reasons why button is disabled (so user never guesses)
  const registerStepBlockers = useMemo(() => {
    const clean = (v) => String(v || "").trim();
    const blockers = [];
    {
      if (!clean(staffFormData.firstName) || clean(staffFormData.firstName).length < 2) blockers.push("First Name (min 2 letters)");
      if (!clean(staffFormData.middleName) || clean(staffFormData.middleName).length < 2) blockers.push("Middle Name (min 2 letters)");
      if (!clean(staffFormData.lastName) || clean(staffFormData.lastName).length < 2) blockers.push("Last Name (min 2 letters)");
      const dobStr = clean(staffFormData.dateOfBirth);
      if (!dobStr) blockers.push("Date of Birth");
      else {
        const dob = new Date(dobStr);
        const today = new Date();
        if (Number.isNaN(dob.getTime())) blockers.push("Valid Date of Birth");
        else if (dob > today) blockers.push("Date of Birth (not future)");
        else {
          let age = today.getFullYear() - dob.getFullYear();
          const m = today.getMonth() - dob.getMonth();
          if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age -= 1;
          if (age < 18) blockers.push("Staff must be 18+ years old");
        }
      }
      if (!clean(staffFormData.gender)) blockers.push("Gender");
      if (!clean(staffFormData.civilStatus)) blockers.push("Civil Status");
      if (!clean(staffFormData.nationality)) blockers.push("Nationality");
    }
    {
      if (!clean(staffFormData.role)) blockers.push("Role / Position");
      const hiredStr = clean(staffFormData.dateHired);
      if (!hiredStr) blockers.push("Date Hired");
      else {
        const hired = new Date(hiredStr);
        const today = new Date();
        if (Number.isNaN(hired.getTime())) blockers.push("Valid Date Hired");
        else if (hired > today) blockers.push("Date Hired (not future)");
      }
      const medicalRoles = ['Doctor', 'Nurse', 'Pharmacist'];
      if (medicalRoles.includes(clean(staffFormData.role))) {
        if (!/^\d{7}$/.test(clean(staffFormData.medicalLicenseNumber))) blockers.push("Medical License # (7 digits)");
      }
      if (clean(staffFormData.role) && !clean(staffFormData.specialization)) blockers.push("Specialization");
      const isMedicineDoctor = clean(staffFormData.role) === 'Doctor' && clean(staffFormData.specialization) === 'Medicine';
      if (isMedicineDoctor && !clean(staffFormData.department)) blockers.push("Department (ER / OPD-Medicine)");
      const specClean = clean(staffFormData.specialization);
      const isDoctorSecretary = ['Office Staff', 'Staff'].includes(clean(staffFormData.role)) &&
        (specClean === "Doctor's Secretary" || specClean === 'Doctor Secretary');
      if (isDoctorSecretary && !clean(staffFormData.linkedDoctorId)) blockers.push("Linked Doctor");
    }
    {
      const emailClean = clean(staffFormData.email);
      const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
      if (!emailClean) blockers.push("Email Address");
      else if (!isValidEmail(emailClean)) blockers.push("Valid Email format");
      const phoneDigits = clean(staffFormData.phone).replace(/[\s\-()]/g, '');
      const isValidPhone = (v) => /^(\+?63\s?|0)9\d{9}$/.test(v);
      if (!clean(staffFormData.phone)) blockers.push("Phone Number");
      else if (!isValidPhone(phoneDigits)) blockers.push("PH Phone format (09XX XXX XXXX or +63 9XX XXX XXXX)");
      const streetStep = clean(staffFormData.streetAddress);
      if (!streetStep || streetStep.length < 5) blockers.push("Street Address (min 5 chars)");
      const cityStep = clean(staffFormData.city) || clean(selectedCity);
      if (!cityStep || cityStep.length < 2) blockers.push("City / Municipality");
    }
    return blockers;
  }, [staffFormData, selectedCity]);

  const handleNextStep = () => {
    setCreateStaffError(""); // Clear previous errors
    const errors = [];
    const clean = (v) => String(v || "").trim();

    if (registrationStep === 1) {
        if (!clean(staffFormData.firstName) || clean(staffFormData.firstName).length < 2) errors.push("First Name must be at least 2 characters.");
        if (!clean(staffFormData.lastName) || clean(staffFormData.lastName).length < 2) errors.push("Last Name must be at least 2 characters.");
        if (!clean(staffFormData.middleName) || clean(staffFormData.middleName).length < 2) errors.push("Middle Name must be at least 2 characters.");
        
        const dobStr = clean(staffFormData.dateOfBirth);
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
        if (!clean(staffFormData.gender)) errors.push("Gender is required.");
        if (!clean(staffFormData.civilStatus)) errors.push("Civil Status is required.");
        if (!clean(staffFormData.nationality)) errors.push("Nationality is required.");
    }

    if (registrationStep === 2) {
        if (!clean(staffFormData.role)) errors.push("Role is required.");
        // Employee ID is now auto-generated, but we still check if it's there
        if (!clean(staffFormData.employeeId)) {
          // If for some reason it's missing, generate it now
          const randomId = "EMP-" + Math.floor(10000 + Math.random() * 90000);
          setStaffFormData(prev => ({ ...prev, employeeId: randomId }));
        }

        const hiredStr = clean(staffFormData.dateHired);
        if (!hiredStr) {
          errors.push("Date Hired is required.");
        } else {
          const hired = new Date(hiredStr);
          const today = new Date();
          if (Number.isNaN(hired.getTime())) errors.push("Date Hired is invalid.");
          else if (hired > today) errors.push("Future year is not valid, only the past years and present year.");
        }

        const medicalRoles = ['Doctor', 'Nurse', 'Pharmacist'];
        if (medicalRoles.includes(staffFormData.role)) {
            if (!clean(staffFormData.medicalLicenseNumber) || !/^\d{7}$/.test(clean(staffFormData.medicalLicenseNumber))) {
              errors.push("Medical License Number must be exactly 7 digits for this role.");
            }
        }
        if (staffFormData.role && !clean(staffFormData.specialization)) {
          errors.push("Specialization is required.");
        }
        const isMedicineDoctor = clean(staffFormData.role) === 'Doctor' && clean(staffFormData.specialization) === 'Medicine';
        if (isMedicineDoctor && !clean(staffFormData.department)) {
          errors.push("Department is required for Medicine doctors (ER or OPD/Medicine).");
        }
        const specClean = clean(staffFormData.specialization);
        const isDoctorSecretary = ['Office Staff', 'Staff'].includes(clean(staffFormData.role)) &&
          (specClean === "Doctor's Secretary" || specClean === 'Doctor Secretary');
        if (isDoctorSecretary && !clean(staffFormData.linkedDoctorId)) {
          errors.push("Linked Doctor is required for Doctor Secretary.");
        }
    }

    if (errors.length > 0) {
        setCreateStaffError(errors.join("\n"));
    } else {
        setCreateStaffError("");
        if (registrationStep === 1) {
            // Generate Employee ID when moving to Step 2
            const randomId = "EMP-" + Math.floor(10000 + Math.random() * 90000);
            setStaffFormData(prev => ({ ...prev, employeeId: randomId }));
        }
        setRegistrationStep(prev => prev + 1);
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
    if (!clean(newUser.civilStatus)) errors.push("Civil Status is required.");
    if (!clean(newUser.nationality)) errors.push("Nationality is required.");
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
        await fetchJson(`/api/patients`, {
          apiBase: API_BASE,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
            'x-user-role': 'admin'
          },
          body: JSON.stringify(newUser),
        });
        await logActivity('Create', `Registered new patient: ${newUser.firstName} ${newUser.lastName}`, `Patient: ${newUser.email}`);
        setSuccessMessage("Patient account created successfully!");
        setShowSuccessModal(true);
        e.target.reset();
        setPassword("");
        setConfirmPassword("");
        handleReset();
    } catch (error) {
        console.error("Error:", error);
        setCreatePatientError(String(error?.message || "Failed to connect to server."));
    }
  };

  // --- REPORTING EXPORT HELPERS ---
  const downloadCSV = (data, filename) => {
      if (!data || data.length === 0) {
          alert("No data available to export.");
          return;
      }
      const headers = Object.keys(data[0]).join(',');
      const rows = data.map(obj => Object.values(obj).map(val => `"${val}"`).join(',')).join('\n');
      const csv = `${headers}\n${rows}`;
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      window.URL.revokeObjectURL(url);
  };

  const parseDateStart = (value) => {
      if (!value) return null;
      const d = new Date(`${value}T00:00:00`);
      return Number.isNaN(d.getTime()) ? null : d;
  };

  const parseDateEnd = (value) => {
      if (!value) return null;
      const d = new Date(`${value}T23:59:59.999`);
      return Number.isNaN(d.getTime()) ? null : d;
  };

  const withinRange = (date, from, to) => {
      if (!date) return false;
      const t = date.getTime();
      if (from && t < from.getTime()) return false;
      if (to && t > to.getTime()) return false;
      return true;
  };

  const printTableReport = (title, subtitle, columns, rows) => {
      const printWindow = window.open('', '_blank');
      const now = new Date().toLocaleString();
      const safeTitle = String(title || 'Report');
      const safeSubtitle = String(subtitle || '');
      const th = columns.map((c) => `<th>${String(c)}</th>`).join('');
      const td = rows.map((r) => `<tr>${columns.map((c) => `<td>${String(r[c] ?? '')}</td>`).join('')}</tr>`).join('');

      printWindow.document.write(`
        <html>
          <head>
            <title>${safeTitle}</title>
            <style>
              body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; color: #0f172a; }
              h1 { margin: 0; font-size: 24px; letter-spacing: -0.02em; }
              .sub { margin-top: 6px; color: #64748b; font-size: 14px; }
              .meta { margin-top: 18px; color: #94a3b8; font-size: 12px; }
              table { width: 100%; border-collapse: collapse; margin-top: 22px; }
              th { text-align: left; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b; background: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 10px 12px; position: sticky; top: 0; }
              td { border-bottom: 1px solid #f1f5f9; padding: 10px 12px; font-size: 13px; color: #0f172a; vertical-align: top; }
              .footer { margin-top: 26px; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 14px; }
              @media print { body { padding: 18px; } }
            </style>
          </head>
          <body>
            <h1>${safeTitle}</h1>
            ${safeSubtitle ? `<div class="sub">${safeSubtitle}</div>` : ``}
            <div class="meta">Generated: ${now}</div>
            <table>
              <thead><tr>${th}</tr></thead>
              <tbody>${td}</tbody>
            </table>
            <div class="footer">Confidential • Internal use only</div>
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
          printWindow.print();
          printWindow.close();
      }, 350);
  };

  const isLowStockItem = (item) => {
      const status = String(item.status || '').toLowerCase();
      const stock = Number(item.stock);
      const threshold = Number(opsSettings.lowStockThreshold);
      if (status === 'low stock' || status === 'out of stock') return true;
      if (Number.isFinite(stock) && Number.isFinite(threshold)) return stock <= threshold;
      return false;
  };

  const exportStaffReport = () => {
      const data = staffList.map(s => ({ Name: `${s.firstName} ${s.lastName}`, Role: getStaffRoleInfo(s).label, Email: s.email, Phone: s.phone, Status: s.status }));
      downloadCSV(data, `staff_roster_${new Date().toISOString().split('T')[0]}.csv`);
  };

  const exportPatientReport = () => {
      const data = patientList.map(p => ({
          Name: `${p.first_name || p.firstName} ${p.last_name || p.lastName}`,
          Gender: p.gender,
          Contact: p.contactNumber || p.phone,
          DateOfBirth: p.date_of_birth ? new Date(p.date_of_birth).toLocaleDateString() : (p.dateOfBirth ? new Date(p.dateOfBirth).toLocaleDateString() : 'N/A')
      }));
      downloadCSV(data, `patient_demographics_${new Date().toISOString().split('T')[0]}.csv`);
  };

  const exportActivityReport = (rowsOverride) => {
      const source = Array.isArray(rowsOverride) ? rowsOverride : activityLogs;
      const data = source.map(l => ({
          Time: new Date(l.timestamp).toLocaleString(),
          Actor: l.actorName,
          Action: l.action,
          Target: l.target,
          Details: l.details
      }));
      downloadCSV(data, `activity_audit_${new Date().toISOString().split('T')[0]}.csv`);
  };

  const exportIncidentReport = (rowsOverride) => {
      const source = Array.isArray(rowsOverride) ? rowsOverride : incidents;
      const data = source.map((i) => ({
          Date: i.date || (i.incident_date ? new Date(i.incident_date).toLocaleDateString() : ''),
          Time: i.time || (i.incident_time ? new Date(i.incident_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''),
          Type: i.type || i.incident_type || '',
          Location: i.location || '',
          Reporter: i.reporter || i.created_by_email || '',
          Status: i.status || '',
          Description: i.description || '',
          ActionTaken: i.action_taken || i.actionTaken || ''
      }));
      downloadCSV(data, `incident_reports_${new Date().toISOString().split('T')[0]}.csv`);
  };

  const exportSalesMonitoringReport = () => {
      if (!salesMonitor) {
          alert("No sales monitoring data available.");
          return;
      }
      const invoicesByStatus = salesMonitor?.billing?.invoices_by_status || {};
      const summary = [
          {
              Date: salesMonitor?.date ? new Date(salesMonitor.date).toISOString().slice(0, 10) : (salesMonitorDate || ''),
              BillingCollected: salesMonitor?.billing?.total_collected ?? '0.00',
              BillingRefunded: salesMonitor?.billing?.total_refunded ?? '0.00',
              BillingPaymentsCount: salesMonitor?.billing?.payments_count ?? 0,
              BillingOnsiteCollected: salesMonitor?.billing?.by_source?.onsite ?? '0.00',
              BillingVideoCollected: salesMonitor?.billing?.by_source?.video ?? '0.00',
              BillingLabCollected: salesMonitor?.billing?.by_source?.lab ?? '0.00',
              BillingRadiologyCollected: salesMonitor?.billing?.by_source?.radiology ?? '0.00',
              BillingPharmacyCollected: salesMonitor?.billing?.by_source?.pharmacy ?? '0.00',
              BillingManualCollected: salesMonitor?.billing?.by_source?.manual ?? '0.00',
              PharmacyNetSales: salesMonitor?.pharmacy_pos?.net_sales ?? '0.00',
              PharmacyTransactions: salesMonitor?.pharmacy_pos?.transactions ?? 0,
              SalesReportsSubmitted: salesMonitor?.sales_reports_submitted ?? 0,
              InvoicesByStatus: JSON.stringify(invoicesByStatus)
          }
      ];
      downloadCSV(summary, `sales_monitoring_${(salesMonitorDate || new Date().toISOString().slice(0, 10))}.csv`);
  };

  const renderContent = () => {
    // -1. DASHBOARD VIEW (Main)
    if (view === "dashboard") {
      const getHueFromString = (value) => {
        const input = String(value || "");
        let hash = 0;
        for (let i = 0; i < input.length; i += 1) {
          hash = (hash * 31 + input.charCodeAt(i)) % 360;
        }
        return hash;
      };

      // Calculate Stats
      const safePatientList = Array.isArray(patientList) ? patientList : [];
      const safeAppointmentEvents = Array.isArray(appointmentEvents) ? appointmentEvents : [];

      const getPatientKeyFromAppointment = (appt) => {
        const email = String(appt?.email || appt?.patientEmail || appt?.patient_email || '').trim().toLowerCase();
        if (email) return `email:${email}`;

        const firstName = String(appt?.firstName || appt?.first_name || '').trim().toLowerCase();
        const lastName = String(appt?.lastName || appt?.last_name || '').trim().toLowerCase();
        const dobRaw = appt?.dateOfBirth || appt?.date_of_birth || null;
        const dob = dobRaw ? new Date(dobRaw) : null;
        const dobKey = dob && !Number.isNaN(dob.getTime()) ? dob.toISOString().slice(0, 10) : '';

        if (firstName || lastName) return `name:${firstName}|${lastName}|${dobKey}`;

        const id = String(appt?.id || '').trim();
        return id ? `appt:${id}` : '';
      };

      // Prepare Chart Data
      // 1. Patient Trend (unique patients with confirmed/approved appointments per day)
      const targetDays = [...Array(dashboardRange)].map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - i);
        return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
      }).reverse();

      const patientTrendData = targetDays.map(targetDate => {
        const startOfDay = new Date(targetDate.year, targetDate.month, targetDate.day, 0, 0, 0, 0);
        const endOfDay = new Date(targetDate.year, targetDate.month, targetDate.day, 23, 59, 59, 999);

        const uniquePatients = new Set();
        safeAppointmentEvents.forEach((appt) => {
          const status = String(appt?.status || '').trim().toLowerCase();
          if (status !== 'confirmed' && status !== 'approved') return;

          const rawDate = appt?.appointmentDate || appt?.appointment_date || null;
          if (!rawDate) return;
          const apptDate = new Date(rawDate);
          if (Number.isNaN(apptDate.getTime())) return;

          if (apptDate.getTime() < startOfDay.getTime() || apptDate.getTime() > endOfDay.getTime()) return;

          const key = getPatientKeyFromAppointment(appt);
          if (!key) return;
          uniquePatients.add(key);
        });

        const count = uniquePatients.size;
        
        const dummyDate = new Date(targetDate.year, targetDate.month, targetDate.day);
        const formatStr = dashboardRange > 7 ? { month: 'short', day: 'numeric' } : { weekday: 'short' };
        return { date: dummyDate.toLocaleDateString(undefined, formatStr), count };
      });

      // 2. Online Staff
      let onlineStaff = staffList.filter(s => s.status === 'Online');
      const currentActiveEmail = localStorage.getItem('tempLoginEmail') || JSON.parse(localStorage.getItem('currentUser') || '{}').email || adminProfile?.email;
      if (currentActiveEmail && !onlineStaff.some(s => s.email === currentActiveEmail)) {
          const dbUser = staffList.find(s => s.email === currentActiveEmail);
          if (dbUser) {
              onlineStaff.push({ ...dbUser, status: 'Online' });
          } else {
              onlineStaff.push({ 
                  firstName: adminProfile?.name?.split(' ')[0] || 'Admin',
                  lastName: adminProfile?.name?.split(' ').slice(1).join(' ') || '',
                  email: currentActiveEmail, 
                  status: 'Online' 
              });
          }
      }

      // Get Recent Data
      const recentPatients = [...safePatientList]
          .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
          .slice(0, 10);
      
      const totalAppointmentsCount = 0; // Placeholder
      
      const wardCapacityBoard = (() => {
        if (Array.isArray(wardRoomRegistry?.wards) && wardRoomRegistry.wards.length > 0 && Array.isArray(wardRoomRegistry?.rooms)) {
          const wards = wardRoomRegistry.wards.map((ward) => {
            const total = Math.max(0, Number(ward?.totalCapacity || ward?.total || 0));
            const occupied = Math.max(0, Number(ward?.occupied || 0));
            const available = Math.max(0, Number(ward?.available || 0));
            const overflow = Math.max(0, Number(ward?.overflow || 0));
            const ratio = total > 0 ? Math.min(1, occupied / total) : 0;
            return {
              id: String(ward?.id || ward?.name || ''),
              name: String(ward?.name || 'Ward'),
              total,
              occupied,
              available,
              reserved: Math.max(0, Number(ward?.reserved || 0)),
              cleaning: Math.max(0, Number(ward?.cleaning || 0)),
              maintenance: Math.max(0, Number(ward?.maintenance || 0)),
              inactive: Math.max(0, Number(ward?.inactive || 0)),
              overflow,
              color: ward?.color || defaultColorForWard(ward?.name),
              ratio,
              statusLabel: getWardStatusLabel(occupied, total)
            };
          });

          const totals = wardRoomRegistry?.totals || {};
          const roomTiles = wardRoomRegistry.rooms.map((room) => ({
            id: String(room?.id || ''),
            wardId:
              String(
                wards.find((ward) => normalizeWardName(ward.name) === normalizeWardName(room?.wardName))?.id ||
                room?.wardName ||
                ''
              ),
            wardName: String(room?.wardName || 'Ward'),
            label: String(room?.roomCode || 'Room'),
            status: normalizeWardName(room?.status) || 'available',
            statusLabel: String(room?.status || 'Available'),
            color: room?.color || defaultColorForWard(room?.wardName),
            manualStatus: String(room?.manualStatus || 'Available'),
            note: String(room?.note || ''),
            patient: room?.patient || null
          }));

          return {
            wards,
            totalRooms: Number(totals?.totalRooms || wards.reduce((sum, ward) => sum + ward.total, 0)),
            occupiedRooms: Number(totals?.occupied || wards.reduce((sum, ward) => sum + ward.occupied, 0)),
            availableRooms: Number(totals?.available || wards.reduce((sum, ward) => sum + ward.available, 0)),
            reservedRooms: Number(totals?.reserved || wards.reduce((sum, ward) => sum + ward.reserved, 0)),
            cleaningRooms: Number(totals?.cleaning || wards.reduce((sum, ward) => sum + ward.cleaning, 0)),
            maintenanceRooms: Number(totals?.maintenance || wards.reduce((sum, ward) => sum + ward.maintenance, 0)),
            overflowRooms: Number(totals?.overflow || wards.reduce((sum, ward) => sum + ward.overflow, 0)),
            criticalWards: wards.filter((ward) => ward.ratio >= 0.8).length,
            roomTiles
          };
        }

        const wardsByPlan = ADMIN_WARD_ROOM_PLAN.map((plannedWard) => {
          const matchedWard = (Array.isArray(wardStatus) ? wardStatus : []).find((ward) => {
            const wardName = normalizeWardName(ward?.name);
            return plannedWard.aliases.some((alias) => wardName.includes(alias));
          });

          const rawOccupied = Math.max(0, Number(matchedWard?.occupied || 0));
          const occupied = Math.min(rawOccupied, plannedWard.total);
          const overflow = Math.max(0, rawOccupied - plannedWard.total);
          const ratio = plannedWard.total > 0 ? occupied / plannedWard.total : 0;

          return {
            ...plannedWard,
            occupied,
            overflow,
            available: Math.max(0, plannedWard.total - occupied),
            ratio,
            statusLabel: getWardStatusLabel(occupied, plannedWard.total)
          };
        });

        const totalRooms = wardsByPlan.reduce((sum, ward) => sum + ward.total, 0);
        const occupiedRooms = wardsByPlan.reduce((sum, ward) => sum + ward.occupied, 0);
        const overflowRooms = wardsByPlan.reduce((sum, ward) => sum + ward.overflow, 0);
        const criticalWards = wardsByPlan.filter((ward) => ward.ratio >= 0.8).length;

        const roomTiles = wardsByPlan.flatMap((ward) =>
          Array.from({ length: ward.total }, (_, index) => {
            const roomIndex = index + 1;
            const roomLabel = `${ward.shortCode}-${String(roomIndex).padStart(2, '0')}`;
            const isOccupied = roomIndex <= ward.occupied;
            return {
              id: `${ward.id}-${roomIndex}`,
              wardId: ward.id,
              wardName: ward.name,
              label: roomLabel,
              status: isOccupied ? 'occupied' : 'available',
              statusLabel: isOccupied ? 'Occupied' : 'Available',
              color: ward.color
            };
          })
        );

        return {
          wards: wardsByPlan,
          totalRooms,
          occupiedRooms,
          availableRooms: Math.max(0, totalRooms - occupiedRooms),
          overflowRooms,
          criticalWards,
          roomTiles
        };
      })();

      const selectedWardDetails = wardCapacityBoard.wards.find((ward) => ward.id === selectedWardCapacity) || null;
      const filteredRoomTiles = selectedWardCapacity === 'all'
        ? wardCapacityBoard.roomTiles
        : wardCapacityBoard.roomTiles.filter((room) => room.wardId === selectedWardCapacity);
      const selectedWardRoom = wardCapacityBoard.roomTiles.find((room) => room.id === selectedWardRoomId) || null;

      const INV_PER_PAGE = 6;
      const filteredInventory =
        inventoryCategory === "All"
          ? inventory
          : inventory.filter((i) => (i.category || "") === inventoryCategory);
      const invTotalPages = Math.max(1, Math.ceil(filteredInventory.length / INV_PER_PAGE));
      const invCurrentPage = Math.min(Math.max(1, inventoryPage), invTotalPages);
      const pagedInventory = filteredInventory.slice(
        (invCurrentPage - 1) * INV_PER_PAGE,
        invCurrentPage * INV_PER_PAGE
      );

      const pendingRestockMedicine = new Set(
        (Array.isArray(restockRequests) ? restockRequests : [])
          .filter((r) => {
            const t = String(r.itemType || r.item_type || '').toLowerCase();
            const s = String(r.status || '').toLowerCase();
            return (t === 'medicine' || t === 'supply') && s === 'pending';
          })
          .map((r) => {
            const t = String(r.itemType || r.item_type || '').toLowerCase();
            const id = String(r.itemId || r.item_id || '');
            return t && id ? `${t}:${id}` : '';
          })
          .filter(Boolean)
      );

      const totalPatients = Number(dashboardStats?.patients?.total || patientList.length || 0);
      const totalStaffCount = Number(staffList.length || 0);
      const todayAppointmentsLocal = safeAppointmentEvents.filter((appt) => {
        const rawDate = appt?.appointmentDate || appt?.appointment_date || null;
        if (!rawDate) return false;
        const d = new Date(rawDate);
        if (Number.isNaN(d.getTime())) return false;
        const now = new Date();
        return d.getFullYear() === now.getFullYear()
          && d.getMonth() === now.getMonth()
          && d.getDate() === now.getDate();
      }).length;
      const totalAppointments = Number(dashboardStats?.appointments?.totalToday || todayAppointmentsLocal || 0);
      const waitingAppointments = Number(dashboardStats?.appointments?.waitingToday || 0);
      const pendingIncidentsCount = incidents.filter((i) => {
        const s = String(i?.status || '').trim().toLowerCase();
        return s !== 'reviewed' && s !== 'resolved';
      }).length;
      const lowStockCount = inventory.filter((i) => isLowStockItem(i)).length;
      const pendingRestockCount = restockRequests.filter((r) => String(r?.status || '').toLowerCase() === 'pending').length;
      const pendingTasksCount = adminTodos.filter((t) => !t.completed).length;
      const activeAnnouncementsCount = announcements.filter((ann) => {
        const expiresAt = ann?.expiresAt || ann?.expires_at;
        if (!expiresAt) return true;
        const d = new Date(expiresAt);
        return Number.isNaN(d.getTime()) ? true : d.getTime() > Date.now();
      }).length;
      const totalTrendPatients = patientTrendData.reduce((sum, item) => sum + Number(item?.count || 0), 0);
      const previousTrendSlice = patientTrendData.slice(0, Math.max(0, patientTrendData.length - Math.ceil(patientTrendData.length / 2)));
      const currentTrendSlice = patientTrendData.slice(-Math.ceil(patientTrendData.length / 2));
      const previousTrendTotal = previousTrendSlice.reduce((sum, item) => sum + Number(item?.count || 0), 0);
      const currentTrendTotal = currentTrendSlice.reduce((sum, item) => sum + Number(item?.count || 0), 0);
      const trendDelta = previousTrendTotal > 0
        ? Math.round(((currentTrendTotal - previousTrendTotal) / previousTrendTotal) * 100)
        : (currentTrendTotal > 0 ? 100 : 0);

      const overviewStats = [
        {
          key: 'patients',
          label: 'Total Patients',
          value: totalPatients,
          tone: 'blue',
          detail: `${Number(dashboardStats?.patients?.newToday || recentPatients.length || 0)} added today`,
          icon: <Users size={18} />
        },
        {
          key: 'appointments',
          label: 'Appointments Today',
          value: totalAppointments,
          tone: 'orange',
          detail: `${waitingAppointments} waiting today`,
          icon: <Calendar size={18} />
        },
        {
          key: 'staff',
          label: 'Staff Online',
          value: onlineStaff.length,
          tone: 'green',
          detail: `${totalStaffCount} total staff records`,
          icon: <ShieldCheck size={18} />
        },
        {
          key: 'announcements',
          label: 'Active Announcements',
          value: activeAnnouncementsCount,
          tone: 'purple',
          detail: `${announcements.filter((ann) => ann?.pinned).length} pinned`,
          icon: <Megaphone size={18} />
        },
        {
          key: 'incidents',
          label: 'Pending Incidents',
          value: pendingIncidentsCount,
          tone: pendingIncidentsCount > 0 ? 'red' : 'slate',
          detail: pendingIncidentsCount > 0 ? 'Live unresolved reports' : 'All clear',
          icon: <AlertCircle size={18} />
        },
        {
          key: 'inventory',
          label: 'Inventory Alerts',
          value: lowStockCount + pendingRestockCount,
          tone: lowStockCount + pendingRestockCount > 0 ? 'amber' : 'slate',
          detail: `${lowStockCount} low stock • ${pendingRestockCount} requests`,
          icon: <Pill size={18} />
        }
      ];

      const quickActions = [
        { key: 'register-staff', label: 'Register Staff', description: 'Create new staff accounts and assign roles.', icon: <UserPlus size={18} />, onClick: () => setView('register-staff') },
        { key: 'post-announcement', label: 'Post Announcement', description: 'Publish hospital-wide operational updates.', icon: <Megaphone size={18} />, onClick: () => window.scrollTo({ top: 0, behavior: 'smooth' }) },
        { key: 'review-incidents', label: 'Review Incidents', description: 'Open unresolved reports and mark progress.', icon: <AlertCircle size={18} />, onClick: () => setView('incidents') },
        { key: 'open-reports', label: 'Open Reports', description: 'Jump to analytics, reports, and exports.', icon: <ClipboardList size={18} />, onClick: () => setView('reports') }
      ];

      const renderAnnouncementsPanel = (extraClassName = '') => (
        <div className={`dashboard-section-card ${extraClassName}`.trim()}>
          <div className="dashboard-section-header">
            <h3 className="dashboard-section-title">
              <Megaphone size={20} className="text-orange-600" /> Announcements
            </h3>
          </div>
          <div className="announcement-input-area">
            <input
              type="text"
              placeholder="Announcement Title"
              className="announcement-input"
              value={newAnnouncement.title}
              onChange={(e) => setNewAnnouncement({ ...newAnnouncement, title: e.target.value })}
            />
            <div className="announcement-actions">
              <select
                className="announcement-select"
                value={newAnnouncement.priority}
                onChange={(e) => setNewAnnouncement({ ...newAnnouncement, priority: e.target.value })}
              >
                <option value="Normal">Normal</option>
                <option value="Urgent">Urgent</option>
                <option value="Info">Info</option>
              </select>
              <input
                type="text"
                placeholder="Message content..."
                className="announcement-input flex-grow"
                value={newAnnouncement.content}
                onChange={(e) => setNewAnnouncement({ ...newAnnouncement, content: e.target.value })}
              />
              <select
                className="announcement-select"
                value={announcementTargets[0] || ''}
                onChange={(e) => setAnnouncementTargets([e.target.value])}
              >
                <option value="">All</option>
                <option value="Doctor">Doctor</option>
                <option value="Nurse">Nurse</option>
                <option value="Staff">Staff</option>
              </select>
              <select
                className="announcement-select"
                value={announcementExpiryDays}
                onChange={(e) => setAnnouncementExpiryDays(e.target.value)}
              >
                <option value="">No expiry</option>
                <option value="1">1 day</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
              </select>
              <label className="ann-pin-toggle">
                <input
                  type="checkbox"
                  checked={announcementPinned}
                  onChange={(e) => setAnnouncementPinned(e.target.checked)}
                />
                <span>Pin</span>
              </label>
              <button className="btn-orange-sm" onClick={handlePostAnnouncement}>Post</button>
            </div>
          </div>
          <div className="announcement-list">
            {announcementsError ? (
              <div className="empty-state-sm">{announcementsError}</div>
            ) : announcements.length === 0 ? (
              <div className="empty-state-sm">No announcements yet.</div>
            ) : (
              (() => {
                const sorted = [...announcements].sort((a, b) => {
                  const ap = a.pinned ? 1 : 0;
                  const bp = b.pinned ? 1 : 0;
                  if (ap !== bp) return bp - ap;
                  const at = new Date(a.createdAt || a.created_at || 0).getTime();
                  const bt = new Date(b.createdAt || b.created_at || 0).getTime();
                  return bt - at;
                });
                const perPage = 3;
                const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
                if (announcementsPage > totalPages) {
                  setTimeout(() => setAnnouncementsPage(totalPages), 0);
                }
                const safePage = Math.min(announcementsPage, totalPages);
                const start = (safePage - 1) * perPage;
                const end = start + perPage;
                const paginated = sorted.slice(start, end);

                return (
                  <>
                    {totalPages > 1 && (
                      <div className="patient-pagination" style={{ alignSelf: 'flex-end', margin: '8px 0 16px' }}>
                        <button
                          type="button"
                          className="patient-page-btn"
                          disabled={safePage === 1}
                          onClick={() => setAnnouncementsPage(p => Math.max(1, p - 1))}
                          aria-label="Previous page"
                        >
                          <ChevronLeft size={18} />
                        </button>
                        <button
                          type="button"
                          className="patient-page-btn"
                          disabled={safePage === totalPages}
                          onClick={() => setAnnouncementsPage(p => Math.min(totalPages, p + 1))}
                          aria-label="Next page"
                        >
                          <ChevronRight size={18} />
                        </button>
                      </div>
                    )}
                    {paginated.map((ann) => {
                      const id = ann.id || ann._id;
                      const priority = String(ann.priority || 'Normal');
                      const pinned = Boolean(ann.pinned);
                      const expiresAt = ann.expiresAt || ann.expires_at || null;
                      const createdAt = ann.createdAt || ann.created_at;
                      const createdText = createdAt ? new Date(createdAt).toLocaleDateString() : '';
                      const expText = expiresAt ? new Date(expiresAt).toLocaleDateString() : '';
                      const target = ann.target || 'All';

                      return (
                        <div key={String(id)} className={`announcement-card priority-${priority.toLowerCase()} ${pinned ? 'ann-pinned' : ''}`}>
                          <div className="announcement-header">
                            <span className="ann-title">{ann.title}</span>
                            <div className="ann-badges">
                              {pinned && <span className="ann-badge badge-pinned">Pinned</span>}
                              <span className={`ann-badge badge-${priority.toLowerCase()}`}>{priority}</span>
                            </div>
                          </div>
                          <p className="ann-content">{ann.content}</p>
                          <div className="ann-footer">
                            <span className="ann-meta">Posted by {ann.author || 'Admin'}{createdText ? ` • ${createdText}` : ''}</span>
                            <span className="ann-meta">Target: {target}</span>
                            {expText ? <span className="ann-meta">Expires: {expText}</span> : null}
                            <div className="ann-footer-actions">
                              <button type="button" className="ann-pin-btn" onClick={() => setViewingAnnouncement(ann)}>
                                View
                              </button>
                              <button
                                type="button"
                                className="ann-pin-btn"
                                onClick={() => updateAnnouncement(id, { pinned: !pinned })}
                              >
                                {pinned ? 'Unpin' : 'Pin'}
                              </button>
                              {expiresAt ? (
                                <button type="button" className="ann-pin-btn" onClick={() => updateAnnouncement(id, { expiresAt: null })}>
                                  Clear expiry
                                </button>
                              ) : null}
                              <button
                                onClick={() => setAnnouncementDeleteConfirmation({ id, title: ann.title })}
                                className="ann-delete-btn"
                                type="button"
                                title="Delete announcement"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                );
              })()
            )}
          </div>
        </div>
      );

      const renderOperationalSnapshotPanel = (extraClassName = '') => (
        <div className={`dashboard-section-card ${extraClassName}`.trim()} style={{ margin: 0 }}>
          <div className="dashboard-section-header">
            <h3 className="dashboard-section-title">
              <Bell size={20} className="text-orange-600" /> Operational Snapshot
            </h3>
            <span className="text-xs text-slate-500 font-medium">{pendingIncidentsCount + pendingRestockCount + lowStockCount} items to monitor</span>
          </div>
          <div className="cmd-list">
            <div className="cmd-item">
              <div className="cmd-item-main">
                <div className="cmd-item-top">
                  <div className="cmd-item-title">Pending approvals and escalations</div>
                  <div className="cmd-badge">{pendingIncidentsCount}</div>
                </div>
                <div className="cmd-item-sub">Incident items still require admin attention.</div>
              </div>
              <div className="cmd-item-actions">
                <button type="button" className="cmd-btn" onClick={() => setView('incidents')}>Open</button>
              </div>
            </div>
            <div className="cmd-item">
              <div className="cmd-item-main">
                <div className="cmd-item-top">
                  <div className="cmd-item-title">Restock queue</div>
                  <div className="cmd-badge">{pendingRestockCount}</div>
                </div>
                <div className="cmd-item-sub">Pharmacy-submitted stock requests waiting for review.</div>
              </div>
              <div className="cmd-item-actions">
                <button type="button" className="cmd-btn" onClick={() => document.getElementById('admin-inventory')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Review</button>
              </div>
            </div>
            <div className="cmd-item">
              <div className="cmd-item-main">
                <div className="cmd-item-top">
                  <div className="cmd-item-title">Care activity this period</div>
                  <div className="cmd-badge">{totalAppointments}</div>
                </div>
                <div className="cmd-item-sub">Appointments, registrations, and patient movement in the current dataset.</div>
              </div>
              <div className="cmd-item-actions">
                <button type="button" className="cmd-btn" onClick={() => setView('reports')}>View reports</button>
              </div>
            </div>
          </div>
        </div>
      );

      const renderPatientTrendPanel = (extraClassName = '') => (
        <div className={`dashboard-section-card ${extraClassName}`.trim()} style={{ height: 'auto', margin: 0 }}>
          <div className="dashboard-section-header">
            <h3 className="dashboard-section-title">
              <Activity size={20} className="text-orange-600" /> Patient Trend
            </h3>
            <select
              className="settings-select"
              style={{ padding: '4px 8px', fontSize: '0.85rem' }}
              value={dashboardRange}
              onChange={(e) => setDashboardRange(Number(e.target.value))}
            >
              <option value={7}>Last 7 Days</option>
              <option value={14}>Last 14 Days</option>
              <option value={30}>Last 30 Days</option>
            </select>
          </div>
          <div className="admin-trend-summary">
            <div className="admin-trend-stat">
              <span className="admin-trend-stat-k">Total patients in range</span>
              <strong className="admin-trend-stat-v">{totalTrendPatients}</strong>
            </div>
            <div className="admin-trend-stat">
              <span className="admin-trend-stat-k">Period comparison</span>
              <strong className={`admin-trend-stat-v ${trendDelta >= 0 ? 'up' : 'down'}`}>
                {trendDelta >= 0 ? `+${trendDelta}%` : `${trendDelta}%`}
              </strong>
            </div>
          </div>
          <div style={{ width: '100%', minHeight: 240, marginTop: '1rem' }}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={patientTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'var(--chart-tick)', fontSize: 12 }} dy={10} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'var(--chart-tick)', fontSize: 12 }} />
                <Tooltip
                  cursor={{ fill: 'var(--chart-cursor)' }}
                  contentStyle={{
                    borderRadius: '10px',
                    border: '1px solid var(--chart-tooltip-border)',
                    background: 'var(--chart-tooltip-bg)',
                    color: 'var(--chart-tooltip-text)',
                    boxShadow: '0 14px 28px rgba(2,6,23,.18)'
                  }}
                />
                <Bar dataKey="count" name="Patients" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  {patientTrendData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.count > 0 ? '#ea580c' : '#fdba74'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      );


      return (
        <div className="staff-management-container admin-dashboard-shell" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          <div className="admin-overview-band">
            <div className="admin-overview-copy">
              <div className="admin-overview-eyebrow">Administrative overview</div>
              <h2 className="admin-overview-title">Monitor operations, respond faster, and keep the hospital team aligned.</h2>
              <p className="admin-overview-subtitle">
                This dashboard brings together patient movement, staff activity, announcements, and operational alerts so the admin side feels like one coordinated control center.
              </p>
            </div>
            <div className="admin-overview-health">
              <div className={`admin-health-pill ${backendHealth.ok ? 'ok' : 'warn'}`}>
                <span className="admin-health-dot" />
                {backendHealth.checked ? (backendHealth.ok ? 'System online' : 'System needs attention') : 'Checking system'}
              </div>
              <div className="admin-health-meta">
                <span>{pendingTasksCount} pending tasks</span>
                <span>{pendingRestockCount} restock requests</span>
              </div>
            </div>
          </div>

          <div className="admin-kpi-grid">
            {overviewStats.map((item) => (
              <div key={item.key} className={`admin-kpi-card tone-${item.tone}`}>
                <div className="admin-kpi-top">
                  <div className="admin-kpi-icon">{item.icon}</div>
                  <div className="admin-kpi-label">{item.label}</div>
                </div>
                <div className="admin-kpi-value">{item.value}</div>
                <div className="admin-kpi-detail">{item.detail}</div>
              </div>
            ))}
          </div>

          <div className="admin-quick-actions-grid">
            {quickActions.map((action) => (
              <button key={action.key} type="button" className="admin-quick-action-card" onClick={action.onClick}>
                <div className="admin-quick-action-icon">{action.icon}</div>
                <div className="admin-quick-action-content">
                  <div className="admin-quick-action-title">{action.label}</div>
                  <div className="admin-quick-action-desc">{action.description}</div>
                </div>
                <ArrowRight size={16} className="admin-quick-action-arrow" />
              </button>
            ))}
          </div>

          <div className="dashboard-grid-asymmetric admin-panel-grid" style={{ alignItems: 'flex-start' }}>
            <div className="admin-dashboard-column admin-dashboard-main-column">
              <div className="dashboard-section-card admin-panel-card" style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
                <div className="dashboard-section-header">
                  <h3 className="dashboard-section-title">
                    <Activity size={20} className="text-red-500" /> Ward Capacity
                  </h3>
                </div>

                <div className="ward-capacity-toolbar">
                  <div>
                    <div className="ward-capacity-toolbar-title">
                      {wardCapacitySection === 'overview' ? 'Ward capacity overview' : 'All ward rooms'}
                    </div>
                    <div className="ward-capacity-toolbar-subtitle">
                      {wardCapacitySection === 'overview'
                        ? 'Use the overview first, then open the room board on the next page when you need room-level control.'
                        : 'Occupied rooms stay patient-driven. Admin can manage reserved, cleaning, and maintenance room states here.'}
                    </div>
                  </div>
                  <div className="ward-capacity-toolbar-actions">
                    <button
                      type="button"
                      className={`ward-capacity-filter-btn ${wardCapacitySection === 'overview' ? 'active' : ''}`}
                      onClick={() => {
                        setWardCapacitySection('overview');
                        setShowAddRoomForm(false);
                        setSelectedWardRoomId('');
                      }}
                    >
                      Overview
                    </button>
                    <button
                      type="button"
                      className={`ward-capacity-filter-btn ${wardCapacitySection === 'rooms' ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedWardCapacity('all');
                        setSelectedWardRoomId('');
                        setShowAddRoomForm(false);
                        setWardCapacitySection('rooms');
                      }}
                    >
                      All ward rooms
                    </button>
                    {wardCapacitySection === 'rooms' ? (
                      <button
                        type="button"
                        className={`ward-capacity-filter-btn ${showAddRoomForm ? 'active' : ''}`}
                        onClick={() => {
                          setShowAddRoomForm((prev) => !prev);
                          setNewRoomError('');
                        }}
                      >
                        {showAddRoomForm ? 'Close add room' : 'Add room'}
                      </button>
                    ) : null}
                  </div>
                </div>

                {wardCapacitySection === 'overview' ? (
                  <>
                    <div className="ward-capacity-summary-grid">
                      <div className="ward-capacity-stat-card">
                        <span className="ward-capacity-stat-label">Total Rooms</span>
                        <strong className="ward-capacity-stat-value">{wardCapacityBoard.totalRooms}</strong>
                        <span className="ward-capacity-stat-meta">Hospital-wide room inventory</span>
                      </div>
                      <div className="ward-capacity-stat-card">
                        <span className="ward-capacity-stat-label">Occupied</span>
                        <strong className="ward-capacity-stat-value">{wardCapacityBoard.occupiedRooms}</strong>
                        <span className="ward-capacity-stat-meta">Patients currently assigned</span>
                      </div>
                      <div className="ward-capacity-stat-card">
                        <span className="ward-capacity-stat-label">Available</span>
                        <strong className="ward-capacity-stat-value">{wardCapacityBoard.availableRooms}</strong>
                        <span className="ward-capacity-stat-meta">Ready for new admissions</span>
                      </div>
                      <div className="ward-capacity-stat-card">
                        <span className="ward-capacity-stat-label">Room Holds</span>
                        <strong className="ward-capacity-stat-value">
                          {Number(wardCapacityBoard.reservedRooms || 0) + Number(wardCapacityBoard.cleaningRooms || 0) + Number(wardCapacityBoard.maintenanceRooms || 0)}
                        </strong>
                        <span className="ward-capacity-stat-meta">
                          {wardCapacityBoard.overflowRooms > 0
                            ? `${wardCapacityBoard.overflowRooms} overflow patient${wardCapacityBoard.overflowRooms > 1 ? 's' : ''} to review`
                            : `${wardCapacityBoard.criticalWards} ward${wardCapacityBoard.criticalWards !== 1 ? 's' : ''} at 80% occupancy or higher`}
                        </span>
                      </div>
                    </div>

                    <div className="ward-grid ward-capacity-grid">
                      {wardCapacityBoard.wards.map((ward) => (
                        <button
                          key={ward.id}
                          type="button"
                          className={`ward-card ward-capacity-card ${selectedWardCapacity === ward.id ? 'active' : ''}`}
                          onClick={() => {
                            setSelectedWardCapacity(ward.id);
                            setSelectedWardRoomId('');
                            setShowAddRoomForm(false);
                            setWardCapacitySection('rooms');
                          }}
                        >
                          <div className="ward-capacity-card-topline">
                            <span className="ward-name">{ward.name}</span>
                            <span
                              className="ward-capacity-badge"
                              style={{ color: ward.color, borderColor: `${ward.color}33`, background: `${ward.color}14` }}
                            >
                              {ward.statusLabel}
                            </span>
                          </div>
                          <div className="ward-info">
                            <span className="ward-count">{ward.occupied}/{ward.total} occupied</span>
                            <span className="ward-capacity-available">{ward.available} open</span>
                          </div>
                          <div className="progress-bar-bg">
                            <div
                              className="progress-fill"
                              style={{
                                width: `${ward.ratio * 100}%`,
                                backgroundColor: ward.color
                              }}
                            ></div>
                          </div>
                          <div className="ward-capacity-footer">
                            <span>{Math.round(ward.ratio * 100)}% in use</span>
                            {ward.overflow > 0 ? (
                              <span className="ward-capacity-overflow">+{ward.overflow} overflow</span>
                            ) : (
                              <span>Open room board</span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}

                {wardCapacitySection === 'rooms' && showAddRoomForm && (
                  <div className="ward-room-editor">
                    <div className="ward-room-editor-header">
                      <div>
                        <div className="ward-room-editor-title">Add new room</div>
                        <div className="ward-room-editor-subtitle">Create another room slot and assign it to the correct ward.</div>
                      </div>
                    </div>
                    <div className="ward-room-editor-grid">
                      <label className="ward-room-field">
                        <span>Room Code</span>
                        <input
                          type="text"
                          value={newRoomForm.roomCode}
                          onChange={(e) => setNewRoomForm((prev) => ({ ...prev, roomCode: e.target.value }))}
                          placeholder="GW-13"
                        />
                      </label>
                      <label className="ward-room-field">
                        <span>Ward</span>
                        <select
                          value={newRoomForm.wardName}
                          onChange={(e) => setNewRoomForm((prev) => ({ ...prev, wardName: e.target.value }))}
                        >
                          {wardCapacityBoard.wards.map((ward) => (
                            <option key={`new-room-ward-${ward.id}`} value={ward.name}>{ward.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="ward-room-field">
                        <span>Starting Status</span>
                        <select
                          value={newRoomForm.status}
                          onChange={(e) => setNewRoomForm((prev) => ({ ...prev, status: e.target.value }))}
                        >
                          <option value="Available">Available</option>
                          <option value="Reserved">Reserved</option>
                          <option value="Cleaning">Cleaning</option>
                          <option value="Maintenance">Maintenance</option>
                          <option value="Inactive">Inactive</option>
                        </select>
                      </label>
                    </div>
                    <label className="ward-room-field">
                      <span>Room Note</span>
                      <textarea
                        rows={3}
                        value={newRoomForm.note}
                        onChange={(e) => setNewRoomForm((prev) => ({ ...prev, note: e.target.value }))}
                        placeholder="Optional prep note for this room."
                      />
                    </label>
                    {newRoomError ? <div className="ward-room-feedback error">{newRoomError}</div> : null}
                    <div className="ward-room-editor-actions">
                      <button type="button" className="btn-white-sm" onClick={() => setShowAddRoomForm(false)}>Cancel</button>
                      <button type="button" className="btn-orange-sm" onClick={handleCreateRoom} disabled={newRoomSaving}>
                        {newRoomSaving ? 'Adding...' : 'Save Room'}
                      </button>
                    </div>
                  </div>
                )}
                {wardCapacitySection === 'rooms' ? (
                <div className="ward-room-board">
                  <div className="ward-room-board-header">
                    <div>
                      <div className="ward-room-board-title">
                        {selectedWardDetails ? `${selectedWardDetails.name} room view` : 'All ward rooms'}
                      </div>
                      <div className="ward-room-board-subtitle">
                        {selectedWardDetails
                          ? `${selectedWardDetails.occupied} occupied, ${selectedWardDetails.available} available in ${selectedWardDetails.name}.`
                          : `Showing all ${wardCapacityBoard.totalRooms} rooms across ICU, General Ward, Pediatrics, and Emergency.`}
                      </div>
                    </div>
                    <div className="ward-room-legend">
                      <span className="ward-room-legend-item"><span className="ward-room-legend-dot occupied"></span>Occupied</span>
                      <span className="ward-room-legend-item"><span className="ward-room-legend-dot available"></span>Available</span>
                      <span className="ward-room-legend-item"><span className="ward-room-legend-dot reserved"></span>Reserved</span>
                      <span className="ward-room-legend-item"><span className="ward-room-legend-dot cleaning"></span>Cleaning</span>
                      <span className="ward-room-legend-item"><span className="ward-room-legend-dot maintenance"></span>Maintenance</span>
                    </div>
                  </div>

                  <div className="ward-room-grid">
                    {filteredRoomTiles.map((room) => (
                      <div
                        key={room.id}
                        className={`ward-room-tile ${room.status} ${selectedWardRoomId === room.id ? 'active' : ''}`}
                        style={{ '--room-accent': room.color }}
                        onClick={() => setSelectedWardRoomId(room.id)}
                      >
                        <div className="ward-room-label">{room.label}</div>
                        <div className="ward-room-ward">{room.wardName}</div>
                        <div className="ward-room-status">{room.statusLabel}</div>
                        {room.patient ? <div className="ward-room-patient">{room.patient.name}</div> : null}
                      </div>
                    ))}
                  </div>

                  {selectedWardRoom ? (
                    <div className="ward-room-editor">
                      <div className="ward-room-editor-header">
                        <div>
                          <div className="ward-room-editor-title">Edit {selectedWardRoom.label}</div>
                          <div className="ward-room-editor-subtitle">
                            {selectedWardRoom.status === 'occupied'
                              ? 'This room is occupied, so patient assignment controls its live occupancy.'
                              : 'Update its operational state to keep live capacity accurate.'}
                          </div>
                        </div>
                        <span className="ward-capacity-badge" style={{ color: selectedWardRoom.color, borderColor: `${selectedWardRoom.color}33`, background: `${selectedWardRoom.color}14` }}>
                          {selectedWardRoom.statusLabel}
                        </span>
                      </div>

                      <div className="ward-room-editor-grid">
                        <label className="ward-room-field">
                          <span>Room Code</span>
                          <input
                            type="text"
                            value={roomEditor.roomCode}
                            onChange={(e) => setRoomEditor((prev) => ({ ...prev, roomCode: e.target.value }))}
                          />
                        </label>
                        <label className="ward-room-field">
                          <span>Ward</span>
                          <select
                            value={roomEditor.wardName}
                            onChange={(e) => setRoomEditor((prev) => ({ ...prev, wardName: e.target.value }))}
                          >
                            {wardCapacityBoard.wards.map((ward) => (
                              <option key={`edit-room-ward-${ward.id}`} value={ward.name}>{ward.name}</option>
                            ))}
                          </select>
                        </label>
                        <label className="ward-room-field">
                          <span>Operational Status</span>
                          <select
                            value={roomEditor.status}
                            onChange={(e) => setRoomEditor((prev) => ({ ...prev, status: e.target.value }))}
                            disabled={selectedWardRoom.status === 'occupied'}
                          >
                            <option value="Available">Available</option>
                            <option value="Reserved">Reserved</option>
                            <option value="Cleaning">Cleaning</option>
                            <option value="Maintenance">Maintenance</option>
                            <option value="Inactive">Inactive</option>
                          </select>
                        </label>
                      </div>

                      <label className="ward-room-field">
                        <span>Room Note</span>
                        <textarea
                          rows={3}
                          value={roomEditor.note}
                          onChange={(e) => setRoomEditor((prev) => ({ ...prev, note: e.target.value }))}
                          placeholder="Leave room-specific preparation or maintenance notes here."
                        />
                      </label>

                      {roomEditorError ? <div className="ward-room-feedback error">{roomEditorError}</div> : null}
                      {roomEditorSuccess ? <div className="ward-room-feedback success">{roomEditorSuccess}</div> : null}

                      <div className="ward-room-editor-actions">
                        <button
                          type="button"
                          className="btn-white-sm"
                          onClick={() => setSelectedWardRoomId('')}
                        >
                          Close
                        </button>
                        <button
                          type="button"
                          className="btn-orange-sm"
                          onClick={handleSaveRoom}
                          disabled={roomSaving}
                        >
                          {roomSaving ? 'Saving...' : 'Save Changes'}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                ) : null}
              </div>

              {renderPatientTrendPanel('admin-panel-card admin-dashboard-feature-card')}

              <div className="dashboard-section-card admin-panel-card" style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
                <div className="dashboard-section-header">
                  <h3 className="dashboard-section-title">
                    <ListTodo size={20} className="text-purple-600" /> My Tasks
                  </h3>
                  <span className="text-xs text-slate-500 font-medium">{adminTodos.filter(t => !t.completed).length} pending</span>
                </div>

                <form onSubmit={handleAddTodo} className="todo-input-group mb-4" noValidate>
                  {newTodoError ? (
                    <div
                      className="text-xs font-medium"
                      style={{
                        marginBottom: '8px',
                        padding: '8px 10px',
                        borderRadius: '8px',
                        background: '#fef2f2',
                        color: '#b91c1c',
                        border: '1px solid #fecaca'
                      }}
                    >
                      {newTodoError}
                    </div>
                  ) : null}
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      id="admin-todo-input"
                      type="text"
                      placeholder="Add a new task..."
                      className="todo-input"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        transition: 'box-shadow 200ms ease, border-color 200ms ease',
                        outline: 'none',
                        border: newTodoError ? '1px solid #fca5a5' : undefined,
                        boxShadow: newTodoError ? '0 0 0 3px rgba(252, 165, 165, 0.25)' : undefined
                      }}
                      value={newTodo}
                      onChange={(e) => {
                        setNewTodo(e.target.value);
                        if (newTodoError) setNewTodoError("");
                      }}
                      aria-invalid={Boolean(newTodoError)}
                      aria-describedby={newTodoError ? "todo-input-error" : undefined}
                    />
                    <button type="submit" className="todo-add-btn" title="Add task" disabled={!String(newTodo || "").trim()}>
                      <Plus size={18} />
                    </button>
                  </div>
                </form>

                <div className="modern-list scrollable-list-y" style={{ flex: 1, minHeight: '350px', maxHeight: '350px' }}>
                  {adminTodos.length === 0 ? (
                    <div className="empty-state-sm">No tasks. Great job!</div>
                  ) : (
                    adminTodos.map((todo) => (
                      <div key={todo.id} className={`todo-item ${todo.completed ? 'completed' : ''}`}>
                        <div
                          className="todo-checkbox"
                          onClick={() => handleToggleTodo(todo.id)}
                        >
                          {todo.completed && <Check size={14} strokeWidth={3} />}
                        </div>
                        <span className="todo-text flex-1" onClick={() => handleToggleTodo(todo.id)}>
                          {todo.text}
                        </span>
                        <button
                          onClick={() => handleDeleteTodo(todo.id)}
                          className="todo-delete-btn"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="admin-dashboard-column admin-dashboard-side-column">
              {renderAnnouncementsPanel('admin-panel-card admin-dashboard-announcements')}

              <div className="dashboard-section-card admin-panel-card compact-activity-card" style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
                <div className="dashboard-section-header">
                  <h3 className="dashboard-section-title">
                    <Activity size={18} className="text-blue-600" /> Recent Activity
                  </h3>
                </div>
                <div className="modern-list compact-list scrollable-list-y admin-dashboard-aligned-list" style={{ flex: 1 }}>
                  {recentActivities.length === 0 ? (
                    <div className="empty-state-sm">No recent activity.</div>
                  ) : (
                    recentActivities.map((log) => (
                      <div key={log.id || log._id} className="modern-list-item compact-item-row">
                        <div className="activity-icon-box">
                          <FileText size={14} />
                        </div>
                        <div className="item-content">
                          <div className="item-title text-sm">{log.action}</div>
                          <div className="item-subtitle text-xs text-muted">
                            {log.details} • {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="dashboard-section-card admin-panel-card compact-activity-card" style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
                <div className="dashboard-section-header">
                  <h3 className="dashboard-section-title">
                    <History size={20} className="text-purple-600" /> Audit Log
                  </h3>
                </div>
                <div className="modern-list scrollable-list-y compact-list" style={{ flex: 1, minHeight: '350px', maxHeight: '350px', overflowY: 'auto' }}>
                  {activityLogs.length === 0 ? (
                    <div className="empty-state-sm">No audit logs.</div>
                  ) : (
                    activityLogs.map((log) => (
                      <div key={log._id} className="modern-list-item compact-item-row">
                        <div className="activity-icon-box">
                          <FileText size={14} />
                        </div>
                        <div className="item-content">
                          <div className="item-title text-sm">{log.action}</div>
                          <div className="item-subtitle text-xs text-muted">
                            {log.details} • {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
          {/* Analytics Row */}
          <div className="admin-analytics-row admin-analytics-row-single">
              <div className="admin-analytics-left">
                {renderOperationalSnapshotPanel('analytics-card admin-dashboard-analytics-snapshot')}

                <div className="dashboard-section-card analytics-card admin-ai-card" style={{ height: 'auto' }}>
                  <div className="dashboard-section-header">
                    <h3 className="dashboard-section-title">
                      <Stethoscope size={20} className="text-orange-600" /> AI-Assisted Symptom Insights
                    </h3>
                    <div className="admin-ai-controls">
                      <input
                        type="month"
                        className="settings-select"
                        value={symptomMonth}
                        max={`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`}
                        onChange={(e) => setSymptomMonth(e.target.value)}
                      />
                      <button
                        className="btn-orange-sm"
                        onClick={() => fetchSymptomInsights({ refresh: true })}
                        disabled={symptomInsightsLoading}
                      >
                        <RefreshCw size={16} />
                        Refresh
                      </button>
                    </div>
                  </div>

                  <div className="admin-ai-body">
                    {symptomInsightsError ? (
                      <div className="empty-state-sm">{symptomInsightsError}</div>
                    ) : symptomInsightsLoading && !symptomInsights ? (
                      <div className="empty-state-sm">Loading insights…</div>
                    ) : !symptomInsights ? (
                      <div className="empty-state-sm">Select a month and refresh to generate insights.</div>
                    ) : (
                      <>
                        <div className="admin-ai-meta">
                          <div className="admin-ai-meta-item">
                            <span className="admin-ai-meta-k">Data completeness</span>
                            <span className="admin-ai-meta-v">{Number(symptomInsights.completenessPct || 0)}%</span>
                          </div>
                          <div className="admin-ai-meta-item">
                            <span className="admin-ai-meta-k">Appointments</span>
                            <span className="admin-ai-meta-v">{Number(symptomInsights.totalAppointments || 0)}</span>
                          </div>
                          <div className="admin-ai-meta-item">
                            <span className="admin-ai-meta-k">Recorded symptoms</span>
                            <span className="admin-ai-meta-v">{Number(symptomInsights.appointmentsWithSymptoms || 0)}</span>
                          </div>
                          <div className="admin-ai-meta-item">
                            <span className="admin-ai-meta-k">Inferred symptoms</span>
                            <span className={`admin-ai-meta-v ${Number(symptomInsights.inferredAppointments || 0) > 0 ? 'warn' : 'ok'}`}>
                              {Number(symptomInsights.inferredAppointments || 0)}
                            </span>
                          </div>
                          <div className="admin-ai-meta-item">
                            <span className="admin-ai-meta-k">Confidence</span>
                            <span className={`admin-ai-meta-v ${['High'].includes(symptomInsights.confidenceLevel) ? 'ok' : 'warn'}`}>
                              {symptomInsights.confidenceLevel || 'Insufficient'}
                            </span>
                          </div>
                        </div>

                        {Array.isArray(symptomInsights.highlights) && symptomInsights.highlights.length ? (
                          <div className="admin-ai-highlights">
                            <div className="admin-ai-highlights-title">What changed</div>
                            <ul className="admin-ai-highlights-list">
                              {symptomInsights.highlights.slice(0, 3).map((h, idx) => (
                                <li key={`hl-${idx}`}>{h}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        <div className="admin-ai-grid">
                          <div className="admin-ai-panel">
                            <div className="admin-ai-panel-title">Top Symptoms</div>
                            {Array.isArray(symptomInsights.topSymptoms) && symptomInsights.topSymptoms.length ? (
                              <div className="admin-ai-toplist">
                                {(() => {
                                  return symptomInsights.topSymptoms.map((s) => {
                                  const count = Number(s.count || 0) || 0;
                                  const pct = Math.max(0, Math.min(100, Number(s.prevalencePct || 0) || 0));
                                  const trend = String(s.trend || '').toLowerCase();
                                  return (
                                    <div key={String(s.symptom)} className="admin-ai-toprow">
                                      <div className="admin-ai-toprow-head">
                                        <div className="admin-ai-symptom">{s.symptom}</div>
                                        <div className={`admin-ai-delta ${trend}`}>
                                          {Number(s.deltaPct || 0) > 0 ? '+' : ''}{Number(s.deltaPct || 0)} pp
                                        </div>
                                      </div>
                                      <div className="admin-ai-bar">
                                        <div className="admin-ai-bar-fill" style={{ width: `${pct}%` }} />
                                      </div>
                                      <div className="admin-ai-count">
                                        {count} appointment{count === 1 ? '' : 's'} ({pct}%) {'\u2022'} {Number(s.recordedCount || 0)} recorded {'\u2022'} {Number(s.inferredCount || 0)} inferred
                                      </div>
                                    </div>
                                  );
                                  });
                                })()}
                              </div>
                            ) : (
                              <div className="empty-state-sm">No symptom data for this month yet.</div>
                            )}
                          </div>

                          <div className="admin-ai-panel">
                            <div className="admin-ai-panel-title">Insights & Recommendations</div>
                            <div className="admin-ai-summary">{symptomInsights.aiSummary || ''}</div>
                            {symptomInsights.dataQualityNote ? (
                              <div className="admin-ai-note">{symptomInsights.dataQualityNote}</div>
                            ) : null}
                            {Array.isArray(symptomInsights.aiRecommendations) && symptomInsights.aiRecommendations.length ? (
                              <div className="admin-ai-recs">
                                {symptomInsights.aiRecommendations.slice(0, 8).map((r, idx) => {
                                  const pr = String(r?.priority || '').toLowerCase();
                                  const badgeBg = pr === 'high' ? '#fee2e2' : pr === 'medium' ? '#ffedd5' : '#e2e8f0';
                                  const badgeFg = pr === 'high' ? '#991b1b' : pr === 'medium' ? '#9a3412' : '#334155';
                                  return (
                                    <div key={`ai-rec-${idx}`} className="admin-ai-rec-block">
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                        <div className="admin-ai-rec-title">{String(r?.title || 'Recommendation')}</div>
                                        <span style={{ background: badgeBg, color: badgeFg, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>
                                          {pr || 'low'}
                                        </span>
                                      </div>
                                      <div style={{ marginTop: 8, color: '#475569', lineHeight: 1.5, fontSize: 13 }}>
                                        {String(r?.action || '')}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : Array.isArray(symptomInsights.recommendations) && symptomInsights.recommendations.length ? (
                              <div className="admin-ai-recs">
                                {symptomInsights.recommendations.map((r) => (
                                  <div key={String(r.symptom)} className="admin-ai-rec-block">
                                    <div className="admin-ai-rec-title">{r.symptom}</div>
                                    {Array.isArray(r.sections) && r.sections.length ? (
                                      <div className="admin-ai-rec-sections">
                                        {r.sections.slice(0, 3).map((sec, sidx) => (
                                          <div key={`${r.symptom}-sec-${sidx}`} className="admin-ai-rec-section">
                                            <div className="admin-ai-rec-section-title">{sec.title}</div>
                                            <ul className="admin-ai-rec-list">
                                              {(Array.isArray(sec.tips) ? sec.tips : []).slice(0, 4).map((tip, idx) => (
                                                <li key={`${r.symptom}-${sidx}-${idx}`}>{tip}</li>
                                              ))}
                                            </ul>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <ul className="admin-ai-rec-list">
                                        {(Array.isArray(r.tips) ? r.tips : []).slice(0, 6).map((tip, idx) => (
                                          <li key={`${r.symptom}-${idx}`}>{tip}</li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="empty-state-sm">No recommendations available.</div>
                            )}
                            <div className="admin-ai-foot">
                              <span>
                                Last updated: {symptomInsights.generatedAt ? new Date(symptomInsights.generatedAt).toLocaleString() : '—'}
                                {symptomInsights.aiGeneratedAt ? ` • AI: ${new Date(symptomInsights.aiGeneratedAt).toLocaleString()}` : ''}
                              </span>
                            </div>
                            <div className="admin-ai-disclaimer">
                              Hybrid AI-assisted operational analytics using normalized recorded symptoms and explainable keyword inference. It supports administrative planning and does not diagnose patients.
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

          </div>

          {viewingAnnouncement && (
            <div className="modern-modal-overlay" onClick={() => setViewingAnnouncement(null)}>
              <div className="modern-modal-card" onClick={(e) => e.stopPropagation()}>
                <div className="staff-profile-head">
                  <div className="staff-profile-title">Announcement</div>
                  <button type="button" className="staff-profile-close" onClick={() => setViewingAnnouncement(null)}>
                    <X size={18} />
                  </button>
                </div>
                <div className="ann-modal-body">
                  {(() => {
                    const id = viewingAnnouncement.id || viewingAnnouncement._id;
                    const priority = String(viewingAnnouncement.priority || 'Normal');
                    const pinned = Boolean(viewingAnnouncement.pinned);
                    const expiresAt = viewingAnnouncement.expiresAt || viewingAnnouncement.expires_at || null;
                    const createdAt = viewingAnnouncement.createdAt || viewingAnnouncement.created_at;
                    const createdText = createdAt ? new Date(createdAt).toLocaleString() : '';
                    const expText = expiresAt ? new Date(expiresAt).toLocaleString() : '';
                    const target = viewingAnnouncement.target || 'All';
                    const author = viewingAnnouncement.author || 'Admin';
                    const title = viewingAnnouncement.title || 'Announcement';
                    const content = String(viewingAnnouncement.content || '');

                    return (
                      <>
                        <div className="announcement-header">
                          <span className="ann-title">{title}</span>
                          <div className="ann-badges">
                            {pinned && <span className="ann-badge badge-pinned">Pinned</span>}
                            <span className={`ann-badge badge-${priority.toLowerCase()}`}>{priority}</span>
                          </div>
                        </div>

                        <div className="ann-modal-meta">
                          <span className="ann-meta">Posted by {author}{createdText ? ` • ${createdText}` : ''}</span>
                          <span className="ann-meta">Target: {target}</span>
                          {expText ? <span className="ann-meta">Expires: {expText}</span> : null}
                          {id ? <span className="ann-meta">ID: {String(id)}</span> : null}
                        </div>

                        <div className="ann-modal-content">{content || '—'}</div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* Command Center */}
          {(() => {
            const normalizeStatus = (v) => String(v || '').trim().toLowerCase();
            const pendingIncidents = incidents.filter((i) => {
              const s = normalizeStatus(i.status);
              return s !== 'reviewed' && s !== 'resolved';
            });
            const lowStock = inventory.filter((it) => isLowStockItem(it));
            const newPatientsFromStats = Number(dashboardStats && dashboardStats.patients && dashboardStats.patients.newToday);
            const newPatientsToday = Number.isFinite(newPatientsFromStats) ? newPatientsFromStats : 0;

            const parseWhen = (v) => {
              if (!v) return null;
              const d = new Date(v);
              return Number.isNaN(d.getTime()) ? null : d;
            };

            const isOverdue = (d, hours) => {
              if (!d) return false;
              return Date.now() - d.getTime() > hours * 60 * 60 * 1000;
            };

            const actionItems = [
              ...pendingIncidents.map((i) => {
                const when = parseWhen(i.incident_date || i.created_at || i.createdAt);
                const overdue = isOverdue(when, Number(opsSettings.incidentOverdueHours) || 24);
                return {
                  kind: 'incident',
                  id: i.id || i._id,
                  title: i.type || 'Incident Report',
                  subtitle: `${i.location || 'Unknown location'} • ${i.reporter || 'Unknown reporter'}`,
                  status: i.status || 'Pending',
                  when,
                  overdue,
                  raw: i
                };
              }),
              ...lowStock.map((it) => {
                const status = it.status || 'Low Stock';
                return {
                  kind: 'inventory',
                  id: it.id || it._id,
                  title: it.name || 'Inventory Item',
                  subtitle: `${it.category || 'Uncategorized'} • ${it.stock ?? 0} left`,
                  status,
                  when: null,
                  overdue: String(status).toLowerCase() === 'out of stock',
                  raw: it
                };
              })
            ]
              .sort((a, b) => {
                const ap = a.overdue ? 1 : 0;
                const bp = b.overdue ? 1 : 0;
                if (ap !== bp) return bp - ap;
                const at = a.when ? a.when.getTime() : 0;
                const bt = b.when ? b.when.getTime() : 0;
                return bt - at;
              })
              .slice(0, 10);

            const scrollToId = (id) => {
              const el = document.getElementById(id);
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            };

            const openInventory = () => {
              setView('dashboard');
              setTimeout(() => scrollToId('admin-inventory'), 50);
            };

            return (
              <div className="dashboard-section-card cmd-center-card" style={{ margin: 0 }}>
                <div className="dashboard-section-header">
                  <h3 className="dashboard-section-title">
                    <LayoutDashboard size={20} className="text-orange-600" /> Command Center
                  </h3>
                  <button
                    type="button"
                    className="link-orange"
                    onClick={() => {
                      fetchDashboardStats();
                      fetchDashboardData();
                    }}
                    title="Refresh"
                  >
                    <RefreshCw size={14} /> Refresh
                  </button>
                </div>
                {dashboardStatsError ? <div className="cmd-empty">{dashboardStatsError}</div> : null}

                <div className="cmd-center-grid">
                  <div className="cmd-kpis">
                    <button type="button" className="cmd-kpi" onClick={() => { setView('incidents'); }}>
                      <div className="cmd-kpi-k">Pending Incidents</div>
                      <div className="cmd-kpi-v">{pendingIncidents.length}</div>
                      <div className="cmd-kpi-sub">Review safety reports</div>
                    </button>
                    <button type="button" className="cmd-kpi" onClick={() => { setView('patient-management'); }}>
                      <div className="cmd-kpi-k">Patients Added Today</div>
                      <div className="cmd-kpi-v">{newPatientsToday}</div>
                      <div className="cmd-kpi-sub">New registrations</div>
                    </button>
                    <button type="button" className="cmd-kpi" onClick={openInventory}>
                      <div className="cmd-kpi-k">Inventory Alerts</div>
                      <div className="cmd-kpi-v">{lowStock.length}</div>
                      <div className="cmd-kpi-sub">Low / out of stock</div>
                    </button>
                    <button type="button" className="cmd-kpi" onClick={() => { setView('staff-management'); }}>
                      <div className="cmd-kpi-k">Staff Online</div>
                      <div className="cmd-kpi-v">{onlineStaff.length}</div>
                      <div className="cmd-kpi-sub">Active sessions</div>
                    </button>
                  </div>

                  <div className="cmd-queue">
                    <div className="cmd-queue-head">
                      <div className="cmd-queue-title">Action Queue</div>
                      <div className="cmd-queue-meta">{actionItems.length} items</div>
                    </div>

                    {actionItems.length === 0 ? (
                      <div className="cmd-empty">No items need attention right now.</div>
                    ) : (
                      <div className="cmd-list">
                        {actionItems.map((it) => {
                          const key = `${it.kind}-${String(it.id)}`;
                          const badge = it.overdue ? 'Overdue' : it.status;
                          const whenText = it.when ? it.when.toLocaleString() : '';
                          const busy = it.kind === 'incident' && String(incidentUpdatingId || '') === String(it.id || '');

                          return (
                            <div key={key} className={`cmd-item ${it.overdue ? 'overdue' : ''}`}>
                              <div className="cmd-item-main">
                                <div className="cmd-item-top">
                                  <div className="cmd-item-title">{it.title}</div>
                                  <div className="cmd-badge">{badge}</div>
                                </div>
                                <div className="cmd-item-sub">{it.subtitle}</div>
                                {whenText ? <div className="cmd-item-time">{whenText}</div> : null}
                              </div>

                              <div className="cmd-item-actions">
                                {it.kind === 'incident' ? (
                                  <>
                                    <button type="button" className="cmd-btn ghost" onClick={() => { setView('incidents'); setIncidentDetails(it.raw); }}>
                                      View
                                    </button>
                                    <button type="button" className="cmd-btn" onClick={() => handleUpdateIncidentStatus(it.id, 'Reviewed')} disabled={busy}>
                                      {busy ? 'Saving…' : 'Mark Reviewed'}
                                    </button>
                                  </>
                                ) : null}
                                {it.kind === 'inventory' ? (
                                  <button type="button" className="cmd-btn" onClick={openInventory}>
                                    View Stock
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          <div id="admin-inventory" className="dashboard-section-card" style={{ margin: 0 }}>
               <div className="dashboard-section-header">
                   <h3 className="dashboard-section-title">
                     <Pill size={20} className="text-emerald-600" /> Restock Requests (From Pharmacy)
                   </h3>
                 <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                   <button className="link-orange" onClick={() => fetchRestockRequests()}>
                     <RefreshCw size={14} /> Refresh Requests
                   </button>
                 </div>
               </div>
               
               {/* Restock Requests Table */}
               <div className="inventory-grid-header" style={{ gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1.2fr' }}>
                   <span>Item Name</span>
                   <span>Type</span>
                   <span>Qty</span>
                   <span>Status</span>
                   <span style={{ textAlign: 'right' }}>Actions</span>
               </div>
               <div className="modern-list scrollable-list-y" style={{ maxHeight: '400px' }}>
                  {restockRequests.length === 0 ? (
                       <div className="empty-state-sm" style={{padding: '2rem'}}>No restock requests from pharmacy.</div>
                   ) : (
                       restockRequests.filter(r => r.status === 'Pending').map((req) => (
                           <div key={req.id} className="inventory-item-row" style={{ gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1.2fr' }}>
                               <div className="inv-name-col">
                                   <span className="inv-name">{req.item_name || req.itemName}</span>
                                   <span className="inv-unit">Requested by {req.requestedBy || 'Pharmacist'}</span>
                               </div>
                               <div className="inv-cat-col">
                                   <span className="inv-category">{req.itemType || 'Item'}</span>
                               </div>
                               <div className="inv-stock-col">
                                   <span className="stock-text" style={{ fontWeight: 800 }}>{req.requestedQty || req.requested_qty} units</span>
                               </div>
                               <div className="inv-status-col">
                                   <span className={`status-badge-table ${req.status === 'Pending' ? 'status-upcoming' : 'status-duty'}`}>
                                       {req.status}
                                   </span>
                               </div>
                               <div className="inv-action-col" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                 <button
                                      className="btn-orange-sm"
                                      onClick={() => handleApproveRestock(req)}
                                      style={{ padding: '4px 12px', fontSize: '0.75rem' }}
                                  >
                                       Approve
                                   </button>
                                   <button
                                      className="btn-gray-sm"
                                      onClick={() => handleRejectRestock(req)}
                                      style={{ padding: '4px 12px', fontSize: '0.75rem', background: '#fee2e2', color: '#b91c1c', border: 'none' }}
                                  >
                                       Reject
                                   </button>
                               </div>
                           </div>
                       ))
                   )}
                   {restockRequests.filter(r => r.status !== 'Pending').length > 0 && (
                     <div style={{ padding: '12px', background: '#f8fafc', fontSize: '0.8rem', fontWeight: 700, color: '#64748b', borderTop: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>
                       RECENTLY PROCESSED
                     </div>
                   )}
                   {restockRequests.filter(r => r.status !== 'Pending').slice(0, 5).map((req) => (
                     <div key={req.id} className="inventory-item-row" style={{ gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1.2fr', opacity: 0.7 }}>
                        <div className="inv-name-col">
                            <span className="inv-name">{req.item_name || req.itemName}</span>
                        </div>
                        <div className="inv-cat-col">
                            <span className="inv-category">{req.itemType}</span>
                        </div>
                        <div className="inv-stock-col">
                            <span className="stock-text">{req.requestedQty} units</span>
                        </div>
                        <div className="inv-status-col">
                            <span className={`status-badge-table ${req.status === 'Approved' ? 'status-duty' : 'status-off'}`}>
                                {req.status}
                            </span>
                        </div>
                        <div className="inv-action-col" style={{ textAlign: 'right', fontSize: '0.7rem', color: '#94a3b8' }}>
                          Processed
                        </div>
                     </div>
                   ))}
               </div>
           </div>
        </div>
      );
    }

    if (view === "doctor-availability") {
      const safeDoctors = Array.isArray(doctorAvailDoctors) ? doctorAvailDoctors : [];
      const safeExceptions = Array.isArray(doctorAvailExceptions) ? doctorAvailExceptions : [];
      const cleanDoctorName = (name) => String(name || '').trim().replace(/^dr\.\s*/i, '');
      const format12hLabel = (time24) => {
        const t = normalizeTimeInput(time24);
        if (!t) return '';
        const hh = parseInt(t.slice(0, 2), 10);
        const mm = t.slice(3, 5);
        const ampm = hh >= 12 ? 'PM' : 'AM';
        const h12 = hh % 12 === 0 ? 12 : hh % 12;
        return `${h12}:${mm} ${ampm}`;
      };
      const timeOptions = [...Array(96)].map((_, i) => {
        const mins = i * 15;
        const hh = Math.floor(mins / 60);
        const mm = mins % 60;
        const value = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
        return { value, label: format12hLabel(value) || value };
      });
      const selectedDoctorMissing = Boolean(doctorAvailDoctorId) && !safeDoctors.some((d) => String(d?.id || '') === String(doctorAvailDoctorId));
      const mergedDoctors = selectedDoctorMissing
        ? [{ id: doctorAvailDoctorId, name: doctorAvailDoctorName || 'Selected Doctor', specialization: '', status: '' }, ...safeDoctors]
        : safeDoctors;
      const scheduleReady = Boolean(doctorAvailDoctorId) && String(doctorAvailLoadedForDoctorId || '') === String(doctorAvailDoctorId);

      return (
        <div className="form-section-container" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="form-section-group" style={{ padding: 18, background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 1000, fontSize: 18, color: '#0f172a' }}>Manage Doctor Availability</div>
                <div style={{ marginTop: 4, color: '#64748b', fontSize: 13 }}>
                  Block specific dates (leave/holiday) or partial clinic hours. Patients won’t be able to book on blocked slots.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  className="white-input"
                  value={doctorAvailMode}
                  onChange={(e) => setDoctorAvailMode(e.target.value)}
                  style={{ width: 180 }}
                >
                  <option value="onsite">Onsite</option>
                </select>
                <button
                  type="button"
                  className="btn-orange-sm"
                  onClick={() => refreshDoctorAvailability({ silent: false, timeoutMs: 60000, doctorId: doctorAvailDoctorId }).catch(() => {})}
                  disabled={doctorAvailLoading || !doctorAvailDoctorId}
                >
                  <RefreshCw size={16} /> Refresh
                </button>
              </div>
            </div>

            {doctorAvailError ? (
              <div style={{ marginTop: 12, background: '#fee2e2', color: '#991b1b', padding: '10px 12px', borderRadius: 10, border: '1px solid #fecaca', fontWeight: 800 }}>
                {doctorAvailError}
              </div>
            ) : null}
            {doctorAvailSuccess ? (
              <div style={{ marginTop: 12, background: '#dcfce7', color: '#166534', padding: '10px 12px', borderRadius: 10, border: '1px solid #bbf7d0', fontWeight: 800 }}>
                {doctorAvailSuccess}
              </div>
            ) : null}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
              <div className="input-group">
                <label>Specialization (optional)</label>
                <select
                  className="white-input"
                  value={doctorAvailSpecialization}
                  onChange={(e) => {
                    setDoctorAvailError('');
                    setDoctorAvailSuccess('');
                    setDoctorAvailSpecialization(e.target.value);
                  }}
                >
                  <option value="">All Specializations</option>
                  {(Array.isArray(doctorAvailSpecializations) ? doctorAvailSpecializations : []).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="input-group">
                <label>Search (optional)</label>
                <input
                  className="white-input"
                  value={doctorAvailQuery}
                  onChange={(e) => {
                    setDoctorAvailError('');
                    setDoctorAvailSuccess('');
                    setDoctorAvailQuery(e.target.value);
                  }}
                  placeholder="Doctor name…"
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
              <div style={{ color: '#64748b', fontSize: 13 }}>
                {doctorAvailDoctorsLoading ? 'Loading…' : safeDoctors.length ? `${safeDoctors.length} found` : 'Type to search doctors'}
              </div>
            </div>

            <div className="input-group" style={{ marginTop: 12 }}>
              <label>Doctor</label>
              <select
                className="white-input"
                value={doctorAvailDoctorId}
                onChange={(e) => {
                  const id = e.target.value;
                  setDoctorAvailError('');
                  setDoctorAvailSuccess('');
                  setDoctorAvailDoctorId(id);
                  if (!id) {
                    setDoctorAvailDoctorName('');
                    setDoctorAvailRules([]);
                    setDoctorAvailExceptions([]);
                    setDoctorAvailDayOffs([]);
                    setDoctorAvailLoadedForDoctorId('');
                    return;
                  }
                  const picked = mergedDoctors.find((d) => String(d?.id || '') === String(id));
                  const pickedName = String(picked?.name || '').trim();
                  if (pickedName) setDoctorAvailDoctorName(pickedName);

                  const cached = id ? doctorAvailCacheRef.current[String(id)] : null;
                  if (cached && typeof cached === 'object') {
                    setDoctorAvailRules(Array.isArray(cached.rules) ? cached.rules : []);
                    setDoctorAvailExceptions(Array.isArray(cached.exceptions) ? cached.exceptions : []);
                    setDoctorAvailDayOffs(Array.isArray(cached.dayOffs) ? cached.dayOffs : []);
                    setDoctorAvailLoadedForDoctorId(String(id));
                  } else {
                    setDoctorAvailLoadedForDoctorId('');
                  }

                  if (id) refreshDoctorAvailability({ silent: false, timeoutMs: 60000, doctorId: id }).catch(() => {});
                }}
              >
                <option value="">{safeDoctors.length ? 'Select doctor…' : 'Load doctors first'}</option>
                <option value="" disabled>
                  Tip: type first letter to jump (e.g. "V" for Vito)
                </option>
                {mergedDoctors.map((d) => (
                  <option key={String(d.id)} value={String(d.id)}>
                    {cleanDoctorName(d.name)}{d.specialization ? ` • ${d.specialization}` : ''}{d.status ? ` • ${d.status}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginTop: 8, color: '#64748b', fontSize: 12 }}>
              Selected: {doctorAvailDoctorName ? `Dr. ${cleanDoctorName(doctorAvailDoctorName)}` : '—'}
            </div>
          </div>

          <div className="form-section-group" style={{ padding: 18, background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0' }}>
            {(() => {
              const sortedExceptions = [...safeExceptions].sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));
              const blockedByDate = new Map(sortedExceptions.map((ex) => [String(ex?.date || '').slice(0, 10), ex]));

              const calendarMonthRaw = String(doctorAvailCalendarMonth || toDateInput(new Date()).slice(0, 7));
              const monthMatch = calendarMonthRaw.match(/^(\d{4})-(\d{2})$/);
              const calYear = monthMatch ? Number(monthMatch[1]) : new Date().getFullYear();
              const calMonth = monthMatch ? Math.max(1, Math.min(12, Number(monthMatch[2]))) : new Date().getMonth() + 1;
              const monthStart = new Date(calYear, calMonth - 1, 1);
              const monthEnd = new Date(calYear, calMonth, 0);
              const monthLabel = monthStart.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
              const monthDateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

              const calendarCells = [];
              const leading = monthStart.getDay();
              for (let i = 0; i < leading; i += 1) calendarCells.push(null);
              for (let d = 1; d <= monthEnd.getDate(); d += 1) calendarCells.push(new Date(calYear, calMonth - 1, d));
              while (calendarCells.length % 7 !== 0) calendarCells.push(null);

              const selectedDateKey = String(doctorAvailAddException.date || '').slice(0, 10);
              const selectedBlocked = blockedByDate.get(selectedDateKey) || null;

              const prevMonth = () => {
                const dt = new Date(calYear, calMonth - 2, 1);
                setDoctorAvailCalendarMonth(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
              };
              const nextMonth = () => {
                const dt = new Date(calYear, calMonth, 1);
                setDoctorAvailCalendarMonth(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
              };

              return (
                <>
                  <div style={{ fontWeight: 1000, fontSize: 16, color: '#0f172a' }}>Blocked Dates</div>
                  <div style={{ marginTop: 4, color: '#64748b', fontSize: 13 }}>
                    Select a day on the calendar, then block the whole day or a specific time range.
                  </div>

                  <div style={{ marginTop: 12, border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, background: '#f8fafc' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                      <button type="button" className="btn-gray shadow-btn" onClick={prevMonth} disabled={doctorAvailSaving}>
                        <ChevronLeft size={16} /> Prev
                      </button>
                      <div style={{ fontWeight: 900, color: '#0f172a' }}>{monthLabel}</div>
                      <button type="button" className="btn-gray shadow-btn" onClick={nextMonth} disabled={doctorAvailSaving}>
                        Next <ChevronRight size={16} />
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                        <div key={day} style={{ fontSize: 11, fontWeight: 900, color: '#64748b', textAlign: 'center', padding: '6px 0' }}>
                          {day}
                        </div>
                      ))}
                      {calendarCells.map((dt, idx) => {
                        if (!dt) return <div key={`blank-${idx}`} />;
                        const key = monthDateKey(dt);
                        const isBlocked = blockedByDate.has(key);
                        const isSelected = key === selectedDateKey;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setDoctorAvailAddException((v) => ({ ...v, date: key }))}
                            disabled={doctorAvailSaving || (!doctorAvailApplyToSpecialization && !scheduleReady)}
                            style={{
                              borderRadius: 10,
                              border: isSelected ? '2px solid #f97316' : '1px solid #cbd5e1',
                              background: isBlocked ? '#fee2e2' : '#fff',
                              color: '#0f172a',
                              fontWeight: 900,
                              minHeight: 40,
                              cursor: doctorAvailSaving || (!doctorAvailApplyToSpecialization && !scheduleReady) ? 'not-allowed' : 'pointer',
                              position: 'relative'
                            }}
                            title={isBlocked ? 'Blocked' : 'Available'}
                          >
                            {dt.getDate()}
                            {isBlocked ? <span style={{ position: 'absolute', top: 4, right: 6, fontSize: 10, color: '#b91c1c' }}>●</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr 2fr auto auto', gap: 10, marginTop: 12, alignItems: 'end' }}>
                    <div className="input-group" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10, gridColumn: '1 / -1' }}>
                      <input
                        type="checkbox"
                        checked={doctorAvailApplyToSpecialization}
                        onChange={(e) => setDoctorAvailApplyToSpecialization(e.target.checked)}
                        disabled={doctorAvailSaving}
                        style={{ width: 18, height: 18 }}
                      />
                      <div style={{ fontSize: 13, fontWeight: 900, color: '#0f172a', lineHeight: 1.2 }}>
                        Block all doctors in selected specialization
                      </div>
                      <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
                        {doctorAvailSpecialization ? doctorAvailSpecialization : 'Select specialization above'}
                      </div>
                    </div>
                    <div className="input-group" style={{ margin: 0 }}>
                      <label>Date</label>
                      <input
                        className="white-input"
                        type="date"
                        value={doctorAvailAddException.date}
                        onChange={(e) => {
                          setDoctorAvailError('');
                          setDoctorAvailAddException((v) => ({ ...v, date: e.target.value }));
                        }}
                        disabled={doctorAvailSaving || (!doctorAvailApplyToSpecialization && !scheduleReady)}
                      />
                    </div>
                    <div className="input-group" style={{ margin: 0 }}>
                      <label>Start (optional)</label>
                      <select
                        className="white-input"
                        value={normalizeTimeInput(doctorAvailAddException.startTime) || ''}
                        onChange={(e) => {
                          setDoctorAvailError('');
                          setDoctorAvailAddException((v) => ({ ...v, startTime: e.target.value }));
                        }}
                        disabled={doctorAvailSaving || (!doctorAvailApplyToSpecialization && !scheduleReady)}
                      >
                        <option value="">—</option>
                        {timeOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div className="input-group" style={{ margin: 0 }}>
                      <label>End (optional)</label>
                      <select
                        className="white-input"
                        value={normalizeTimeInput(doctorAvailAddException.endTime) || ''}
                        onChange={(e) => {
                          setDoctorAvailError('');
                          setDoctorAvailAddException((v) => ({ ...v, endTime: e.target.value }));
                        }}
                        disabled={doctorAvailSaving || (!doctorAvailApplyToSpecialization && !scheduleReady)}
                      >
                        <option value="">—</option>
                        {timeOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div className="input-group" style={{ margin: 0 }}>
                      <label>Note (optional)</label>
                      <input
                        className="white-input"
                        value={doctorAvailAddException.note}
                        onChange={(e) => {
                          setDoctorAvailError('');
                          setDoctorAvailAddException((v) => ({ ...v, note: e.target.value }));
                        }}
                        placeholder="e.g. Conference / Leave"
                        disabled={doctorAvailSaving || (!doctorAvailApplyToSpecialization && !scheduleReady)}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-orange-sm"
                      onClick={addDoctorAvailabilityException}
                      disabled={doctorAvailSaving || (doctorAvailApplyToSpecialization ? !doctorAvailSpecialization : (!doctorAvailDoctorId || !scheduleReady))}
                    >
                      <Plus size={16} /> Block
                    </button>
                    <button
                      type="button"
                      className="btn-gray shadow-btn"
                      onClick={() => {
                        if (doctorAvailApplyToSpecialization) deleteDoctorAvailabilityExceptionsBulk({ date: selectedDateKey });
                        else if (selectedBlocked) deleteDoctorAvailabilityException(selectedBlocked.id);
                      }}
                      disabled={
                        doctorAvailSaving ||
                        (doctorAvailApplyToSpecialization ? (!doctorAvailSpecialization || !selectedDateKey) : (!scheduleReady || !selectedBlocked))
                      }
                    >
                      <Trash2 size={16} /> Unblock
                    </button>
                  </div>

                  <div style={{ marginTop: 12, border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr 2fr auto', gap: 0, padding: '10px 12px', background: '#f8fafc', fontSize: 12, fontWeight: 900, color: '#64748b' }}>
                      <div>Date</div>
                      <div>Start</div>
                      <div>End</div>
                      <div>Note</div>
                      <div style={{ textAlign: 'right' }}>Action</div>
                    </div>
                    {sortedExceptions.length === 0 ? (
                      <div style={{ padding: 12, color: '#64748b' }}>{doctorAvailDoctorId ? 'No blocked dates yet.' : 'Select a doctor first.'}</div>
                    ) : (
                      sortedExceptions.map((ex) => {
                        const start = normalizeTimeInput(ex.startTime);
                        const end = normalizeTimeInput(ex.endTime);
                        return (
                          <div key={String(ex.id)} style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr 2fr auto', padding: '10px 12px', borderTop: '1px solid #f1f5f9', alignItems: 'center', gap: 10 }}>
                            <div style={{ fontWeight: 900, color: '#0f172a' }}>{String(ex.date || '').slice(0, 10) || '—'}</div>
                            <div style={{ color: '#334155' }}>{start ? format12hLabel(start) : '—'}</div>
                            <div style={{ color: '#334155' }}>{end ? format12hLabel(end) : '—'}</div>
                            <div style={{ color: '#64748b' }}>{String(ex.note || '').trim() || '—'}</div>
                            <div style={{ textAlign: 'right' }}>
                              <button type="button" className="btn-gray shadow-btn" onClick={() => deleteDoctorAvailabilityException(ex.id)} disabled={doctorAvailSaving}>
                                <Trash2 size={16} /> Delete
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              );
            })()}
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
                {adminProfile.profilePicture ? (
                  <img src={adminProfile.profilePicture} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <User size={64} color="#cbd5e1" />
                )}
              </div>
              <input
                ref={adminAvatarInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleAdminAvatarPick}
              />
              <button type="button" className="btn-neutral-sm shadow-btn" onClick={() => adminAvatarInputRef.current && adminAvatarInputRef.current.click()}>
                Update Avatar
              </button>
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
                    <User size={20} color="#475569" />
                    Personal Information
                  </h3>
                  
                  <div className="profile-input-group">
                    <label>Email Address</label>
                    <div className="input-wrapper-relative">
                      <Mail size={18} className="absolute-icon-left text-slate-400" />
                      <input 
                        type="email" 
                        name="email"
                        value={adminProfile.email}
                        readOnly
                        className="profile-input input-with-icon-padding input-disabled-bg"
                      />
                    </div>
                    {emailNoticeField === "admin-email" && emailNotice && (
                      <p className="field-notice-error">{emailNotice}</p>
                    )}
                  </div>

                  <div className="profile-input-group">
                    <label>Department / Role</label>
                    <div className="input-wrapper-relative">
                      <Briefcase size={18} className="absolute-icon-left text-slate-400" />
                      <input 
                        type="text" 
                        name="department"
                        value={adminProfile.department}
                        onChange={handleAdminProfileChange}
                        onKeyDown={(e) => handleNameInput(e, "admin-department")}
                        className="profile-input input-with-icon-padding"
                        placeholder="e.g. Administration"
                      />
                    </div>
                    {nameNoticeField === "admin-department" && nameNotice && (
                      <p className="field-notice-error">{nameNotice}</p>
                    )}
                  </div>

                  <div className="profile-input-group">
                    <label>Phone Number</label>
                    <div className="input-wrapper-relative">
                      <Phone size={18} className="absolute-icon-left text-slate-400" />
                      <input 
                        type="tel" 
                        name="phone"
                        value={adminProfile.phone}
                        onChange={handleAdminProfileChange}
                        onKeyDown={(e) => handlePhoneInput(e, "admin-phone")}
                        className="profile-input input-with-icon-padding"
                        placeholder="+63 900 000 0000"
                      />
                    </div>
                    {phoneNoticeField === "admin-phone" && phoneNotice && (
                      <p className="field-notice-error">{phoneNotice}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="profile-column">
                <div className="profile-card">
                  <h3 className="column-title">
                    <Shield size={20} color="#475569" />
                    Security & Password
                  </h3>
                  
                  <div className="profile-input-group">
                    <label>Current Password</label>
                    <div className="input-wrapper-relative">
                      <Key size={18} className="absolute-icon-left text-slate-400" />
                      <input 
                        type={showCurrentPassword ? "text" : "password"}
                        name="currentPassword"
                        value={adminProfile.currentPassword}
                        onChange={handleAdminProfileChange}
                        className="profile-input input-with-icon-padding"
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
                      <Key size={18} className="absolute-icon-left text-slate-400" />
                      <input 
                        type={showNewPassword ? "text" : "password"}
                        name="newPassword"
                        value={adminProfile.newPassword}
                        onChange={handleAdminProfileChange}
                        className="profile-input input-with-icon-padding"
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

                  <div className="profile-input-group">
                    <label>Confirm New Password</label>
                    <div className="input-wrapper-relative">
                      <Key size={18} className="absolute-icon-left text-slate-400" />
                      <input 
                        type={showConfirmPassword ? "text" : "password"}
                        name="confirmNewPassword"
                        value={adminProfile.confirmNewPassword}
                        onChange={handleAdminProfileChange}
                        className="profile-input input-with-icon-padding"
                        placeholder="Confirm new password"
                      />
                      <button 
                        type="button"
                        className="toggle-password-btn"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      >
                        {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                      </button>
                    </div>
                    {adminProfile.confirmNewPassword && (
                      <p className={`match-indicator ${adminProfile.newPassword === adminProfile.confirmNewPassword ? 'match-success' : 'match-error'}`}>
                        {adminProfile.newPassword === adminProfile.confirmNewPassword ? 'Passwords match' : 'Passwords do not match'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="form-actions-row staff-registration-actions">
              {updateNotice && (
                <p className="form-notice-error form-notice-error-text">{updateNotice}</p>
              )}
              <button type="submit" className="btn-neutral-large flex-center-gap-8">
                <Save size={18} />
                Save Changes
              </button>
            </div>
          </form>
        </div>
      );
    }

    // 2. STAFF REGISTRATION VIEW
    if (view === "register-staff") {
      const medicalRoles = ['Doctor', 'Nurse', 'Pharmacist'];
      return (
        <div className="patient-form-container staff-registration-shell">
          <form className="compact-form staff-registration-form" onSubmit={handleCreateStaff} id="staff-wizard-form">
            <div className="staff-registration-intro">
              <div>
                <span className="staff-registration-eyebrow">Staff onboarding</span>
                <h2>Create a staff account</h2>
                <p>Complete the personal, professional, and account information in one workspace.</p>
              </div>
              <div className="staff-registration-status"><ShieldCheck size={18} /> Secure administrator action</div>
            </div>

            <div className="staff-registration-horizontal-grid">
            <div className="form-section-container staff-registration-column staff-registration-personal">
              <div className="form-grid-main">
                <div className="form-left-col">
                  <h3 className="section-title">Personal Information</h3>
                  <div className="form-grid-2-col">
                    <div className="input-group">
                      <label>First Name</label>
                      <input
                        type="text"
                        name="firstName"
                        value={staffFormData.firstName}
                        onChange={handleStaffFormChange}
                        required
                        onKeyDown={(e) => handleNameInput(e, "staff-first-name")}
                      />
                      {nameNoticeField === "staff-first-name" && nameNotice && (
                        <p className="field-notice-error">{nameNotice}</p>
                      )}
                    </div>
                    <div className="input-group">
                      <label>Last Name</label>
                      <input
                        type="text"
                        name="lastName"
                        value={staffFormData.lastName}
                        onChange={handleStaffFormChange}
                        required
                        onKeyDown={(e) => handleNameInput(e, "staff-last-name")}
                      />
                      {nameNoticeField === "staff-last-name" && nameNotice && (
                        <p className="field-notice-error">{nameNotice}</p>
                      )}
                    </div>
                    <div className="input-group">
                      <label>Middle Name</label>
                      <input
                        type="text"
                        name="middleName"
                        value={staffFormData.middleName}
                        onChange={handleStaffFormChange}
                        required
                        onKeyDown={(e) => handleNameInput(e, "staff-middle-name")}
                      />
                      {nameNoticeField === "staff-middle-name" && nameNotice && (
                        <p className="field-notice-error">{nameNotice}</p>
                      )}
                    </div>
                    <div className="input-group">
                      <label>Date of Birth</label>
                      <input 
                        type="date" 
                        name="dateOfBirth" 
                        className="white-input" 
                        value={staffFormData.dateOfBirth}
                        required 
                        max={new Date().toISOString().split('T')[0]}
                        onChange={(e) => {
                            handleStaffFormChange(e);
                            handleDateChange(e, "staff-dob");
                        }}
                      />
                      {ageNoticeField === "staff-dob" && ageNotice && (
                        <p className="field-notice-error">{ageNotice}</p>
                      )}
                    </div>
                    <div className="input-group">
                      <label>Gender</label>
                      <select className="white-input" name="gender" required value={staffFormData.gender} onChange={handleStaffFormChange}>
                        <option value="">Select Gender</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div className="input-group">
                      <label>Civil Status</label>
                      <select className="white-input" name="civilStatus" required value={staffFormData.civilStatus} onChange={handleStaffFormChange}>
                        <option value="">Select Status</option>
                        <option value="Single">Single</option>
                        <option value="Married">Married</option>
                        <option value="Widowed">Widowed</option>
                        <option value="Separated">Separated</option>
                      </select>
                    </div>
                    <div className="input-group">
                      <label>Nationality</label>
                      <select className="white-input" name="nationality" required value={staffFormData.nationality} onChange={handleStaffFormChange}>
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
              </div>
            </div>

            <div className="form-section-container staff-registration-column staff-registration-professional">
              <div className="form-section-group" style={{ padding: '24px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', width: '100%' }}>
                <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #cbd5e1', paddingBottom: '12px', marginBottom: '24px' }}>
                  <Award size={22} className="text-blue-600" />
                  Professional Information
                </h3>
                <div className="form-grid-2-col">
                  <div className="input-group">
                    <label>Employee ID</label>
                    <input 
                      type="text" 
                      name="employeeId"
                      value={staffFormData.employeeId}
                      readOnly
                      required 
                      className="white-input input-disabled-bg"
                      placeholder="Auto-generated"
                    />
                    <p style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '4px' }}>Generated automatically upon next step.</p>
                  </div>
                  
                  <div className="input-group">
                    <label>Role</label>
                    <select 
                      className="white-input" 
                      name="role" 
                      value={staffFormData.role}
                      onChange={handleStaffFormChange}
                      required
                    >
                      <option value="">Select Staff Role</option>
                      <option value="Doctor">Doctor</option>
                      <option value="Nurse">Nurse</option>
                      <option value="Pharmacist">Pharmacist</option>
                      <option value="Office Staff">Office Staff</option>
                      <option value="Clinical Staff">Clinical Staff</option>
                    </select>
                  </div>

                  <div className="input-group">
                    <label>Medical License Number</label>
                    <input 
                      type="text" 
                      name="medicalLicenseNumber"
                      value={staffFormData.medicalLicenseNumber}
                      onChange={handleStaffFormChange}
                      className="white-input"
                      placeholder="e.g. 1234567"
                      onKeyDown={(e) => handleMedicalLicenseInput(e, "medical-license")}
                    />
                    {medicalLicenseNoticeField === "medical-license" && medicalLicenseNotice && (
                      <p className="field-notice-error">{medicalLicenseNotice}</p>
                    )}
                  </div>

                  <div className="input-group">
                    <label>Specialization</label>
                    <select 
                      name="specialization"
                      className="white-input" 
                      value={staffFormData.specialization}
                      onChange={handleStaffFormChange}
                      required={Boolean(staffFormData.role)}
                      disabled={!staffFormData.role}
                    >
                      <option value="">{staffFormData.role ? "Select Specialization" : "Select role first"}</option>
                      {(specializationOptionsByRole[staffFormData.role] || []).map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>

                  {(String(staffFormData.role || '').trim() === 'Doctor' &&
                    String(staffFormData.specialization || '').trim() === 'Medicine') ? (
                    <div className="input-group">
                      <label>Department <span style={{color: '#ef4444'}}>*</span></label>
                      <select
                        name="department"
                        className="white-input"
                        value={staffFormData.department}
                        onChange={handleStaffFormChange}
                        required
                      >
                        <option value="">Select Department</option>
                        <option value="ER">ER</option>
                        <option value="OPD/Medicine">OPD/Medicine</option>
                      </select>
                      <p style={{margin: '6px 0 0 0', fontSize: '0.8rem', color: '#64748b', fontWeight: 700}}>
                        Medicine doctors must be tagged as ER duty or OPD/Medicine for correct queue routing.
                      </p>
                    </div>
                  ) : null}

                  {(() => {
                    const spec = String(staffFormData.specialization || '').trim();
                    const show = ['Office Staff', 'Staff'].includes(String(staffFormData.role || '').trim()) &&
                      (spec === "Doctor's Secretary" || spec === 'Doctor Secretary');
                    if (!show) return null;
                    return (
                    <>
                      <div className="input-group">
                        <label>Linked Doctor</label>
                        <select
                          name="linkedDoctorId"
                          className="white-input"
                          value={staffFormData.linkedDoctorId}
                          onChange={handleStaffFormChange}
                          required
                        >
                          <option value="">
                            {secretaryDoctorsLoading ? 'Loading doctors…' : 'Select Doctor'}
                          </option>
                          {secretaryDoctors.map((d) => (
                            <option key={String(d.id || d.email || d.name)} value={String(d.id || '')}>
                              {String(d.name || '').trim() || String(d.email || '').trim() || 'Doctor'}
                            </option>
                          ))}
                        </select>
                        {secretaryDoctorsError ? (
                          <p className="field-notice-error">{secretaryDoctorsError}</p>
                        ) : null}
                      </div>
                      <div className="input-group">
                        <label>Doctor Specialization</label>
                        <input
                          type="text"
                          className="white-input"
                          value={String(selectedLinkedDoctor?.specialization || '')}
                          readOnly
                          placeholder="Select doctor first"
                        />
                      </div>
                    </>
                    );
                  })()}

                  <div className="input-group">
                    <label>Date Hired</label>
                    <input 
                      type="date" 
                      name="dateHired" 
                      className="white-input" 
                      value={staffFormData.dateHired}
                      onChange={(e) => {
                        handleStaffFormChange(e);
                        handleDateHiredChange(e, "staff-date-hired");
                      }}
                      required 
                      max={new Date().toISOString().split("T")[0]}
                    />
                    {dateHiredNoticeField === "staff-date-hired" && dateHiredNotice && (
                      <p className="field-notice-error">{dateHiredNotice}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="form-section-container staff-registration-column staff-registration-account" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              <div className="form-section-group" style={{ padding: '24px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #cbd5e1', paddingBottom: '12px', marginBottom: '24px' }}>
                  <Shield size={22} className="text-orange-600" />
                  Account Credentials
                </h3>
                <div className="form-grid-2-col">
                  <div className="input-group">
                    <label>Email Address</label>
                    <input 
                      type="email" 
                      name="email"
                      value={staffFormData.email}
                      required 
                      className="white-input"
                      onKeyDown={(e) => handleEmailInput(e, "staff-email")}
                      onChange={(e) => {
                        handleUncontrolledEmailChange(e, "staff-email");
                        handleStaffFormChange(e);
                      }}
                      placeholder="e.g. staff@pascualcare.com"
                    />
                    {emailNoticeField === "staff-email" && emailNotice && (
                      <p className="field-notice-error" style={{ marginTop: '4px' }}>{emailNotice}</p>
                    )}
                  </div>
                  <div className="input-group" style={{ display: 'flex', alignItems: 'center' }}>
                      <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0, padding: '10px 14px', background: '#eff6ff', borderRadius: '8px', border: '1px solid #dbeafe', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <AlertCircle size={16} className="text-blue-500" />
                          A temporary secure password will be auto-generated and emailed to this address.
                      </p>
                  </div>
                </div>
              </div>

              <div className="form-section-group" style={{ padding: '24px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #cbd5e1', paddingBottom: '12px', marginBottom: '24px' }}>
                  <MapPin size={22} className="text-emerald-600" />
                  Contact Information
                </h3>
                <div className="form-grid-3-col">
                  <div className="input-group">
                    <label>Phone Number</label>
                    <input
                      type="text"
                      name="phone"
                      className="white-input"
                      value={staffFormData.phone}
                      onChange={handleStaffFormChange}
                      placeholder="09XXXXXXXXX"
                      required
                      onKeyDown={(e) => handlePhoneInput(e, "staff-phone")}
                    />
                    {phoneNoticeField === "staff-phone" && phoneNotice && (
                      <p className="field-notice-error">{phoneNotice}</p>
                    )}
                  </div>
                  <div className="input-group">
                    <label>Street Address</label>
                    <input
                      type="text"
                      name="streetAddress"
                      className="white-input"
                      value={staffFormData.streetAddress}
                      onChange={handleStaffFormChange}
                      placeholder="House No., Street Name, Barangay"
                      required
                      onKeyDown={(e) => handleAddressInput(e, "staff-address")}
                    />
                    {addressNoticeField === "staff-address" && addressNotice && (
                      <p className="field-notice-error">{addressNotice}</p>
                    )}
                  </div>
                  <div className="input-group">
                    <label>City / Municipality</label>
                    <select className="white-input" name="city" required onChange={handleCityChange} value={staffFormData.city || selectedCity}>
                      <option value="">Select City</option>
                      {ncrCalabarzonCities.map((item, index) => (
                        <option key={index} value={item.city}>{item.city}</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group">
                    <label>Province</label>
                    <input type="text" name="province" className="white-input input-disabled-bg" value={staffFormData.province || selectedProvince} readOnly />
                  </div>
                  <div className="input-group">
                    <label>Postal Code</label>
                    <input type="text" name="postalCode" className="white-input input-disabled-bg" value={staffFormData.postalCode || postalCode} readOnly />
                  </div>
                </div>
              </div>
            </div>
            </div>

            {createStaffError && (
                <div className="field-notice-error" style={{ whiteSpace: 'pre-line', marginBottom: '16px', fontWeight: 'bold', textAlign: 'center', background: '#fef2f2', padding: '12px', borderRadius: '8px', border: '1px solid #fecaca' }}>
                  {createStaffError}
                  {(/already\s+registered|already\s+exists|duplicate/i.test(String(createStaffError)) && String(staffFormData.email || '').trim()) ? (
                    <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'center' }}>
                      <button
                        type="button"
                        className="btn-gray shadow-btn"
                        onClick={handleForceRemoveEmail}
                        disabled={purgeEmailLoading}
                      >
                        {purgeEmailLoading ? 'Removing…' : 'Force Remove Email'}
                      </button>
                    </div>
                  ) : null}
                </div>
            )}
            {createStaffSuccess && (
                <div style={{ color: '#16a34a', whiteSpace: 'pre-line', marginBottom: '16px', fontWeight: 'bold', textAlign: 'center', background: '#dcfce7', padding: '12px', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                  {createStaffSuccess}
                </div>
            )}

            {/* Visible explanation if Next / Create button is disabled */}
            {!isValidRegisterStep && registerStepBlockers.length > 0 && (
              <div style={{
                marginBottom: '16px',
                padding: '14px 16px',
                borderRadius: '10px',
                border: '1px solid #fed7aa',
                background: '#fff7ed',
                color: '#9a3412',
                fontSize: '0.88rem',
                textAlign: 'left'
              }}>
                <div style={{ fontWeight: 700, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <AlertCircle size={16} /> Please complete these fields first before proceeding:
                </div>
                <ul style={{ margin: '6px 0 0', paddingLeft: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '4px 16px' }}>
                  {registerStepBlockers.map((b, i) => (
                    <li key={i} style={{ color: '#7c2d12' }}>• {b}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="form-actions-row">
              {registrationStep > 1 && (
                <button type="button" className="btn-gray shadow-btn" onClick={() => setRegistrationStep(prev => prev - 1)} disabled={createStaffLoading}>Back</button>
              )}
              {registrationStep < 3 ? (
                <button type="button" className="btn-orange-large shadow-btn" onClick={handleNextStep} disabled={createStaffLoading || !isValidRegisterStep}>
                  {createStaffLoading ? 'Processing…' : 'Next'}
                </button>
              ) : (
                <button
                  type="submit"
                  className="shadow-btn staff-registration-submit"
                  style={{ width: 'auto', minWidth: '160px', flex: '0 0 auto' }}
                  disabled={createStaffLoading || !isValidRegisterStep}
                >
                  {createStaffLoading ? '⏳ Creating Staff Account…' : 'Create Staff Account'}
                </button>
              )}
              <button type="button" className="btn-gray shadow-btn" onClick={handleReset} disabled={createStaffLoading}>
                {createStaffLoading ? 'Busy…' : 'Remove All'}
              </button>
            </div>
          </form>
        </div>
      );
    }

    // 3. PATIENT REGISTRATION VIEW
    // Patient registration view removed as requested.

    // 4. PATIENT MANAGEMENT VIEW
    if (view === "patient-management") {
      const PATIENTS_PER_PAGE = 9;
      const q = String(searchTerm || '').trim().toLowerCase();
      const g = 'All'; // Gender filter removed for simplification

      const filteredPatients = []; // Patient list removed

      const totalPages = Math.max(1, Math.ceil(filteredPatients.length / PATIENTS_PER_PAGE));
      const currentPage = Math.min(Math.max(1, patientPage), totalPages);
      const startIndex = (currentPage - 1) * PATIENTS_PER_PAGE;
      const pagedPatients = filteredPatients.slice(startIndex, startIndex + PATIENTS_PER_PAGE);

      return (
        <div className="staff-management-container patient-management-container">
           <div className="page-header-container mt-12">
             <div className="flex-col">
               {/* Duplicate Header Removed */}
               <p className="text-slate-500">Manage and monitor patient records</p>
             </div>
             <div className="patient-controls-row">
              {/* Search and filter controls removed */}
             </div>
           </div>

           <div className="patient-card-list">
                <div className="empty-state-box">
                    <User size={48} className="opacity-30 mb-4" />
                    <p className="text-slate-500 text-lg">Patient management is handled by the admin staff.</p>
                  </div>
           </div>
        </div>
      );
    }

    // 4.5 INCIDENTS VIEW
    if (view === "incidents") {
      const filteredIncidents = incidents.filter(inc => {
        const q = incidentSearch.toLowerCase();
        return (inc.type || inc.incident_type || '').toLowerCase().includes(q) || 
               (inc.location || '').toLowerCase().includes(q) ||
               (inc.reporter || inc.created_by_email || '').toLowerCase().includes(q);
      });
      const incFrom = parseDateStart(incidentDateFrom);
      const incTo = parseDateEnd(incidentDateTo);
      const rangedIncidents = filteredIncidents.filter((inc) => {
        if (!incFrom && !incTo) return true;
        const d = new Date(inc.incident_date || inc.created_at || inc.createdAt || 0);
        if (Number.isNaN(d.getTime())) return false;
        return withinRange(d, incFrom, incTo);
      });

      const incidentStats = (() => {
        const total = incidents.length;
        const reviewed = incidents.filter((i) => {
          const v = String(i.status || '').toLowerCase();
          return v === 'reviewed' || v === 'resolved';
        }).length;
        const pending = total - reviewed;
        return { total, pending, reviewed };
      })();

      const statusTone = (s) => {
        const v = String(s || '').toLowerCase();
        if (v === 'reviewed' || v === 'resolved') return 'reviewed';
        if (v === 'pending' || v === 'submitted') return 'pending';
        if (v === 'processing') return 'processing';
        return 'default';
      };

      return (
        <div className="staff-management-container">
          <div className="inc-header">
            <div className="inc-header-left">
              <div className="inc-title-row">
                <div className="inc-title">Incident Reports</div>
                <span className="inc-count">{incidentStats.total} total</span>
              </div>
              <div className="inc-subtitle">Review safety incidents reported by staff</div>
              <div className="inc-stats">
                <div className="inc-stat">
                  <span className="inc-stat-k">Pending</span>
                  <span className="inc-stat-v">{incidentStats.pending}</span>
                </div>
                <div className="inc-stat">
                  <span className="inc-stat-k">Reviewed</span>
                  <span className="inc-stat-v">{incidentStats.reviewed}</span>
                </div>
              </div>
            </div>
            <div className="inc-header-right">
              <div className="input-wrapper-relative inc-search">
                <Search size={18} className="absolute-icon-left text-slate-400" />
                <input
                  type="text"
                  value={incidentSearch}
                  onChange={(e) => setIncidentSearch(e.target.value)}
                  className="search-input-with-icon"
                  placeholder="Search incidents..."
                />
              </div>
              <div className="inc-date-range">
                <input
                  type="date"
                  className="patient-filter-select"
                  value={incidentDateFrom}
                  onChange={(e) => setIncidentDateFrom(e.target.value)}
                />
                <input
                  type="date"
                  className="patient-filter-select"
                  value={incidentDateTo}
                  onChange={(e) => setIncidentDateTo(e.target.value)}
                />
              </div>
              <button type="button" className="inc-btn inc-btn-ghost inc-btn-icon" onClick={fetchIncidents} disabled={incidentsLoading} title="Refresh">
                <RefreshCw size={16} />
              </button>
              <div className="inc-menu" tabIndex={0} onBlur={() => setIncidentActionsOpen(false)}>
                <button
                  type="button"
                  className="inc-btn inc-btn-ghost"
                  onClick={() => setIncidentActionsOpen((v) => !v)}
                  disabled={incidentsLoading}
                >
                  <Download size={16} />
                  Export
                  <ChevronDown size={16} />
                </button>
                {incidentActionsOpen && (
                  <div className="inc-menu-pop">
                    <button
                      type="button"
                      className="inc-menu-item"
                      onClick={() => {
                        setIncidentActionsOpen(false);
                        exportIncidentReport(rangedIncidents);
                      }}
                      disabled={incidentsLoading || rangedIncidents.length === 0}
                    >
                      Export CSV
                    </button>
                    <button
                      type="button"
                      className="inc-menu-item"
                      onClick={() => {
                        setIncidentActionsOpen(false);
                        const data = rangedIncidents.map((i) => ({
                          Date: i.date || (i.incident_date ? new Date(i.incident_date).toLocaleDateString() : ''),
                          Time: i.time || (i.incident_time ? new Date(i.incident_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''),
                          Type: i.type || i.incident_type || '',
                          Location: i.location || '',
                          Reporter: i.reporter || i.created_by_email || '',
                          Status: i.status || '',
                          Description: i.description || '',
                          ActionTaken: i.action_taken || i.actionTaken || ''
                        }));
                        printTableReport('Incident Reports', 'Filtered report', Object.keys(data[0] || {}), data);
                      }}
                      disabled={incidentsLoading || rangedIncidents.length === 0}
                    >
                      Print
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="inc-card">
            {incidentsError ? (
              <div className="inc-empty">{incidentsError}</div>
            ) : incidentsLoading ? (
              <div className="inc-empty">Loading incidents...</div>
            ) : rangedIncidents.length === 0 ? (
              <div className="inc-empty">
                <AlertCircle size={44} className="inc-empty-icon" />
                <div className="inc-empty-title">No incident reports found</div>
                <div className="inc-empty-sub">Try clearing the search or refresh.</div>
              </div>
            ) : (
              <div className="inc-table-wrap">
                <table className="inc-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Location</th>
                      <th>Reporter</th>
                      <th>Status</th>
                      <th className="inc-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rangedIncidents.map((inc) => {
                      const isReviewed = (() => {
                        const v = String(inc.status || '').toLowerCase();
                        return v === 'reviewed' || v === 'resolved';
                      })();
                      const busy = incidentUpdatingId === inc.id;
                      return (
                        <tr key={inc.id}>
                          <td>
                            <div className="inc-date">{inc.date}</div>
                            <div className="inc-time">{inc.time}</div>
                          </td>
                          <td>
                            <span className="inc-pill inc-pill-type">{inc.type}</span>
                          </td>
                          <td className="inc-muted">{inc.location || '—'}</td>
                          <td className="inc-muted">{inc.reporter || '—'}</td>
                          <td>
                            <span className={`inc-pill inc-pill-status ${statusTone(inc.status)}`}>
                              {inc.status || 'Pending'}
                            </span>
                          </td>
                          <td className="inc-right">
                            <div className="inc-actions">
                              <button type="button" className="inc-btn inc-btn-ghost" onClick={() => setIncidentDetails(inc)}>
                                <Eye size={16} />
                                View
                              </button>
                              <button
                                type="button"
                                className={`inc-btn ${isReviewed ? 'inc-btn-disabled' : 'inc-btn-primary'}`}
                                onClick={() => handleUpdateIncidentStatus(inc.id, 'Reviewed')}
                                disabled={isReviewed || busy}
                              >
                                <Check size={16} />
                                {busy ? 'Saving…' : (isReviewed ? 'Reviewed' : 'Mark Reviewed')}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      );
    }

    // 5. STAFF MANAGEMENT VIEW
    if (view === "staff-management") {
      const STAFF_PER_PAGE = 10;
      const q = String(staffSearchTerm || '').trim().toLowerCase();
      const g = String(staffGenderFilter || 'All').toLowerCase();
      const r = String(staffRoleFilter || 'All').toLowerCase();
      const st = String(staffStatusFilter || 'All').toLowerCase();

      const filteredStaff = staffList.filter((s) => {
        const fullName = `${s.firstName || ""} ${s.lastName || ""}`.trim().toLowerCase();
        const email = (s.email || "").toLowerCase();
        const roleInfo = getStaffRoleInfo(s);
        const roleLabel = roleInfo.label.toLowerCase();
        const roleKey = roleInfo.key.toLowerCase();
        const empId = (s.employeeId || "").toString().toLowerCase();
        const phone = (s.phone || "").toString().toLowerCase();
        const sg = String(s.gender || "").toLowerCase();
        const ss = String(s.status || "Offline").toLowerCase();

        const matchesSearch = !q || (
          fullName.includes(q) ||
          email.includes(q) ||
          roleLabel.includes(q) ||
          roleKey.includes(q) ||
          empId.includes(q) ||
          phone.includes(q)
        );

        const matchesGender = g === 'all' ? true : sg === g;
        const matchesRole = r === 'all' ? true : roleKey === r;
        const matchesStatus = st === 'all' ? true : ss === st;
        return matchesSearch && matchesGender && matchesRole && matchesStatus;
      });

      const sortedStaff = [...filteredStaff].sort((a, b) => {
        const mode = String(staffSort || 'Newest');
        if (mode === 'Name (A-Z)') {
          const an = `${a.firstName || ''} ${a.lastName || ''}`.trim().toLowerCase();
          const bn = `${b.firstName || ''} ${b.lastName || ''}`.trim().toLowerCase();
          return an.localeCompare(bn);
        }
        if (mode === 'Role') {
          const ar = getStaffRoleInfo(a).label.toLowerCase();
          const br = getStaffRoleInfo(b).label.toLowerCase();
          return ar.localeCompare(br);
        }
        if (mode === 'Status') {
          const ar = String(a.status || 'Offline').toLowerCase();
          const br = String(b.status || 'Offline').toLowerCase();
          return ar.localeCompare(br);
        }
        const at = new Date(a.created_at || a.createdAt || 0).getTime();
        const bt = new Date(b.created_at || b.createdAt || 0).getTime();
        return bt - at;
      });

      const totalPages = Math.max(1, Math.ceil(sortedStaff.length / STAFF_PER_PAGE));
      const currentPage = Math.min(Math.max(1, staffPage), totalPages);
      const startIndex = (currentPage - 1) * STAFF_PER_PAGE;
      const pagedStaff = sortedStaff.slice(startIndex, startIndex + STAFF_PER_PAGE);

      return (
        <div className="staff-management-container patient-management-container">
          {staffError ? <div className="admin-alert error">{staffError}</div> : null}
          <div className="page-header-container staff-header">
            <div className="staff-header-left">
              <p className="staff-header-sub">Manage staff accounts and contact details</p>
            </div>
            <div className="patient-controls-row staff-toolbar">
              <div className="input-wrapper-relative">
                <Search size={18} className="absolute-icon-left text-slate-400" />
                <input
                  type="text"
                  value={staffSearchTerm}
                  onChange={(e) => {
                    setStaffSearchTerm(e.target.value);
                    setStaffPage(1);
                  }}
                  className="search-input-with-icon"
                  placeholder="Search staff..."
                />
              </div>

              <select
                className="patient-filter-select"
                value={staffGenderFilter}
                onChange={(e) => {
                  setStaffGenderFilter(e.target.value);
                  setStaffPage(1);
                }}
              >
                <option value="All">All</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>

              <select
                className="patient-filter-select"
                value={staffRoleFilter}
                onChange={(e) => {
                  setStaffRoleFilter(e.target.value);
                  setStaffPage(1);
                }}
              >
                <option value="All">All Roles</option>
                <option value="staff">Staff</option>
                <option value="nurse">Nurse</option>
                <option value="doctor">Doctor</option>
                <option value="pharmacist">Pharmacist</option>
                <option value="cashier">Cashier</option>
                <option value="doctor_secretary">Doctor Secretary</option>
                <option value="medtech">MedTech</option>
                <option value="radiographer">Radiographer</option>
                <option value="ecg_operator">ECG Operator</option>
                <option value="physical_therapist">Physical Therapist</option>
                <option value="admin">Admin</option>
              </select>

              <select
                className="patient-filter-select"
                value={staffStatusFilter}
                onChange={(e) => {
                  setStaffStatusFilter(e.target.value);
                  setStaffPage(1);
                }}
              >
                <option value="All">All Status</option>
                <option value="Online">Online</option>
                <option value="Offline">Offline</option>
              </select>

              <select
                className="patient-filter-select"
                value={staffSort}
                onChange={(e) => {
                  setStaffSort(e.target.value);
                  setStaffPage(1);
                }}
              >
                <option value="Newest">Newest</option>
                <option value="Name (A-Z)">Name (A-Z)</option>
                <option value="Role">Role</option>
                <option value="Status">Status</option>
              </select>

              <button className="staff-export-btn" onClick={exportStaffReport} type="button">
                <Download size={16} />
                <span className="staff-export-label">Export</span>
                <span className="staff-export-chip">CSV</span>
              </button>

              <div className="patient-pagination">
                <button
                  type="button"
                  className="patient-page-btn"
                  onClick={() => setStaffPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={18} />
                </button>

                <button
                  type="button"
                  className="patient-page-btn"
                  onClick={() => setStaffPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  aria-label="Next page"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
             </div>
           </div>

          <div className="dashboard-section-card admin-shell-card" style={{ maxHeight: 'calc(100vh - 220px)', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
            <div className="logs-table-container">
              <table className="staff-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Employee ID</th>
                    <th>Contact</th>
                    <th>Status</th>
                    <th className="inc-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedStaff.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="text-center py-8 text-slate-500">
                        No staff members found.
                      </td>
                    </tr>
                  ) : (
                    pagedStaff.map((staff) => {
                      const fullName = `${staff.firstName || ""} ${staff.lastName || ""}`.trim() || "Staff Member";
                      const email = staff.email || "No email";
                      const roleInfo = getStaffRoleInfo(staff);
                      const roleText = roleInfo.label;
                      const linkedDoctorName = staff?.linkedDoctor?.name ? String(staff.linkedDoctor.name) : '';
                      const employeeId = staff.employeeId || "N/A";
                      const phone = staff.phone || "N/A";
                      const status = staff.status || "Offline";
                      const tone = status === 'Online' ? 'status-duty' : 'status-off';

                      return (
                        <tr key={staff.id}>
                          <td>
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600">
                                {(fullName || "S")[0].toUpperCase()}
                              </div>
                              <span className="text-sm font-medium">{fullName}</span>
                            </div>
                          </td>
                          <td className="text-sm text-slate-600">{email}</td>
                          <td className="text-sm font-medium text-slate-700">
                            <div>{roleText}</div>
                            {(roleInfo.key === 'doctor_secretary' && linkedDoctorName) ? (
                              <div className="text-xs text-slate-500">{linkedDoctorName}</div>
                            ) : null}
                          </td>
                          <td className="text-sm text-slate-600">{employeeId}</td>
                          <td className="text-sm text-slate-600">{phone}</td>
                          <td>
                            <span className={`status-badge-table ${tone}`}>{status}</span>
                          </td>
                          <td className="inc-right">
                            <div className="inc-actions">
                              <button type="button" className="inc-btn inc-btn-ghost" onClick={() => setViewingStaff(staff)}>
                                <EyeIcon size={16} />
                                View
                              </button>
                              <button type="button" className="inc-btn inc-btn-ghost" onClick={() => handleEditStaff(staff)}>
                                <Edit size={16} />
                                Edit
                              </button>
                              <button type="button" className="inc-btn inc-btn-ghost" onClick={() => handleDeleteStaff(staff.id)}>
                                <Trash2 size={16} />
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

           {editingStaff && (
            <div className="modern-modal-overlay">
              <div className="modern-modal-card">
                <div className="mm-header">
                  <div className="mm-header-simple">
                    <div>
                      <h3 className="mm-title">Edit Staff Member</h3>
                      <p className="mm-subtitle">Update staff account and contact information</p>
                    </div>
                    <button className="mm-close-btn" onClick={handleCancelEdit} type="button">
                      <X size={20} />
                    </button>
                  </div>
                </div>

                <form id="staff-edit-form" onSubmit={handleSaveStaff} className="form-flex-wrapper">
                  <div className="mm-content mm-content-edit">
                    <div className="mm-section">
                      <div className="mm-section-title">Staff Details</div>
                      <div className="form-grid-2-col">
                        <div className="input-group">
                          <label className="form-label">First Name</label>
                          <input
                            type="text"
                            name="firstName"
                            value={editFormData.firstName}
                            onChange={handleEditFormChange}
                            onKeyDown={(e) => handleNameInput(e, "edit-firstName")}
                            required
                            className="white-input"
                          />
                          {nameNoticeField === "edit-firstName" && nameNotice && (
                            <p className="field-notice-error">{nameNotice}</p>
                          )}
                        </div>
                        <div className="input-group">
                          <label className="form-label">Last Name</label>
                          <input
                            type="text"
                            name="lastName"
                            value={editFormData.lastName}
                            onChange={handleEditFormChange}
                            onKeyDown={(e) => handleNameInput(e, "edit-lastName")}
                            required
                            className="white-input"
                          />
                          {nameNoticeField === "edit-lastName" && nameNotice && (
                            <p className="field-notice-error">{nameNotice}</p>
                          )}
                        </div>
                      </div>

                      <div className="form-grid-2-col mt-4">
                        <div className="input-group">
                          <label className="form-label">Account Group</label>
                          <select
                            name="role"
                            value={editFormData.role}
                            disabled
                            className="white-input input-disabled-bg"
                          >
                            <option value="">Select Role</option>
                            <option value="Admin">Admin</option>
                            <option value="Doctor">Doctor</option>
                            <option value="Nurse">Nurse</option>
                            <option value="Pharmacist">Pharmacist</option>
                            <option value="Office Staff">Office Staff</option>
                            <option value="Clinical Staff">Clinical Staff</option>
                            <option value="Staff">Staff</option>
                          </select>
                        </div>
                        <div className="input-group">
                          <label className="form-label">Current Sub-role / Specialization</label>
                          <input
                            type="text"
                            value={editFormData.specialization || ''}
                            readOnly
                            className="white-input input-disabled-bg"
                          />
                        </div>
                      </div>
                      <p className="field-notice" style={{ marginTop: 8 }}>
                        Account group and sub-role are shown for verification. Use the dedicated account-role workflow for role migration.
                      </p>
                    </div>

                    <div className="mm-section">
                      <div className="mm-section-title">Contact Information</div>
                      <div className="form-grid-2-col">
                        <div className="input-group">
                          <label className="form-label">Email</label>
                          <input
                            type="email"
                            name="email"
                            value={editFormData.email}
                            onChange={handleEditFormChange}
                            onKeyDown={(e) => handleEmailInput(e, "edit-email")}
                            required
                            className="white-input"
                          />
                          {emailNoticeField === "edit-email" && emailNotice && (
                            <p className="field-notice-error" style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '4px' }}>{emailNotice}</p>
                          )}
                        </div>
                        <div className="input-group">
                          <label className="form-label">Phone Number</label>
                          <input
                            type="tel"
                            name="phone"
                            value={editFormData.phone}
                            onChange={handleEditFormChange}
                            onKeyDown={(e) => handlePhoneInput(e, "edit-phone")}
                            required
                            className="white-input"
                          />
                          {phoneNoticeField === "edit-phone" && phoneNotice && (
                            <p className="field-notice-error" style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '4px' }}>{phoneNotice}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mm-footer">
                    <button type="button" className="btn-modal-cancel" onClick={handleCancelEdit}>Cancel</button>
                    <button type="submit" className="btn-modal-save">Save Changes</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      );
    }

    // 5. NURSE DASHBOARD VIEW
    if (view === "dashboard-nurse") { // This view is not used in Admin, but kept for reference
      return (
        <div className="staff-management-container">
           <div className="nurse-dashboard-grid">
              {/* Shift Roster */}
              <div className="table-card-padded">
                  <div className="roster-header">
                      <h3 className="section-title section-title-no-margin">Nurse Shift Roster (Today)</h3>
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
                              <td><span className="status-badge-table status-duty">On Duty</span></td>
                          </tr>
                          <tr>
                              <td>John Smith</td>
                              <td>6:00 AM - 2:00 PM</td>
                              <td>ICU</td>
                              <td><span className="status-badge-table status-duty">On Duty</span></td>
                          </tr>
                          <tr>
                              <td>Maria Garcia</td>
                              <td>2:00 PM - 10:00 PM</td>
                              <td>Ward A</td>
                              <td><span className="status-badge-table status-upcoming">Upcoming</span></td>
                          </tr>
                          <tr>
                              <td>Alex Brown</td>
                              <td>10:00 PM - 6:00 AM</td>
                              <td>Pediatrics</td>
                              <td><span className="status-badge-table status-scheduled">Scheduled</span></td>
                          </tr>
                      </tbody>
                  </table>
              </div>

              {/* Quick Announcements/Tasks */}
              <div className="dashboard-side-column">
                  <div className="table-card-padded flex-1">
                      <h3 className="section-title">Announcements</h3>
                      <div className="announcement-list">
                          <div className="announcement-item urgent">
                              <p className="announcement-title">Staff Meeting</p>
                              <p className="announcement-desc">General assembly at 3:00 PM in Conference Room B.</p>
                          </div>
                          <div className="announcement-item info">
                              <p className="announcement-title">Protocol Update</p>
                              <p className="announcement-desc">New sanitation guidelines effective immediately.</p>
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
        const LOGS_PER_PAGE = 12;
        const filteredLogs = logFilter === 'All'
            ? activityLogs
            : activityLogs.filter(log => {
                if (logFilter === 'Create') return log.action.includes('Create') || log.action.includes('Register');
                if (logFilter === 'Update') return log.action.includes('Update') || log.action.includes('Edit');
                if (logFilter === 'Delete') return log.action.includes('Delete') || log.action.includes('Remove');
                return log.action === logFilter;
            });
        const logFrom = parseDateStart(logDateFrom);
        const logTo = parseDateEnd(logDateTo);
        const rangedLogs = filteredLogs.filter((l) => {
          if (!logFrom && !logTo) return true;
          const d = new Date(l.timestamp || 0);
          if (Number.isNaN(d.getTime())) return false;
          return withinRange(d, logFrom, logTo);
        });

        const totalPages = Math.max(1, Math.ceil(rangedLogs.length / LOGS_PER_PAGE));
        const currentPage = Math.min(Math.max(1, logPage), totalPages);
        const startIndex = (currentPage - 1) * LOGS_PER_PAGE;
        const pagedLogs = rangedLogs.slice(startIndex, startIndex + LOGS_PER_PAGE);

        return (
            <div className="staff-management-container">
                <div className="dashboard-section-card admin-shell-card" style={{ maxHeight: 'calc(100vh - 140px)', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
                    <div className="request-header">
                        <div className="flex-col">
                            <h3 className="section-title text-lg section-title-no-margin">System Activity Logs</h3>
                            <p className="text-slate-500 text-sm">Audit trail of all system actions</p>
                        </div>
                        
                        <div className="patient-controls-row">
                            <select
                                className="patient-filter-select"
                                value={logFilter}
                                onChange={(e) => {
                                    setLogFilter(e.target.value);
                                    setLogPage(1);
                                }}
                            >
                                <option value="All">All</option>
                                <option value="Create">Create</option>
                                <option value="Update">Update</option>
                                <option value="Delete">Delete</option>
                                <option value="Login">Login</option>
                            </select>
                            <input
                              type="date"
                              className="patient-filter-select"
                              value={logDateFrom}
                              onChange={(e) => { setLogDateFrom(e.target.value); setLogPage(1); }}
                            />
                            <input
                              type="date"
                              className="patient-filter-select"
                              value={logDateTo}
                              onChange={(e) => { setLogDateTo(e.target.value); setLogPage(1); }}
                            />
                            <button
                              type="button"
                              className="inc-btn inc-btn-ghost"
                              onClick={async () => {
                                try {
                                  const rows = await fetchActivityLogsForExport(logDateFrom, logDateTo);
                                  exportActivityReport(rows);
                                } catch (_) {
                                  setModalType("error");
                                  setSuccessMessage("Failed to export activity logs. Please check the server.");
                                  setShowSuccessModal(true);
                                }
                              }}
                              disabled={Boolean(activityLogsError)}
                            >
                              <Download size={16} />
                              Export All
                            </button>
                            <button
                              type="button"
                              className="inc-btn inc-btn-ghost"
                              onClick={() => {
                                const data = rangedLogs.map((l) => ({
                                  Time: new Date(l.timestamp).toLocaleString(),
                                  Actor: l.actorName,
                                  Action: l.action,
                                  Target: l.target,
                                  Details: l.details
                                }));
                                printTableReport('System Activity Logs', 'Filtered report', Object.keys(data[0] || {}), data);
                              }}
                              disabled={rangedLogs.length === 0}
                            >
                              <Download size={16} />
                              Print
                            </button>

                            <div className="patient-pagination">
                                <button
                                    type="button"
                                    className="patient-page-btn"
                                    onClick={() => setLogPage((p) => Math.max(1, p - 1))}
                                    disabled={currentPage <= 1}
                                    aria-label="Previous page"
                                >
                                    <ChevronLeft size={18} />
                                </button>

                                <button
                                    type="button"
                                    className="patient-page-btn"
                                    onClick={() => setLogPage((p) => Math.min(totalPages, p + 1))}
                                    disabled={currentPage >= totalPages}
                                    aria-label="Next page"
                                >
                                    <ChevronRight size={18} />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="logs-table-container">
                        <table className="staff-table">
                            <thead>
                                <tr>
                                    <th>Time</th>
                                    <th>Actor</th>
                                    <th>Action</th>
                                    <th>Target</th>
                                    <th>Details</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activityLogsError ? (
                                    <tr>
                                        <td colSpan="5" className="text-center py-8 text-slate-500">
                                            {activityLogsError}
                                        </td>
                                    </tr>
                                ) : rangedLogs.length === 0 ? (
                                    <tr>
                                        <td colSpan="5" className="text-center py-8 text-slate-500">
                                            No activity logs found.
                                        </td>
                                    </tr>
                                ) : (
                                    pagedLogs.map(log => (
                                        <tr key={log.id || log._id}>
                                            <td className="whitespace-nowrap text-sm text-slate-500">
                                                {new Date(log.timestamp).toLocaleString()}
                                            </td>
                                            <td>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600">
                                                        {(log.actorName || "A")[0].toUpperCase()}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="text-sm font-medium">{log.actorName}</span>
                                                        <span className="text-xs text-slate-400">{log.role}</span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td>
                                                <span className={`status-badge-table ${
                                                    log.action.includes('Create') ? 'status-duty' : 
                                                    log.action.includes('Delete') ? 'status-off' : 
                                                    log.action.includes('Update') ? 'status-upcoming' : 'status-scheduled'
                                                }`}>
                                                    {log.action}
                                                </span>
                                            </td>
                                            <td className="text-sm font-medium text-slate-700">{log.target || "-"}</td>
                                            <td className="text-sm text-slate-600 max-w-xs truncate" title={log.details}>
                                                {log.details}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    }

    // 8. REPORTS VIEW
    if (view === "reports") {
        const repFrom = parseDateStart(reportsDateFrom);
        const repTo = parseDateEnd(reportsDateTo);
        const reportIncidents = incidents.filter((i) => {
          const d = new Date(i.incident_date || i.created_at || i.createdAt || 0);
          if (!repFrom && !repTo) return true;
          if (Number.isNaN(d.getTime())) return false;
          return withinRange(d, repFrom, repTo);
        });
        const reportLogs = activityLogs.filter((l) => {
          const d = new Date(l.timestamp || 0);
          if (!repFrom && !repTo) return true;
          if (Number.isNaN(d.getTime())) return false;
          return withinRange(d, repFrom, repTo);
        });

        return (
            <div className="staff-management-container">
                <div className="settings-header-container">
                    <h2 className="settings-page-title">Reports & Analytics</h2>
                    <p className="settings-page-subtitle">Generate and download comprehensive system reports.</p>
                </div>

                <div className="dashboard-grid-equal-2">
                    <div className="dashboard-section-card col-span-2" style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="dashboard-section-header">
                            <h3 className="dashboard-section-title">
                                <BarChart size={20} className="text-emerald-600" /> Sales Monitoring
                            </h3>
                        </div>
                        <div className="patient-controls-row" style={{ flexWrap: 'wrap', justifyContent: 'space-between', gap: '10px' }}>
                          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <input
                              type="date"
                              className="patient-filter-select"
                              value={salesMonitorDate}
                              onChange={(e) => setSalesMonitorDate(e.target.value)}
                            />
                            <button
                              className="btn-gray"
                              style={{ padding: '10px 16px' }}
                              onClick={() => fetchSalesMonitoring({ date: salesMonitorDate })}
                              disabled={salesMonitorLoading}
                            >
                              <RefreshCw size={16} /> Refresh
                            </button>
                          </div>
                          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <button
                              className="btn-orange-sm shadow-sm"
                              onClick={exportSalesMonitoringReport}
                              disabled={salesMonitorLoading || !salesMonitor}
                            >
                              <Download size={16} /> Sales CSV
                            </button>
                          </div>
                        </div>

                        {salesMonitorError ? (
                          <div className="patient-alert error" style={{ marginTop: 12 }}>
                            {salesMonitorError}
                          </div>
                        ) : null}

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', padding: '14px 18px 4px' }}>
                          <div className="metric-card" style={{ padding: '14px 16px', border: '1px solid #f1f5f9', borderRadius: 12 }}>
                            <div style={{ color: '#64748b', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Billing Collected</div>
                            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 900, color: '#0f172a' }}>₱ {salesMonitor?.billing?.total_collected ?? '0.00'}</div>
                          </div>
                          <div className="metric-card" style={{ padding: '14px 16px', border: '1px solid #f1f5f9', borderRadius: 12 }}>
                            <div style={{ color: '#64748b', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Refunds</div>
                            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 900, color: '#0f172a' }}>₱ {salesMonitor?.billing?.total_refunded ?? '0.00'}</div>
                          </div>
                          <div className="metric-card" style={{ padding: '14px 16px', border: '1px solid #f1f5f9', borderRadius: 12 }}>
                            <div style={{ color: '#64748b', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pharmacy Net Sales</div>
                            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 900, color: '#0f172a' }}>₱ {salesMonitor?.pharmacy_pos?.net_sales ?? '0.00'}</div>
                          </div>
                          <div className="metric-card" style={{ padding: '14px 16px', border: '1px solid #f1f5f9', borderRadius: 12 }}>
                            <div style={{ color: '#64748b', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Submitted Reports</div>
                            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 900, color: '#0f172a' }}>{salesMonitor?.sales_reports_submitted ?? 0}</div>
                          </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '14px', padding: '10px 18px 4px' }}>
                          <div className="metric-card" style={{ padding: '14px 16px', border: '1px solid #f1f5f9', borderRadius: 12 }}>
                            <div style={{ color: '#64748b', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Onsite Consultations</div>
                            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 900, color: '#0f172a' }}>₱ {salesMonitor?.billing?.by_source?.onsite ?? '0.00'}</div>
                            <div style={{ marginTop: 6, color: '#64748b', fontSize: 13 }}>{salesMonitor?.billing?.by_source?.counts?.onsite ?? 0} payment(s)</div>
                          </div>
                          <div className="metric-card" style={{ padding: '14px 16px', border: '1px solid #f1f5f9', borderRadius: 12 }}>
                            <div style={{ color: '#64748b', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Video Consultations</div>
                            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 900, color: '#0f172a' }}>₱ {salesMonitor?.billing?.by_source?.video ?? '0.00'}</div>
                            <div style={{ marginTop: 6, color: '#64748b', fontSize: 13 }}>{salesMonitor?.billing?.by_source?.counts?.video ?? 0} payment(s)</div>
                          </div>
                          <div className="metric-card" style={{ padding: '14px 16px', border: '1px solid #f1f5f9', borderRadius: 12 }}>
                            <div style={{ color: '#64748b', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Laboratory</div>
                            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 900, color: '#0f172a' }}>₱ {salesMonitor?.billing?.by_source?.lab ?? '0.00'}</div>
                            <div style={{ marginTop: 6, color: '#64748b', fontSize: 13 }}>{salesMonitor?.billing?.by_source?.counts?.lab ?? 0} payment(s)</div>
                          </div>
                          <div className="metric-card" style={{ padding: '14px 16px', border: '1px solid #f1f5f9', borderRadius: 12 }}>
                            <div style={{ color: '#64748b', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Radiology</div>
                            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 900, color: '#0f172a' }}>â‚± {salesMonitor?.billing?.by_source?.radiology ?? '0.00'}</div>
                            <div style={{ marginTop: 6, color: '#64748b', fontSize: 13 }}>{salesMonitor?.billing?.by_source?.counts?.radiology ?? 0} payment(s)</div>
                          </div>
                          <div className="metric-card" style={{ padding: '14px 16px', border: '1px solid #f1f5f9', borderRadius: 12 }}>
                            <div style={{ color: '#64748b', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pharmacy Billing</div>
                            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 900, color: '#0f172a' }}>â‚± {salesMonitor?.billing?.by_source?.pharmacy ?? '0.00'}</div>
                            <div style={{ marginTop: 6, color: '#64748b', fontSize: 13 }}>{salesMonitor?.billing?.by_source?.counts?.pharmacy ?? 0} payment(s)</div>
                          </div>
                        </div>

                        <div className="logs-table-container" style={{ maxHeight: '260px', marginTop: 10 }}>
                          <table className="staff-table">
                            <thead>
                              <tr>
                                <th>Billing Invoices by Status</th>
                                <th>Count</th>
                              </tr>
                            </thead>
                            <tbody>
                              {salesMonitorLoading ? (
                                <tr>
                                  <td colSpan="2" className="text-center py-8 text-slate-500">Loading sales monitoring...</td>
                                </tr>
                              ) : Object.keys(salesMonitor?.billing?.invoices_by_status || {}).length === 0 ? (
                                <tr>
                                  <td colSpan="2" className="text-center py-8 text-slate-500">No billing invoice data for this date.</td>
                                </tr>
                              ) : (
                                Object.entries(salesMonitor?.billing?.invoices_by_status || {}).map(([k, v]) => (
                                  <tr key={k}>
                                    <td className="text-sm font-medium text-slate-700">{k}</td>
                                    <td className="text-sm text-slate-600">{v}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                    </div>

                    <div className="dashboard-section-card col-span-2" style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="dashboard-section-header">
                            <h3 className="dashboard-section-title">
                                <FileText size={20} className="text-slate-600" /> Operational Reports
                            </h3>
                        </div>
                        <div className="patient-controls-row" style={{ flexWrap: 'wrap', justifyContent: 'space-between', gap: '10px' }}>
                          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <input
                              type="date"
                              className="patient-filter-select"
                              value={reportsDateFrom}
                              onChange={(e) => setReportsDateFrom(e.target.value)}
                            />
                            <input
                              type="date"
                              className="patient-filter-select"
                              value={reportsDateTo}
                              onChange={(e) => setReportsDateTo(e.target.value)}
                            />
                          </div>
                          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <button
                              className="btn-orange-sm shadow-sm"
                              onClick={() => {
                                exportIncidentReport(reportIncidents);
                              }}
                              disabled={incidentsLoading || incidents.length === 0}
                            >
                              <Download size={16} /> Incidents CSV
                            </button>
                            <button
                              className="btn-orange-sm shadow-sm"
                              onClick={async () => {
                                try {
                                  const rows = await fetchActivityLogsForExport(reportsDateFrom, reportsDateTo);
                                  exportActivityReport(rows);
                                } catch (_) {
                                  setModalType("error");
                                  setSuccessMessage("Failed to export activity logs. Please check the server.");
                                  setShowSuccessModal(true);
                                }
                              }}
                              disabled={Boolean(activityLogsError)}
                            >
                              <Download size={16} /> Audit Logs CSV
                            </button>
                            <button
                              className="btn-gray"
                              style={{ padding: '10px 16px' }}
                              onClick={() => {
                                const rows = reportIncidents.map((i) => ({
                                  Date: i.date || (i.incident_date ? new Date(i.incident_date).toLocaleDateString() : ''),
                                  Time: i.time || (i.incident_time ? new Date(i.incident_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''),
                                  Type: i.type || i.incident_type || '',
                                  Location: i.location || '',
                                  Reporter: i.reporter || i.created_by_email || '',
                                  Status: i.status || '',
                                  Description: i.description || ''
                                }));
                                printTableReport('Operational Report (Incidents)', 'Filtered report', Object.keys(rows[0] || {}), rows);
                              }}
                              disabled={incidentsLoading || incidents.length === 0}
                            >
                              <Download size={16} /> Print Incidents
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
                          <div className="dashboard-section-card" style={{ margin: 0, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                            <div className="dashboard-section-header" style={{ padding: '18px 22px' }}>
                              <h3 className="dashboard-section-title">
                                <AlertCircle size={18} className="text-orange-600" /> Incident Reports
                              </h3>
                            </div>
                            <div className="logs-table-container" style={{ maxHeight: '360px' }}>
                              <table className="staff-table">
                                <thead>
                                  <tr>
                                    <th>Date</th>
                                    <th>Type</th>
                                    <th>Location</th>
                                    <th>Reporter</th>
                                    <th>Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {incidentsError ? (
                                    <tr>
                                      <td colSpan="5" className="text-center py-8 text-slate-500">{incidentsError}</td>
                                    </tr>
                                  ) : incidentsLoading ? (
                                    <tr>
                                      <td colSpan="5" className="text-center py-8 text-slate-500">Loading incidents...</td>
                                    </tr>
                                  ) : reportIncidents.length === 0 ? (
                                    <tr>
                                      <td colSpan="5" className="text-center py-8 text-slate-500">No incident reports found.</td>
                                    </tr>
                                  ) : (
                                    reportIncidents.map((inc) => (
                                      <tr key={inc.id || inc._id}>
                                        <td className="whitespace-nowrap text-sm text-slate-500">
                                          {inc.incident_date ? new Date(inc.incident_date).toLocaleString() : (inc.date || '—')}
                                        </td>
                                        <td className="text-sm font-medium text-slate-700">{inc.type || inc.incident_type || '—'}</td>
                                        <td className="text-sm text-slate-600">{inc.location || '—'}</td>
                                        <td className="text-sm text-slate-600">{inc.reporter || inc.created_by_email || '—'}</td>
                                        <td>
                                          <span className={`status-badge-table ${(() => {
                                            const v = String(inc.status || '').toLowerCase();
                                            return v === 'reviewed' || v === 'resolved';
                                          })() ? 'status-duty' : 'status-upcoming'}`}>
                                            {inc.status || 'Pending'}
                                          </span>
                                        </td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>

                          <div className="dashboard-section-card" style={{ margin: 0, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                            <div className="dashboard-section-header" style={{ padding: '18px 22px' }}>
                              <h3 className="dashboard-section-title">
                                <History size={18} className="text-purple-600" /> Audit Logs
                              </h3>
                            </div>
                            <div className="logs-table-container" style={{ maxHeight: '360px' }}>
                              <table className="staff-table">
                                <thead>
                                  <tr>
                                    <th>Time</th>
                                    <th>Actor</th>
                                    <th>Action</th>
                                    <th>Target</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {activityLogsError ? (
                                    <tr>
                                      <td colSpan="4" className="text-center py-8 text-slate-500">{activityLogsError}</td>
                                    </tr>
                                  ) : reportLogs.length === 0 ? (
                                    <tr>
                                      <td colSpan="4" className="text-center py-8 text-slate-500">No audit logs found.</td>
                                    </tr>
                                  ) : (
                                    reportLogs.map((log) => (
                                      <tr key={log.id || log._id}>
                                        <td className="whitespace-nowrap text-sm text-slate-500">{new Date(log.timestamp).toLocaleString()}</td>
                                        <td className="text-sm text-slate-700">{log.actorName || '—'}</td>
                                        <td>
                                          <span className={`status-badge-table ${
                                            String(log.action || '').includes('Create') ? 'status-duty' :
                                            String(log.action || '').includes('Delete') ? 'status-off' :
                                            String(log.action || '').includes('Update') ? 'status-upcoming' : 'status-scheduled'
                                          }`}>
                                            {log.action || '—'}
                                          </span>
                                        </td>
                                        <td className="text-sm text-slate-600">{log.target || '—'}</td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                    </div>

                    <div className="dashboard-section-card" style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="dashboard-section-header">
                            <h3 className="dashboard-section-title">
                                <Users size={20} className="text-blue-600" /> Staff Roster
                            </h3>
                        </div>
                        <div className="logs-table-container" style={{ maxHeight: '320px' }}>
                          <table className="staff-table">
                            <thead>
                              <tr>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Role</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {staffList.length === 0 ? (
                                <tr>
                                  <td colSpan="4" className="text-center py-8 text-slate-500">No staff records found.</td>
                                </tr>
                              ) : (
                                staffList.slice(0, 50).map((s) => (
                                  <tr key={s.id || s._id}>
                                    <td className="text-sm font-medium text-slate-700">{`${s.firstName || ''} ${s.lastName || ''}`.trim() || '—'}</td>
                                    <td className="text-sm text-slate-600">{s.email || '—'}</td>
                                    <td className="text-sm text-slate-600">{s.role || '—'}</td>
                                    <td>
                                      <span className={`status-badge-table ${String(s.status || 'Offline') === 'Online' ? 'status-duty' : 'status-off'}`}>
                                        {s.status || 'Offline'}
                                      </span>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                        <div style={{ paddingTop: '12px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.875rem', fontWeight: '600', color: '#334155' }}>{staffList.length} Records</span>
                          <button className="btn-orange-sm shadow-sm" onClick={exportStaffReport}>
                            <Download size={16} /> Download CSV
                          </button>
                        </div>
                    </div>

                    <div className="dashboard-section-card" style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="dashboard-section-header">
                            <h3 className="dashboard-section-title">
                                <UserPlus size={20} className="text-green-600" /> Patient Demographics
                            </h3>
                        </div>
                        <div className="logs-table-container" style={{ maxHeight: '320px' }}>
                          <table className="staff-table">
                            <thead>
                              <tr>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Gender</th>
                                <th>Contact</th>
                              </tr>
                            </thead>
                            <tbody>
                              {patientList.length === 0 ? (
                                <tr>
                                  <td colSpan="4" className="text-center py-8 text-slate-500">No patient records found.</td>
                                </tr>
                              ) : (
                                patientList.slice(0, 50).map((p) => (
                                  <tr key={p.id || p._id}>
                                    <td className="text-sm font-medium text-slate-700">{`${p.first_name || p.firstName || ''} ${p.last_name || p.lastName || ''}`.trim() || '—'}</td>
                                    <td className="text-sm text-slate-600">{p.email || '—'}</td>
                                    <td className="text-sm text-slate-600">{p.gender || '—'}</td>
                                    <td className="text-sm text-slate-600">{p.contact_number || p.contactNumber || p.phone || '—'}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                        <div style={{ paddingTop: '12px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.875rem', fontWeight: '600', color: '#334155' }}>{patientList.length} Records</span>
                          <button className="btn-orange-sm shadow-sm" onClick={exportPatientReport}>
                            <Download size={16} /> Download CSV
                          </button>
                        </div>
                    </div>

                    <div className="dashboard-section-card col-span-2" style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="dashboard-section-header">
                            <h3 className="dashboard-section-title">
                                <Activity size={20} className="text-orange-600" /> Executive Analytics
                            </h3>
                        </div>
                        <div className="logs-table-container" style={{ maxHeight: '260px' }}>
                          <table className="staff-table">
                            <thead>
                              <tr>
                                <th>Metric</th>
                                <th>Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td className="text-sm text-slate-700">Active Staff</td>
                                <td className="text-sm font-medium text-slate-700">{staffList.length}</td>
                              </tr>
                              <tr>
                                <td className="text-sm text-slate-700">Total Patients</td>
                                <td className="text-sm font-medium text-slate-700">{patientList.length}</td>
                              </tr>
                              <tr>
                                <td className="text-sm text-slate-700">Low Stock Alerts</td>
                                <td className="text-sm font-medium text-slate-700">{inventory.filter((i) => isLowStockItem(i)).length}</td>
                              </tr>
                              <tr>
                                <td className="text-sm text-slate-700">Incidents (Filtered)</td>
                                <td className="text-sm font-medium text-slate-700">{reportIncidents.length}</td>
                              </tr>
                              <tr>
                                <td className="text-sm text-slate-700">Audit Logs (Filtered)</td>
                                <td className="text-sm font-medium text-slate-700">{reportLogs.length}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                            <button className="btn-orange-sm shadow-sm" onClick={exportPDFAnalytics}>
                                <Download size={16} /> Download PDF Report
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // 8. SYSTEM SETTINGS VIEW
    if (view === "system-settings" || view === "settings") {
        return (
            <div className="admin-settings-page" style={{ width: '100%', maxWidth: '100%', padding: '0 40px' }}>
                <div className="settings-header-container">
                    <h2 className="settings-page-title">System Configuration</h2>
                    <p className="settings-page-subtitle">Manage global application settings, dynamic dropdowns, and role permissions.</p>
                </div>

                <div className="settings-grid-layout">
                    {/* Maintenance Mode & General Settings */}
                    <div className="settings-section-card full-width-card">
                        <div className="section-card-header">
                            <h3 className="section-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Settings size={18} className="text-slate-500"/> General Settings
                            </h3>
                            <p className="section-card-desc">System-wide operational controls.</p>
                        </div>
                        <div className="section-card-body" style={{ padding: '24px 32px' }}>
                            <div className="notification-item" style={{ borderBottom: 'none', padding: 0 }}>
                                <div className="notif-info">
                                    <h4 style={{ fontSize: '1rem', color: '#1e293b' }}>Maintenance Mode</h4>
                                    <p style={{ fontSize: '0.85rem', color: '#64748b' }}>Temporarily disable access for non-admin users across the application.</p>
                                </div>
                                <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '50px', height: '24px' }}>
                                    <input type="checkbox" checked={maintenanceMode} onChange={async () => {
                                        const next = !maintenanceMode;
                                        setMaintenanceMode(next);
                                        const saved = await persistSystemSettings(
                                          { maintenanceMode: next },
                                          `Maintenance mode ${next ? 'enabled' : 'disabled'}.`
                                        );
                                        if (!saved) setMaintenanceMode(!next);
                                    }} style={{ opacity: 0, width: 0, height: 0 }} />
                                    <span className="slider round" style={{
                                        position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                                        backgroundColor: maintenanceMode ? '#ea580c' : '#cbd5e1', transition: '.4s', borderRadius: '24px'
                                    }}>
                                        <span style={{
                                            position: 'absolute', content: '""', height: '16px', width: '16px', left: maintenanceMode ? '30px' : '4px', bottom: '4px',
                                            backgroundColor: 'white', transition: '.4s', borderRadius: '50%'
                                        }}></span>
                                    </span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <div className="settings-section-card full-width-card">
                        <div className="section-card-header">
                            <h3 className="section-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <SlidersHorizontal size={18} className="text-orange-600"/> Operational Thresholds
                            </h3>
                            <p className="section-card-desc">Tune dashboard alerts and overdue rules without code changes.</p>
                        </div>
                        <div className="section-card-body" style={{ padding: '24px 32px' }}>
                            <div className="form-grid-2-col" style={{ margin: 0 }}>
                                <div className="input-group">
                                    <label className="form-label">Incident Overdue (hours)</label>
                                    <input
                                      type="number"
                                      min="1"
                                      className="settings-input"
                                      value={opsSettings.incidentOverdueHours}
                                      onChange={(e) => {
                                        const v = Number(e.target.value);
                                        setOpsSettings((p) => ({ ...p, incidentOverdueHours: Number.isFinite(v) && v > 0 ? v : p.incidentOverdueHours }));
                                      }}
                                    />
                                </div>
                                <div className="input-group">
                                    <label className="form-label">Low Stock Threshold (≤ stock)</label>
                                    <input
                                      type="number"
                                      min="0"
                                      className="settings-input"
                                      value={opsSettings.lowStockThreshold}
                                      onChange={(e) => {
                                        const v = Number(e.target.value);
                                        setOpsSettings((p) => ({ ...p, lowStockThreshold: Number.isFinite(v) && v >= 0 ? v : p.lowStockThreshold }));
                                      }}
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', marginTop: '14px' }}>
                              <button
                                type="button"
                                className="btn-orange-sm"
                                style={{ padding: '10px 20px', width: 'auto', marginTop: 0, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                onClick={() => persistSystemSettings({ opsSettings }, "Operational thresholds saved.")}
                              >
                                <Save size={16} /> Save
                              </button>
                            </div>
                        </div>
                    </div>

                    {/* Dynamic Dropdowns: Departments */}
                    <div className="settings-section-card">
                        <div className="section-card-header">
                            <h3 className="section-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Layers size={18} className="text-blue-500"/> Departments
                            </h3>
                            <p className="section-card-desc">Manage hospital departments.</p>
                        </div>
                        <div className="section-card-body" style={{ padding: '24px' }}>
                            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
                                <input type="text" className="settings-input flex-1" placeholder="New Department..." value={newDepartment} onChange={e => setNewDepartment(e.target.value)} onKeyDown={async e => { 
                                  if (e.key === 'Enter') {
                                    const v = newDepartment.trim();
                                    if (!v) {
                                      setModalType('error'); setSuccessMessage('Department name cannot be empty.'); setShowSuccessModal(true);
                                    } else if (v.length < 2) {
                                      setModalType('error'); setSuccessMessage('Department name is too short (min 2 characters).'); setShowSuccessModal(true);
                                    } else if (v.length > 64) {
                                      setModalType('error'); setSuccessMessage('Department name is too long (max 64 characters).'); setShowSuccessModal(true);
                                    } else {
                                      const next = [...departments, v]; 
                                      setDepartments(next); setNewDepartment(""); 
                                      const saved = await persistSystemSettings({ departments: next }, "Departments updated."); 
                                      if (!saved) setDepartments(departments); 
                                    }
                                  }
                                }} />
                                <button className="btn-orange-sm" style={{ padding: '10px 20px', width: 'auto', marginTop: 0, display: 'inline-flex', alignItems: 'center', gap: '6px' }} onClick={async () => {
                                    const v = newDepartment.trim();
                                    if (!v) {
                                      setModalType('error'); setSuccessMessage('Department name cannot be empty.'); setShowSuccessModal(true);
                                    } else if (v.length < 2) {
                                      setModalType('error'); setSuccessMessage('Department name is too short (min 2 characters).'); setShowSuccessModal(true);
                                    } else if (v.length > 64) {
                                      setModalType('error'); setSuccessMessage('Department name is too long (max 64 characters).'); setShowSuccessModal(true);
                                    } else {
                                      const next = [...departments, v];
                                      setDepartments(next);
                                      setNewDepartment("");
                                      const saved = await persistSystemSettings({ departments: next }, "Departments updated.");
                                      if (!saved) setDepartments(departments);
                                    }
                                }}>
                                    <Plus size={16} /> Add
                                </button>
                            </div>
                            <div className="modern-list scrollable-list-y" style={{ maxHeight: '250px', paddingRight: '10px' }}>
                                {departments.map((dept, i) => (
                                    <div key={i} className="modern-list-item" style={{ padding: '12px 16px', marginBottom: '8px', border: '1px solid #f1f5f9', borderRadius: '8px', display: 'flex', alignItems: 'center' }}>
                                        <span style={{ flex: 1, fontWeight: '500', fontSize: '0.9rem', color: '#334155' }}>{dept}</span>
                                        <button style={{ color: '#ef4444', background: '#fef2f2', padding: '6px', borderRadius: '6px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={async () => {
                                          const next = departments.filter(d => d !== dept);
                                          setDepartments(next);
                                          const saved = await persistSystemSettings({ departments: next }, "Departments updated.");
                                          if (!saved) setDepartments(departments);
                                        }}>
                                            <Trash2 size={14}/>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Dynamic Dropdowns: Wards */}
                    <div className="settings-section-card">
                        <div className="section-card-header">
                            <h3 className="section-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <MapPin size={18} className="text-green-500"/> Ward List
                            </h3>
                            <p className="section-card-desc">Manage hospital wards connected to the live room registry.</p>
                        </div>
                        <div className="section-card-body" style={{ padding: '24px' }}>
                            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
                                <input type="text" className="settings-input flex-1" placeholder="New Ward..." value={newWard} onChange={e => setNewWard(e.target.value)} onKeyDown={async e => {
                                  if (e.key === 'Enter') {
                                    const v = newWard.trim();
                                    if (!v) {
                                      setModalType("error"); setSuccessMessage("Ward name cannot be empty."); setShowSuccessModal(true);
                                    } else if (v.length < 2) {
                                      setModalType("error"); setSuccessMessage("Ward name is too short (min 2 characters)."); setShowSuccessModal(true);
                                    } else if (v.length > 64) {
                                      setModalType("error"); setSuccessMessage("Ward name is too long (max 64 characters)."); setShowSuccessModal(true);
                                    } else {
                                      try {
                                        await fetchJson(`/api/wards`, {
                                          apiBase: API_BASE,
                                          method: 'POST',
                                          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ name: v, totalCapacity: 0 })
                                        });
                                        setNewWard("");
                                        await fetchWardRegistry();
                                        setModalType("success");
                                        setSuccessMessage("Ward created.");
                                        setShowSuccessModal(true);
                                      } catch (error) {
                                        setModalType("error");
                                        setSuccessMessage(String(error?.message || "Unable to create ward."));
                                        setShowSuccessModal(true);
                                      }
                                    }
                                  }
                                }} />
                                <button className="btn-orange-sm" style={{ padding: '10px 20px', width: 'auto', marginTop: 0, display: 'inline-flex', alignItems: 'center', gap: '6px' }} onClick={async () => {
                                    const v = newWard.trim();
                                    if (!v) {
                                      setModalType("error"); setSuccessMessage("Ward name cannot be empty."); setShowSuccessModal(true);
                                    } else if (v.length < 2) {
                                      setModalType("error"); setSuccessMessage("Ward name is too short (min 2 characters)."); setShowSuccessModal(true);
                                    } else if (v.length > 64) {
                                      setModalType("error"); setSuccessMessage("Ward name is too long (max 64 characters)."); setShowSuccessModal(true);
                                    } else {
                                      try {
                                        await fetchJson(`/api/wards`, {
                                          apiBase: API_BASE,
                                          method: 'POST',
                                          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ name: v, totalCapacity: 0 })
                                        });
                                        setNewWard("");
                                        await fetchWardRegistry();
                                        setModalType("success");
                                        setSuccessMessage("Ward created.");
                                        setShowSuccessModal(true);
                                      } catch (error) {
                                        setModalType("error");
                                        setSuccessMessage(String(error?.message || "Unable to create ward."));
                                        setShowSuccessModal(true);
                                      }
                                    }
                                }}>
                                    <Plus size={16} /> Add
                                </button>
                            </div>
                            <div className="modern-list scrollable-list-y" style={{ maxHeight: '250px', paddingRight: '10px' }}>
                                {(Array.isArray(wardRoomRegistry.wards) ? wardRoomRegistry.wards : []).map((ward, i) => (
                                    <div key={ward.id || i} className="modern-list-item" style={{ padding: '12px 16px', marginBottom: '8px', border: '1px solid #f1f5f9', borderRadius: '8px', display: 'flex', alignItems: 'center' }}>
                                        <span style={{ flex: 1, fontWeight: '500', fontSize: '0.9rem', color: '#334155' }}>{ward.name}</span>
                                        <span style={{ fontSize: '0.75rem', color: '#64748b', marginRight: '10px' }}>{Number(ward.totalCapacity || 0)} active rooms</span>
                                        <button style={{ color: '#ef4444', background: '#fef2f2', padding: '6px', borderRadius: '6px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={async () => {
                                          try {
                                            await fetchJson(`/api/wards/${ward.id}`, {
                                              apiBase: API_BASE,
                                              method: 'DELETE',
                                              headers: { ...getAuthHeaders() }
                                            });
                                            await fetchWardRegistry();
                                            setModalType("success");
                                            setSuccessMessage("Ward removed.");
                                            setShowSuccessModal(true);
                                          } catch (error) {
                                            setModalType("error");
                                            setSuccessMessage(String(error?.message || "Unable to remove ward."));
                                            setShowSuccessModal(true);
                                          }
                                        }}>
                                            <Trash2 size={14}/>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Advanced Role Management */}
                    <div className="settings-section-card full-width-card">
                        <div className="section-card-header">
                            <h3 className="section-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <ShieldCheck size={18} className="text-purple-500"/> Role Permissions
                            </h3>
                            <p className="section-card-desc">Configure access levels for different staff roles.</p>
                        </div>
                        <div className="section-card-body" style={{ padding: '0', overflowX: 'auto' }}>
                            <table className="staff-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
                                <thead>
                                    <tr style={{ background: '#f8fafc' }}>
                                        <th style={{ textAlign: 'left', padding: '16px 32px', color: '#64748b', fontWeight: '600', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Role</th>
                                        <th style={{ textAlign: 'center', padding: '16px', color: '#64748b', fontWeight: '600', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Manage Staff</th>
                                        <th style={{ textAlign: 'center', padding: '16px', color: '#64748b', fontWeight: '600', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Manage Patients</th>
                                        <th style={{ textAlign: 'center', padding: '16px', color: '#64748b', fontWeight: '600', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Manage Inventory</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {roles.map((role) => (
                                        <tr key={role.name} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                            <td style={{ fontWeight: '600', padding: '16px 32px', color: '#1e293b' }}>{role.name}</td>
                                            <td style={{ textAlign: 'center', padding: '16px' }}>
                                                <input type="checkbox" className="custom-checkbox" style={{ width: '18px', height: '18px', cursor: role.name === 'Admin' ? 'not-allowed' : 'pointer' }} checked={role.permissions.includes('all') || role.permissions.includes('manage_staff')} onChange={(e) => {
                                                let newPerms = [...role.permissions];
                                                if(e.target.checked) newPerms.push('manage_staff');
                                                else newPerms = newPerms.filter(p => p !== 'manage_staff' && p !== 'all');
                                                setRoles(roles.map(r => r.name === role.name ? {...r, permissions: newPerms} : r));
                                            }} disabled={role.name === 'Admin'}/></td>
                                            <td style={{ textAlign: 'center', padding: '16px' }}>
                                                <input type="checkbox" className="custom-checkbox" style={{ width: '18px', height: '18px', cursor: role.name === 'Admin' ? 'not-allowed' : 'pointer' }} checked={role.permissions.includes('all') || role.permissions.includes('view_patients') || role.permissions.includes('manage_patients')} onChange={(e) => {
                                                let newPerms = [...role.permissions];
                                                if(e.target.checked) newPerms.push('manage_patients');
                                                else newPerms = newPerms.filter(p => p !== 'manage_patients' && p !== 'all');
                                                setRoles(roles.map(r => r.name === role.name ? {...r, permissions: newPerms} : r));
                                            }} disabled={role.name === 'Admin'}/></td>
                                            <td style={{ textAlign: 'center', padding: '16px' }}>
                                                <input type="checkbox" className="custom-checkbox" style={{ width: '18px', height: '18px', cursor: role.name === 'Admin' ? 'not-allowed' : 'pointer' }} checked={role.permissions.includes('all') || role.permissions.includes('manage_inventory')} onChange={(e) => {
                                                let newPerms = [...role.permissions];
                                                if(e.target.checked) newPerms.push('manage_inventory');
                                                else newPerms = newPerms.filter(p => p !== 'manage_inventory' && p !== 'all');
                                                setRoles(roles.map(r => r.name === role.name ? {...r, permissions: newPerms} : r));
                                            }} disabled={role.name === 'Admin'}/></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <div style={{ padding: '16px 32px', background: '#f8fafc', borderTop: '1px solid #f1f5f9' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                  <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>* Administrators have full access and their permissions cannot be restricted.</p>
                                  <button
                                    type="button"
                                    className="btn-orange-sm"
                                    style={{ padding: '10px 20px', width: 'auto', marginTop: 0, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                    onClick={() => persistSystemSettings({ roles }, "Role permissions saved.")}
                                    disabled={systemSettingsSaving}
                                  >
                                    <Save size={16} /> Save Permissions
                                  </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
  };

  // --- PDF ANALYTICS HELPER ---
  const exportPDFAnalytics = () => {
      // Open a temporary printable window
      const printWindow = window.open('', '_blank');
      
      // Calculate analytical data derived from Supabase
      const totalStaff = staffList.length;
      const totalPatients = patientList.length || dashboardStats?.patients?.total || 0;
      const lowStock = inventory.filter(i => i.status === 'Low Stock' || i.status === 'Out of Stock').length;
      const onlineCount = staffList.filter(s => s.status === 'Online').length;
      
      printWindow.document.write(`
          <html>
              <head>
                  <title>Executive Operational Analytics</title>
                  <style>
                      body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; color: #1e293b; }
                      h1 { color: #ea580c; border-bottom: 2px solid #ea580c; padding-bottom: 10px; margin-bottom: 5px; }
                      .date { font-size: 14px; color: #64748b; margin-bottom: 30px; }
                      .metric-grid { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 30px; }
                      .metric-card { border: 1px solid #e2e8f0; padding: 24px; border-radius: 12px; width: calc(50% - 20px); box-sizing: border-box; background: #f8fafc; }
                      .metric-title { font-size: 13px; color: #64748b; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px; font-weight: bold; }
                      .metric-value { font-size: 32px; font-weight: 800; color: #0f172a; margin: 0; }
                      .metric-danger { color: #ef4444; }
                      .metric-success { color: #16a34a; }
                      .footer { margin-top: 60px; font-size: 12px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 20px; }
                  </style>
              </head>
              <body>
                  <h1>Hospital Operations Analytics</h1>
                  <p class="date">Generated securely from system database on: ${new Date().toLocaleString()}</p>
                  
                  <div class="metric-grid">
                      <div class="metric-card">
                          <div class="metric-title">Total Active Staff</div>
                          <p class="metric-value">${totalStaff} <span style="font-size:16px; font-weight:normal; color:#64748b;">(${onlineCount} Currently Online)</span></p>
                      </div>
                      <div class="metric-card">
                          <div class="metric-title">Total Registered Patients</div>
                          <p class="metric-value">${totalPatients}</p>
                      </div>
                      <div class="metric-card">
                          <div class="metric-title">Critical Inventory Alerts</div>
                          <p class="metric-value metric-danger">${lowStock}</p>
                      </div>
                  </div>
                  
                  <div class="footer">Pascual General Hospital - Confidential Internal Analytics Report</div>
              </body>
          </html>
      `);
      
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
          printWindow.print();
          printWindow.close();
      }, 500); // Small delay to ensure styles apply before print dialog
  };

  const onlineStaffNow = staffList.filter(s => s.status === 'Online');
  const currentActiveUserEmail = localStorage.getItem('tempLoginEmail') || JSON.parse(localStorage.getItem('currentUser') || '{}').email || adminProfile?.email;
  if (currentActiveUserEmail && !onlineStaffNow.some(s => s.email === currentActiveUserEmail)) {
      const dbUser = staffList.find(s => s.email === currentActiveUserEmail);
      if (dbUser) {
          onlineStaffNow.push({ ...dbUser, status: 'Online' });
      } else {
          // Mock admin fallback
          onlineStaffNow.push({
              id: 'current-user',
              firstName: adminProfile?.name?.split(' ')[0] || 'Admin',
              lastName: adminProfile?.name?.split(' ').slice(1).join(' ') || '',
              role: adminProfile?.role || 'Admin',
              email: currentActiveUserEmail,
              status: 'Online'
          });
      }
  }

  return (
    
      <div className={`admin-dashboard-container ${backendHealth.checked && !backendHealth.ok ? 'has-error-banner' : ''}`}>
      {backendHealth.checked && !backendHealth.ok ? (
        <div className="admin-error-banner">
          <div className="admin-error-banner-content">
            <span className="admin-error-icon">⚠️</span>
            Backend connection error: {backendHealth.error}
          </div>
        </div>
      ) : null}
      {/* SIDEBAR */}
      <aside className={`sidebar ${isCollapsed ? "collapsed" : ""}`}>
        <div className="sidebar-header">
          <div className="admin-brand">
            <img className="admin-brand-logo" src="/images/pgh%20logo.png" alt="PASCUALINGA" />
            {!isCollapsed ? <span className="admin-brand-text">PASCUALINGA</span> : null}
          </div>
          <button onClick={() => setIsCollapsed(!isCollapsed)} className="sidebar-toggle">
            <ChevronLeft size={20} className={`toggle-icon ${isCollapsed ? "rotated" : ""}`} />
          </button>
        </div>

        <nav className="sidebar-nav">
          <button 
            className={`nav-item ${view === "dashboard" ? "active" : ""}`} 
            onClick={() => setView("dashboard")}
          >
            <LayoutDashboard size={20} />
            {!isCollapsed && <span>Dashboard</span>}
          </button>

          <button 
            className={`nav-item ${(view === "reports" || view === "incidents") ? "active" : ""}`}
            onClick={() => {
              if (isCollapsed) {
                setView("reports");
                setIsReportsOpen(false);
                return;
              }
              setIsReportsOpen(!isReportsOpen);
            }}
          >
            <FileText size={20} />
            {!isCollapsed && <span className="flex-1 text-left">Reports</span>}
            {!isCollapsed && (
              <ChevronDown size={18} className={`nav-chevron ${isReportsOpen ? "open" : ""}`} />
            )}
          </button>

          {!isCollapsed && isReportsOpen && (
            <div className="nav-submenu">
              <button
                className={`nav-subitem ${view === "reports" ? "active" : ""}`}
                type="button"
                onClick={() => {
                  setView("reports");
                  setIsReportsOpen(false);
                }}
              >
                Reports & Analytics
              </button>
              <button
                className={`nav-subitem ${view === "incidents" ? "active" : ""}`}
                type="button"
                onClick={() => {
                  setView("incidents");
                  setIsReportsOpen(false);
                }}
              >
                Incident Reports
              </button>
            </div>
          )}

          <button 
            className={`nav-item ${view === "register-staff" ? "active" : ""}`} 
            onClick={() => setView("register-staff")}
          >
            <UserPlus size={20} />
            {!isCollapsed && <span>Register Staff</span>}
          </button>

          
          <button 
            className={`nav-item ${view === "staff-management" ? "active" : ""}`}
            onClick={() => setView("staff-management")}
          >
            <Users size={20} />
            {!isCollapsed && <span>Staff</span>}
          </button>

          <button
            className={`nav-item ${view === "doctor-availability" ? "active" : ""}`}
            onClick={() => setView("doctor-availability")}
          >
            <Calendar size={20} />
            {!isCollapsed && <span>Doctor Availability</span>}
          </button>

          <button 
            className={`nav-item ${view === "activity-logs" ? "active" : ""}`}
            onClick={() => setView("activity-logs")}
          >
            <History size={20} />
            {!isCollapsed && <span>Activity Logs</span>}
          </button>

          <button 
            className={`nav-item ${view === "system-settings" ? "active" : ""}`}
            onClick={() => setView("system-settings")}
          >
            <Settings size={20} />
            {!isCollapsed && <span>System Settings</span>}
          </button>
        </nav>
      </aside>

      <main className="main-content">
        <header className="admin-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            {isCollapsed ? (
              <button type="button" className="app-mobile-menu-btn" onClick={() => setIsCollapsed(false)} aria-label="Open menu">
                <Menu size={18} />
              </button>
            ) : null}
            <div className="header-title">
              <h2>
                  {view === "dashboard" && "Dashboard"}
                  {view === "admin-settings" && "Admin Profile"}
                  {view === "register-staff" && "Staff Registration"}
                  {view === "staff-management" && "Staff Management"}
                  {view === "doctor-availability" && "Doctor Availability"}
                  {view === "incidents" && "Incident Reports"}
                  {view === "activity-logs" && "Activity Logs"}
                  {view === "reports" && "Reports & Analytics"}
                  {view === "system-settings" && "System Settings"}
              </h2>
              <p>Welcome back, Admin</p>
            </div>
          </div>
          
          <div className="header-actions">
            {/* Who's Online */}
            <div style={{ position: 'relative' }}>
              <button
                className="header-icon-btn"
                onClick={() => {
                  setShowOnlineDropdown(!showOnlineDropdown);
                }}
                style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', padding: '8px', color: '#64748b' }}
                title="Who's online"
                type="button"
              >
                <Users size={22} />
                {onlineStaffNow.length > 0 && (
                  <span style={{ position: 'absolute', top: 2, right: 4, background: '#16a34a', color: 'white', fontSize: '9px', minWidth: '16px', height: '16px', borderRadius: '999px', padding: '0 4px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                    {onlineStaffNow.length}
                  </span>
                )}
              </button>

              {showOnlineDropdown && (
                <div className="header-dropdown" style={{ width: '320px', right: '0', padding: '0', maxHeight: '420px', overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', fontWeight: 'bold', fontSize: '0.95rem', color: '#1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                    <span>Who&apos;s Online ({onlineStaffNow.length})</span>
                    <button
                      type="button"
                      className="link-orange"
                      onClick={() => {
                        setView('staff-management');
                        setShowOnlineDropdown(false);
                        setOnlineSearch('');
                      }}
                    >
                      Open
                    </button>
                  </div>
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid #f8fafc' }}>
                    <div className="input-wrapper-relative" style={{ width: '100%' }}>
                      <Search size={18} className="absolute-icon-left text-slate-400" />
                      <input
                        type="text"
                        value={onlineSearch}
                        onChange={(e) => setOnlineSearch(e.target.value)}
                        className="search-input-with-icon"
                        placeholder="Search online staff..."
                        style={{ width: '100%' }}
                      />
                    </div>
                  </div>
                  <div style={{ maxHeight: '320px', overflowY: 'auto' }} className="hide-scrollbar">
                    {onlineStaffNow.length === 0 ? (
                      <div style={{ padding: '18px', textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>No staff online.</div>
                    ) : (
                      onlineStaffNow
                        .filter((s) => {
                          const q = String(onlineSearch || '').trim().toLowerCase();
                          if (!q) return true;
                          const name = `${s.firstName || ''} ${s.lastName || ''}`.trim().toLowerCase();
                          const role = String(s.role || s.accountType || '').toLowerCase();
                          const email = String(s.email || '').toLowerCase();
                          return name.includes(q) || role.includes(q) || email.includes(q);
                        })
                        .map((s) => {
                          const fullName = `${s.firstName || ''} ${s.lastName || ''}`.trim() || 'Staff Member';
                          const role = s.role || s.accountType || 'Staff';
                          const email = s.email || '';
                          return (
                            <div
                              key={`${email}-${role}-${fullName}`}
                              className="dropdown-item"
                              style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderBottom: '1px solid #f8fafc', cursor: 'pointer' }}
                              onClick={() => {
                                setView('staff-management');
                                setStaffSearchTerm(email || fullName);
                                setStaffPage(1);
                                setShowOnlineDropdown(false);
                              }}
                            >
                              <div className="online-avatar sm">
                                {(s.firstName ? s.firstName[0] : 'U').toUpperCase()}
                                <span className="status-dot"></span>
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fullName}</div>
                                <div style={{ color: '#64748b', fontSize: '0.82rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{role}{email ? ` • ${email}` : ''}</div>
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>
              )}
            </div>

            <AccountHeaderActions
              user={{ ...adminProfile, role: 'admin' }}
              roleLabel="Administrator"
              onMyProfile={() => setView("admin-settings")}
              onSignOut={confirmLogout}
              showChangePasswordMenu={false}
            />
          </div>
        </header>
        
        {/* Content Body */}
        <div className="content-body">
          {renderContent()}
        </div>
      </main>

      {incidentDetails && (
        <div className="inc-modal-overlay" onClick={() => setIncidentDetails(null)}>
          <div className="inc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="inc-modal-head">
              <div>
                <div className="inc-modal-title">Incident Details</div>
                <div className="inc-modal-sub">
                  <span>{incidentDetails.date}</span>
                  <span className="inc-dot">•</span>
                  <span>{incidentDetails.time}</span>
                </div>
              </div>
              <button type="button" className="inc-icon-btn" onClick={() => setIncidentDetails(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="inc-modal-body">
              <div className="inc-detail-grid">
                <div className="inc-detail">
                  <div className="inc-detail-k">Type</div>
                  <div className="inc-detail-v">{incidentDetails.type || '—'}</div>
                </div>
                <div className="inc-detail">
                  <div className="inc-detail-k">Location</div>
                  <div className="inc-detail-v">{incidentDetails.location || '—'}</div>
                </div>
                <div className="inc-detail">
                  <div className="inc-detail-k">Reporter</div>
                  <div className="inc-detail-v">{incidentDetails.reporter || '—'}</div>
                </div>
                <div className="inc-detail">
                  <div className="inc-detail-k">Status</div>
                  <div className="inc-detail-v">
                    <span className={`inc-pill inc-pill-status ${(() => {
                      const v = String(incidentDetails.status || '').toLowerCase();
                      return v === 'reviewed' || v === 'resolved';
                    })() ? 'reviewed' : 'pending'}`}>
                      {incidentDetails.status || 'Pending'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="inc-detail-block">
                <div className="inc-detail-k">Description</div>
                <div className="inc-detail-text">{incidentDetails.description || '—'}</div>
              </div>

              <div className="inc-detail-block">
                <div className="inc-detail-k">Action Taken</div>
                <div className="inc-detail-text">{incidentDetails.action_taken || incidentDetails.actionTaken || '—'}</div>
              </div>
            </div>

            <div className="inc-modal-actions">
              <button type="button" className="inc-btn inc-btn-ghost" onClick={() => setIncidentDetails(null)}>
                Close
              </button>
              <button
                type="button"
                className={`inc-btn ${(() => {
                  const v = String(incidentDetails.status || '').toLowerCase();
                  return v === 'reviewed' || v === 'resolved';
                })() ? 'inc-btn-disabled' : 'inc-btn-primary'}`}
                onClick={() => handleUpdateIncidentStatus(incidentDetails.id, 'Reviewed')}
                disabled={(() => {
                  const v = String(incidentDetails.status || '').toLowerCase();
                  return v === 'reviewed' || v === 'resolved';
                })() || incidentUpdatingId === incidentDetails.id}
              >
                <Check size={16} />
                {incidentUpdatingId === incidentDetails.id ? 'Saving…' : ((() => {
                  const v = String(incidentDetails.status || '').toLowerCase();
                  return v === 'reviewed' || v === 'resolved';
                })() ? 'Reviewed' : 'Mark Reviewed')}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewingStaff && (
        <div className="modern-modal-overlay" onClick={() => setViewingStaff(null)}>
          <div className="modern-modal-card staff-profile-modal" onClick={(e) => e.stopPropagation()}>
            <div className="staff-profile-head">
              <div className="staff-profile-title">Staff Profile</div>
              <button type="button" className="staff-profile-close" onClick={() => setViewingStaff(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="staff-profile-body">
              {(() => {
                const fullName = `${viewingStaff.firstName || ""} ${viewingStaff.lastName || ""}`.trim() || "Staff Member";
                const email = viewingStaff.email || "";
                const roleInfo = getStaffRoleInfo(viewingStaff);
                const roleText = roleInfo.label;
                const status = viewingStaff.status || "Offline";
                const employeeId = viewingStaff.employeeId || "N/A";
                const phone = viewingStaff.phone || "N/A";
                const gender = viewingStaff.gender || "N/A";

                let staffPic = null;
                try {
                  const savedAvatars = JSON.parse(localStorage.getItem('staffAvatars') || '{}');
                  staffPic = savedAvatars[email];
                } catch (_) {
                  staffPic = null;
                }

                const nameKey = fullName.toLowerCase();
                const emailKey = email.toLowerCase();
                const logs = activityLogs
                  .filter((l) => {
                    const actor = String(l.actorName || '').toLowerCase();
                    const details = String(l.details || '').toLowerCase();
                    return (actor && actor === nameKey) || (emailKey && details.includes(emailKey));
                  })
                  .slice(0, 8);

                return (
                  <>
                    <div className="staff-profile-summary">
                      <div className="staff-profile-avatar" style={{ background: staffPic ? 'transparent' : '#fff7ed' }}>
                        {staffPic ? (
                          <img src={staffPic} alt={fullName} />
                        ) : (
                          (viewingStaff.firstName ? viewingStaff.firstName[0] : "S").toUpperCase()
                        )}
                      </div>
                      <div className="staff-profile-main">
                        <div className="staff-profile-name">{fullName}</div>
                        <div className="staff-profile-sub">{email}</div>
                        <div className="staff-profile-tags">
                          <span className="staff-profile-tag">{roleText}</span>
                          <span className={`staff-profile-tag ${String(status).toLowerCase() === 'online' ? 'online' : ''}`}>{status}</span>
                        </div>
                      </div>
                    </div>

                    <div className="staff-profile-grid">
                      <div className="staff-profile-item">
                        <div className="staff-profile-k">Employee ID</div>
                        <div className="staff-profile-v">{employeeId}</div>
                      </div>
                      <div className="staff-profile-item">
                        <div className="staff-profile-k">Phone</div>
                        <div className="staff-profile-v">{phone}</div>
                      </div>
                      <div className="staff-profile-item">
                        <div className="staff-profile-k">Gender</div>
                        <div className="staff-profile-v">{gender}</div>
                      </div>
                      <div className="staff-profile-item">
                        <div className="staff-profile-k">Role</div>
                        <div className="staff-profile-v">{roleText}</div>
                      </div>
                    </div>

                    <div className="staff-profile-logs">
                      <div className="staff-profile-logs-title">Recent Activity</div>
                      {logs.length === 0 ? (
                        <div className="staff-profile-logs-empty">No activity logs found for this staff member.</div>
                      ) : (
                        <div className="staff-profile-logs-list">
                          {logs.map((l) => (
                            <div key={l.id} className="staff-profile-log">
                              <div className="staff-profile-log-title">{l.action}</div>
                              <div className="staff-profile-log-sub">{l.details}</div>
                              <div className="staff-profile-log-time">{new Date(l.timestamp).toLocaleString()}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>

            <div className="staff-profile-foot">
              <button type="button" className="btn-modal-cancel" onClick={() => setViewingStaff(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {announcementDeleteConfirmation && (
        <ConfirmModal
          open={Boolean(announcementDeleteConfirmation)}
          onClose={() => setAnnouncementDeleteConfirmation(null)}
          onConfirm={async () => {
            const id = announcementDeleteConfirmation.id;
            setAnnouncementDeleteConfirmation(null);
            await handleDeleteAnnouncement(id);
            setModalType("success");
            setSuccessMessage("Announcement deleted successfully.");
            setShowSuccessModal(true);
          }}
          title="Delete announcement?"
          message="This action cannot be undone."
          subtext={announcementDeleteConfirmation.title || ""}
          cancelLabel="Cancel"
          confirmLabel="Delete"
          confirmVariant="danger"
        />
      )}

      {deleteConfirmation && (
        <ConfirmModal
          open={Boolean(deleteConfirmation)}
          onClose={cancelDelete}
          onConfirm={confirmDelete}
          title="Delete staff member?"
          message="This action cannot be undone."
          cancelLabel="Cancel"
          confirmLabel="Delete"
          confirmVariant="danger"
        />
      )}

      {restockModal && (
        <div className="modern-modal-overlay" onClick={() => !restockSubmitting && setRestockModal(null)}>
          <div className="logout-confirm-card restock-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="logout-header">
              <div className="logout-icon-wrapper">
                <Pill size={32} />
              </div>
              <h2 className="logout-title">Request Restock</h2>
            </div>

            <div className="logout-body">
              <p className="logout-text restock-subtitle">
                Request restock for <strong>{restockModal.name}</strong>
              </p>
              <div className="restock-grid">
                <div className="restock-field">
                  <div className="restock-label">Quantity</div>
                  <input
                    type="number"
                    min="1"
                    className="patient-filter-select"
                    value={restockQty}
                    onChange={(e) => setRestockQty(e.target.value)}
                    disabled={restockSubmitting}
                  />
                </div>
                <div className="restock-field">
                  <div className="restock-label">Priority</div>
                  <select
                    className="patient-filter-select"
                    value={restockPriority}
                    onChange={(e) => setRestockPriority(e.target.value)}
                    disabled={restockSubmitting}
                  >
                    <option value="Low">Low</option>
                    <option value="Normal">Normal</option>
                    <option value="Urgent">Urgent</option>
                  </select>
                </div>
              </div>
              <div className="restock-notes">
                <div className="restock-label">Notes (optional)</div>
                <textarea
                  className="restock-textarea"
                  value={restockNote}
                  onChange={(e) => setRestockNote(e.target.value)}
                  disabled={restockSubmitting}
                  rows={3}
                />
              </div>
            </div>

            <div className="mm-footer restock-footer">
              <button className="btn-modal-cancel" onClick={() => setRestockModal(null)} disabled={restockSubmitting}>Cancel</button>
              <button className="btn-modal-save" onClick={submitRestockRequest} disabled={restockSubmitting}>
                Send Request
              </button>
            </div>
          </div>
        </div>
      )}

      {showSuccessModal && (
        <div className="modern-modal-overlay">
          <div className="success-modal-card">
            <div className={`success-modal-icon ${modalType === 'success' ? 'success' : 'error'}`}>
              {modalType === 'success' ? <Check size={48} strokeWidth={3} /> : <AlertCircle size={48} strokeWidth={3} />}
            </div>
            <h3 className="success-modal-title">{modalType === 'success' ? 'Success!' : 'Error'}</h3>
            <p className="success-modal-text">{successMessage}</p>
            <button 
                className={modalType === 'success' ? 'btn-modal-success' : 'btn-modal-error'} 
                onClick={() => setShowSuccessModal(false)}
            >
                OK
            </button>
          </div>
        </div>
      )}
      </div>
  );
}

export default AdminDashboard;
  
