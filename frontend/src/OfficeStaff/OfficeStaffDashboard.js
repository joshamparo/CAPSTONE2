import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, CreditCard, FileText, LogOut, Plus, RefreshCw, Search, User, Upload, Save, KeyRound, Eye, EyeOff, ShieldAlert, Menu, Mail, Briefcase, Phone, Key, Shield, Check, X, Edit2, IdCard } from 'lucide-react';
import '../Admin/AdminDashboard.css';
import './OfficeStaffDashboard.css';
import AccountHeaderActions from '../components/AccountHeaderActions';
import SignOutConfirmModal from '../components/SignOutConfirmModal';
import PatientFullRecordModal from '../components/PatientFullRecordModal';
import { checkBackendHealth, fetchJson } from '../utils/api';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

const getUser = () => {
  try {
    return JSON.parse(localStorage.getItem('currentUser') || 'null');
  } catch (_) {
    return null;
  }
};

const buildHeaders = (user) => {
  const role = String(user?.role || user?.account_type || user?.accountType || user?.roles || '').toLowerCase();
  const email = String(user?.email || '').trim();
  return {
    'Content-Type': 'application/json',
    'x-user-role': role,
    ...(email ? { 'x-user-email': email } : {})
  };
};

const toMoney = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const toLocalDateInputValue = (value = new Date()) => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const downloadCSV = (rows, filename) => {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return;
  const headers = Object.keys(list[0] || {});
  const esc = (value) => {
    const s = String(value ?? '');
    if (s.includes('"') || s.includes(',') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [
    headers.join(','),
    ...list.map((r) => headers.map((h) => esc(r?.[h])).join(','))
  ];
  const csv = `${lines.join('\n')}\n`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename || 'export.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
};

const formatDateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
};

const inferInvoiceSource = (invoice) => {
  const notes = String(invoice?.notes || '').toLowerCase();
  if (notes.includes('pharmacy pos')) return 'Pharmacy POS';
  if (notes.includes('video consultation')) return 'Video Consultation';
  if (invoice?.appointment_id != null || notes.includes('onsite') || notes.includes('approvalrequest')) {
    return 'Onsite Consultation';
  }
  if (notes.includes('lab')) return 'Lab';
  if (notes.includes('radiology')) return 'Radiology';
  return 'Manual Invoice';
};

const receiptPrefixForSource = (source) => {
  const low = String(source || '').toLowerCase();
  if (low.includes('lab')) return 'LAB';
  if (low.includes('video')) return 'VID';
  if (low.includes('onsite') || low.includes('consult')) return 'CON';
  return 'PAY';
};

const inferInvoiceDepartment = (invoice) => {
  const notes = String(invoice?.notes || '').trim();
  if (!notes) return 'General Billing';
  if (/approvalrequest/i.test(notes)) return 'Approved Booking';
  if (/onsite/i.test(notes)) return 'Consultation Queue';
  return notes.length > 54 ? `${notes.slice(0, 54)}…` : notes;
};

const buildConsultationReceipt = ({ invoice, payment, user, amountReceivedOverride, philhealthDeduction, hmoCoverage, hmoProvider, loaNumber }) => {
  if (!invoice || !payment) return null;
  const source = inferInvoiceSource(invoice);
  const patientName = invoice.patients
    ? `${String(invoice.patients.first_name || '').trim()} ${String(invoice.patients.last_name || '').trim()}`.trim()
    : 'Patient';
  
  const grossAmount = Number(invoice.total_amount || 0);
  const outstandingBeforePayment = Number(invoice.balance_amount ?? grossAmount);
  const ph = Number(philhealthDeduction || 0);
  const hmo = Number(hmoCoverage || 0);
  const benefitAdjustedTotal = Math.max(0, grossAmount - ph - hmo);
  const amountDueAfterDeductions = Math.max(0, Math.min(outstandingBeforePayment, benefitAdjustedTotal));

  const amountReceived = Number.isFinite(Number(amountReceivedOverride))
    ? Number(amountReceivedOverride)
    : Number(payment.amount || 0);
  const amountPosted = Number(payment.amount || 0);
  const remainingBalance = Math.max(0, amountDueAfterDeductions - amountPosted);
  const fullyPaid = remainingBalance <= 0.0001;
  return {
    receiptNumber: `PGH-${receiptPrefixForSource(source)}-${String(payment.id || invoice.id || 'PAY')}`,
    orderId: invoice.id || payment.invoice_id || '',
    paidAt: payment.created_at || payment.createdAt || new Date().toISOString(),
    paidAtLabel: formatDateTime(payment.created_at || payment.createdAt),
    cashierName: String(user?.name || user?.first_name || user?.firstName || user?.email || 'Cashier'),
    method: payment.method || 'Cash',
    reference: payment.reference || '—',
    patientName,
    serviceLabel: (invoice.items || []).map((item) => item?.description).filter(Boolean).join(', ') || source,
    amountDue: grossAmount,
    philhealthDeduction: ph,
    hmoCoverage: hmo,
    hmoProvider: hmoProvider || '',
    loaNumber: loaNumber || '',
    netAmountDue: amountDueAfterDeductions,
    remainingBalance,
    status: fullyPaid ? 'Paid' : 'Partially Paid',
    amountReceived,
    change: Math.max(0, amountReceived - amountPosted),
    source,
    note: fullyPaid
      ? 'Payment confirmed. Consultation billing is fully settled.'
      : `Partial payment recorded. Remaining balance: ₱ ${toMoney(remainingBalance)}`
  };
};

export default function OfficeStaffDashboard({ mode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [backendHealth, setBackendHealth] = useState({ checked: false, ok: true, error: '' });
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState('dashboard');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [centralRecordOpen, setCentralRecordOpen] = useState(false);
  const [centralRecordPatientId, setCentralRecordPatientId] = useState(null);
  const [centralRecordPatientLabel, setCentralRecordPatientLabel] = useState('');

  const [profileForm, setProfileForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [profileMessage, setProfileMessage] = useState({ text: '', type: '' });

  const passwordCriteria = useMemo(() => {
    const v = String(profileForm.newPassword || '');
    return {
      length: v.length >= 11,
      hasNumber: /\d/.test(v),
      hasSpecial: /[!@#$%^&*(),.?":{}|<>]/.test(v),
    };
  }, [profileForm.newPassword]);

  const [privacyMode, setPrivacyMode] = useState(() => {
    try {
      const saved = localStorage.getItem('systemPreferences');
      return saved ? JSON.parse(saved).privacyMode : false;
    } catch (_) {
      return false;
    }
  });

  useEffect(() => {
    const handleStorage = () => {
      try {
        const saved = localStorage.getItem('systemPreferences');
        if (saved) setPrivacyMode(JSON.parse(saved).privacyMode);
      } catch (_) {}
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const blurStyle = useMemo(() => privacyMode ? { filter: 'blur(8px)', transition: 'filter 0.3s ease' } : {}, [privacyMode]);
  const blurOnHover = (e) => {
    if (privacyMode) {
      e.currentTarget.style.filter = 'none';
    }
  };
  const resetBlur = (e) => {
    if (privacyMode) {
      e.currentTarget.style.filter = 'blur(8px)';
    }
  };
  const role = String(mode || '').toLowerCase();
  const roleLabel = role === 'doctor_secretary' ? 'Doctor Secretary' : 'Cashier';

  useEffect(() => {
    const u = getUser();
    setUser(u);
  }, []);

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

  useEffect(() => {
    if (user) {
      setProfileForm({
        firstName: user.firstName || user.first_name || '',
        lastName: user.lastName || user.last_name || '',
        email: user.email || '',
        newPassword: '',
        confirmPassword: ''
      });
      setProfileAvatarUrl(user.avatarUrl || user.profilePicture || user.avatar_url || null);
    }
  }, [user]);

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('email', profileForm.email);
    formData.append('role', role);
    formData.append('id', user.id || user._id);

    setUploadingAvatar(true);
    setProfileMessage({ text: '', type: '' });
    try {
      const data = await fetchJson(`/api/staff/avatar`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: {
          'x-user-role': role,
          'x-user-email': profileForm.email
        },
        body: formData
      });

      setProfileAvatarUrl(data.avatarUrl);
      const updatedUser = { ...user, avatarUrl: data.avatarUrl, avatar_url: data.avatarUrl };
      localStorage.setItem('currentUser', JSON.stringify(updatedUser));
      setUser(updatedUser);
      setProfileMessage({ text: 'Profile picture updated!', type: 'success' });
    } catch (e) {
      setProfileMessage({ text: String(e?.message || 'Failed to upload image'), type: 'error' });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    setProfileMessage({ text: '', type: '' });
    try {
      const isPasswordChange = Boolean(String(profileForm.newPassword || '').trim());

      if (isPasswordChange) {
        if (!String(profileForm.currentPassword || '').trim() || !String(profileForm.confirmPassword || '').trim()) {
          throw new Error('To change password, please fill in Current, New, and Confirm Password fields.');
        }
        if (profileForm.newPassword !== profileForm.confirmPassword) {
          throw new Error('Passwords do not match');
        }
        if (!passwordCriteria.length || !passwordCriteria.hasNumber || !passwordCriteria.hasSpecial) {
          throw new Error('New password must be at least 11 characters with a number and special character.');
        }
      }

      const payload = {
        firstName: profileForm.firstName,
        lastName: profileForm.lastName,
      };

      if (isPasswordChange) {
        payload.currentPassword = String(profileForm.currentPassword || '').trim();
        payload.password = String(profileForm.newPassword || '').trim();
        payload.requiresPasswordAuth = true;
      }

      const data = await fetchJson(`/api/staff/${user.id || user._id}`, {
        apiBase: API_BASE,
        method: 'PUT',
        headers: buildHeaders(user),
        body: JSON.stringify(payload)
      });

      // The staff endpoint returns the user object directly.  Support the
      // legacy wrapped response too, so the updated details persist locally.
      const savedUser = data?.user || data || {};
      const updatedUser = {
        ...user,
        ...savedUser,
        firstName: savedUser.first_name || savedUser.firstName || profileForm.firstName,
        lastName: savedUser.last_name || savedUser.lastName || profileForm.lastName
      };
      localStorage.setItem('currentUser', JSON.stringify(updatedUser));
      setUser(updatedUser);
      setProfileMessage({ text: 'Profile updated successfully!', type: 'success' });
      setProfileForm(prev => ({ ...prev, currentPassword: '', newPassword: '', confirmPassword: '' }));
    } catch (e) {
      setProfileMessage({ text: String(e.message), type: 'error' });
    } finally {
      setSavingProfile(false);
    }
  };

  const displayName = useMemo(() => {
    if (!user) return roleLabel;
    const fromFirst = user.first_name || user.firstName || user.name;
    if (fromFirst) return String(fromFirst);
    const email = String(user.email || '').trim();
    if (email) return email.split('@')[0];
    return roleLabel;
  }, [user, roleLabel]);

  const [patients, setPatients] = useState([]);
  const [patientQuery, setPatientQuery] = useState('');
  const [patientsLoading, setPatientsLoading] = useState(false);
  const [patientsError, setPatientsError] = useState('');

  const [appointments, setAppointments] = useState([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [appointmentsError, setAppointmentsError] = useState('');

  const [invoices, setInvoices] = useState([]);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState('');
  const [invoiceStatus, setInvoiceStatus] = useState(role === 'cashier' ? 'Ready' : 'All');
  const [invoiceRange, setInvoiceRange] = useState('All');
  const [invoiceQuery, setInvoiceQuery] = useState('');
  const [invoicePage, setInvoicePage] = useState(1);
  const [invoiceTotalCount, setInvoiceTotalCount] = useState(0);
  const [invoiceSummary, setInvoiceSummary] = useState(null);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [selectedInvoiceLoading, setSelectedInvoiceLoading] = useState(false);

  const [closeoutDate, setCloseoutDate] = useState(() => toLocalDateInputValue());
  const [closeout, setCloseout] = useState(null);
  const [closeoutLoading, setCloseoutLoading] = useState(false);
  const [closeoutError, setCloseoutError] = useState('');

  const [newInvoicePatient, setNewInvoicePatient] = useState(null);
  const [invoiceItems, setInvoiceItems] = useState([{ description: '', quantity: 1, unitPrice: '' }]);
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [createInvoiceLoading, setCreateInvoiceLoading] = useState(false);
  const [createInvoiceError, setCreateInvoiceError] = useState('');

  const [payMethod, setPayMethod] = useState('Cash');
  const [payReference, setPayReference] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [cashReceived, setCashReceived] = useState('');
  const [paymentLoading, setPaymentLoading] = useState(false);
  const paymentIdempotencyKeyRef = useRef('');
  const [paymentError, setPaymentError] = useState('');
  const [adjustmentLoading, setAdjustmentLoading] = useState(false);
  const [adjustmentError, setAdjustmentError] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReference, setRefundReference] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [voidReference, setVoidReference] = useState('');
  const [voidReason, setVoidReason] = useState('');

  // HMO & Deductions UI state
  const [hmoProvider, setHmoProvider] = useState('');
  const [hmoCardNumber, setHmoCardNumber] = useState('');
  const [philhealthDeduction, setPhilhealthDeduction] = useState('');
  const [hmoCoverage, setHmoCoverage] = useState('');
  const [loaNumber, setLoaNumber] = useState('');
  const [hmoStatus, setHmoStatus] = useState('Pending');
  const [hmoNotes, setHmoNotes] = useState('');
  const [savingHmoClaim, setSavingHmoClaim] = useState(false);

  const [hmoQueue, setHmoQueue] = useState({
    filter: 'approved',
    page: 1,
    perPage: 8,
    totalCount: 0,
    invoiceCount: 0,
    totalPages: 1,
    rows: []
  });
  const [hmoQueueLoading, setHmoQueueLoading] = useState(false);
  const [hmoQueueError, setHmoQueueError] = useState('');
  const [hmoQueueFilter, setHmoQueueFilter] = useState('all');
  const [hmoQueuePage, setHmoQueuePage] = useState(1);
  const [hmoQueueQuery, setHmoQueueQuery] = useState('');
  const [hmoQuickEdit, setHmoQuickEdit] = useState(null);
  const [hmoQuickSaving, setHmoQuickSaving] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [modalType, setModalType] = useState('success');
  const [successMessage, setSuccessMessage] = useState('');

  const [hmoRefSearch, setHmoRefSearch] = useState('');
  const [hmoHighlightRowId, setHmoHighlightRowId] = useState(null);
  const [hmoRefSearchLoading, setHmoRefSearchLoading] = useState(false);

  const [labOrders, setLabOrders] = useState([]);
  const [labOrdersLoading, setLabOrdersLoading] = useState(false);
  const [labOrdersError, setLabOrdersError] = useState('');
  const [labOrdersRange, setLabOrdersRange] = useState('All');
  const [labOrdersQuery, setLabOrdersQuery] = useState('');
  const [labPage, setLabPage] = useState(1);
  const [selectedLabOrder, setSelectedLabOrder] = useState(null);
  const [selectedLabOrderHmo, setSelectedLabOrderHmo] = useState(null);
  const [labPaymentMethod, setLabPaymentMethod] = useState('Cash');
  const [labPaymentAmount, setLabPaymentAmount] = useState('');
  const [labPaymentReference, setLabPaymentReference] = useState('');
  const [labPaymentLoading, setLabPaymentLoading] = useState(false);
  const [labPaymentError, setLabPaymentError] = useState('');
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [paymentHistoryTotal, setPaymentHistoryTotal] = useState(0);
  const [paymentHistoryCollected, setPaymentHistoryCollected] = useState(0);
  const [paymentHistoryLoading, setPaymentHistoryLoading] = useState(false);
  const [paymentHistoryError, setPaymentHistoryError] = useState('');
  const [paymentsQuery, setPaymentsQuery] = useState('');
  const [paymentsSource, setPaymentsSource] = useState('All');
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentReceipt, setPaymentReceipt] = useState(null);

  const refreshPatients = useCallback(async () => {
    if (!user) return;
    setPatientsLoading(true);
    setPatientsError('');
    try {
      const params = new URLSearchParams();
      if (patientQuery.trim()) params.set('q', patientQuery.trim());
      const data = await fetchJson(`/api/patients?${params.toString()}`, { apiBase: API_BASE, headers: buildHeaders(user) });
      setPatients(Array.isArray(data) ? data : []);
    } catch (e) {
      setPatients([]);
      setPatientsError(String(e.message || 'Failed to load patients'));
    } finally {
      setPatientsLoading(false);
    }
  }, [patientQuery, user]);

  useEffect(() => {
    if (!user) return;
    if (view === 'patients') refreshPatients();
    if (view === 'billing' && role === 'doctor_secretary') refreshPatients();
  }, [refreshPatients, role, user, view]);

  const refreshAppointments = async () => {
    if (!user) return;
    setAppointmentsLoading(true);
    setAppointmentsError('');
    try {
      const data = await fetchJson(`/api/appointments`, { apiBase: API_BASE, headers: buildHeaders(user) });
      setAppointments(Array.isArray(data) ? data : []);
    } catch (e) {
      setAppointments([]);
      setAppointmentsError(String(e.message || 'Failed to load appointments'));
    } finally {
      setAppointmentsLoading(false);
    }
  };

  const refreshInvoices = async (options = {}) => {
    if (!user) return;
    const requestedPage = Math.max(1, Number(options.page || invoicePage || 1));
    const requestedStatus = options.status ?? invoiceStatus;
    const requestedRange = options.range ?? invoiceRange;
    const requestedQuery = options.query ?? invoiceQuery;
    setInvoiceLoading(true);
    setInvoiceError('');
    try {
      const params = new URLSearchParams();
      if (requestedStatus && requestedStatus !== 'All') params.set('status', requestedStatus);
      if (String(requestedQuery).trim()) params.set('q', String(requestedQuery).trim());
      if (requestedRange === 'Today' || requestedRange === 'Week') {
        const end = new Date();
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        if (requestedRange === 'Week') start.setDate(start.getDate() - 6);
        end.setDate(end.getDate() + 1);
        end.setHours(0, 0, 0, 0);
        params.set('from', start.toISOString());
        params.set('to', end.toISOString());
      }
      params.set('take', '8');
      params.set('skip', String((requestedPage - 1) * 8));
      params.set('withTotal', '1');
      const data = await fetchJson(`/api/billing/invoices?${params.toString()}`, { apiBase: API_BASE, headers: buildHeaders(user) });
      setInvoices(Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []));
      setInvoiceTotalCount(Number(data?.totalCount ?? (Array.isArray(data) ? data.length : 0)) || 0);
      setInvoicePage(requestedPage);
    } catch (e) {
      setInvoices([]);
      setInvoiceError(String(e.message || 'Failed to load invoices'));
    } finally {
      setInvoiceLoading(false);
    }
  };

  const refreshDashboardKpis = async () => {
    if (!user || role !== 'cashier') return;
    try {
      const data = await fetchJson(`/api/billing/invoices/summary?date=${encodeURIComponent(toLocalDateInputValue())}`, {
        apiBase: API_BASE,
        headers: buildHeaders(user)
      });
      setInvoiceSummary(data && typeof data === 'object' ? data : null);
    } catch (e) {
      setInvoiceError(String(e?.message || 'Failed to load invoice summary'));
    }
  };

  const fetchCloseout = async ({ date } = {}) => {
    if (!user || role !== 'cashier') return;
    const targetDate = String(date || closeoutDate || '').trim();
    if (!targetDate) return;
    setCloseoutLoading(true);
    setCloseoutError('');
    try {
      const params = new URLSearchParams();
      params.set('date', targetDate);
      const data = await fetchJson(`/api/stats/cashier-closeout?${params.toString()}`, {
        apiBase: API_BASE,
        headers: buildHeaders({ ...user, role })
      });
      setCloseout(data);
    } catch (e) {
      setCloseout(null);
      setCloseoutError(String(e.message || 'Failed to load closeout'));
    } finally {
      setCloseoutLoading(false);
    }
  };

  const refreshLabOrders = useCallback(async () => {
    if (!user || role !== 'cashier') return;
    setLabOrdersLoading(true);
    setLabOrdersError('');
    try {
      const params = new URLSearchParams();
      params.set('status', 'hmo_lab_queue');
      params.set('take', '200');
      const data = await fetchJson(`/api/clinical-orders?${params.toString()}`, { apiBase: API_BASE, headers: buildHeaders(user) });
      setLabOrders(Array.isArray(data) ? data : []);
    } catch (e) {
      setLabOrders([]);
      setLabOrdersError(String(e.message || 'Failed to load lab payments'));
    } finally {
      setLabOrdersLoading(false);
    }
  }, [role, user]);

  const refreshPaymentHistory = useCallback(async (options = {}) => {
    if (!user || role !== 'cashier') return;
    const requestedPage = Math.max(1, Number(options.page || paymentsPage || 1));
    const requestedSource = options.source ?? paymentsSource;
    const requestedQuery = options.query ?? paymentsQuery;
    setPaymentHistoryLoading(true);
    setPaymentHistoryError('');
    try {
      const params = new URLSearchParams();
      params.set('take', '8');
      params.set('skip', String((requestedPage - 1) * 8));
      params.set('withTotal', '1');
      if (String(requestedQuery).trim()) params.set('q', String(requestedQuery).trim());
      if (requestedSource && requestedSource !== 'All') params.set('source', requestedSource);
      const data = await fetchJson(`/api/billing/payments?${params.toString()}`, {
        apiBase: API_BASE,
        headers: buildHeaders(user)
      });
      setPaymentHistory(Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []));
      setPaymentHistoryTotal(Number(data?.totalCount ?? (Array.isArray(data) ? data.length : 0)) || 0);
      setPaymentHistoryCollected(Number(data?.totalCollected || 0) || 0);
      setPaymentsPage(requestedPage);
    } catch (e) {
      setPaymentHistory([]);
      setPaymentHistoryError(String(e.message || 'Failed to load payment history'));
    } finally {
      setPaymentHistoryLoading(false);
    }
  }, [paymentsPage, paymentsQuery, paymentsSource, role, user]);

  const buildPaymentReceipt = useCallback((payment) => {
    if (!payment) return null;
    const source = payment.source || inferInvoiceSource(payment.invoice || {});
    const serviceLabel = payment.serviceLabel
      || payment.invoice?.items?.[0]?.description
      || payment.invoice?.notes
      || source
      || 'Hospital Service';
    const amountDue = Number(payment.invoice?.total_amount ?? payment.amount ?? 0);
    const amountReceived = Number(payment.amount ?? amountDue ?? 0);
    return {
      receiptNumber: payment.receiptNumber || `PGH-${receiptPrefixForSource(source)}-${String(payment.id || payment.invoice_id || 'PAY')}`,
      orderId: payment.invoice_id || payment.id || '',
      paidAt: payment.created_at || payment.createdAt || new Date().toISOString(),
      paidAtLabel: formatDateTime(payment.created_at || payment.createdAt),
      cashierName: payment.cashierName || payment.received_by || payment.receivedBy || 'Cashier',
      method: payment.method || 'Cash',
      reference: payment.reference || '—',
      patientName: payment.patientName
        || `${String(payment.invoice?.patients?.first_name || '').trim()} ${String(payment.invoice?.patients?.last_name || '').trim()}`.trim()
        || 'Patient',
      serviceLabel,
      amountDue,
      netAmountDue: amountDue,
      amountReceived,
      change: Math.max(0, amountReceived - amountDue),
      status: String(payment.invoice?.status || '').toLowerCase() === 'paid' ? 'Paid' : 'Payment Posted',
      source
    };
  }, []);

  const openLabOrderPos = useCallback(async (order) => {
    const due = Number(order?.amountDue ?? order?.unitPrice ?? 0);
    setSelectedLabOrder(order || null);
    setSelectedLabOrderHmo(null); // Reset
    setLabPaymentMethod('Cash');
    setLabPaymentAmount(Number.isFinite(due) && due > 0 ? due.toFixed(2) : '');
    setLabPaymentReference('');
    setLabPaymentError('');

    // Try to fetch HMO coverage for this patient/order
    if (order?.patientId && user) {
      try {
        const q = order.patientName || '';
        const claims = await fetchJson(`/api/billing/hmo-queue?q=${encodeURIComponent(q)}`, {
          apiBase: API_BASE,
          headers: buildHeaders(user)
        });
        if (Array.isArray(claims) && claims.length > 0) {
          // Find a claim that matches this order (either via note or just the most recent one for walk-in)
          const orderIdStr = String(order.id);
          const match = claims.find(c => 
            String(c.hmo_claim?.notes || '').includes(orderIdStr) || 
            String(c.hmo_claim?.notes || '').toLowerCase().includes('walk-in service')
          ) || claims[0];
          
          if (match) {
            setSelectedLabOrderHmo(match.hmo_claim);
            // If HMO covers everything, set payment amount to 0
            const hmoAmt = Number(match.hmo_claim?.applied_hmo_amount || match.hmo_claim?.loa_approved_amount || 0);
            const phAmt = Number(match.hmo_claim?.philhealth_deduction || 0);
            const netDue = Math.max(0, due - hmoAmt - phAmt);
            setLabPaymentAmount(netDue.toFixed(2));
            if (netDue <= 0) {
              setLabPaymentMethod('Card'); // Set to something else to imply non-cash if free
              setLabPaymentReference(match.hmo_claim?.loa_number || match.hmo_claim?.hmo_card_number || 'HMO COVERED');
            }
          }
        }
      } catch (_) {}
    }
  }, [user]);

  const printPaymentReceipt = useCallback((receipt) => {
    if (!receipt || typeof window === 'undefined') return;
    const printFrame = document.createElement('iframe');
    printFrame.setAttribute('title', 'Cashier receipt print');
    printFrame.style.position = 'fixed';
    printFrame.style.width = '1px';
    printFrame.style.height = '1px';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.border = '0';
    printFrame.style.opacity = '0';
    document.body.appendChild(printFrame);
    const popup = printFrame.contentWindow;
    if (!popup) {
      printFrame.remove();
      return;
    }
    const safe = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const sourceNote = receipt.note || (
      String(receipt.source || '').toLowerCase().includes('lab')
        ? 'Payment confirmed. Patient may proceed to the laboratory for the exam.'
        : String(receipt.source || '').toLowerCase().includes('video')
          ? 'Payment confirmed. Video consultation booking is settled.'
          : 'Payment confirmed. Please present this receipt if verification is needed.'
    );

    const deductionRows = [];
    if (receipt.philhealthDeduction > 0) {
      deductionRows.push(`<div class="row"><span class="label">PhilHealth</span><span>- PHP ${safe(toMoney(receipt.philhealthDeduction))}</span></div>`);
    }
    if (receipt.hmoCoverage > 0) {
      deductionRows.push(`<div class="row"><span class="label">HMO (${safe(receipt.hmoProvider || 'Provider')})</span><span>- PHP ${safe(toMoney(receipt.hmoCoverage))}</span></div>`);
    }
    if (receipt.loaNumber) {
      deductionRows.push(`<div class="row"><span class="label">LOA Ref</span><span>${safe(receipt.loaNumber)}</span></div>`);
    }

    popup.document.write(`
      <html>
        <head>
          <title>Official Receipt - PGH</title>
          <style>
            @page { margin: 0; size: 80mm auto; }
            body { font-family: 'Courier New', Courier, monospace; color: #000; padding: 12px; margin: 0; font-size: 12px; line-height: 1.4; background: #fff; width: 72mm; }
            .wrap { width: 100%; margin: 0 auto; }
            .center { text-align: center; }
            .title { font-size: 14px; font-weight: 800; margin-bottom: 4px; }
            .sub { font-size: 11px; margin-bottom: 2px; }
            .line { border-top: 1px dashed #000; margin: 8px 0; }
            .row { display: flex; justify-content: space-between; gap: 8px; margin: 4px 0; }
            .label { font-weight: normal; }
            .total { font-size: 13px; font-weight: 800; margin-top: 8px; }
            .note { margin-top: 12px; font-size: 10px; text-align: center; font-style: italic; }
            .print-btn-wrap { text-align: center; margin-top: 20px; }
            @media print { .no-print { display: none !important; } }
          </style>
        </head>
        <body>
          <div class="wrap">
            <div class="center">
              <div class="title">PASCUAL GENERAL HOSPITAL</div>
              <div class="sub">Novaliches, Quezon City</div>
              <div class="sub">TIN: 000-000-000-000</div>
              <div class="sub">OFFICIAL RECEIPT</div>
            </div>
            <div class="line"></div>
            <div class="row"><span class="label">OR No:</span><span>${safe(receipt.receiptNumber)}</span></div>
            <div class="row"><span class="label">Date:</span><span>${safe(receipt.paidAtLabel)}</span></div>
            <div class="row"><span class="label">Cashier:</span><span>${safe(receipt.cashierName)}</span></div>
            <div class="row"><span class="label">Patient:</span><span>${safe(receipt.patientName)}</span></div>
            <div class="line"></div>
            <div style="font-weight: 800; margin: 6px 0;">ITEMS:</div>
            <div class="row"><span class="label" style="flex: 1; word-break: break-word;">${safe(receipt.serviceLabel)}</span><span style="white-space: nowrap;">PHP ${safe(toMoney(receipt.amountDue))}</span></div>
            <div class="line"></div>
            <div class="row"><span class="label">Gross Amount</span><span>PHP ${safe(toMoney(receipt.amountDue))}</span></div>
            ${deductionRows.join('')}
            <div class="row total"><span>Amount Due</span><span>PHP ${safe(toMoney(receipt.netAmountDue || receipt.amountDue))}</span></div>
            <div class="row"><span class="label">Tendered (${safe(receipt.method)})</span><span>PHP ${safe(toMoney(receipt.amountReceived))}</span></div>
            <div class="row total"><span>Change</span><span>PHP ${safe(toMoney(receipt.change))}</span></div>
            <div class="line"></div>
            <div class="note">${safe(sourceNote)}</div>
            <div class="note">This serves as your official receipt.<br/>Thank you!</div>
            <div class="print-btn-wrap no-print">
              <button onclick="window.print()" style="padding: 8px 16px; cursor: pointer; font-family: inherit;">Print Receipt</button>
            </div>
          </div>
          <script>window.onload = function () { window.print(); };</script>
        </body>
      </html>
    `);
    popup.document.close();
    window.setTimeout(() => printFrame.remove(), 60000);
  }, []);

  const refreshHmoQueue = useCallback(async () => {
    if (!user) return;
    setHmoQueueLoading(true);
    setHmoQueueError('');
    try {
      const params = new URLSearchParams();
      params.set('filter', hmoQueueFilter === 'all' ? 'all' : 'approved');
      params.set('page', String(Math.max(1, hmoQueuePage || 1)));
      params.set('perPage', '8');
      if (hmoQueueQuery.trim()) params.set('q', hmoQueueQuery.trim());
      const data = await fetchJson(`/api/billing/hmo-queue?${params.toString()}`, {
        apiBase: API_BASE,
        headers: buildHeaders(user),
        timeoutMs: 120000
      });
      const safe = data && typeof data === 'object' && !Array.isArray(data)
        ? {
            filter: String(data.filter || hmoQueueFilter || 'all'),
            page: Math.max(1, Number(data.page || 1)),
            perPage: Math.max(1, Math.min(50, Number(data.perPage || 8))),
            totalCount: Math.max(0, Number(data.totalCount || 0)),
            invoiceCount: Math.max(0, Number(data.invoiceCount || 0)),
            totalPages: Math.max(1, Math.ceil(Math.max(0, Number(data.totalCount || 0)) / Math.max(1, Math.min(50, Number(data.perPage || 8))))),
            rows: Array.isArray(data.rows) ? data.rows : []
          }
        : { filter: hmoQueueFilter === 'all' ? 'all' : 'approved', page: 1, perPage: 8, totalCount: 0, totalPages: 1, rows: [] };
      setHmoQueue(safe);
      if ((safe.totalPages || 1) < (safe.page || 1) && safe.totalPages > 0) {
        setHmoQueuePage(safe.totalPages);
      }
    } catch (e) {
      setHmoQueue((current) => ({
        ...current,
        filter: hmoQueueFilter === 'all' ? 'all' : 'approved'
      }));
      setHmoQueueError(String(e.message || 'Failed to load HMO queue'));
    } finally {
      setHmoQueueLoading(false);
    }
  }, [user, hmoQueueFilter, hmoQueuePage, hmoQueueQuery]);

  useEffect(() => {
    if (!user) return;
    if (view === 'hmo') refreshHmoQueue();
  }, [refreshHmoQueue, user, view]);

  const handleRefGoSearch = async () => {
    const refRaw = String(hmoRefSearch || '').trim();
    if (!refRaw) return;
    if (!user) return;

    setHmoRefSearchLoading(true);
    setHmoHighlightRowId(null);
    try {
      // Always do a regular search first via queue endpoint. Keep user's typed case for text search.
      setHmoQueuePage(1);
      setHmoQueueQuery(refRaw);

      // Try ref search to detect exact match for highlight + auto open modal
      // Endpoint expects uppercase ref since columns store "PGHYYMMDD-NNNNN" uppercase.
      let matchedInvoiceIds = [];
      try {
        const result = await fetchJson(`/api/billing/search-by-ref?ref=${encodeURIComponent(refRaw.toUpperCase())}`, {
          apiBase: API_BASE,
          headers: buildHeaders(user),
          timeoutMs: 60000
        });
        matchedInvoiceIds = Array.isArray(result?.matched_invoice_ids)
          ? result.matched_invoice_ids.map(String).filter(Boolean)
          : [];
      } catch (_) { /* ignore, fallthrough */ }

      const params = new URLSearchParams();
      params.set('filter', hmoQueueFilter);
      params.set('page', '1');
      params.set('perPage', '8');
      params.set('q', refRaw);

      const data = await fetchJson(`/api/billing/hmo-queue?${params.toString()}`, {
        apiBase: API_BASE,
        headers: buildHeaders(user),
        timeoutMs: 60000
      });
      const safe = data && typeof data === 'object' && !Array.isArray(data)
        ? {
            filter: String(data.filter || hmoQueueFilter),
            page: 1,
            perPage: Math.max(1, Math.min(50, Number(data.perPage || 8))),
            totalCount: Math.max(0, Number(data.totalCount || 0)),
            invoiceCount: Math.max(0, Number(data.invoiceCount || 0)),
            totalPages: Math.max(1, Math.ceil(Math.max(0, Number(data.totalCount || 0)) / Math.max(1, Math.min(50, Number(data.perPage || 8))))),
            rows: Array.isArray(data.rows) ? data.rows : []
          }
        : { filter: hmoQueueFilter, page: 1, perPage: 8, totalCount: 0, totalPages: 1, rows: [] };
      setHmoQueue(safe);

      let firstMatch = null;
      if (matchedInvoiceIds.length) {
        firstMatch = (Array.isArray(safe.rows) ? safe.rows : []).find((r) => {
          const inv = String(r.invoice_id || (r.hmo_claim && r.hmo_claim.invoice_id) || '').trim();
          return matchedInvoiceIds.includes(inv) || Boolean(r.patient_reference) && String(r.patient_reference).toUpperCase() === String(refRaw).toUpperCase();
        }) || (safe.rows && safe.rows[0]);
      } else {
        // If no ref match AND we got at least one row from text search (patient/provider name), do nothing extra, just show rows
      }

      if (firstMatch) {
        const firstMatchId = String(firstMatch.id || firstMatch.invoice_id || Math.random());
        setHmoHighlightRowId(firstMatchId);
        setTimeout(() => {
          try {
            const el = document.querySelector('.hmo-row-highlight');
            if (el && typeof el.scrollIntoView === 'function') {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          } catch (_) { /* noop */ }
        }, 120);
        setTimeout(() => {
          try {
            setHmoQuickEdit(firstMatch);
          } catch (err) {
            alert('⚠️ Update modal error: ' + String(err?.message || err));
          }
        }, 260);
        setTimeout(() => setHmoHighlightRowId(null), 3100);
      } else if (!Array.isArray(safe.rows) || safe.rows.length === 0) {
        setModalType('success');
        setSuccessMessage(`❌ No results found for "${refRaw}".\n\nTry a different keyword or clear the Search box and try again.`);
        setShowSuccessModal(true);
      }
    } catch (e) {
      const msg = String(e?.message || e || '').toLowerCase().includes('timeout') || String(e?.message || e || '').toLowerCase().includes('abort')
        ? `⏱️ Request timed out searching "${refRaw}".\n\nRetry after 2 seconds.`
        : `⚠️ Search error: ${String(e.message || e)}`;
      setModalType('success');
      setSuccessMessage(msg);
      setShowSuccessModal(true);
    } finally {
      setHmoRefSearchLoading(false);
    }
  };

  const saveHmoClaim = async (invoiceId, opts = {}) => {
    if (!user) return Promise.resolve(null);
    const providerRaw = String(opts.provider ?? hmoProvider ?? '').trim();
    const loaNumberRaw = String(opts.loaNumber ?? loaNumber ?? '').trim();
    const cardNumberRaw = String(opts.hmoCardNumber ?? hmoCardNumber ?? '').trim();
    const statusRaw = String(opts.status ?? hmoStatus ?? 'Pending').trim();
    const notesRaw = String(opts.notes ?? hmoNotes ?? '').trim();
    const philhealth = Number(opts.philhealthDeduction ?? philhealthDeduction ?? 0) || 0;
    const loaApproved = Number(opts.loaApprovedAmount ?? hmoCoverage ?? 0) || 0;

    const hasAnything = Boolean(
      providerRaw || loaNumberRaw || cardNumberRaw || notesRaw ||
      philhealth > 0 || loaApproved > 0 ||
      (statusRaw && statusRaw !== 'Pending')
    );
    if (!hasAnything) return Promise.resolve(null);

    setSavingHmoClaim(true);
    return fetchJson(`/api/billing/invoices/${encodeURIComponent(String(invoiceId))}/hmo`, {
      apiBase: API_BASE,
      method: 'PUT',
      headers: buildHeaders(user),
      timeoutMs: 30000,
      body: JSON.stringify({
        provider: providerRaw || null,
        loaNumber: loaNumberRaw || null,
        hmoCardNumber: cardNumberRaw || null,
        status: statusRaw || 'Pending',
        notes: notesRaw || null,
        philhealthDeduction: philhealth,
        loaApprovedAmount: loaApproved
      })
    }).finally(() => setSavingHmoClaim(false));
  };

  const openInvoice = async (invoiceId) => {
    if (!user) return;
    setSelectedInvoiceLoading(true);
    setPaymentError('');
    setAdjustmentError('');
    setPhilhealthDeduction('');
    setHmoCoverage('');
    setHmoProvider('');
    setLoaNumber('');
    setHmoCardNumber('');
    setHmoStatus('Pending');
    setHmoNotes('');
    try {
      const data = await fetchJson(`/api/billing/invoices/${invoiceId}`, { apiBase: API_BASE, headers: buildHeaders(user) });
      setSelectedInvoice(data);
      const claim = data?.hmo_claim || null;
      if (claim) {
        if (claim.hmo_provider || claim.provider) setHmoProvider(String(claim.hmo_provider || claim.provider));
        if (claim.hmo_loa_number || claim.loa_number) setLoaNumber(String(claim.hmo_loa_number || claim.loa_number));
        if (claim.hmo_card_number) setHmoCardNumber(String(claim.hmo_card_number));
        if (claim.notes) setHmoNotes(String(claim.notes));
        if (claim.status) setHmoStatus(String(claim.status));
        const ph = Number(claim.philhealth_deduction || 0);
        if (ph > 0) setPhilhealthDeduction(String(ph));
        const hmo = Number(claim.loa_approved_amount || 0);
        if (hmo > 0) setHmoCoverage(String(hmo));
      }
      const balance = Number(data.balance_amount || 0);
      setPayAmount(balance ? String(balance) : '');
      setRefundAmount('');
      setRefundReference('');
      setRefundReason('');
      setVoidReference('');
      setVoidReason('');
    } catch (e) {
      setSelectedInvoice(null);
    } finally {
      setSelectedInvoiceLoading(false);
    }
  };

  const addInvoiceItem = () => {
    setInvoiceItems((prev) => [...prev, { description: '', quantity: 1, unitPrice: '' }]);
  };

  const updateInvoiceItem = (idx, patch) => {
    setInvoiceItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const removeInvoiceItem = (idx) => {
    setInvoiceItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const invoiceTotal = useMemo(() => {
    return invoiceItems.reduce((sum, it) => {
      const qty = Math.max(1, Math.trunc(Number(it.quantity || 1)));
      const price = Number(it.unitPrice || 0);
      if (!Number.isFinite(price) || price < 0) return sum;
      return sum + qty * (Math.round(price * 100) / 100);
    }, 0);
  }, [invoiceItems]);

  const selectedInvoiceDue = useMemo(() => {
    const rawTotal = Number(selectedInvoice?.total_amount || selectedInvoice?.balance_amount || 0);
    const ph = Number(philhealthDeduction || 0);
    const phSafe = Math.max(0, Math.min(rawTotal, ph));
    const afterPH = Math.max(0, rawTotal - phSafe);
    const hmo = Number(hmoCoverage || 0);
    const statusApplied = hmoStatus === 'Approved' || hmoStatus === 'Partially Approved';
    const hmoSafe = statusApplied ? Math.max(0, Math.min(afterPH, hmo)) : 0;
    return Math.max(0, rawTotal - phSafe - hmoSafe);
  }, [selectedInvoice, philhealthDeduction, hmoCoverage, hmoStatus]);

  const paymentEntryValue = useMemo(() => {
    if (payMethod === 'Cash') return Number(String(cashReceived || payAmount || '').trim() || 0);
    return Number(String(payAmount || '').trim() || 0);
  }, [cashReceived, payAmount, payMethod]);

  const paymentChange = useMemo(() => {
    if (payMethod !== 'Cash') return 0;
    if (!Number.isFinite(paymentEntryValue)) return 0;
    return Math.max(0, paymentEntryValue - selectedInvoiceDue);
  }, [payMethod, paymentEntryValue, selectedInvoiceDue]);

  const paymentShort = useMemo(() => {
    if (payMethod !== 'Cash') return false;
    if (!Number.isFinite(paymentEntryValue) || paymentEntryValue <= 0) return false;
    return paymentEntryValue + 0.0001 < selectedInvoiceDue;
  }, [payMethod, paymentEntryValue, selectedInvoiceDue]);

  const createInvoice = async () => {
    if (!user) return;
    setCreateInvoiceLoading(true);
    setCreateInvoiceError('');
    try {
      if (!newInvoicePatient?.id) throw new Error('Select a patient first');
      const items = invoiceItems
        .map((it) => ({
          description: String(it.description || '').trim(),
          quantity: Number(it.quantity || 1),
          unitPrice: Number(it.unitPrice || 0)
        }))
        .filter((it) => it.description);

      if (items.length === 0) throw new Error('Add at least one item');

      await fetchJson(`/api/billing/invoices`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: buildHeaders(user),
        body: JSON.stringify({
          patientId: newInvoicePatient.id,
          items,
          notes: invoiceNotes || null
        })
      });

      setInvoiceItems([{ description: '', quantity: 1, unitPrice: '' }]);
      setInvoiceNotes('');
      setNewInvoicePatient(null);
      await refreshInvoices();
    } catch (e) {
      setCreateInvoiceError(String(e.message || 'Failed to create invoice'));
    } finally {
      setCreateInvoiceLoading(false);
    }
  };

  const setInvoiceStatusSafe = async (invoiceId, status) => {
    if (!user) return;
    setSelectedInvoiceLoading(true);
    try {
      await fetchJson(`/api/billing/invoices/${invoiceId}`, {
        apiBase: API_BASE,
        method: 'PATCH',
        headers: buildHeaders(user),
        body: JSON.stringify({ status })
      });
      await openInvoice(invoiceId);
      await refreshInvoices();
    } catch (e) {
      setPaymentError(String(e?.message || `Failed to mark invoice ${status}.`));
    } finally {
      setSelectedInvoiceLoading(false);
    }
  };

  const [receiptToPrint, setReceiptToPrint] = useState(null);

  // Auto Print logic
  useEffect(() => {
    if (receiptToPrint) {
      try {
        const saved = localStorage.getItem('systemPreferences');
        const autoPrint = saved ? JSON.parse(saved).autoPrint : false;
        if (autoPrint) {
          // Short delay to ensure state is settled
          setTimeout(() => {
            printPaymentReceipt(receiptToPrint);
            setReceiptToPrint(null);
          }, 300);
        }
      } catch (_) {}
    }
  }, [receiptToPrint]);

  const createPayment = async () => {
    if (!user || !selectedInvoice?.id) return;
    setPaymentLoading(true);
    setPaymentError('');
    let priorPaymentIds = new Set(
      (Array.isArray(selectedInvoice.payments) ? selectedInvoice.payments : [])
        .map((p) => String(p?.id || '').trim())
        .filter(Boolean)
    );
    let priorBalance = Number(selectedInvoice.balance_amount || 0);
    try {
      let workingInvoice = selectedInvoice;
      try {
        const updated = await saveHmoClaim(selectedInvoice.id);
        if (updated) {
          workingInvoice = updated;
        }
      } catch (hmoErr) {
        throw new Error(`HMO details were not saved. Payment was not posted: ${String(hmoErr?.message || 'Unknown HMO error')}`);
      }
      priorPaymentIds = new Set(
        (Array.isArray(workingInvoice.payments) ? workingInvoice.payments : [])
          .map((p) => String(p?.id || '').trim())
          .filter(Boolean)
      );
      priorBalance = Number(workingInvoice.balance_amount || 0);
      const due = Number(workingInvoice.balance_amount || 0);
      if (!Number.isFinite(due) || due <= 0) throw new Error('No outstanding balance.');
      const method = String(payMethod || 'Cash').trim();
      if (method === 'GCash') throw new Error('GCash is currently unavailable.');
      const ref = String(payReference || '').trim();
      if (method !== 'Cash' && !ref) throw new Error('Receipt/reference is required.');
      let amountToPost = due;
      if (method === 'Cash') {
        const received = Number(String(cashReceived || payAmount || '').trim());
        if (!Number.isFinite(received) || received <= 0) throw new Error('Enter cash received.');
        if (received + 0.0001 < due) throw new Error(`Cash received is below the amount due of PHP ${toMoney(due)}.`);
      } else {
        amountToPost = Number(String(payAmount || '').trim());
        if (!Number.isFinite(amountToPost) || amountToPost <= 0) throw new Error('Enter the amount to post.');
        if (amountToPost - due > 0.0001) throw new Error(`Payment cannot exceed the balance of PHP ${toMoney(due)}.`);
      }
      const createdPayment = await fetchJson(`/api/billing/payments`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: {
          ...buildHeaders(user),
          'x-idempotency-key': paymentIdempotencyKeyRef.current || (paymentIdempotencyKeyRef.current = (globalThis.crypto?.randomUUID?.() || `cashier-${selectedInvoice.id}-${Date.now()}`))
        },
        timeoutMs: 90000,
        body: JSON.stringify({
          invoiceId: workingInvoice.id,
          amount: amountToPost,
          method,
          reference: ref || null
        })
      });
      setPayReference('');
      paymentIdempotencyKeyRef.current = '';
      const received = method === 'Cash' ? Number(String(cashReceived || payAmount || '').trim()) : amountToPost;
      setCashReceived('');
      setPayAmount('');
      const receipt = buildConsultationReceipt({ 
        invoice: workingInvoice, 
        payment: createdPayment, 
        user, 
        amountReceivedOverride: received,
        philhealthDeduction,
        hmoCoverage,
        hmoProvider,
        loaNumber
      });
      setPaymentReceipt(receipt);
      setReceiptToPrint(receipt);
      await openInvoice(workingInvoice.id);
      await refreshInvoices();
      await refreshPaymentHistory();
      if (role === 'cashier') await fetchCloseout({ date: closeoutDate });
    } catch (e) {
      const isTimeout = String(e?.name || '') === 'AbortError' || /timed out/i.test(String(e?.message || ''));
      if (isTimeout && selectedInvoice?.id) {
        try {
          await saveHmoClaim(selectedInvoice.id).catch(() => null);
          const latest = await fetchJson(`/api/billing/invoices/${encodeURIComponent(String(selectedInvoice.id))}`, {
            apiBase: API_BASE,
            headers: buildHeaders(user),
            timeoutMs: 30000
          });
          const currentPayments = Array.isArray(latest?.payments) ? latest.payments : [];
          const newestPayment =
            currentPayments.find((p) => !priorPaymentIds.has(String(p?.id || '').trim())) ||
            currentPayments
              .slice()
              .sort((a, b) => {
                const at = a?.created_at || a?.createdAt || 0;
                const bt = b?.created_at || b?.createdAt || 0;
                const ad = at ? new Date(at).getTime() : 0;
                const bd = bt ? new Date(bt).getTime() : 0;
                if (ad !== bd) return bd - ad;
                return Number(b?.id || 0) - Number(a?.id || 0);
              })[0] ||
            null;

          const nextBalance = Number(latest?.balance_amount || 0);
          const markedPaid = String(latest?.status || '').trim().toLowerCase() === 'paid';
          const balanceMoved = Number.isFinite(priorBalance) && Number.isFinite(nextBalance) && nextBalance + 0.0001 < priorBalance;

          if (newestPayment && (markedPaid || balanceMoved)) {
            const method = String(payMethod || 'Cash').trim();
            const received = method === 'Cash' ? Number(String(cashReceived || payAmount || '').trim()) : Number(newestPayment.amount || 0);
            setPayReference('');
            setCashReceived('');
            setPayAmount('');
            const receipt = buildConsultationReceipt({ 
              invoice: latest, 
              payment: newestPayment, 
              user, 
              amountReceivedOverride: received,
              philhealthDeduction,
              hmoCoverage,
              hmoProvider,
              loaNumber
            });
            setPaymentReceipt(receipt);
            setReceiptToPrint(receipt);
            await openInvoice(selectedInvoice.id);
            await refreshInvoices();
            await refreshPaymentHistory();
            if (role === 'cashier') await fetchCloseout({ date: closeoutDate });
            return;
          }
        } catch (_) {}
      }
      if (!(String(e?.name || '') === 'AbortError' || /timed out/i.test(String(e?.message || '')))) {
        paymentIdempotencyKeyRef.current = '';
      }
      setPaymentError(String(e.message || 'Failed to record payment'));
    } finally {
      setPaymentLoading(false);
    }
  };

  const createAdjustment = async (type) => {
    if (!user || !selectedInvoice?.id) return;
    
    // Add Reason validation for both Void and Refund
    if (type === 'void' && !voidReason.trim()) {
      setAdjustmentError('Please provide a reason for voiding this invoice.');
      return;
    }
    if (type === 'refund' && !refundReason.trim()) {
      setAdjustmentError('Please provide a reason for this refund.');
      return;
    }

    setAdjustmentLoading(true);
    setAdjustmentError('');
    try {
      const payload = { invoiceId: selectedInvoice.id, type };
      if (type === 'refund') {
        const amountRaw = Number(refundAmount || 0);
        if (!Number.isFinite(amountRaw) || amountRaw <= 0) throw new Error('Enter a valid refund amount.');
        const ref = String(refundReference || '').trim();
        if (!ref) throw new Error('Refund reference is required.');
        payload.amount = amountRaw;
        payload.reference = ref;
        payload.reason = String(refundReason).trim();
      } else if (type === 'void') {
        payload.reference = voidReference ? String(voidReference).trim() : null;
        payload.reason = String(voidReason).trim();
      } else {
        throw new Error('Invalid adjustment type.');
      }

      await fetchJson(`/api/billing/adjustments`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: buildHeaders(user),
        body: JSON.stringify(payload)
      });

      // Clear fields after success
      setVoidReason('');
      setVoidReference('');
      setRefundReason('');
      setRefundReference('');
      setRefundAmount('');

      await openInvoice(selectedInvoice.id);
      await refreshInvoices();
    } catch (e) {
      setAdjustmentError(String(e.message || 'Failed to apply adjustment'));
    } finally {
      setAdjustmentLoading(false);
    }
  };

  const recordLabPayment = async () => {
    if (!user || role !== 'cashier' || !selectedLabOrder?.id) return;
    const amountReceived = Number(labPaymentAmount || 0);
    const amountDue = Number(selectedLabOrder?.amountDue ?? selectedLabOrder?.patientPayable ?? selectedLabOrder?.unitPrice ?? 0);
    const grossAmount = Number(selectedLabOrder?.configuredUnitPrice ?? selectedLabOrder?.unitPrice ?? 0);
    const method = String(labPaymentMethod || 'Cash').trim();
    const ref = String(labPaymentReference || '').trim();
    if (!selectedLabOrder?.priceConfigured) {
      setLabPaymentError('No configured cashier price is available for this lab service yet.');
      return;
    }
    const hmoCoveredZeroPay = Number(amountDue) <= 0.0099;
    if (!hmoCoveredZeroPay) {
      if (method !== 'Cash' && !ref) {
        setLabPaymentError('Receipt/reference is required.');
        return;
      }
      if (!Number.isFinite(amountReceived) || amountReceived <= 0) {
        setLabPaymentError('Enter the amount received.');
        return;
      }
      if (amountReceived + 0.0001 < amountDue) {
        setLabPaymentError(`Amount received is below the amount due of PHP ${toMoney(amountDue)}.`);
        return;
      }
    } else {
      if (!ref) {
        setLabPaymentError('Reference / LOA number is required for HMO-covered transactions.');
        return;
      }
    }
    setLabPaymentLoading(true);
    setLabPaymentError('');
    try {
      const phDed = Number(selectedLabOrderHmo?.philhealth_deduction || selectedLabOrder?.philhealthApplied || 0);
      const hmoCov = Number(selectedLabOrderHmo?.applied_hmo_amount || selectedLabOrderHmo?.loa_approved_amount || selectedLabOrder?.hmoCoverageApplied || 0);
      const receiptPayload = {
        orderId: String(selectedLabOrder.id),
        patientName: selectedLabOrder.patientName || 'Patient',
        serviceLabel: selectedLabOrder.priceLabel || selectedLabOrder.service || selectedLabOrder.kind || 'Lab Service',
        amountDue: Number(grossAmount || 0),
        philhealthDeduction: phDed,
        hmoCoverage: hmoCov,
        hmoProvider: selectedLabOrderHmo?.hmo_provider || (selectedLabOrder?.hmoIndicators?.provider) || '',
        loaNumber: selectedLabOrderHmo?.loa_number || selectedLabOrderHmo?.hmo_loa_number || (selectedLabOrder?.hmoIndicators?.loaNumber) || '',
        netAmountDue: Number(amountDue || 0),
        amountReceived: hmoCoveredZeroPay ? 0 : amountReceived,
        change: hmoCoveredZeroPay ? 0 : Math.max(0, amountReceived - amountDue),
        method: hmoCoveredZeroPay ? 'HMO' : method,
        reference: ref || 'HMO COVERED',
        cashierName: user.name || user.first_name || user.firstName || user.email || 'Cashier',
        paidAt: new Date().toISOString()
      };
      receiptPayload.paidAtLabel = formatDateTime(receiptPayload.paidAt);
      receiptPayload.receiptNumber = `PGH-LAB-${receiptPayload.orderId}-${Date.now().toString().slice(-6)}`;
      await fetchJson(`/api/clinical-orders/${encodeURIComponent(String(selectedLabOrder.id))}`, {
        apiBase: API_BASE,
        method: 'PATCH',
        headers: buildHeaders(user),
        body: JSON.stringify({
          status: 'Paid',
          paymentReference: ref || 'HMO COVERED',
          paymentMethod: hmoCoveredZeroPay ? 'HMO' : (labPaymentMethod || null),
          paymentAmount: hmoCoveredZeroPay ? 0 : amountReceived,
          actorName: user.name || user.first_name || user.firstName || user.email || 'Cashier',
          actorRole: 'cashier',
          eventNote: hmoCoveredZeroPay
            ? `HMO-authorized • No cash collection • ${ref || 'HMO COVERED'}`
            : `Payment recorded • ${labPaymentMethod || 'method'} • ${ref}`
        })
      });
      setSelectedLabOrder(null);
      setLabPaymentMethod('Cash');
      setLabPaymentAmount('');
      setLabPaymentReference('');
      setPaymentReceipt({ ...receiptPayload, source: hmoCoveredZeroPay ? 'Lab Payment (HMO)' : 'Lab Payment' });
      await refreshLabOrders();
      await refreshPaymentHistory();
      if (role === 'cashier') await fetchCloseout({ date: closeoutDate });
    } catch (e) {
      setLabPaymentError(String(e.message || 'Failed to record payment'));
    } finally {
      setLabPaymentLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    refreshInvoices();
    if (role === 'cashier') refreshDashboardKpis();
  }, [user]);

  useEffect(() => {
    if (!user || role !== 'cashier') return;
    if (!['dashboard', 'billing', 'lab-payments'].includes(view)) return;
    refreshLabOrders();
  }, [refreshLabOrders, role, user, view]);

  useEffect(() => {
    if (!user || role !== 'cashier') return;
    if (!['dashboard', 'payments', 'closeout'].includes(view)) return;
    refreshPaymentHistory();
  }, [refreshPaymentHistory, role, user, view]);

  useEffect(() => {
    if (!user) return;
    if (role !== 'cashier') return;
    if (!['dashboard', 'billing', 'lab-payments', 'closeout'].includes(view)) return;
    fetchCloseout({ date: closeoutDate });
  }, [closeoutDate, role, user, view]);

  const handleLogout = async () => {
    try {
      const u = getUser();
      if (u && u._id && localStorage.getItem('tempLoginEmail') !== 'admin@pgh.com') {
        await fetchJson(`/api/staff/logout`, {
          apiBase: API_BASE,
          method: 'POST',
          headers: buildHeaders(u),
          body: JSON.stringify({ id: u._id, accountType: u.accountType || u.account_type || u.role || role })
        });
      }
    } catch (_) {
    }
    localStorage.removeItem('currentUser');
    localStorage.removeItem('tempLoginEmail');
    localStorage.removeItem('tempLoginRole');
    localStorage.removeItem('generatedOTP');
    navigate('/login');
  };

  const navItems = useMemo(() => {
    const base = [
      { key: 'dashboard', label: 'Dashboard', icon: <ClipboardList size={18} /> },
      { key: 'patients', label: 'Patients', icon: <User size={18} /> },
      { key: 'billing', label: 'Billing', icon: <FileText size={18} /> },
      { key: 'hmo', label: 'HMO Monitoring', icon: <Shield size={18} /> }
    ];
    if (role === 'doctor_secretary') {
      base.splice(1, 0, { key: 'appointments', label: 'Appointments', icon: <ClipboardList size={18} /> });
    }
    if (role === 'cashier') {
      base.push({ key: 'lab-payments', label: 'Lab Payments', icon: <CreditCard size={18} /> });
      base.push({ key: 'payments', label: 'Payments', icon: <CreditCard size={18} /> });
      base.push({ key: 'closeout', label: 'Daily Closeout', icon: <FileText size={18} /> });
    }
    return base;
  }, [role]);

  const dashboardKpis = useMemo(() => {
    if (role === 'cashier' && invoiceSummary) {
      return {
        todaysInvoices: Number(invoiceSummary.todayCount || 0),
        unpaidCount: Number(invoiceSummary.openCount || 0),
        readyCount: Number(invoiceSummary.readyCount || 0)
      };
    }
    const today = new Date();
    const todayStr = today.toDateString();
    const todaysInvoices = invoices.filter((i) => new Date(i.created_at || i.createdAt || 0).toDateString() === todayStr);
    const unpaid = invoices.filter((i) => String(i.status || '').toLowerCase() !== 'paid');
    const ready = invoices.filter((i) => String(i.status || '').toLowerCase() === 'ready');
    return {
      todaysInvoices: todaysInvoices.length,
      unpaidCount: unpaid.length,
      readyCount: ready.length
    };
  }, [invoiceSummary, invoices, role]);

  const billingSummary = useMemo(() => {
    const list = Array.isArray(invoices) ? invoices : [];
    const ready = list.filter((i) => String(i.status || '').toLowerCase() === 'ready');
    const consultationReady = ready.filter((i) => inferInvoiceSource(i) === 'Onsite Consultation').length;
    const collectedToday = Number(closeout?.billing?.total_collected ?? 0) || 0;
    const paidToday = Number(closeout?.billing?.payments_count ?? 0) || 0;
    return {
      readyCount: ready.length,
      consultationReady,
      collectedToday,
      paidToday
    };
  }, [closeout, invoices]);

  const filteredPaymentHistory = useMemo(() => {
    return Array.isArray(paymentHistory) ? paymentHistory : [];
  }, [paymentHistory]);

  useEffect(() => {
    setPaymentsPage(1);
  }, [paymentsQuery, paymentsSource]);

  const pagedPaymentHistory = useMemo(() => {
    const perPage = 8;
    const list = filteredPaymentHistory;
    const totalPages = Math.max(1, Math.ceil(paymentHistoryTotal / perPage));
    const currentPage = Math.min(Math.max(1, paymentsPage), totalPages);
    const startIndex = (currentPage - 1) * perPage;
    return {
      perPage,
      totalPages,
      currentPage,
      startIndex,
      endIndex: startIndex + perPage,
      totalCount: paymentHistoryTotal,
      items: list
    };
  }, [filteredPaymentHistory, paymentHistoryTotal, paymentsPage]);

  const paymentHistorySummary = useMemo(() => {
    const list = filteredPaymentHistory;
    const sourceCount = (label) => list.filter((payment) => String(payment.source || '') === label).length;
    const totalCollected = paymentHistoryCollected;
    return {
      totalCollected,
      transactionCount: paymentHistoryTotal,
      consultationCount: sourceCount('Onsite Consultation'),
      videoCount: sourceCount('Video Consultation'),
      labCount: sourceCount('Lab')
    };
  }, [filteredPaymentHistory, paymentHistoryCollected, paymentHistoryTotal]);

  const displayedInvoices = useMemo(() => {
    const list = Array.isArray(invoices) ? invoices : [];
    if (invoiceRange === 'All') return list;
    const inRange = (dateValue) => {
      const d = dateValue ? new Date(dateValue) : null;
      if (!d || Number.isNaN(d.getTime())) return false;
      if (invoiceRange === 'Today') return d.toDateString() === new Date().toDateString();
      if (invoiceRange === 'Week') {
        const now = new Date();
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - 6);
        return d >= start && d <= now;
      }
      return true;
    };
    return list.filter((inv) => inRange(inv.created_at || inv.createdAt || null));
  }, [invoiceRange, invoices]);

  useEffect(() => {
    setInvoicePage(1);
  }, [invoiceStatus, invoiceRange]);

  useEffect(() => {
    setLabPage(1);
  }, [labOrdersRange, labOrdersQuery, labOrders.length]);

  const pagedDisplayedInvoices = useMemo(() => {
    const perPage = 8;
    const list = displayedInvoices;
    const totalPages = Math.max(1, Math.ceil(invoiceTotalCount / perPage));
    const currentPage = Math.min(Math.max(1, invoicePage), totalPages);
    const startIndex = (currentPage - 1) * perPage;
    return {
      perPage,
      totalPages,
      currentPage,
      startIndex,
      endIndex: startIndex + perPage,
      totalCount: invoiceTotalCount,
      items: list
    };
  }, [displayedInvoices, invoicePage, invoiceTotalCount]);

  const displayedLabOrders = useMemo(() => {
    const list = Array.isArray(labOrders) ? labOrders : [];
    const q = String(labOrdersQuery || '').trim().toLowerCase();
    const inRange = (dateValue) => {
      if (labOrdersRange === 'All') return true;
      const d = dateValue ? new Date(dateValue) : null;
      if (!d || Number.isNaN(d.getTime())) return false;
      if (labOrdersRange === 'Today') return d.toDateString() === new Date().toDateString();
      if (labOrdersRange === 'Week') {
        const now = new Date();
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - 6);
        return d >= start && d <= now;
      }
      return true;
    };
    return list.filter((o) => {
      const when = o.createdAt || o.scheduledAt || null;
      if (!inRange(when)) return false;
      if (!q) return true;
      const hmoProv = String(o.hmoIndicators?.provider || '').toLowerCase();
      const hmoLoa = String(o.hmoIndicators?.loaNumber || '').toLowerCase();
      const hay = `${o.patientName || ''} ${o.service || ''} ${o.kind || ''} ${hmoProv} ${hmoLoa}`.toLowerCase();
      return hay.includes(q);
    });
  }, [labOrders, labOrdersQuery, labOrdersRange]);

  const pagedLabOrders = useMemo(() => {
    const perPage = 8;
    const list = displayedLabOrders;
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    const currentPage = Math.min(Math.max(1, labPage), totalPages);
    const startIndex = (currentPage - 1) * perPage;
    return {
      perPage,
      totalPages,
      currentPage,
      startIndex,
      endIndex: startIndex + perPage,
      totalCount: list.length,
      items: list.slice(startIndex, startIndex + perPage)
    };
  }, [displayedLabOrders, labPage]);

  const selectedLabOrderDue = useMemo(() => {
    const gross = Number(selectedLabOrder?.amountDue ?? selectedLabOrder?.unitPrice ?? 0);
    const hmoAmt = Number(selectedLabOrderHmo?.applied_hmo_amount || selectedLabOrderHmo?.loa_approved_amount || 0);
    const phAmt = Number(selectedLabOrderHmo?.philhealth_deduction || 0);
    const due = Math.max(0, gross - hmoAmt - phAmt);
    return Number.isFinite(due) ? due : 0;
  }, [selectedLabOrder, selectedLabOrderHmo]);

  const selectedLabOrderReceived = useMemo(() => {
    const received = Number(labPaymentAmount || 0);
    return Number.isFinite(received) ? received : 0;
  }, [labPaymentAmount]);

  const selectedLabOrderChange = useMemo(() => {
    if (labPaymentMethod !== 'Cash') return 0;
    return Math.max(0, selectedLabOrderReceived - selectedLabOrderDue);
  }, [labPaymentMethod, selectedLabOrderDue, selectedLabOrderReceived]);

  const selectedLabOrderShort = useMemo(() => {
    return Math.max(0, selectedLabOrderDue - selectedLabOrderReceived);
  }, [selectedLabOrderDue, selectedLabOrderReceived]);

  return (
    <div className="office-shell" style={{ paddingTop: backendHealth.checked && !backendHealth.ok ? 44 : 0 }}>
      {backendHealth.checked && !backendHealth.ok ? (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            background: '#fee2e2',
            color: '#991b1b',
            padding: '10px 12px',
            fontWeight: 800,
            borderBottom: '1px solid #fecaca'
          }}
        >
          Backend offline: {backendHealth.error}
        </div>
      ) : null}
      <aside className={`office-sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="office-sidebar-top">
          <div className="office-brand">
            <img className="office-brand-logo" src="/images/pgh%20logo.png" alt="PASCUALINGA" />
            {!collapsed ? <span className="office-brand-text">PASCUALINGA</span> : null}
          </div>
          <button type="button" className="office-collapse-btn" onClick={() => setCollapsed((v) => !v)} aria-label="Toggle sidebar">
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        <nav className="office-nav">
          {navItems.map((it) => (
            <button
              key={it.key}
              type="button"
              className={`office-nav-btn ${view === it.key ? 'active' : ''}`}
              onClick={() => setView(it.key)}
              title={it.label}
            >
              {it.icon}
              {!collapsed ? <span className="office-nav-label">{it.label}</span> : null}
            </button>
          ))}
        </nav>

      </aside>

      <main className="office-main">
        <div style={{ width: '100%', maxWidth: 1500, margin: '0 auto', flex: 1, minWidth: 0 }}>
          <div className="office-header">
            <div className="office-header-left">
              <div>
                <div className="office-title">{roleLabel}</div>
                <div className="office-subtitle">
                  {view === 'dashboard' ? 'Overview' :
                   view === 'profile' ? 'My Profile' :
                   view === 'hmo' ? 'HMO Monitoring' :
                   view === 'lab-payments' ? 'Lab Payments' :
                   view === 'closeout' ? 'Daily Closeout' :
                   view.charAt(0).toUpperCase() + view.slice(1)}
                </div>
              </div>
            </div>
            <div className="office-header-right">
              <button
                type="button"
                className="office-btn ghost"
                onClick={async () => {
                  if (!user) return;
                  try {
                    if (view === 'hmo') {
                      await refreshHmoQueue();
                    } else if (view === 'patients' || (view === 'billing' && role === 'doctor_secretary')) {
                      await refreshPatients();
                    } else if (view === 'lab-payments') {
                      await refreshLabOrders();
                    } else if (view === 'appointments') {
                      await refreshAppointments();
                    } else {
                      await Promise.all([refreshInvoices(), refreshDashboardKpis()]);
                    }
                  } catch (_) {}
                }}
                disabled={!user}
                title="Refresh"
              >
                <RefreshCw size={16} />
                Refresh
              </button>
              <AccountHeaderActions user={user} roleLabel={roleLabel} showChangePasswordMenu={false} onSignOut={() => setShowLogoutConfirm(true)} onMyProfile={() => setView('profile')} />
            </div>
          </div>

          {view === 'dashboard' ? (
          <>
            <div className="office-grid-4">
              <div className="office-kpi">
                <div className="office-kpi-k">Invoices Today</div>
                <div className="office-kpi-v">{dashboardKpis.todaysInvoices}</div>
              </div>
              <div className="office-kpi">
                <div className="office-kpi-k">Ready For Payment</div>
                <div className="office-kpi-v">{dashboardKpis.readyCount}</div>
              </div>
              <div className="office-kpi">
                <div className="office-kpi-k">Unpaid / Open</div>
                <div className="office-kpi-v">{dashboardKpis.unpaidCount}</div>
              </div>
              <div className="office-kpi">
                <div className="office-kpi-k">Lab Payments Waiting</div>
                <div className="office-kpi-v">{displayedLabOrders.length}</div>
                <div className="office-kpi-meta">Pay-before-exam queue</div>
              </div>
            </div>

            {role === 'cashier' ? (
              <div className="office-card" style={{ marginTop: 16 }}>
                <div className="office-billing-section-head">
                  <div>
                    <div className="office-title" style={{ fontSize: '1.05rem' }}>Pending Lab Payments</div>
                    <div className="office-subtitle">Patients must pay cashier first before the lab exam can proceed.</div>
                  </div>
                  <button type="button" className="office-btn" onClick={() => { setView('lab-payments'); refreshLabOrders(); }}>
                    <CreditCard size={16} />
                    Open Lab Queue
                  </button>
                </div>
                <div className="logs-table-container" style={{ maxHeight: 320 }}>
                  <table className="staff-table">
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Patient</th>
                        <th>Service</th>
                        <th>Amount Due</th>
                        <th>Status</th>
                        <th className="inc-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {labOrdersLoading ? (
                        <tr>
                          <td colSpan="6" className="text-center py-8 text-slate-500">Loading...</td>
                        </tr>
                      ) : displayedLabOrders.length === 0 ? (
                        <tr>
                          <td colSpan="6" className="text-center py-8 text-slate-500">No pending lab payments right now.</td>
                        </tr>
                      ) : (
                        displayedLabOrders.slice(0, 5).map((o) => (
                          <tr key={String(o.id)}>
                            <td className="text-sm font-medium text-slate-900">#{o.id}</td>
                            <td className="text-sm text-slate-900">{o.patientName || '—'}</td>
                            <td className="text-sm text-slate-900">{o.service || o.kind || '—'}</td>
                            <td className="text-sm text-slate-900">
                              {String(o.status || '').toLowerCase() === 'paid'
                                ? (
                                  <div>
                                    <div style={{ textDecoration: 'line-through', opacity: 0.55, fontWeight: 500, fontSize: '12px', color: '#475569' }}>₱ {toMoney(Number(o.configuredUnitPrice ?? o.unitPrice ?? 0))}</div>
                                    <div style={{ fontWeight: 900, color: '#0f172a' }}>₱ 0.00 (covered by HMO)</div>
                                  </div>
                                )
                                : (o.priceConfigured ? `₱ ${toMoney(o.amountDue)}` : 'Needs setup')}
                            </td>
                            <td>
                              {String(o.status || '').toLowerCase() === 'paid'
                                ? <span className="status-badge-table status-duty" style={{ background: '#e2e8f0', color: '#0f172a', border: '1px solid #cbd5e1', fontWeight: 900 }}>PAID (HMO)</span>
                                : <span className="status-badge-table status-upcoming">{o.status || 'For Payment'}</span>}
                            </td>
                            <td className="inc-right">
                              {String(o.status || '').toLowerCase() === 'paid'
                                ? (
                                  <button type="button" className="office-btn ghost" onClick={() => openLabOrderPos(o)}>
                                    View Record
                                  </button>
                                )
                                : (
                                  <button
                                    type="button"
                                    className="office-btn ghost"
                                    onClick={() => openLabOrderPos(o)}
                                  >
                                    Record Payment
                                  </button>
                                )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {view === 'profile' ? (
          <div className="sec-profile-module">
            <div className="sec-profile-card-main">
              <div className="sec-profile-left">
                <div className="sec-avatar-edit">
                  <div className="sec-avatar-large">
                    {profileAvatarUrl ? (
                      <img src={profileAvatarUrl} alt="Profile" />
                    ) : (
                      <span>{(profileForm.firstName[0] || 'U').toUpperCase()}</span>
                    )}
                    {uploadingAvatar && <div className="sec-avatar-loading"><RefreshCw size={24} className="animate-spin" /></div>}
                  </div>
                  <label className="sec-avatar-upload-label">
                    <Upload size={16} />
                    {uploadingAvatar ? 'Uploading...' : 'Change Photo'}
                    <input type="file" onChange={handleAvatarUpload} disabled={uploadingAvatar} hidden accept="image/*" />
                  </label>
                </div>

                <div className="sec-profile-info-static">
                  <h3>{profileForm.firstName} {profileForm.lastName}</h3>
                  <p>{profileForm.email}</p>
                </div>
              </div>

              <div className="sec-profile-right">
                <form className="admin-profile-form" onSubmit={(e) => { e.preventDefault(); saveProfile(); }}>
                  <div className="profile-form-grid">
                    <div className="profile-column">
                      <div className="profile-card">
                        <h3 className="column-title">
                          <User size={20} color="#475569" />
                          Personal Information
                        </h3>

                        <div className="profile-input-group">
                          <label>First Name</label>
                          <div className="input-wrapper-relative">
                            <User size={18} className="absolute-icon-left text-slate-400" />
                            <input
                              type="text"
                              className="profile-input input-with-icon-padding"
                              value={profileForm.firstName}
                              onChange={(e) => setProfileForm(v => ({ ...v, firstName: e.target.value }))}
                              placeholder="First name"
                            />
                          </div>
                        </div>

                        <div className="profile-input-group">
                          <label>Last Name</label>
                          <div className="input-wrapper-relative">
                            <User size={18} className="absolute-icon-left text-slate-400" />
                            <input
                              type="text"
                              className="profile-input input-with-icon-padding"
                              value={profileForm.lastName}
                              onChange={(e) => setProfileForm(v => ({ ...v, lastName: e.target.value }))}
                              placeholder="Last name"
                            />
                          </div>
                        </div>

                        <div className="profile-input-group">
                          <label>Email Address (Not changeable)</label>
                          <div className="input-wrapper-relative">
                            <Mail size={18} className="absolute-icon-left text-slate-400" />
                            <input
                              type="email"
                              className="profile-input input-with-icon-padding input-disabled-bg"
                              value={profileForm.email}
                              readOnly
                            />
                          </div>
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
                              className="profile-input input-with-icon-padding"
                              value={profileForm.currentPassword}
                              onChange={(e) => setProfileForm(v => ({ ...v, currentPassword: e.target.value }))}
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
                          <p className="field-notice-error" style={{ color: '#94a3b8' }}>Required only when changing your password.</p>
                        </div>

                        <div className="profile-input-group">
                          <label>New Password</label>
                          <div className="input-wrapper-relative">
                            <Key size={18} className="absolute-icon-left text-slate-400" />
                            <input
                              type={showNewPassword ? "text" : "password"}
                              className="profile-input input-with-icon-padding"
                              value={profileForm.newPassword}
                              onChange={(e) => setProfileForm(v => ({ ...v, newPassword: e.target.value }))}
                              placeholder="Enter new password (leave blank to keep)"
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
                              className="profile-input input-with-icon-padding"
                              value={profileForm.confirmPassword}
                              onChange={(e) => setProfileForm(v => ({ ...v, confirmPassword: e.target.value }))}
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
                          {profileForm.confirmPassword ? (
                            <p className={`match-indicator ${profileForm.newPassword === profileForm.confirmPassword ? 'match-success' : 'match-error'}`}>
                              {profileForm.newPassword === profileForm.confirmPassword ? 'Passwords match' : 'Passwords do not match'}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>

                  {profileMessage.text && (
                    <div className={`sec-profile-alert ${profileMessage.type}`}>
                      {profileMessage.type === 'success' ? <CheckCircle2 size={16} /> : <ShieldAlert size={16} />}
                      <span>{profileMessage.text}</span>
                    </div>
                  )}

                  <div className="form-actions-row">
                    <button type="submit" className="btn-neutral-large flex-center-gap-8" disabled={savingProfile}>
                      <Save size={18} />
                      {savingProfile ? 'Saving Changes…' : 'Save Changes'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        ) : null}

        {view === 'patients' ? (
          <div className="office-card">
            <div className="office-row" style={{ justifyContent: 'space-between' }}>
              <div className="office-row">
                <div className="input-wrapper-relative">
                  <Search size={18} className="absolute-icon-left text-slate-400" />
                  <input
                    className="search-input-with-icon"
                    value={patientQuery}
                    onChange={(e) => setPatientQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') refreshPatients();
                    }}
                    placeholder="Search patient name/email..."
                  />
                </div>
                <button type="button" className="office-btn primary" onClick={refreshPatients} disabled={patientsLoading || !user}>
                  Search
                </button>
              </div>
            </div>

            <div className="logs-table-container" style={{ marginTop: 14, maxHeight: '520px' }}>
              <table className="staff-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Contact</th>
                    <th>Gender</th>
                    <th className="inc-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {patientsError ? (
                    <tr>
                      <td colSpan="5" className="text-center py-8 text-slate-500">{patientsError}</td>
                    </tr>
                  ) : patientsLoading ? (
                    <tr>
                      <td colSpan="5" className="text-center py-8 text-slate-500">Loading...</td>
                    </tr>
                  ) : patients.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="text-center py-8 text-slate-500">No patients found.</td>
                    </tr>
                  ) : (
                    patients.slice(0, 100).map((p) => (
                      <tr key={p.id}>
                        <td className="text-sm font-medium text-slate-700">{`${p.first_name || ''} ${p.last_name || ''}`.trim() || '—'}</td>
                        <td className="text-sm text-slate-600">{p.email || '—'}</td>
                        <td className="text-sm text-slate-600">{p.contact_number || '—'}</td>
                        <td className="text-sm text-slate-600">{p.gender || '—'}</td>
                        <td className="inc-right">
                          <button
                            type="button"
                            className="office-btn ghost"
                            onClick={() => {
                              setCentralRecordPatientId(String(p.id));
                              setCentralRecordPatientLabel(`${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Patient');
                              setCentralRecordOpen(true);
                            }}
                          >
                            View Record
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {view === 'appointments' && role === 'doctor_secretary' ? (
          <div className="office-card">
            <div className="office-row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="office-title" style={{ fontSize: '1.05rem' }}>Appointments</div>
                <div className="office-subtitle">View submitted appointments</div>
              </div>
              <button type="button" className="office-btn primary" onClick={refreshAppointments} disabled={appointmentsLoading || !user}>
                <RefreshCw size={16} />
                Refresh
              </button>
            </div>

            <div className="logs-table-container" style={{ marginTop: 14, maxHeight: '520px' }}>
              <table className="staff-table">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Email</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {appointmentsError ? (
                    <tr>
                      <td colSpan="5" className="text-center py-8 text-slate-500">{appointmentsError}</td>
                    </tr>
                  ) : appointmentsLoading ? (
                    <tr>
                      <td colSpan="5" className="text-center py-8 text-slate-500">Loading...</td>
                    </tr>
                  ) : appointments.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="text-center py-8 text-slate-500">No appointments found.</td>
                    </tr>
                  ) : (
                    appointments.slice(0, 100).map((a) => (
                      <tr key={a.id}>
                        <td className="text-sm font-medium text-slate-700">{`${a.first_name || ''} ${a.last_name || ''}`.trim() || '—'}</td>
                        <td className="text-sm text-slate-600">{a.email || '—'}</td>
                        <td className="text-sm text-slate-600">{a.appointment_date ? String(a.appointment_date).slice(0, 10) : '—'}</td>
                        <td className="text-sm text-slate-600">{a.appointment_time ? String(a.appointment_time).slice(0, 5) : '—'}</td>
                        <td>
                          <span className="status-badge-table status-upcoming">{a.status || 'Pending'}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {view === 'billing' ? (
          <div className="office-billing-shell">
            <div className="office-grid-3">
              <div className="office-kpi office-kpi-accent">
                <div className="office-kpi-k">Ready For Payment</div>
                <div className="office-kpi-v">{billingSummary.readyCount}</div>
                <div className="office-kpi-meta">{billingSummary.consultationReady} consultation invoice(s)</div>
              </div>
              <div className="office-kpi">
                <div className="office-kpi-k">Collected Today</div>
                <div className="office-kpi-v" style={blurStyle} onMouseEnter={blurOnHover} onMouseLeave={resetBlur}>₱ {toMoney(billingSummary.collectedToday)}</div>
                <div className="office-kpi-meta">{billingSummary.paidToday} settled invoice(s)</div>
              </div>
              <div className="office-kpi">
                <div className="office-kpi-k">Invoices Today</div>
                <div className="office-kpi-v">{dashboardKpis.todaysInvoices}</div>
                <div className="office-kpi-meta">{dashboardKpis.unpaidCount} open invoice(s)</div>
              </div>
            </div>

            <div className="office-card office-billing-toolbar">
              <div>
                <div className="office-title" style={{ fontSize: '1.05rem' }}>Billing Queue</div>
                <div className="office-subtitle">Search patient, invoice ID, appointment ID, doctor, or service and open the POS for collection.</div>
              </div>
              <div className="office-row">
                <div className="input-wrapper-relative office-search-wide">
                  <Search size={18} className="absolute-icon-left text-slate-400" />
                  <input
                    className="search-input-with-icon"
                    value={invoiceQuery}
                    onChange={(e) => setInvoiceQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') refreshInvoices({ page: 1 });
                    }}
                    placeholder="Search patient, invoice ID, appointment ID, doctor, or service"
                  />
                </div>
                <button type="button" className="office-btn primary" onClick={() => refreshInvoices({ page: 1 })} disabled={invoiceLoading || !user}>
                  <Search size={16} />
                  Search
                </button>
              </div>
            </div>

          <div className="office-grid-2">
            {role === 'doctor_secretary' ? (
              <div className="office-card">
                <div className="office-title" style={{ fontSize: '1.05rem' }}>Create Invoice</div>
                <div className="office-subtitle">Prepare billing after consultation</div>

                <div className="office-row" style={{ marginTop: 12 }}>
                  <div className="input-wrapper-relative" style={{ flex: 1 }}>
                    <Search size={18} className="absolute-icon-left text-slate-400" />
                    <input
                      className="search-input-with-icon"
                      value={patientQuery}
                      onChange={(e) => setPatientQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') refreshPatients();
                      }}
                      placeholder="Search patient for invoice..."
                    />
                  </div>
                  <button type="button" className="office-btn" onClick={refreshPatients} disabled={!user || patientsLoading}>
                    Search
                  </button>
                </div>

                {patients.length > 0 ? (
                  <div className="modern-list scrollable-list-y" style={{ maxHeight: 220, marginTop: 10 }}>
                    {patients.slice(0, 8).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="modern-list-item"
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          display: 'flex',
                          gap: 12,
                          alignItems: 'center',
                          border: newInvoicePatient?.id === p.id ? '1px solid #fed7aa' : '1px solid #f1f5f9',
                          background: newInvoicePatient?.id === p.id ? '#fff7ed' : '#fff'
                        }}
                        onClick={() => setNewInvoicePatient(p)}
                      >
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>
                          {`${p.first_name || ''} ${p.last_name || ''}`.trim() || '—'}
                        </div>
                        <div style={{ color: '#64748b', fontSize: '0.85rem' }}>{p.email || '—'}</div>
                      </button>
                    ))}
                  </div>
                ) : null}

                <div style={{ marginTop: 14, borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
                  <div className="office-title" style={{ fontSize: '1.0rem' }}>Items</div>
                  <div className="office-subtitle">Add consultation fee and any charges</div>

                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {invoiceItems.map((it, idx) => (
                      <div key={idx} className="office-row">
                        <input
                          className="office-input"
                          style={{ minWidth: 0, flex: 1 }}
                          placeholder="Description"
                          value={it.description}
                          onChange={(e) => updateInvoiceItem(idx, { description: e.target.value })}
                        />
                        <input
                          className="office-input"
                          style={{ width: 90, minWidth: 90 }}
                          type="number"
                          min="1"
                          value={it.quantity}
                          onChange={(e) => updateInvoiceItem(idx, { quantity: e.target.value })}
                        />
                        <input
                          className="office-input"
                          style={{ width: 120, minWidth: 120 }}
                          placeholder="Unit price"
                          value={it.unitPrice}
                          onChange={(e) => updateInvoiceItem(idx, { unitPrice: e.target.value })}
                        />
                        <button type="button" className="office-btn ghost" onClick={() => removeInvoiceItem(idx)} disabled={invoiceItems.length <= 1}>
                          Remove
                        </button>
                      </div>
                    ))}
                    <button type="button" className="office-btn" onClick={addInvoiceItem}>
                      <Plus size={16} />
                      Add item
                    </button>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <textarea
                      className="office-input"
                      style={{ width: '100%', minHeight: 90 }}
                      placeholder="Notes (optional)"
                      value={invoiceNotes}
                      onChange={(e) => setInvoiceNotes(e.target.value)}
                    />
                  </div>

                  {createInvoiceError ? (
                    <div className="admin-alert error" style={{ marginTop: 12 }}>{createInvoiceError}</div>
                  ) : null}

                  <div className="office-row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
                    <div style={{ fontWeight: 900, color: '#0f172a' }}>Total: ₱ {toMoney(invoiceTotal)}</div>
                    <button type="button" className="office-btn primary" onClick={createInvoice} disabled={createInvoiceLoading || !user}>
                      {createInvoiceLoading ? 'Saving…' : 'Create Invoice'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="office-card">
                <div className="office-title" style={{ fontSize: '1.05rem' }}>Cashier POS Search</div>
                <div className="office-subtitle">Open a ready invoice, review the bill, and accept payment in one flow.</div>
                <div className="office-row" style={{ marginTop: 12 }}>
                  <div className="input-wrapper-relative" style={{ flex: 1 }}>
                    <Search size={18} className="absolute-icon-left text-slate-400" />
                    <input
                      className="search-input-with-icon"
                      value={invoiceQuery}
                      onChange={(e) => setInvoiceQuery(e.target.value)}
                      placeholder="Search patient, invoice ID, appointment ID, doctor, or service"
                    />
                  </div>
                  <button type="button" className="office-btn primary" onClick={() => refreshInvoices({ page: 1 })} disabled={invoiceLoading || !user}>
                    Search
                  </button>
                </div>
                <div style={{ marginTop: 12, color: '#64748b', fontSize: '0.9rem' }}>
                  `Ready` invoices will open a POS-style collection panel when selected from the queue.
                </div>
                <div style={{ marginTop: 16, borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
                  <div className="office-billing-section-head">
                    <div>
                      <div className="office-title" style={{ fontSize: '1rem' }}>Lab Payments Preview</div>
                      <div className="office-subtitle">These still pay at cashier first before the exam starts.</div>
                    </div>
                    <button type="button" className="office-btn ghost" onClick={() => setView('lab-payments')}>
                      View All
                    </button>
                  </div>
                  <div className="office-mini-list">
                    {labOrdersLoading ? (
                      <div className="office-mini-item muted">Loading lab queue...</div>
                    ) : displayedLabOrders.length === 0 ? (
                      <div className="office-mini-item muted">No lab payments waiting right now.</div>
                    ) : (
                      displayedLabOrders.slice(0, 3).map((o) => (
                        <button
                          key={String(o.id)}
                          type="button"
                          className="office-mini-item"
                          onClick={() => openLabOrderPos(o)}
                        >
                          <div>
                            <div className="office-billing-patient">{o.patientName || '—'}</div>
                            <div className="office-billing-subline">#{o.id} • {o.service || o.kind || 'Lab Service'}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div className="office-billing-patient" style={{ fontSize: '0.9rem' }}>
                              {o.priceConfigured ? `₱ ${toMoney(o.amountDue)}` : 'Needs setup'}
                            </div>
                            <div className="office-billing-subline">{o.status || 'For Payment'}</div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="office-card office-table-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div className="office-title" style={{ fontSize: '1.05rem' }}>Invoices</div>
                  <div className="office-subtitle">Select to view details</div>
                </div>
                <div className="office-row">
                  <select className="office-select" value={invoiceStatus} onChange={(e) => { const value = e.target.value; setInvoiceStatus(value); refreshInvoices({ page: 1, status: value }); }}>
                    <option value="All">All</option>
                    <option value="Draft">Draft</option>
                    <option value="Ready">Ready</option>
                    <option value="Paid">Paid</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                  <select className="office-select" value={invoiceRange} onChange={(e) => { const value = e.target.value; setInvoiceRange(value); refreshInvoices({ page: 1, range: value }); }}>
                    <option value="All">All Dates</option>
                    <option value="Today">Today</option>
                    <option value="Week">This Week</option>
                  </select>
                  <button type="button" className="office-btn" onClick={() => refreshInvoices({ page: invoicePage })} disabled={invoiceLoading || !user}>
                    <RefreshCw size={16} />
                    Refresh
                  </button>
                </div>
              </div>

              {invoiceError ? <div className="admin-alert error" style={{ margin: 12 }}>{invoiceError}</div> : null}

              <div className="logs-table-container">
                <table className="staff-table">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Patient</th>
                      <th>Status</th>
                      <th>HMO</th>
                      <th>Total</th>
                      <th>Balance</th>
                      <th className="inc-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceLoading ? (
                      <tr>
                        <td colSpan="7" className="text-center py-8 text-slate-500">Loading…</td>
                      </tr>
                    ) : displayedInvoices.length === 0 ? (
                      <tr>
                        <td colSpan="7" className="text-center py-8 text-slate-500">No invoices match your filters.</td>
                      </tr>
                    ) : (
                      pagedDisplayedInvoices.items.map((inv) => {
                        const p = inv.patients;
                        const patientName = p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : '—';
                        const status = inv.status || 'Draft';
                        const claim = inv?.hmo_claim && typeof inv.hmo_claim === 'object' ? inv.hmo_claim : null;
                        const hmoStatus = String(claim?.status || '').trim();
                        const hasHmoClaim = Boolean(hmoStatus && claim);
                        const hmoBadge = (() => {
                          if (!hasHmoClaim) {
                            return <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>—</span>;
                          }
                          const label = hmoStatus === 'Approved' ? `✅ Approved${claim.provider ? ' · ' + claim.provider : ''}` :
                                        hmoStatus === 'Partially Approved' ? `🟡 Partially${claim.provider ? ' · ' + claim.provider : ''}` :
                                        hmoStatus === 'Awaiting LOA' ? `⏳ Awaiting LOA${claim.provider ? ' · ' + claim.provider : ''}` :
                                        hmoStatus === 'Rejected' ? `❌ Rejected` :
                                        `⏸ ${hmoStatus}${claim.provider ? ' · ' + claim.provider : ''}`;
                          const color =
                            hmoStatus === 'Approved' ? { bg: '#16a34a', fg: '#ffffff', ring: '#86efac' } :
                            hmoStatus === 'Partially Approved' ? { bg: '#fde68a', fg: '#854d0e', ring: '#fbbf24' } :
                            hmoStatus === 'Rejected' ? { bg: '#fee2e2', fg: '#991b1b', ring: '#fca5a5' } :
                            hmoStatus === 'Awaiting LOA' ? { bg: '#dbeafe', fg: '#1e3a8a', ring: '#93c5fd' } :
                            { bg: '#f1f5f9', fg: '#334155', ring: '#cbd5e1' };
                          return (
                            <div>
                              <span style={{
                                display: 'inline-block',
                                fontSize: '11px',
                                fontWeight: 800,
                                padding: '4px 8px',
                                borderRadius: 999,
                                background: color.bg,
                                color: color.fg,
                                border: `1px solid ${color.ring}`
                              }}>{label}</span>
                              {hmoStatus === 'Approved' || hmoStatus === 'Partially Approved' ? (
                                <div style={{ marginTop: 4, fontSize: '11px', color: '#475569', fontWeight: 600, lineHeight: '1.45' }}>
                                  {claim.philhealth_deduction > 0 ? <span style={{ color: '#ea580c' }}>−PH {toMoney(claim.philhealth_deduction)}  </span> : null}
                                  {claim.applied_hmo_amount > 0 || claim.loa_approved_amount > 0 ? <span style={{ color: '#2563eb' }}>−HMO {toMoney(Math.max(Number(claim.applied_hmo_amount || 0), Number(claim.loa_approved_amount || 0)))}</span> : null}
                                  <div style={{ color: '#0f172a', fontWeight: 800, marginTop: 2 }}>
                                    Patient pays: ₱ {toMoney(Number(inv.patient_due_amount ?? claim.patient_payable ?? 0))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })();
                        const balanceValue = (() => {
                          if (hasHmoClaim && (hmoStatus === 'Approved' || hmoStatus === 'Partially Approved')) {
                            return Number(inv.balance_amount ?? inv.patient_due_amount ?? claim.patient_payable ?? inv.total_amount ?? 0);
                          }
                          return Number(inv.balance_amount ?? inv.total_amount ?? 0);
                        })();
                        return (
                          <tr key={inv.id}>
                            <td className="text-sm font-medium text-slate-700">#{inv.id}</td>
                            <td className="text-sm text-slate-600">{patientName}</td>
                            <td>
                              <span className={`status-badge-table ${
                                String(status).toLowerCase() === 'paid' ? 'status-duty' :
                                String(status).toLowerCase() === 'ready' ? 'status-upcoming' :
                                String(status).toLowerCase() === 'cancelled' ? 'status-off' : 'status-scheduled'
                              }`}>{status}</span>
                            </td>
                            <td>{hmoBadge}</td>
                            <td className="text-sm text-slate-600">₱ {toMoney(inv.total_amount)}</td>
                            <td className={`text-sm ${hasHmoClaim ? 'font-semibold' : ''} ${Number(balanceValue) <= 0.0001 ? 'text-green-700 font-bold' : 'text-slate-700'}`}>
                              ₱ {toMoney(balanceValue)}
                            </td>
                            <td className="inc-right">
                              <button type="button" className="office-btn ghost" onClick={() => openInvoice(inv.id)}>
                                View
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {pagedDisplayedInvoices.totalCount > 0 ? (
                <div style={{ padding: '12px 16px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', padding: '7px 12px', borderRadius: 9, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569', fontSize: '0.8rem', fontWeight: 700 }}>
                    Showing {pagedDisplayedInvoices.totalCount === 0 ? 0 : pagedDisplayedInvoices.startIndex + 1}–{Math.min(pagedDisplayedInvoices.endIndex, pagedDisplayedInvoices.totalCount)} of {pagedDisplayedInvoices.totalCount}
                  </div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <button
                      type="button"
                      aria-label="Previous page"
                      disabled={pagedDisplayedInvoices.currentPage <= 1 || invoiceLoading}
                      onClick={() => { const next = Math.max(1, pagedDisplayedInvoices.currentPage - 1); setInvoicePage(next); refreshInvoices({ page: next }); }}
                      style={{
                        width: 34, height: 34,
                        borderRadius: 9,
                        border: pagedDisplayedInvoices.currentPage <= 1 || invoiceLoading ? '1px solid #e2e8f0' : '1px solid #cbd5e1',
                        background: pagedDisplayedInvoices.currentPage <= 1 || invoiceLoading ? '#f8fafc' : '#ffffff',
                        color: pagedDisplayedInvoices.currentPage <= 1 || invoiceLoading ? '#cbd5e1' : '#334155',
                        fontWeight: 900,
                        cursor: pagedDisplayedInvoices.currentPage <= 1 || invoiceLoading ? 'not-allowed' : 'pointer',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0
                      }}
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <div style={{ display: 'inline-flex', alignItems: 'center', padding: '7px 10px', borderRadius: 9, background: '#ffffff', border: '1px solid #e2e8f0', color: '#334155', fontSize: '0.8rem', fontWeight: 700, minWidth: 60, justifyContent: 'center' }}>
                      {pagedDisplayedInvoices.currentPage} / {pagedDisplayedInvoices.totalPages}
                    </div>
                    <button
                      type="button"
                      aria-label="Next page"
                      disabled={pagedDisplayedInvoices.currentPage >= pagedDisplayedInvoices.totalPages || invoiceLoading}
                      onClick={() => { const next = Math.min(pagedDisplayedInvoices.totalPages, pagedDisplayedInvoices.currentPage + 1); setInvoicePage(next); refreshInvoices({ page: next }); }}
                      style={{
                        width: 34, height: 34,
                        borderRadius: 9,
                        border: pagedDisplayedInvoices.currentPage >= pagedDisplayedInvoices.totalPages || invoiceLoading ? '1px solid #e2e8f0' : '1px solid #cbd5e1',
                        background: pagedDisplayedInvoices.currentPage >= pagedDisplayedInvoices.totalPages || invoiceLoading ? '#f8fafc' : '#ffffff',
                        color: pagedDisplayedInvoices.currentPage >= pagedDisplayedInvoices.totalPages || invoiceLoading ? '#cbd5e1' : '#334155',
                        fontWeight: 900,
                        cursor: pagedDisplayedInvoices.currentPage >= pagedDisplayedInvoices.totalPages || invoiceLoading ? 'not-allowed' : 'pointer',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0
                      }}
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          </div>
        ) : null}

        {view === 'lab-payments' && role === 'cashier' ? (
          <div className="office-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div className="office-title" style={{ fontSize: '1.05rem' }}>Lab Payments</div>
                <div className="office-subtitle">Orders for pay-before-exam (laboratory / ECG / radiology / imaging). HMO-approved rows show green PAID(HMO) badge with no further payment needed.</div>
              </div>
              <div className="office-row">
                <input className="office-input" value={labOrdersQuery} onChange={(e) => setLabOrdersQuery(e.target.value)} placeholder="Search patient/service" />
                <select className="office-select" value={labOrdersRange} onChange={(e) => setLabOrdersRange(e.target.value)}>
                  <option value="All">All Dates</option>
                  <option value="Today">Today</option>
                  <option value="Week">This Week</option>
                </select>
                <button type="button" className="office-btn" onClick={refreshLabOrders} disabled={labOrdersLoading || !user}>
                  <RefreshCw size={16} />
                  Refresh
                </button>
              </div>
            </div>

            {labOrdersError ? <div className="admin-alert error" style={{ margin: 12 }}>{labOrdersError}</div> : null}

            <div className="logs-table-container" style={{ maxHeight: '520px' }}>
              <table className="staff-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Patient</th>
                    <th>Service</th>
                    <th>HMO Provider</th>
                    <th>LOA #</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>Philhealth</th>
                    <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>HMO Covered</th>
                    <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Patient Pays</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th className="inc-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {labOrdersLoading ? (
                    <tr>
                      <td colSpan="12" className="text-center py-8 text-slate-500">Loading…</td>
                    </tr>
                  ) : displayedLabOrders.length === 0 ? (
                    <tr>
                      <td colSpan="12" className="text-center py-8 text-slate-500">No lab/imaging orders found. Check filters or create a walk-in patient with lab/imaging services.</td>
                    </tr>
                  ) : (
                    pagedLabOrders.items.map((o) => {
                      const statusNorm = String(o.status || '').toLowerCase();
                      const isPrePaid = statusNorm === 'paid';
                      const servicePrice = Number(o.configuredUnitPrice ?? o.unitPrice ?? o.amountDue ?? 0);
                      const rowPatientDue = isPrePaid ? 0 : Number(o.amountDue ?? o.patientPayable ?? servicePrice);
                      const hmo = o.hmoIndicators && typeof o.hmoIndicators === 'object' ? o.hmoIndicators : {};
                      const phNow = Number(o.philhealthApplied || 0);
                      const hmoNow = Number(o.hmoCoverageApplied || 0);
                      return (
                      <tr key={String(o.id)} style={{ background: isPrePaid ? '#ffffff' : undefined }}>
                        <td className="text-sm font-medium text-slate-900">#{o.id}</td>
                        <td className="text-sm text-slate-900" style={{ fontWeight: 700, color: '#0f172a' }}>{o.patientName || '—'}</td>
                        <td className="text-sm text-slate-900" style={{ maxWidth: 260 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span>{o.service || o.kind || '—'}</span>
                            {isPrePaid ? (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                padding: '3px 9px', borderRadius: 999,
                                background: '#e2e8f0', color: '#0f172a',
                                border: '1px solid #cbd5e1',
                                fontSize: '11px', fontWeight: 700
                              }}>
                                HMO COVERED • NO PAYMENT NEEDED
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="text-sm text-slate-600">
                          <div style={{ fontWeight: 700, color: hmo.provider ? '#0f172a' : '#94a3b8', fontSize: '0.82rem' }}>{hmo.provider || '—'}</div>
                          {hmo.cardNumber ? <div className="office-billing-subline" style={{ color: '#64748b', fontSize: '0.72rem' }}>Card: {String(hmo.cardNumber)}</div> : null}
                        </td>
                        <td className="text-sm text-slate-600">
                          {hmo.loaNumber ? (
                            <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#2563eb', fontWeight: 800, fontSize: '0.82rem' }}>{String(hmo.loaNumber)}</div>
                          ) : (
                            <div style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.78rem' }}>no LOA</div>
                          )}
                          {hmo.status ? (
                            <div style={{ marginTop: 3 }}>
                              <span className={`status-badge-table ${
                                String(hmo.status || '').toLowerCase() === 'approved' ? 'status-duty' :
                                String(hmo.status || '').toLowerCase() === 'partially approved' ? 'status-scheduled' :
                                'status-off'
                              }`} style={{ fontSize: '0.68rem', padding: '2px 7px', fontWeight: 800 }}>{hmo.status}</span>
                            </div>
                          ) : null}
                        </td>
                        <td className="text-sm" style={{ color: '#0f172a', textAlign: 'right', fontWeight: 600 }}>
                          ₱ {toMoney(servicePrice)}
                        </td>
                        <td className="text-sm" style={{ color: phNow > 0 ? '#0f172a' : '#94a3b8', textAlign: 'right', fontWeight: 600 }}>
                          {phNow > 0 ? `₱ ${toMoney(phNow)}` : '—'}
                        </td>
                        <td className="text-sm" style={{ color: hmoNow > 0 ? '#15803d' : '#94a3b8', textAlign: 'right', fontWeight: 700 }}>
                          {hmoNow > 0 ? `₱ ${toMoney(hmoNow)}` : '—'}
                        </td>
                        <td className="text-sm" style={{ color: rowPatientDue > 0 && !isPrePaid ? '#b91c1c' : '#0f172a', textAlign: 'right', fontWeight: 900 }}>
                          {isPrePaid ? '₱ 0.00' : `₱ ${toMoney(rowPatientDue)}`}
                        </td>
                        <td>
                          {isPrePaid ? (
                            <span className={`status-badge-table status-duty`} style={{ fontWeight: 900, background: '#e2e8f0', color: '#0f172a', border: '1px solid #cbd5e1' }}>
                              PAID (HMO)
                            </span>
                          ) : (
                            <span className={`status-badge-table ${
                              String(o.status || '').toLowerCase() === 'paid' ? 'status-duty' :
                              String(o.status || '').toLowerCase() === 'for payment' ? 'status-upcoming' :
                              'status-scheduled'
                            }`}>{o.status || '—'}</span>
                          )}
                        </td>
                        <td className="text-sm text-slate-600" style={{ fontSize: '0.78rem' }}>{o.createdAt ? new Date(o.createdAt).toLocaleString() : '—'}</td>
                        <td className="inc-right">
                          {isPrePaid ? (
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                className="office-btn ghost"
                                onClick={async () => { await openLabOrderPos(o); }}
                              >
                                <FileText size={14} style={{ marginRight: 4 }} />
                                View
                              </button>
                              <button
                                type="button"
                                className="office-btn ghost"
                                onClick={() => {
                                  if (typeof window !== 'undefined') {
                                    const patientText = `Patient: ${o.patientName || ''}\nOrder: #${o.id}\nService: ${o.service || o.kind || ''}\nStatus: PAID via HMO (no further payment)\nAmount: ₱ ${toMoney(servicePrice)} (100% covered by HMO)\nCreated: ${o.createdAt ? new Date(o.createdAt).toLocaleString() : ''}\n\nPresent this slip to the station. Patient may proceed directly to the laboratory.`;
                                    navigator.clipboard?.writeText(patientText).catch(() => {});
                                    setSuccessMessage('HMO-covered lab slip copied to clipboard — patient may go directly to lab.');
                                    setModalType('success');
                                    setShowSuccessModal(true);
                                  }
                                }}
                              >
                                Print
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="office-btn ghost"
                              onClick={() => openLabOrderPos(o)}
                            >
                              Record Payment
                            </button>
                          )}
                        </td>
                      </tr>
                    );})
                  )}
                </tbody>
              </table>
            </div>
            {pagedLabOrders.totalCount > 0 ? (
              <div style={{ padding: '12px 16px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', padding: '7px 12px', borderRadius: 9, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569', fontSize: '0.8rem', fontWeight: 700 }}>
                  Showing {pagedLabOrders.totalCount === 0 ? 0 : pagedLabOrders.startIndex + 1}–{Math.min(pagedLabOrders.endIndex, pagedLabOrders.totalCount)} of {pagedLabOrders.totalCount}
                </div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    aria-label="Previous page"
                    disabled={pagedLabOrders.currentPage <= 1 || labOrdersLoading}
                    onClick={() => setLabPage(p => Math.max(1, p - 1))}
                    style={{
                      width: 34, height: 34,
                      borderRadius: 9,
                      border: pagedLabOrders.currentPage <= 1 || labOrdersLoading ? '1px solid #e2e8f0' : '1px solid #cbd5e1',
                      background: pagedLabOrders.currentPage <= 1 || labOrdersLoading ? '#f8fafc' : '#ffffff',
                      color: pagedLabOrders.currentPage <= 1 || labOrdersLoading ? '#cbd5e1' : '#334155',
                      fontWeight: 900,
                      cursor: pagedLabOrders.currentPage <= 1 || labOrdersLoading ? 'not-allowed' : 'pointer',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0
                    }}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <div style={{ display: 'inline-flex', alignItems: 'center', padding: '7px 10px', borderRadius: 9, background: '#ffffff', border: '1px solid #e2e8f0', color: '#334155', fontSize: '0.8rem', fontWeight: 700, minWidth: 60, justifyContent: 'center' }}>
                    {pagedLabOrders.currentPage} / {pagedLabOrders.totalPages}
                  </div>
                  <button
                    type="button"
                    aria-label="Next page"
                    disabled={pagedLabOrders.currentPage >= pagedLabOrders.totalPages || labOrdersLoading}
                    onClick={() => setLabPage(p => Math.min(pagedLabOrders.totalPages, p + 1))}
                    style={{
                      width: 34, height: 34,
                      borderRadius: 9,
                      border: pagedLabOrders.currentPage >= pagedLabOrders.totalPages || labOrdersLoading ? '1px solid #e2e8f0' : '1px solid #cbd5e1',
                      background: pagedLabOrders.currentPage >= pagedLabOrders.totalPages || labOrdersLoading ? '#f8fafc' : '#ffffff',
                      color: pagedLabOrders.currentPage >= pagedLabOrders.totalPages || labOrdersLoading ? '#cbd5e1' : '#334155',
                      fontWeight: 900,
                      cursor: pagedLabOrders.currentPage >= pagedLabOrders.totalPages || labOrdersLoading ? 'not-allowed' : 'pointer',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0
                    }}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {view === 'payments' && role === 'cashier' ? (
          <div className="office-billing-shell">
            <div className="office-grid-4">
              <div className="office-kpi office-kpi-accent">
                <div className="office-kpi-k">Collected</div>
                <div className="office-kpi-v">₱ {toMoney(paymentHistorySummary.totalCollected)}</div>
                <div className="office-kpi-meta">{paymentHistorySummary.transactionCount} recorded transaction(s)</div>
              </div>
              <div className="office-kpi">
                <div className="office-kpi-k">Consultation Payments</div>
                <div className="office-kpi-v">{paymentHistorySummary.consultationCount}</div>
                <div className="office-kpi-meta">Onsite receipts on this page</div>
              </div>
              <div className="office-kpi">
                <div className="office-kpi-k">Video Consultation</div>
                <div className="office-kpi-v">{paymentHistorySummary.videoCount}</div>
                <div className="office-kpi-meta">Online receipts on this page</div>
              </div>
              <div className="office-kpi">
                <div className="office-kpi-k">Lab Payments</div>
                <div className="office-kpi-v">{paymentHistorySummary.labCount}</div>
                <div className="office-kpi-meta">Lab receipts on this page</div>
              </div>
            </div>

            <div className="office-card">
              <div className="office-billing-toolbar">
                <div>
                  <div className="office-title" style={{ fontSize: '1.05rem' }}>Payment History</div>
                  <div className="office-subtitle">Every collected transaction from billing, video consultation, and laboratory payments.</div>
                </div>
                <div className="office-row" style={{ marginLeft: 'auto' }}>
                  <div className="office-input-wrap office-search-wide">
                    <Search size={16} />
                    <input
                      className="office-input"
                      placeholder="Search patient, receipt, reference, cashier, or source"
                      value={paymentsQuery}
                      onChange={(e) => setPaymentsQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') refreshPaymentHistory({ page: 1 }); }}
                    />
                  </div>
                  <select className="office-select" value={paymentsSource} onChange={(e) => { const value = e.target.value; setPaymentsSource(value); refreshPaymentHistory({ page: 1, source: value }); }}>
                    <option value="All">All Sources</option>
                    <option value="Onsite Consultation">Onsite Consultation</option>
                    <option value="Video Consultation">Video Consultation</option>
                    <option value="Lab">Lab</option>
                    <option value="Radiology">Radiology</option>
                    <option value="Manual Invoice">Manual Invoice</option>
                  </select>
                  <button type="button" className="office-btn ghost" onClick={() => refreshPaymentHistory({ page: 1 })} disabled={paymentHistoryLoading}>
                    <RefreshCw size={16} />
                    Refresh
                  </button>
                </div>
              </div>

              {paymentHistoryError ? <div className="admin-alert error" style={{ marginTop: 12 }}>{paymentHistoryError}</div> : null}

              <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', padding: '7px 12px', borderRadius: 9, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569', fontSize: '0.8rem', fontWeight: 700 }}>
                  Showing {pagedPaymentHistory.totalCount === 0 ? 0 : pagedPaymentHistory.startIndex + 1}–{Math.min(pagedPaymentHistory.endIndex, pagedPaymentHistory.totalCount)} of {pagedPaymentHistory.totalCount}
                </div>
                <div className="office-row" style={{ gap: 8 }}>
                  <button
                    type="button"
                    aria-label="Previous page"
                    className="office-btn ghost"
                    onClick={() => { const next = Math.max(1, pagedPaymentHistory.currentPage - 1); setPaymentsPage(next); refreshPaymentHistory({ page: next }); }}
                    disabled={paymentHistoryLoading || pagedPaymentHistory.currentPage <= 1}
                    style={{ width: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                    title="Previous page"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <div style={{ display: 'inline-flex', alignItems: 'center', padding: '7px 10px', borderRadius: 9, background: '#ffffff', border: '1px solid #e2e8f0', color: '#334155', fontSize: '0.8rem', fontWeight: 700, minWidth: 60, justifyContent: 'center' }}>
                    {pagedPaymentHistory.currentPage} / {pagedPaymentHistory.totalPages}
                  </div>
                  <button
                    type="button"
                    aria-label="Next page"
                    className="office-btn ghost"
                    onClick={() => { const next = Math.min(pagedPaymentHistory.totalPages, pagedPaymentHistory.currentPage + 1); setPaymentsPage(next); refreshPaymentHistory({ page: next }); }}
                    disabled={paymentHistoryLoading || pagedPaymentHistory.currentPage >= pagedPaymentHistory.totalPages}
                    style={{ width: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                    title="Next page"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>

              <div className="logs-table-container" style={{ marginTop: 14 }}>
                <table className="staff-table">
                  <thead>
                    <tr>
                      <th>Receipt</th>
                      <th>Patient</th>
                      <th>Source</th>
                      <th>Service</th>
                      <th>Method</th>
                      <th className="inc-right">Amount</th>
                      <th>Collected</th>
                      <th>Cashier</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentHistoryLoading ? (
                      <tr><td colSpan={9} className="text-center py-8 text-slate-500">Loading payment history…</td></tr>
                    ) : !filteredPaymentHistory.length ? (
                      <tr><td colSpan={9} className="text-center py-8 text-slate-500">No recorded payments match the current filters.</td></tr>
                    ) : (
                      pagedPaymentHistory.items.map((payment) => (
                        <tr key={String(payment.id)}>
                          <td>
                            <div className="office-billing-patient">{payment.receiptNumber || `PAY-${payment.id}`}</div>
                            <div className="office-billing-subline">{payment.reference || 'No reference'}</div>
                          </td>
                          <td>
                            <div className="office-billing-patient">{payment.patientName || 'Patient'}</div>
                            <div className="office-billing-subline">{payment.invoice_id ? `Invoice #${payment.invoice_id}` : 'Ledger payment'}</div>
                          </td>
                          <td><span className="office-source-badge">{payment.source || 'Payment'}</span></td>
                          <td className="text-sm text-slate-700">{payment.serviceLabel || 'Hospital Service'}</td>
                          <td className="text-sm text-slate-700">{payment.method || 'Cash'}</td>
                          <td className="inc-right text-sm text-slate-700">₱ {toMoney(payment.amount)}</td>
                          <td className="text-sm text-slate-600">{formatDateTime(payment.created_at || payment.createdAt)}</td>
                          <td className="text-sm text-slate-600">{payment.cashierName || payment.received_by || payment.receivedBy || 'Cashier'}</td>
                          <td className="inc-right">
                            <button
                              type="button"
                              className="office-btn ghost"
                              onClick={() => setPaymentReceipt(buildPaymentReceipt(payment))}
                            >
                              View Receipt
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}

        {view === 'closeout' && role === 'cashier' ? (
          <div className="office-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div className="office-title" style={{ fontSize: '1.05rem' }}>Daily Closeout</div>
                <div className="office-subtitle">Summary for a selected date</div>
              </div>
              <div className="office-row">
                <input className="office-input" type="date" value={closeoutDate} onChange={(e) => setCloseoutDate(e.target.value)} />
                <button type="button" className="office-btn" onClick={() => fetchCloseout({ date: closeoutDate })} disabled={closeoutLoading || !user}>
                  <RefreshCw size={16} />
                  Generate
                </button>
                <button
                  type="button"
                  className="office-btn ghost"
                  disabled={!closeout || closeoutLoading}
                  onClick={() => {
                    if (!closeout) return;
                    const dateKey = closeoutDate || toLocalDateInputValue();
                    const statusRows = Object.entries(closeout?.billing?.invoices_by_status || {}).map(([k, v]) => ({
                      Metric: `Invoices • ${k}`,
                      Value: String(v ?? 0)
                    }));
                    const rows = [
                      { Metric: 'Date', Value: dateKey },
                      { Metric: 'Billing • Total Collected', Value: String(closeout?.billing?.total_collected ?? '0.00') },
                      { Metric: 'Billing • Payments Count', Value: String(closeout?.billing?.payments_count ?? 0) },
                      { Metric: 'Billing • Total Refunded', Value: String(closeout?.billing?.total_refunded ?? '0.00') },
                      { Metric: 'Billing • Onsite Consultation', Value: String(closeout?.billing?.by_source?.onsite ?? '0.00') },
                      { Metric: 'Billing • Video Consultation', Value: String(closeout?.billing?.by_source?.video ?? '0.00') },
                      { Metric: 'Billing • Lab', Value: String(closeout?.billing?.by_source?.lab ?? '0.00') },
                      { Metric: 'Billing • Radiology', Value: String(closeout?.billing?.by_source?.radiology ?? '0.00') },
                      { Metric: 'Billing • Manual', Value: String(closeout?.billing?.by_source?.manual ?? '0.00') },
                      { Metric: 'Pharmacy POS • Net Sales', Value: String(closeout?.pharmacy_pos?.net_sales ?? '0.00') },
                      { Metric: 'Pharmacy POS • Transactions', Value: String(closeout?.pharmacy_pos?.transactions ?? 0) },
                      { Metric: 'Sales Reports Submitted', Value: String(closeout?.sales_reports_submitted ?? 0) },
                      ...statusRows
                    ];
                    downloadCSV(rows, `cashier_closeout_${dateKey}.csv`);
                  }}
                >
                  <FileText size={16} />
                  Export CSV
                </button>
              </div>
            </div>

            {closeoutError ? <div className="admin-alert error" style={{ margin: 12 }}>{closeoutError}</div> : null}

            <div style={{ padding: 16 }}>
              {closeoutLoading ? (
                <div className="text-slate-500">Loading…</div>
              ) : closeout ? (
                <div className="office-grid-3" style={{ gap: 14 }}>
                  <div className="office-kpi">
                    <div className="office-kpi-k">Billing Collected</div>
                    <div className="office-kpi-v" style={blurStyle} onMouseEnter={blurOnHover} onMouseLeave={resetBlur}>₱ {String(closeout?.billing?.total_collected ?? '0.00')}</div>
                  </div>
                  <div className="office-kpi">
                    <div className="office-kpi-k">Payments</div>
                    <div className="office-kpi-v" style={blurStyle} onMouseEnter={blurOnHover} onMouseLeave={resetBlur}>{Number(closeout?.billing?.payments_count ?? 0) || 0}</div>
                  </div>
                  <div className="office-kpi">
                    <div className="office-kpi-k">Refunded</div>
                    <div className="office-kpi-v" style={blurStyle} onMouseEnter={blurOnHover} onMouseLeave={resetBlur}>₱ {String(closeout?.billing?.total_refunded ?? '0.00')}</div>
                  </div>

                  <div className="office-kpi">
                    <div className="office-kpi-k">Pharmacy Net Sales</div>
                    <div className="office-kpi-v" style={blurStyle} onMouseEnter={blurOnHover} onMouseLeave={resetBlur}>₱ {String(closeout?.pharmacy_pos?.net_sales ?? '0.00')}</div>
                  </div>
                  <div className="office-kpi">
                    <div className="office-kpi-k">Pharmacy Transactions</div>
                    <div className="office-kpi-v" style={blurStyle} onMouseEnter={blurOnHover} onMouseLeave={resetBlur}>{Number(closeout?.pharmacy_pos?.transactions ?? 0) || 0}</div>
                  </div>
                  <div className="office-kpi">
                    <div className="office-kpi-k">Sales Reports Submitted</div>
                    <div className="office-kpi-v" style={blurStyle} onMouseEnter={blurOnHover} onMouseLeave={resetBlur}>{Number(closeout?.sales_reports_submitted ?? 0) || 0}</div>
                  </div>
                  <div className="office-kpi">
                    <div className="office-kpi-k">Onsite Consultations</div>
                    <div className="office-kpi-v" style={blurStyle} onMouseEnter={blurOnHover} onMouseLeave={resetBlur}>₱ {String(closeout?.billing?.by_source?.onsite ?? '0.00')}</div>
                    <div className="office-kpi-meta">{Number(closeout?.billing?.by_source?.counts?.onsite ?? 0) || 0} payment(s)</div>
                  </div>
                  <div className="office-kpi">
                    <div className="office-kpi-k">Video Consultations</div>
                    <div className="office-kpi-v" style={blurStyle} onMouseEnter={blurOnHover} onMouseLeave={resetBlur}>₱ {String(closeout?.billing?.by_source?.video ?? '0.00')}</div>
                    <div className="office-kpi-meta">{Number(closeout?.billing?.by_source?.counts?.video ?? 0) || 0} payment(s)</div>
                  </div>
                  <div className="office-kpi">
                    <div className="office-kpi-k">Lab Collections</div>
                    <div className="office-kpi-v" style={blurStyle} onMouseEnter={blurOnHover} onMouseLeave={resetBlur}>₱ {String(closeout?.billing?.by_source?.lab ?? '0.00')}</div>
                    <div className="office-kpi-meta">{Number(closeout?.billing?.by_source?.counts?.lab ?? 0) || 0} payment(s)</div>
                  </div>
                </div>
              ) : (
                <div className="text-slate-500">Generate closeout to see summary.</div>
              )}

              {closeout && closeout?.billing?.invoices_by_status ? (
                <div style={{ marginTop: 16 }}>
                  <div className="office-title" style={{ fontSize: '1.05rem', marginBottom: 10 }}>Invoices by Status</div>
                  <div className="logs-table-container" style={{ maxHeight: 320 }}>
                    <table className="staff-table">
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th className="inc-right">Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(closeout.billing.invoices_by_status).length ? (
                          Object.entries(closeout.billing.invoices_by_status).map(([k, v]) => (
                            <tr key={String(k)}>
                              <td className="text-sm text-slate-700">{String(k)}</td>
                              <td className="inc-right text-sm text-slate-600">{Number(v ?? 0) || 0}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={2} className="text-center py-8 text-slate-500">No invoices found for this date.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

      {selectedLabOrder ? (
        <div className="office-modal-overlay" onClick={() => setSelectedLabOrder(null)}>
          <div className="office-modal" onClick={(e) => e.stopPropagation()}>
            <div className="office-modal-head">
              <div className="office-modal-title">Lab Order #{selectedLabOrder?.id || ''}</div>
              <button type="button" className="office-btn ghost" onClick={() => setSelectedLabOrder(null)}>Close</button>
            </div>
            <div className="office-modal-body">
              <div className="office-pos-shell">
                <div className="office-row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 900, color: '#0f172a' }}>{selectedLabOrder.patientName || 'Patient'}</div>
                    <div style={{ color: '#64748b', fontSize: '0.9rem' }}>
                      Service: <strong>{selectedLabOrder.priceLabel || selectedLabOrder.service || selectedLabOrder.kind || '—'}</strong>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: '#64748b', fontSize: '0.9rem' }}>
                      Status: <strong>{selectedLabOrder.status || '—'}</strong>
                    </div>
                    <div style={{ color: '#64748b', fontSize: '0.9rem', marginTop: 4 }}>
                      Price source: <strong>{selectedLabOrder.priceConfigured ? 'Cashier catalog' : 'Needs setup'}</strong>
                    </div>
                  </div>
                </div>

                <div className="office-pos-summary">
                  <div className="office-pos-metric">
                    <div className="office-pos-label">Gross Amount</div>
                    <div className="office-pos-value">₱ {toMoney(Number(selectedLabOrder?.amountDue ?? selectedLabOrder?.unitPrice ?? 0))}</div>
                  </div>
                  {selectedLabOrderHmo ? (
                    <>
                      {Number(selectedLabOrderHmo.philhealth_deduction || 0) > 0 && (
                        <div className="office-pos-metric" style={{ color: '#059669' }}>
                          <div className="office-pos-label">PhilHealth</div>
                          <div className="office-pos-value">- ₱ {toMoney(selectedLabOrderHmo.philhealth_deduction)}</div>
                        </div>
                      )}
                      {Number(selectedLabOrderHmo.applied_hmo_amount || selectedLabOrderHmo.loa_approved_amount || 0) > 0 && (
                        <div className="office-pos-metric" style={{ color: '#059669' }}>
                          <div className="office-pos-label">HMO ({selectedLabOrderHmo.hmo_provider || 'Provider'})</div>
                          <div className="office-pos-value">- ₱ {toMoney(selectedLabOrderHmo.applied_hmo_amount || selectedLabOrderHmo.loa_approved_amount)}</div>
                        </div>
                      )}
                    </>
                  ) : null}
                  <div className="office-pos-metric">
                    <div className="office-pos-label">Net Due</div>
                    <div className="office-pos-value">₱ {toMoney(selectedLabOrderDue)}</div>
                  </div>
                  <div className="office-pos-metric">
                    <div className="office-pos-label">Received</div>
                    <div className="office-pos-value">₱ {toMoney(selectedLabOrderReceived)}</div>
                  </div>
                  <div className="office-pos-metric">
                    <div className="office-pos-label">{labPaymentMethod === 'Cash' ? 'Change' : 'Balance Check'}</div>
                    <div className="office-pos-value">
                      {labPaymentMethod === 'Cash'
                        ? `₱ ${toMoney(selectedLabOrderChange)}`
                        : (selectedLabOrderShort > 0 ? `Short ₱ ${toMoney(selectedLabOrderShort)}` : 'Fully covered')}
                    </div>
                  </div>
                </div>

                <div className="office-pos-line-item">
                  <div>
                    <div className="office-billing-patient">{selectedLabOrder.priceLabel || selectedLabOrder.service || 'Lab Service'}</div>
                    <div className="office-billing-subline">Order #{selectedLabOrder.id} • Qty 1</div>
                  </div>
                  <div className="office-pos-line-total">
                    {selectedLabOrder.priceConfigured ? `₱ ${toMoney(selectedLabOrderDue)}` : 'Needs setup'}
                  </div>
                </div>

                <div style={{ marginTop: 14, borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
                  <div style={{ fontWeight: 900, marginBottom: 8 }}>Cashier POS</div>
                  {labPaymentError ? <div className="admin-alert error" style={{ marginBottom: 10 }}>{labPaymentError}</div> : null}
                  {!selectedLabOrder.priceConfigured ? (
                    <div className="admin-alert error" style={{ marginBottom: 10 }}>
                      This lab service has no configured cashier price yet. Add it to the clinical service catalog before collecting payment.
                    </div>
                  ) : null}
                  {selectedLabOrderDue <= 0.0099 && selectedLabOrder.priceConfigured ? (
                    <div style={{
                      marginBottom: 12, padding: '14px 18px', borderRadius: 10,
                      background: '#f8fafc', border: '1px solid #e2e8f0',
                      color: '#0f172a', fontWeight: 600, lineHeight: 1.55
                    }}>
                      ✅ <strong style={{ color: '#0f172a', fontWeight: 900 }}>WALA NA BABAYARAN:</strong>
                      <div style={{ marginTop: 6, fontWeight: 500 }}>
                        Lahat ng serbisyong ito ay sakop na ng PhilHealth at HMO Letter of Authority (LOA).
                        Hindi na kailangang magbayad ng pasyente. Pindutin ang <strong>"Mark as Settled (No Charge)"</strong> para ituloy ang record sa laboratoryo.
                      </div>
                    </div>
                  ) : null}
                  <div className="office-row">
                    <select className="office-select" value={labPaymentMethod} onChange={(e) => setLabPaymentMethod(e.target.value)} disabled={selectedLabOrderDue <= 0.0099}>
                      <option value="Cash">Cash</option>
                      <option value="GCash">GCash</option>
                      <option value="Card">Card</option>
                      <option value="HMO">HMO / LOA</option>
                    </select>
                    <input
                      className="office-input"
                      style={{ width: 180, minWidth: 0, opacity: selectedLabOrderDue <= 0.0099 ? 0.5 : 1 }}
                      type="number"
                      min="0"
                      step="0.01"
                      value={selectedLabOrderDue <= 0.0099 ? '0.00' : labPaymentAmount}
                      onChange={(e) => setLabPaymentAmount(selectedLabOrderDue <= 0.0099 ? '0.00' : e.target.value)}
                      disabled={selectedLabOrderDue <= 0.0099}
                      placeholder="Amount received"
                    />
                    <input
                      className="office-input"
                      style={{ flex: '1 1 220px', minWidth: 0 }}
                      value={labPaymentReference}
                      onChange={(e) => setLabPaymentReference(e.target.value)}
                      placeholder={selectedLabOrderDue <= 0.0099 ? 'HMO LOA Number / Reference (required)' : (labPaymentMethod === 'Cash' ? 'Receipt / Reference (optional)' : 'Receipt / Reference (required)')}
                    />
                    <button
                      type="button"
                      className="office-btn primary"
                      onClick={recordLabPayment}
                      disabled={labPaymentLoading || !selectedLabOrder.priceConfigured}
                    >
                      {labPaymentLoading ? 'Saving…' : (selectedLabOrderDue <= 0.0099 ? 'Mark as Settled (No Charge)' : 'Collect Payment')}
                    </button>
                  </div>
                  <div style={{ marginTop: 10, color: '#64748b', fontSize: '0.9rem' }}>
                    {selectedLabOrderDue <= 0.0099
                      ? 'After confirmation, this lab order is set to PAID (HMO) and patient may proceed directly to the laboratory station.'
                      : 'After cashier collection, this lab order moves to <strong>Paid</strong> so the lab staff can proceed with the exam.'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {view === 'hmo' ? (
          <div className="office-card">
          <style>{`
            @keyframes hmoYellowBlink {
              0%,100% { background-color: transparent; }
              50% { background-color: #fef08a; }
            }
            .hmo-row-highlight {
              animation: hmoYellowBlink 0.8s ease-in-out 3 !important;
              border-left: 4px solid #eab308 !important;
            }
          `}</style>
          <div className="office-row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div className="office-row" style={{ gap: 10, alignItems: 'center' }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                border: '1px solid #cbd5e1', borderRadius: 10, padding: '4px 8px 4px 10px',
                background: '#ffffff', flexShrink: 0
              }}>
                <span style={{color:'#475569',fontWeight:700,fontSize:'0.85rem'}}>🔎 Search:</span>
                <input
                  type="text"
                  value={hmoRefSearch}
                  onChange={(e) => {
                    const raw = String(e.target.value || '');
                    const cleaned = raw.replace(/[^A-Za-z0-9-\s]/g, '');
                    setHmoRefSearch(cleaned);
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleRefGoSearch(); }}
                  placeholder="PGH260817-00042, or patient name, provider, LOA #, contact"
                  style={{
                    border:'1px solid #e2e8f0',background:'#f8fafc',borderRadius:7,padding:'6px 10px',
                    fontSize:'0.9rem',fontWeight:600,width:380,outline:'none'
                  }}
                />
                <button
                  type="button"
                  className="office-btn primary"
                  onClick={handleRefGoSearch}
                  disabled={hmoRefSearchLoading || !hmoRefSearch.trim()}
                  style={{padding:'7px 14px'}}
                >{hmoRefSearchLoading ? '…' : 'Search'}</button>
              </div>
            </div>
            <div className="office-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {[
                { key: 'approved', label: 'Approved Only' },
                { key: 'all', label: 'All Claims' }
              ].map((tab) => {
                const active = hmoQueueFilter === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => { setHmoQueueFilter(tab.key); setHmoQueuePage(1); }}
                    style={{
                      padding: '7px 13px',
                      borderRadius: 9,
                      border: active ? '2px solid #f97316' : '1px solid #e2e8f0',
                      background: active ? '#fff7ed' : '#ffffff',
                      color: active ? '#c2410c' : '#475569',
                      fontWeight: active ? 800 : 600,
                      fontSize: '0.82rem',
                      cursor: 'pointer'
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
              {Number(hmoQueue.totalCount) > 0 ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', padding: '7px 12px', borderRadius: 9, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569', fontSize: '0.8rem', fontWeight: 700 }}>
                  Showing {(Number(hmoQueue.page) - 1) * Number(hmoQueue.perPage) + 1}–{Math.min(Number(hmoQueue.page) * Number(hmoQueue.perPage), Number(hmoQueue.totalCount))} of {Number(hmoQueue.totalCount)} encounters{Number(hmoQueue.invoiceCount || 0) ? ` · ${Number(hmoQueue.invoiceCount)} invoices` : ''}
                </div>
              ) : null}
              {Number(hmoQueue.totalCount) > Number(hmoQueue.perPage) ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    aria-label="Previous page"
                    disabled={Number(hmoQueue.page) <= 1 || hmoQueueLoading || !user}
                    onClick={() => { if (Number(hmoQueue.page) > 1) { setHmoQueuePage(Number(hmoQueue.page) - 1); } }}
                    style={{
                      width: 34, height: 34,
                      borderRadius: 9,
                      border: Number(hmoQueue.page) <= 1 || hmoQueueLoading || !user ? '1px solid #e2e8f0' : '1px solid #cbd5e1',
                      background: Number(hmoQueue.page) <= 1 || hmoQueueLoading || !user ? '#f8fafc' : '#ffffff',
                      color: Number(hmoQueue.page) <= 1 || hmoQueueLoading || !user ? '#cbd5e1' : '#334155',
                      fontSize: '0.95rem', fontWeight: 900,
                      cursor: Number(hmoQueue.page) <= 1 || hmoQueueLoading || !user ? 'not-allowed' : 'pointer',
                      boxShadow: Number(hmoQueue.page) <= 1 || hmoQueueLoading || !user ? 'none' : '0 1px 2px rgba(15,23,42,0.05)',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0
                    }}
                  >
                    ‹
                  </button>
                  <div style={{ display: 'inline-flex', alignItems: 'center', padding: '7px 10px', borderRadius: 9, background: '#ffffff', border: '1px solid #e2e8f0', color: '#334155', fontSize: '0.8rem', fontWeight: 700, minWidth: 60, justifyContent: 'center' }}>
                    {Number(hmoQueue.page)} / {Math.max(1, Math.ceil(Number(hmoQueue.totalCount) / Number(hmoQueue.perPage)))}
                  </div>
                  <button
                    type="button"
                    aria-label="Next page"
                    disabled={Number(hmoQueue.page) >= Math.max(1, Math.ceil(Number(hmoQueue.totalCount) / Number(hmoQueue.perPage))) || hmoQueueLoading || !user}
                    onClick={() => { const tp = Math.ceil(Number(hmoQueue.totalCount) / Number(hmoQueue.perPage)); if (Number(hmoQueue.page) < tp) { setHmoQueuePage(Number(hmoQueue.page) + 1); } }}
                    style={{
                      width: 34, height: 34,
                      borderRadius: 9,
                      border: Number(hmoQueue.page) >= Math.max(1, Math.ceil(Number(hmoQueue.totalCount) / Number(hmoQueue.perPage))) || hmoQueueLoading || !user ? '1px solid #e2e8f0' : '1px solid #cbd5e1',
                      background: Number(hmoQueue.page) >= Math.max(1, Math.ceil(Number(hmoQueue.totalCount) / Number(hmoQueue.perPage))) || hmoQueueLoading || !user ? '#f8fafc' : '#ffffff',
                      color: Number(hmoQueue.page) >= Math.max(1, Math.ceil(Number(hmoQueue.totalCount) / Number(hmoQueue.perPage))) || hmoQueueLoading || !user ? '#cbd5e1' : '#334155',
                      fontSize: '0.95rem', fontWeight: 900,
                      cursor: Number(hmoQueue.page) >= Math.max(1, Math.ceil(Number(hmoQueue.totalCount) / Number(hmoQueue.perPage))) || hmoQueueLoading || !user ? 'not-allowed' : 'pointer',
                      boxShadow: Number(hmoQueue.page) >= Math.max(1, Math.ceil(Number(hmoQueue.totalCount) / Number(hmoQueue.perPage))) || hmoQueueLoading || !user ? 'none' : '0 1px 2px rgba(15,23,42,0.05)',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0
                    }}
                  >
                    ›
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {hmoQueueError ? <div className="admin-alert error" style={{ margin: '12px 0 0 0' }}>{hmoQueueError}</div> : null}

          <div className="logs-table-container" style={{ marginTop: 14, maxHeight: '520px' }}>
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>HMO Provider</th>
                  <th>LOA #</th>
                  <th>Workups</th>
                  <th style={{ textAlign: 'right' }}>Total Bill</th>
                  <th style={{ textAlign: 'right' }}>PhilHealth</th>
                  <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>HMO Covered</th>
                  <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Patient Pays</th>
                  <th className="inc-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {hmoQueueLoading ? (
                  <tr>
                    <td colSpan="9" className="text-center py-8 text-slate-500">Loading...</td>
                  </tr>
                ) : (!Array.isArray(hmoQueue.rows) || hmoQueue.rows.length === 0) ? (
                  <tr>
                    <td colSpan="9" className="text-center py-8 text-slate-500">
                      {hmoQueueFilter === 'approved'
                        ? (Number(hmoQueue.totalCount) === 0
                          ? 'No Approved / Partially Approved HMO claims yet.'
                          : 'No rows on this page. Go to Page 1.')
                        : (Number(hmoQueue.totalCount) === 0
                          ? 'No HMO claims stored yet. Create a Nurse Walk-In Intake with HMO = YES + encode LOA details first.'
                          : 'No rows on this page. Go to Page 1.')}
                    </td>
                  </tr>
                ) : hmoQueue.rows.map((row) => {
                  const claim = row?.hmo_claim || {};
                  const storedStatus = String(row.claim_status || claim.status || 'Pending');
                  const patientDue = Number(row.patient_pays === '₱ 0.00' ? 0 : (row.patient_pays ? String(row.patient_pays).replace(/[^\d.]/g, '') : 0)) || Number(claim.patient_payable || 0);
                  const phNow = Number(row.philhealth_amount === '₱ 0.00' ? 0 : (row.philhealth_amount ? String(row.philhealth_amount).replace(/[^\d.]/g, '') : 0)) || Number(claim.philhealth_deduction || 0);
                  const hmoNow = Number(row.hmo_covered_amount === '₱ 0.00' ? 0 : (row.hmo_covered_amount ? String(row.hmo_covered_amount).replace(/[^\d.]/g, '') : 0)) || Number(claim.applied_hmo_amount || claim.loa_approved_amount || 0);
                  const totalNow = Number(row.total_amount === '₱ 0.00' ? 0 : (row.total_amount ? String(row.total_amount).replace(/[^\d.]/g, '') : 0)) || Number(claim.total_amount || claim.gross_amount || 0);
                  const invoiceIdTxt = String(row.invoice_id || claim.invoice_id || '').trim();
                  const invoiceCount = Math.max(1, Number(row.invoice_count || 1));
                  const invoiceIds = Array.isArray(row.invoice_ids) ? row.invoice_ids.map(String) : (invoiceIdTxt ? [invoiceIdTxt] : []);
                  const rawPatientName = String(row.patient_name || claim.patient_name || '').trim();
                  const isFallbackName = !rawPatientName
                    || rawPatientName.toLowerCase() === 'patient'
                    || rawPatientName.toLowerCase().startsWith('patient (click')
                    || rawPatientName.toLowerCase().startsWith('patient of')
                    || rawPatientName.toLowerCase().startsWith('patient of invoice')
                    || rawPatientName.toLowerCase().includes('[pass0-auto')
                    || rawPatientName.toLowerCase().startsWith('invoice-')
                    || rawPatientName.toLowerCase().startsWith('lab order #')
                    || rawPatientName.toLowerCase().startsWith('walk-in')
                    || rawPatientName.toLowerCase().startsWith('nurse walk-in')
                    || rawPatientName.toLowerCase().startsWith('nurse walk')
                    || rawPatientName.toLowerCase().startsWith('onsite consultation')
                    || rawPatientName.toLowerCase().startsWith('online consultation')
                    || rawPatientName.toLowerCase().startsWith('video consultation')
                    || rawPatientName.toLowerCase().includes('[appointment]')
                    || rawPatientName.toLowerCase().includes('[triage ');
                  const displayPatientName = isFallbackName ? 'Patient name unavailable' : rawPatientName;
                  const hasProvider = Boolean(String(claim.provider || claim.hmo_provider || '').trim());
                  const hasLoa = Boolean(String(claim.loa_number || claim.hmo_loa_number || '').trim());
                  const storedApproved = storedStatus === 'Approved' || storedStatus === 'Partially Approved';
                  const isClaimVerified = storedApproved && hasProvider && hasLoa && hmoNow > 0.0001 && !isFallbackName;
                  const status = storedApproved && !isClaimVerified ? 'Needs Verification' : storedStatus;
                  const rawClaimNotes = String(claim.notes || '').trim();
                  const isInternalNote = /(?:\[?auto[- ]?pass|walk-in-intake[- ]gate|system:|gate-no-crash|pass\d-auto)/i.test(rawClaimNotes);
                  const visibleClaimNotes = isInternalNote ? '' : rawClaimNotes;
                  const rawUpdatedBy = String(claim.updated_by || claim.requested_by || '').trim();
                  const visibleUpdatedBy = /^(?:system:|system$)/i.test(rawUpdatedBy) ? '' : rawUpdatedBy;
                  const subtitleText = (() => {
                    const parts = [];
                    if (invoiceIds.length > 1) parts.push(`${invoiceIds.length} invoices: #${invoiceIds.join(', #')}`);
                    else if (invoiceIdTxt) parts.push(`Invoice #${invoiceIdTxt}`);
                    if (!isFallbackName && String(row.workups_list || '').trim()) {
                      const w = String(row.workups_list).trim();
                      parts.push(w.length > 38 ? (w.slice(0, 36) + '…') : w);
                    } else if (isFallbackName && String(rawPatientName || '').trim()) {
                      const n = String(rawPatientName).trim();
                      parts.push(n.length > 40 ? (n.slice(0, 38) + '…') : n);
                    }
                    if (!parts.length && String(row.contact_number || '').trim()) parts.push('');
                    return parts.join(' · ');
                  })();
                  return (
                    <tr
                      key={String(row.id || row.invoice_id)}
                      className={String(row.id || row.invoice_id) === String(hmoHighlightRowId) ? 'hmo-row-highlight' : ''}
                    >
                      <td className="text-sm font-medium text-slate-700">
                        <div style={{ fontWeight: 900, fontSize: '0.93rem', color: isFallbackName ? '#475569' : '#0f172a' }}>{displayPatientName}</div>
                        {subtitleText ? <div className="office-billing-subline">{subtitleText}</div> : null}
                        {String(row.patient_reference || claim.patient_reference || '').trim() ? (
                          <div className="office-billing-subline">Patient Ref: {String(row.patient_reference || claim.patient_reference)}</div>
                        ) : null}
                        {String(row.contact_number || claim.patient_contact || '').trim() ? (
                          <div className="office-billing-subline">Contact: {String(row.contact_number || claim.patient_contact)}</div>
                        ) : null}
                      </td>
                      <td className="text-sm text-slate-600">
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>{claim.provider || String(row.hmo_claim?.provider) || '—'}</div>
                        {claim.hmo_card_number ? <div className="office-billing-subline" style={{ color: '#64748b' }}>Card: {String(claim.hmo_card_number)}</div> : null}
                        {String(row.company || claim.company || '').trim() ? <div className="office-billing-subline">Company: {String(row.company || claim.company)}</div> : null}
                      </td>
                      <td className="text-sm text-slate-600">
                        {claim.loa_number ? (
                          <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#2563eb', fontWeight: 800, fontSize: '0.86rem' }}>{String(claim.loa_number)}</div>
                        ) : (
                          <div style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.8rem' }}>no LOA # yet</div>
                        )}
                        <div style={{ marginTop: 4 }}>
                          <span className={`status-badge-table ${
                            status === 'Approved' ? 'status-duty' :
                            status === 'Partially Approved' ? 'status-scheduled' :
                            status === 'Needs Verification' ? 'status-upcoming' :
                            status === 'Awaiting LOA' || status === 'Pending' ? 'status-off' :
                            status === 'Rejected' ? 'status-off' :
                            'status-upcoming'
                          }`} style={{ fontSize: '0.72rem', padding: '2px 8px', fontWeight: 800 }}>{status}</span>
                        </div>
                      </td>
                      <td className="text-sm text-slate-600" style={{ maxWidth: 320 }}>
                        {row.workups_list ? (
                          <div
                            style={{
                              display: '-webkit-box',
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              lineHeight: 1.35,
                              fontWeight: 600
                            }}
                            title={String(row.workups_list)}
                          >
                            {String(row.workups_list)}
                          </div>
                        ) : (
                          <span style={{ color: '#cbd5e1', fontSize: '0.78rem', fontStyle: 'italic' }}>No lab/imaging linked yet.</span>
                        )}
                        {invoiceIds.length ? (
                          <div className="office-billing-subline" style={{ color: '#64748b', marginTop: 4 }}>
                            {invoiceCount > 1 ? `${invoiceCount} invoices: #${invoiceIds.join(', #')}` : `Invoice #${invoiceIds[0]}`}
                          </div>
                        ) : null}
                        {visibleClaimNotes ? (
                          <div className="office-billing-subline" style={{ marginTop: 4 }} title={visibleClaimNotes}>Notes: {visibleClaimNotes}</div>
                        ) : null}
                        {(claim.updated_at || claim.created_at) ? (
                          <div className="office-billing-subline" style={{ marginTop: 4 }}>
                            Updated: {formatDateTime(claim.updated_at || claim.created_at)}{visibleUpdatedBy ? ` by ${visibleUpdatedBy}` : ''}
                          </div>
                        ) : null}
                      </td>
                      <td className="text-sm font-medium text-slate-700" style={{ textAlign: 'right' }}>₱ {toMoney(totalNow)}</td>
                      <td className="text-sm text-slate-600" style={{ textAlign: 'right' }}>
                        {phNow <= 0.0001 ? <span style={{ color: '#cbd5e1' }}>—</span> : <span style={{ color: '#ea580c', fontWeight: 700 }}>−₱ {toMoney(phNow)}</span>}
                      </td>
                      <td className="text-sm text-slate-600" style={{ textAlign: 'right' }}>
                        {hmoNow <= 0.0001 ? <span style={{ color: '#cbd5e1' }}>—</span> : <span style={{ color: '#2563eb', fontWeight: 700 }}>−₱ {toMoney(hmoNow)}</span>}
                      </td>
                      <td className="text-sm text-slate-600" style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 900, color: patientDue <= 0.0099 ? '#475569' : '#0f172a' }}>
                          ₱ {toMoney(patientDue)}
                        </div>
                        {patientDue <= 0.0099 ? (
                          <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#475569', marginTop: 2 }}>100% covered · no charge</div>
                        ) : null}
                      </td>
                      <td className="inc-right">
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="office-btn ghost"
                            onClick={() => {
                              try {
                                setHmoQuickEdit(row);
                              } catch (err) {
                                alert('⚠️ Update error: ' + String(err?.message || err));
                              }
                            }}
                          >
                            Update
                          </button>
                          <button
                            type="button"
                            className="office-btn"
                            disabled={!isClaimVerified}
                            title={isClaimVerified ? 'View verified HMO receipt slip' : 'Complete and verify the patient, provider, LOA, and covered amount first'}
                            onClick={() => {
                              try {
                                const invoiceIdStr = String(row.invoice_id || claim.invoice_id || '').trim();
                                if (!invoiceIdStr) {
                                  setSuccessMessage('No invoice linked yet. Use "Update" to encode LOA and amounts first.');
                                  setModalType('success');
                                  setShowSuccessModal(true);
                                  setHmoQuickEdit(row);
                                  return;
                                }

                                // ✅ INSTANT RECEIPT! NO API FETCH, NO openInvoice() CALL!
                                // We already have 100% of the data we need from the row + claim objects.
                                // SKIPPING openInvoice() avoids the CASHIER POS INVOICE MODAL that used to appear FIRST!
                                // Receipt modal now shows INSTANTLY. No intermediate popups!
                                const dispName = (displayPatientName && displayPatientName !== '—') ? displayPatientName : 'Patient';
                                const serviceStr = (
                                  String(row.workups_list || '').trim()
                                  || (isFallbackName && subtitleText)
                                  || 'Hospital Services'
                                );
                                const source = (
                                  String(serviceStr).toLowerCase().includes('lab') ? 'Lab Services (HMO)' :
                                  String(serviceStr).toLowerCase().includes('pharmacy') || String(serviceStr).toLowerCase().includes('medicine') ? 'Pharmacy (HMO)' :
                                  String(serviceStr).toLowerCase().includes('xray') || String(serviceStr).toLowerCase().includes('imaging') || String(serviceStr).toLowerCase().includes('radiograph') ? 'Radiology / Imaging (HMO)' :
                                  String(serviceStr).toLowerCase().includes('ecg') ? 'ECG / Cardio (HMO)' :
                                  String(serviceStr).toLowerCase().includes('pt') || String(serviceStr).toLowerCase().includes('physical therapy') ? 'Physical Therapy (HMO)' :
                                  String(serviceStr).toLowerCase().includes('consult') || String(serviceStr).toLowerCase().includes('onsite') ? 'Onsite Consult (HMO)' :
                                  'HMO Billing Statement'
                                );
                                const receiptPayload = {
                                  receiptNumber: `PGH-HMO-${invoiceIdStr}`,
                                  orderId: invoiceIdStr,
                                  invoice_id: invoiceIdStr,
                                  paidAt: row.created_at || claim.created_at || claim.updated_at || new Date().toISOString(),
                                  paidAtLabel: formatDateTime(row.created_at || claim.created_at || claim.updated_at || new Date().toISOString()),
                                  cashierName: (user?.name || user?.full_name || (user?.first_name ? String(user.first_name || '').trim() + ' ' + String(user.last_name || '').trim() : 'Cashier') || 'Cashier').trim() || 'Cashier',
                                  method: (hmoNow > 0.0099 || claim.provider) ? `HMO · ${String(claim.provider || 'Provider')}` : 'Pending Settlement',
                                  reference: claim.loa_number ? `LOA ${String(claim.loa_number)}` : (claim.hmo_card_number ? `Card ${String(claim.hmo_card_number)}` : '—'),
                                  patientName: dispName,
                                  serviceLabel: (String(serviceStr || 'Hospital Services').trim().length > 90 ? String(serviceStr).slice(0, 88) + '…' : String(serviceStr || 'Hospital Services')) || 'Hospital Services',
                                  amountDue: Number(totalNow || 0),
                                  netAmountDue: Number(patientDue || 0),
                                  remainingBalance: Number(patientDue || 0),
                                  status: patientDue <= 0.0099 ? 'Fully Covered' : 'Balance Due',
                                  amountReceived: Math.max(0, Number(totalNow || 0) - Number(patientDue || 0)),
                                  change: 0,
                                  source,
                                  philhealthDeduction: Number(phNow || 0),
                                  hmoCoverage: Number(hmoNow || 0),
                                  hmoProvider: String(claim.provider || '').trim() || '—',
                                  hmoCard: String(claim.hmo_card_number || '').trim() || '—',
                                  loaNumber: String(claim.loa_number || '').trim() || '—',
                                  note: (hmoNow > 0.0099 || claim.provider)
                                    ? (
                                        (phNow > 0.0099 ? `PhilHealth deduction (₱ ${toMoney(phNow)}) applied first per OPD protocol. ` : '')
                                        + (hmoNow > 0.0099 ? `Remaining balance covered by HMO LOA #${String(claim.loa_number || 'pending')} (₱ ${toMoney(hmoNow)}). ` : '')
                                        + (patientDue > 0.0099 ? `Patient pays balance ₱ ${toMoney(patientDue)} upon discharge / settlement.` : 'Full HMO settlement · 100% covered · no balance.')
                                      )
                                    : 'Official billing statement · present HMO card + this slip for settlement.'
                                };

                                // Directly open RECEIPT MODAL ONLY (no POS invoice modal!)
                                setPaymentReceipt({
                                  ...receiptPayload,
                                  id: `INV-${invoiceIdStr}`
                                });
                              } catch (err) {
                                alert('⚠️ Receipt error: ' + String(err?.message || err));
                              }
                            }}
                          >
                            {isClaimVerified ? 'View Receipt Slip' : 'Receipt Unavailable'}
                          </button>
                          <button
                            type="button"
                            className="office-btn primary"
                            onClick={() => {
                              try {
                                const dispName = (displayPatientName && displayPatientName !== '—') ? displayPatientName : 'Patient';
                                const workupsStr = String(row.workups_list || 'No workups linked yet.').trim();
                                const lines = [
                                  `======================================================================`,
                                  `                  HMO STATEMENT OF ACCOUNT (SOA)`,
                                  `======================================================================`,
                                  ``,
                                  `  PATIENT NAME    :  ${dispName}`,
                                  `  CONTACT #       :  ${String(row.contact_number || '—')}`,
                                  row.invoice_id ? `  INVOICE #       :  ${String(row.invoice_id)}` : null,
                                  ``,
                                  `  HMO PROVIDER    :  ${String(claim.provider || '—')}`,
                                  `  HMO CARD #      :  ${String(claim.hmo_card_number || '—')}`,
                                  `  LOA / AUTH #    :  ${String(claim.loa_number || '—')}`,
                                  `  CLAIM STATUS    :  ${status}`,
                                  ``,
                                  `----------------------------------------------------------------------`,
                                  `  SERVICES / WORKUPS:`,
                                  `----------------------------------------------------------------------`,
                                  ...(workupsStr.length > 72
                                    ? workupsStr.match(/.{1,72}/g)?.map((s) => `  ${String(s || '').padEnd(68)}`) || [`  ${workupsStr}`]
                                    : [`  ${workupsStr}`]),
                                  ``,
                                  `----------------------------------------------------------------------`,
                                  `  BILLING SUMMARY`,
                                  `----------------------------------------------------------------------`,
                                  `  TOTAL GROSS BILL         :      ₱ ${toMoney(totalNow).padStart(12)}`,
                                  phNow > 0.0099 ? `  LESS : PHILHEALTH        :     -₱ ${toMoney(phNow).padStart(12)}` : null,
                                  hmoNow > 0.0099 ? `  LESS : HMO LOA COVERAGE  :     -₱ ${toMoney(hmoNow).padStart(12)}` : null,
                                  `                          =========================`,
                                  `  NET PATIENT PAYABLE      :      ₱ ${toMoney(patientDue).padStart(12)}`,
                                  ``,
                                  patientDue <= 0.0099
                                    ? `  >>> 100% COVERED · NO CHARGE TO PATIENT`
                                    : `  >>> COLLECT BALANCE FROM PATIENT ON DISCHARGE`,
                                  ``,
                                  `----------------------------------------------------------------------`,
                                  `  NOTES:`,
                                  `----------------------------------------------------------------------`,
                                  `  1. PhilHealth deducted first per OPD protocol, remainder covered`,
                                  `     by HMO LOA per approved amount.`,
                                  `  2. This is a system-generated SOA. Present HMO card + LOA upon`,
                                  `     discharge for final verification.`,
                                  `  Generated: ${formatDateTime(new Date().toISOString())}`,
                                  `======================================================================`
                                ].filter(Boolean);
                                const soaText = lines.join('\n');

                                // ✅ BLACK & WHITE PRINT-READY new window (per user request: simple, all white/black)
                                if (typeof window !== 'undefined') {
                                  try { navigator.clipboard?.writeText(soaText).catch(() => {}); } catch (_) {}
                                  const safe = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                                  const popup = window.open('', '_blank', 'width=820,height=900');
                                  if (popup) {
                                    popup.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>HMO SOA - ${safe(dispName)}</title><style>
                                      * { box-sizing: border-box; }
                                      html, body { margin: 0; padding: 0; background: #ffffff; color: #000000; font-family: 'Courier New', Courier, ui-monospace, monospace; font-size: 12.5px; line-height: 1.5; }
                                      .page { max-width: 760px; margin: 0 auto; padding: 22px 24px 28px 24px; white-space: pre-wrap; word-break: break-word; }
                                      @media print {
                                        body { background: #ffffff; color: #000000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                                        .page { max-width: 100%; padding: 0; margin: 0; }
                                        @page { size: letter; margin: 10mm 10mm; }
                                      }
                                    </style></head><body><div class="page">${safe(soaText)}</div></body></html>`);
                                    popup.document.close();
                                    try { popup.focus(); } catch (_) {}
                                    setTimeout(() => { try { popup.print(); } catch (_) {} }, 250);
                                  }
                                }

                                setSuccessMessage('SOA printed (black & white window opened) + copied to clipboard.');
                                setModalType('success');
                                setShowSuccessModal(true);
                              } catch (err) {
                                alert('⚠️ SOA error: ' + String(err?.message || err));
                              }
                            }}
                          >
                            {isClaimVerified ? 'Print SOA' : 'Print Draft SOA'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

        </div>
      ) : null}

      {hmoQuickEdit ? (
        <div className="office-modal-overlay" onClick={() => setHmoQuickEdit(null)}>
          <div className="office-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="office-modal-head">
              <div className="office-modal-title" style={{ fontSize: '1rem' }}>
                Update HMO • #{String(hmoQuickEdit.invoice_id || '')}
                <div style={{ fontSize: '0.82rem', fontWeight: 400, color: '#94a3b8', marginTop: 2 }}>
                  {hmoQuickEdit.patient_name || ''}
                </div>
              </div>
              <button type="button" className="office-btn ghost" onClick={() => setHmoQuickEdit(null)}>Close</button>
            </div>
            <div className="office-modal-body">
              <div className="office-hmo-fields-pro">
                <div className="office-hmo-field-pro">
                  <label className="office-hmo-field-label-pro">
                    <span className="label-dot-hmo"></span> HMO Provider
                  </label>
                  <div className="office-hmo-input-wrap-pro">
                    <Shield size={15} className="office-hmo-input-icon-pro" />
                    <select
                      className="office-hmo-select-pro"
                      value={hmoQuickEdit._provider ?? String(hmoQuickEdit?.hmo_claim?.provider || '')}
                      onChange={(e) => setHmoQuickEdit({ ...hmoQuickEdit, _provider: e.target.value })}
                    >
                      <option value="">None</option>
                      <option value="Cocolife">Cocolife</option>
                      <option value="Philcare">Philcare</option>
                      <option value="Value Care">Value Care</option>
                      <option value="Eastwest">Eastwest</option>
                      <option value="IMS">IMS</option>
                      <option value="Medocare">Medocare</option>
                      <option value="Sunlife">Sunlife</option>
                      <option value="AMAPHIL">AMAPHIL</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>
                <div className="office-hmo-field-pro">
                  <label className="office-hmo-field-label-pro">
                    <span className="label-dot-st"></span> Claim Status
                  </label>
                  <div className="office-hmo-input-wrap-pro">
                    <ClipboardList size={15} className="office-hmo-input-icon-pro" />
                    <select
                      className="office-hmo-select-pro"
                      value={hmoQuickEdit._status ?? String(hmoQuickEdit?.hmo_claim?.status || 'Pending')}
                      onChange={(e) => setHmoQuickEdit({ ...hmoQuickEdit, _status: e.target.value })}
                    >
                      <option value="Pending">Pending</option>
                      <option value="Awaiting LOA">Awaiting LOA</option>
                      <option value="Approved">Approved</option>
                      <option value="Partially Approved">Partially Approved</option>
                      <option value="Rejected">Rejected</option>
                    </select>
                  </div>
                </div>
                <div className="office-hmo-field-pro">
                  <label className="office-hmo-field-label-pro">
                    <span className="label-dot-loa"></span> LOA / Reference No.
                  </label>
                  <div className="office-hmo-input-wrap-pro">
                    <FileText size={15} className="office-hmo-input-icon-pro" />
                    <input
                      className="office-hmo-input-pro"
                      value={hmoQuickEdit._loa ?? String(hmoQuickEdit?.hmo_claim?.loa_number || '')}
                      onChange={(e) => setHmoQuickEdit({ ...hmoQuickEdit, _loa: e.target.value })}
                      placeholder="e.g. LOA-2026-00123"
                    />
                  </div>
                </div>
                <div className="office-hmo-field-pro">
                  <label className="office-hmo-field-label-pro">
                    <span className="label-dot-hmo"></span> HMO Card Number
                  </label>
                  <div className="office-hmo-input-wrap-pro">
                    <IdCard size={15} className="office-hmo-input-icon-pro" />
                    <input
                      className="office-hmo-input-pro"
                      value={hmoQuickEdit._hmoCardNumber ?? String(hmoQuickEdit?.hmo_claim?.hmo_card_number || '')}
                      onChange={(e) => setHmoQuickEdit({ ...hmoQuickEdit, _hmoCardNumber: e.target.value })}
                      placeholder="e.g. 1234-5678-9012"
                    />
                  </div>
                </div>
                <div className="office-hmo-field-pro">
                  <label className="office-hmo-field-label-pro">
                    <span className="label-dot-ph"></span> PhilHealth Share
                  </label>
                  <div className="office-hmo-input-wrap-pro">
                    <CreditCard size={15} className="office-hmo-input-icon-pro" />
                    <input
                      className="office-hmo-input-pro"
                      type="number"
                      value={hmoQuickEdit._ph ?? (hmoQuickEdit?._ph === 0 ? 0 : String(hmoQuickEdit?.hmo_claim?.philhealth_deduction ?? ''))}
                      onChange={(e) => setHmoQuickEdit({ ...hmoQuickEdit, _ph: e.target.value })}
                      placeholder="₱ 0.00"
                    />
                  </div>
                </div>
                <div className="office-hmo-field-pro">
                  <label className="office-hmo-field-label-pro">
                    <span className="label-dot-hmo"></span> HMO Covered Amount
                  </label>
                  <div className="office-hmo-input-wrap-pro">
                    <Check size={15} className="office-hmo-input-icon-pro" />
                    <input
                      className="office-hmo-input-pro"
                      type="number"
                      value={hmoQuickEdit._hmoAmt ?? (hmoQuickEdit?._hmoAmt === 0 ? 0 : String(hmoQuickEdit?.hmo_claim?.loa_approved_amount ?? ''))}
                      onChange={(e) => setHmoQuickEdit({ ...hmoQuickEdit, _hmoAmt: e.target.value })}
                      placeholder="₱ 0.00"
                    />
                  </div>
                </div>
                <div className="office-hmo-field-pro wide">
                  <label className="office-hmo-field-label-pro">
                    <span className="label-dot-st" style={{ background: '#64748b' }}></span> Approval Notes
                  </label>
                  <div className="office-hmo-input-wrap-pro">
                    <FileText size={15} className="office-hmo-input-icon-pro" />
                    <input
                      className="office-hmo-input-pro"
                      value={hmoQuickEdit._notes ?? String(hmoQuickEdit?.hmo_claim?.notes || '')}
                      onChange={(e) => setHmoQuickEdit({ ...hmoQuickEdit, _notes: e.target.value })}
                      placeholder="Optional — HMO approval notes, contact name, budget remarks"
                    />
                  </div>
                </div>
              </div>

              <div className="office-hmo-modal-summary-pro">
                {(() => {
                  const total = Number(hmoQuickEdit.total_amount || 0);
                  const phRaw = Number(hmoQuickEdit._ph ?? hmoQuickEdit?.hmo_claim?.philhealth_deduction ?? 0) || 0;
                  const phSafe = Math.max(0, Math.min(total, phRaw));
                  const phClamped = Number.isFinite(phRaw) && phRaw > 0 && Math.abs(phRaw - phSafe) > 0.0001;
                  const afterPH = Math.max(0, total - phSafe);
                  const statusQ = String(hmoQuickEdit._status ?? hmoQuickEdit?.hmo_claim?.status ?? 'Pending');
                  const hmoRaw = Number(hmoQuickEdit._hmoAmt ?? hmoQuickEdit?.hmo_claim?.loa_approved_amount ?? 0) || 0;
                  const hmoAmt = (statusQ === 'Approved' || statusQ === 'Partially Approved') ? Math.max(0, Math.min(afterPH, hmoRaw)) : 0;
                  const hmoClamped = (statusQ === 'Approved' || statusQ === 'Partially Approved') && Number.isFinite(hmoRaw) && hmoRaw > 0 && Math.abs(hmoRaw - hmoAmt) > 0.0001;
                  const net = Math.max(0, total - phSafe - hmoAmt);
                  const hmoWarn = statusQ !== 'Approved' && statusQ !== 'Partially Approved' && hmoRaw > 0;
                  const providerNow = hmoQuickEdit._provider ?? String(hmoQuickEdit?.hmo_claim?.provider || '');
                  const loaNow = hmoQuickEdit._loa ?? String(hmoQuickEdit?.hmo_claim?.loa_number || '');
                  const cardNow = hmoQuickEdit._hmoCardNumber ?? String(hmoQuickEdit?.hmo_claim?.hmo_card_number || '');
                  const totalDeduct = phSafe + hmoAmt;
                  return (
                    <>
                      {phClamped ? (
                        <div className="office-hmo-warn-pro">
                          <ShieldAlert size={15} />
                          PhilHealth was clamped — it cannot exceed the total bill.
                        </div>
                      ) : null}
                      {hmoClamped ? (
                        <div className="office-hmo-warn-pro">
                          <ShieldAlert size={15} />
                          HMO amount was clamped — it cannot exceed the excess after PhilHealth.
                        </div>
                      ) : null}
                      {hmoWarn ? (
                        <div className="office-hmo-warn-pro">
                          <ShieldAlert size={15} />
                          HMO amount not deducted — status is not Approved / Partially Approved.
                        </div>
                      ) : null}
                      <div className="office-hmo-summary-row-pro gross" style={{ marginTop: 8 }}>
                        <span>Gross Bill</span>
                        <strong>₱ {toMoney(total)}</strong>
                      </div>
                      <div className="office-hmo-summary-row-pro ph-row">
                        <span>Less PhilHealth (Standard Share)</span>
                        <strong>−₱ {toMoney(phSafe)}</strong>
                      </div>
                      <div className="office-hmo-summary-row-pro hmo-row">
                        <span>
                          Less HMO {providerNow ? `· ${String(providerNow)}` : ''}
                        </span>
                        <strong>−₱ {toMoney(hmoAmt)}</strong>
                      </div>
                      {totalDeduct > 0 ? (
                        <div className="office-hmo-summary-row-pro deduct-total">
                          <span>Total Deductions Applied</span>
                          <strong>−₱ {toMoney(totalDeduct)}</strong>
                        </div>
                      ) : null}
                      <div className="office-hmo-summary-divider-pro" />
                      <div className="office-hmo-summary-row-pro total-row">
                        <span>Patient Pays</span>
                        <strong>₱ {toMoney(net)}</strong>
                      </div>
                      {loaNow ? (
                        <div className="office-hmo-loa-pro">
                          <FileText size={12} />
                          LOA Reference: <span style={{ fontWeight: 900, color: '#4c1d95' }}>{String(loaNow)}</span>
                        </div>
                      ) : null}
                      {cardNow ? (
                        <div className="office-hmo-loa-pro" style={{ marginTop: 4, background: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0' }}>
                          <IdCard size={12} />
                          HMO Card No: <span style={{ fontWeight: 700, color: '#0f172a' }}>{String(cardNow)}</span>
                        </div>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            </div>
            <div className="office-modal-actions">
              <button type="button" className="office-btn ghost" onClick={() => setHmoQuickEdit(null)}>Cancel</button>
              <button
                type="button"
                className="office-btn primary"
                disabled={hmoQuickSaving}
                onClick={async () => {
                  if (!hmoQuickEdit?.invoice_id) return;
                  setHmoQuickSaving(true);
                  try {
                    await saveHmoClaim(String(hmoQuickEdit.invoice_id), {
                      provider: hmoQuickEdit._provider ?? String(hmoQuickEdit?.hmo_claim?.provider || ''),
                      loaNumber: hmoQuickEdit._loa ?? String(hmoQuickEdit?.hmo_claim?.loa_number || ''),
                      hmoCardNumber: hmoQuickEdit._hmoCardNumber ?? String(hmoQuickEdit?.hmo_claim?.hmo_card_number || ''),
                      status: hmoQuickEdit._status ?? String(hmoQuickEdit?.hmo_claim?.status || 'Pending'),
                      notes: hmoQuickEdit._notes ?? String(hmoQuickEdit?.hmo_claim?.notes || ''),
                      philhealthDeduction: Number(hmoQuickEdit._ph ?? hmoQuickEdit?.hmo_claim?.philhealth_deduction ?? 0) || 0,
                      loaApprovedAmount: Number(hmoQuickEdit._hmoAmt ?? hmoQuickEdit?.hmo_claim?.loa_approved_amount ?? 0) || 0
                    });
                    setHmoQuickEdit(null);
                    await refreshHmoQueue();
                    await refreshInvoices();
                  } catch (e) {
                    alert(String(e?.message || 'Failed to update HMO claim'));
                  } finally {
                    setHmoQuickSaving(false);
                  }
                }}
              >
                {hmoQuickSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {paymentReceipt ? (
        <div className="office-modal-overlay" onClick={() => setPaymentReceipt(null)}>
          <div className="office-modal office-receipt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="office-modal-head">
              <div className="office-modal-title">Payment Receipt</div>
              <button type="button" className="office-btn ghost" onClick={() => setPaymentReceipt(null)}>Close</button>
            </div>
            <div className="office-modal-body">
              <div className="office-receipt-card">
                <div className="office-receipt-center">
                  <div className="office-receipt-hospital">PASCUAL GENERAL HOSPITAL</div>
                  <div className="office-receipt-sub">Novaliches, Quezon City</div>
                  <div className="office-receipt-sub">0915 312 7144</div>
                  <div className="office-receipt-sub">System-Generated Payment Receipt</div>
                </div>
                <div className="office-receipt-line" />
                <div className="office-receipt-row"><span>Receipt No.</span><strong>{paymentReceipt.receiptNumber}</strong></div>
                <div className="office-receipt-row"><span>Order No.</span><strong>#{paymentReceipt.orderId}</strong></div>
                <div className="office-receipt-row"><span>Date & Time</span><strong>{paymentReceipt.paidAtLabel}</strong></div>
                <div className="office-receipt-row"><span>Cashier</span><strong>{paymentReceipt.cashierName}</strong></div>
                <div className="office-receipt-row"><span>Method</span><strong>{paymentReceipt.method}</strong></div>
                <div className="office-receipt-row"><span>Reference</span><strong>{paymentReceipt.reference}</strong></div>
                <div className="office-receipt-line" />
                <div className="office-receipt-row"><span>Patient</span><strong>{paymentReceipt.patientName}</strong></div>
                <div className="office-receipt-row"><span>Service</span><strong>{paymentReceipt.serviceLabel}</strong></div>
                <div className="office-receipt-line" />
                <div className="office-receipt-row"><span>Gross Amount</span><strong>₱ {toMoney(paymentReceipt.amountDue)}</strong></div>
                {Number(paymentReceipt.philhealthDeduction || 0) > 0 ? (
                  <div className="office-receipt-row"><span>Less PhilHealth</span><strong>−₱ {toMoney(paymentReceipt.philhealthDeduction)}</strong></div>
                ) : null}
                {Number(paymentReceipt.hmoCoverage || 0) > 0 ? (
                  <div className="office-receipt-row"><span>Less HMO{paymentReceipt.hmoProvider ? ` (${paymentReceipt.hmoProvider})` : ''}</span><strong>−₱ {toMoney(paymentReceipt.hmoCoverage)}</strong></div>
                ) : null}
                {paymentReceipt.loaNumber ? <div className="office-receipt-row"><span>LOA Reference</span><strong>{paymentReceipt.loaNumber}</strong></div> : null}
                <div className="office-receipt-row"><span>Net Amount Due</span><strong>₱ {toMoney(paymentReceipt.netAmountDue ?? paymentReceipt.amountDue)}</strong></div>
                <div className="office-receipt-row"><span>Amount Received</span><strong>₱ {toMoney(paymentReceipt.amountReceived)}</strong></div>
                <div className="office-receipt-row"><span>Change</span><strong>₱ {toMoney(paymentReceipt.change)}</strong></div>
                {Number(paymentReceipt.remainingBalance || 0) > 0 ? <div className="office-receipt-row"><span>Remaining Balance</span><strong>₱ {toMoney(paymentReceipt.remainingBalance)}</strong></div> : null}
                <div className="office-receipt-row"><span>Status</span><strong>{paymentReceipt.status || (Number(paymentReceipt.remainingBalance || 0) > 0 ? 'Partially Paid' : 'Paid')}</strong></div>
                <div className="office-receipt-note">
                  {paymentReceipt.note || (
                    String(paymentReceipt.source || '').toLowerCase().includes('lab')
                      ? 'Payment confirmed. Patient may proceed to the laboratory for the exam.'
                      : String(paymentReceipt.source || '').toLowerCase().includes('video')
                        ? 'Payment confirmed. Video consultation booking is settled.'
                        : 'Payment confirmed. Please present this receipt if verification is needed.'
                  )}
                </div>
              </div>
            </div>
            <div className="office-modal-actions">
              <button type="button" className="office-btn ghost" onClick={() => printPaymentReceipt(paymentReceipt)}>Print Receipt</button>
              <button type="button" className="office-btn primary" onClick={() => setPaymentReceipt(null)}>Done</button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedInvoice || selectedInvoiceLoading ? (
        <div className="office-modal-overlay" onClick={() => setSelectedInvoice(null)}>
          <div className="office-modal office-billing-modal" onClick={(e) => e.stopPropagation()}>
            <div className="office-modal-head">
              <div className="office-modal-title">{role === 'cashier' ? `Cashier POS • Invoice #${selectedInvoice?.id || ''}` : `Invoice #${selectedInvoice?.id || ''}`}</div>
              <button type="button" className="office-btn ghost" onClick={() => setSelectedInvoice(null)}>Close</button>
            </div>
            <div className="office-modal-body">
              {selectedInvoiceLoading ? (
                <div className="text-slate-500">Loading…</div>
              ) : selectedInvoice ? (
                <>
                  <div className="office-billing-header-strip">
                    <div className="office-billing-header-patient">
                      <div className="office-title" style={{ fontWeight: 900, color: '#0f172a' }}>
                        {selectedInvoice.patients ? `${selectedInvoice.patients.first_name || ''} ${selectedInvoice.patients.last_name || ''}`.trim() : 'Patient'}
                      </div>
                      <div className="office-billing-header-meta">
                        Status: <strong>{selectedInvoice.status || 'Draft'}</strong>
                      </div>
                      <div className="office-billing-header-meta">
                        Source: <strong>{inferInvoiceSource(selectedInvoice)}</strong>{selectedInvoice.appointment_id ? ` • Appointment #${selectedInvoice.appointment_id}` : ''}
                      </div>
                    </div>
                    <div className="office-billing-header-totals">
                      <div className="lbl">Total Bill</div>
                      <div className="val">₱ {toMoney(selectedInvoice.total_amount)}</div>
                      <div className="lbl">Paid</div>
                      <div className="val">₱ {toMoney(selectedInvoice.net_paid_amount ?? selectedInvoice.paid_amount ?? 0)}</div>
                      {Number(selectedInvoice.refunded_amount || 0) > 0 ? (
                        <>
                          <div className="lbl">Refunded</div>
                          <div className="val">₱ {toMoney(selectedInvoice.refunded_amount)}</div>
                        </>
                      ) : null}
                      <div className="lbl">Balance</div>
                      <div className="val big">₱ {toMoney(selectedInvoice.balance_amount)}</div>
                    </div>
                  </div>

                  <div className="office-billing-grid">
                    <div className="office-billing-left">
                      <div className="office-billing-card">
                        <div className="office-billing-card-head">
                          <span>Invoice Items</span>
                          <span className="small-note">{(selectedInvoice.items || []).length} line(s)</span>
                        </div>
                        <div className="office-billing-card-body">
                          <div className="logs-table-container">
                            <table className="staff-table">
                              <thead>
                                <tr>
                                  <th>Description</th>
                                  <th>Qty</th>
                                  <th>Unit</th>
                                  <th>Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(selectedInvoice.items || []).map((it) => (
                                  <tr key={it.id}>
                                    <td className="text-sm text-slate-700">{it.description}</td>
                                    <td className="text-sm text-slate-600">{it.quantity}</td>
                                    <td className="text-sm text-slate-600">₱ {toMoney(it.unit_price)}</td>
                                    <td className="text-sm text-slate-600">₱ {toMoney(it.line_total)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>

                      {role === 'doctor_secretary' ? (
                        <div className="office-billing-sec-tight" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="office-btn"
                            onClick={() => setInvoiceStatusSafe(selectedInvoice.id, 'Cancelled')}
                            disabled={selectedInvoiceLoading || selectedInvoice.status === 'Cancelled' || selectedInvoice.status === 'Paid'}
                          >
                            Cancel Invoice
                          </button>
                          <button
                            type="button"
                            className="office-btn primary"
                            onClick={() => setInvoiceStatusSafe(selectedInvoice.id, 'Ready')}
                            disabled={selectedInvoiceLoading || selectedInvoice.status === 'Ready' || selectedInvoice.status === 'Paid' || selectedInvoice.status === 'Cancelled'}
                          >
                            Set Ready For Payment
                          </button>
                        </div>
                      ) : null}

                      {role === 'cashier' ? (
                        <div className="office-billing-card">
                          <div className="office-billing-card-head">
                            <span>Payment History</span>
                            <span className="small-note">{(selectedInvoice.payments || []).length} record(s)</span>
                          </div>
                          <div className="office-billing-card-body">
                            <div className="logs-table-container">
                              <table className="staff-table">
                                <thead>
                                  <tr>
                                    <th>Time</th>
                                    <th>Method</th>
                                    <th>Amount</th>
                                    <th>Reference</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(selectedInvoice.payments || []).length === 0 ? (
                                    <tr>
                                      <td colSpan="4" className="text-center py-8 text-slate-500">No payments yet.</td>
                                    </tr>
                                  ) : (
                                    (selectedInvoice.payments || []).map((p) => (
                                      <tr key={p.id}>
                                        <td className="text-sm text-slate-600">{p.created_at ? new Date(p.created_at).toLocaleString() : '—'}</td>
                                        <td className="text-sm text-slate-600">{p.method || '—'}</td>
                                        <td className="text-sm text-slate-700">₱ {toMoney(p.amount)}</td>
                                        <td className="text-sm text-slate-600">{p.reference || '—'}</td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {role === 'cashier' ? (
                        <div className="office-billing-card">
                          <div className="office-billing-card-head">
                            <span>Adjustments</span>
                            <span className="small-note">{(selectedInvoice.adjustments || []).length} record(s)</span>
                          </div>
                          <div className="office-billing-card-body">
                            {adjustmentError ? <div className="admin-alert error" style={{ margin: 12 }}>{adjustmentError}</div> : null}
                            <div className="logs-table-container">
                              <table className="staff-table">
                                <thead>
                                  <tr>
                                    <th>Time</th>
                                    <th>Type</th>
                                    <th>Amount</th>
                                    <th>Reference</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(selectedInvoice.adjustments || []).length === 0 ? (
                                    <tr>
                                      <td colSpan="4" className="text-center py-8 text-slate-500">No adjustments yet.</td>
                                    </tr>
                                  ) : (
                                    (selectedInvoice.adjustments || []).map((a) => (
                                      <tr key={a.id}>
                                        <td className="text-sm text-slate-600">{a.created_at ? new Date(a.created_at).toLocaleString() : '—'}</td>
                                        <td className="text-sm text-slate-600">{a.type || '—'}</td>
                                        <td className="text-sm text-slate-700">₱ {toMoney(a.amount)}</td>
                                        <td className="text-sm text-slate-600" title={a.reason || ''}>{a.reference || '—'}</td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>

                            <div className="office-billing-sec-tight">
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                <div style={{ border: '1px solid #f1f5f9', borderRadius: 12, padding: 10 }}>
                                  <div style={{ fontWeight: 900, marginBottom: 8, fontSize: '0.86rem' }}>Issue Refund</div>
                                  <div className="office-billing-refund-grid">
                                    <input className="office-input" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} placeholder="Amount" />
                                    <input className="office-input" value={refundReference} onChange={(e) => setRefundReference(e.target.value)} placeholder="Refund reference (required)" />
                                    <input className="office-input full" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="Reason (optional)" />
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                                    <button
                                      type="button"
                                      className="office-btn"
                                      onClick={() => createAdjustment('refund')}
                                      disabled={
                                        adjustmentLoading ||
                                        ['Voided', 'Cancelled'].includes(String(selectedInvoice.status || '')) ||
                                        Number(selectedInvoice.net_paid_amount ?? selectedInvoice.paid_amount ?? 0) <= 0
                                      }
                                    >
                                      {adjustmentLoading ? 'Saving…' : 'Refund'}
                                    </button>
                                  </div>
                                </div>

                                <div style={{ border: '1px solid #f1f5f9', borderRadius: 12, padding: 10 }}>
                                  <div style={{ fontWeight: 900, marginBottom: 8, fontSize: '0.86rem' }}>Void Invoice</div>
                                  <input className="office-input" style={{ width: '100%' }} value={voidReference} onChange={(e) => setVoidReference(e.target.value)} placeholder="Void reference (optional)" />
                                  <input className="office-input" style={{ marginTop: 8, width: '100%' }} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Reason (required)" />
                                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                                    <button
                                      type="button"
                                      className="office-btn"
                                      onClick={() => createAdjustment('void')}
                                      disabled={adjustmentLoading || ['Voided', 'Cancelled'].includes(String(selectedInvoice.status || ''))}
                                    >
                                      {adjustmentLoading ? 'Saving…' : 'Void'}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {role === 'cashier' ? (
                      <div className="office-billing-right">
                        <div className="office-payment-panel" style={{ padding: 0, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, flex: '1 1 auto', overflow: 'hidden' }}>
                          <div className="office-payment-panel-head" style={{ flexWrap: 'wrap' }}>
                            <div>
                              <div className="office-payment-title">
                                {String(selectedInvoice.status || '').toLowerCase() === 'ready' && Number(selectedInvoice.balance_amount || 0) > 0 ? 'POS Payment Entry' : 'Payment Record'}
                              </div>
                              <div className="office-payment-subtitle">
                                Record the cashier payment here. GCash is currently unavailable.
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                              {(() => {
                                const claim = selectedInvoice?.hmo_claim || null;
                                if (!claim) return null;
                                const provider = String(claim.provider || '').trim();
                                if (!provider) return null;
                                const status = String(claim.status || 'Pending');
                                const ph = Number(claim.philhealth_deduction || 0);
                                const hmoAmt = Number(claim.applied_hmo_amount || claim.loa_approved_amount || 0);
                                const statusApplied = status === 'Approved' || status === 'Partially Approved';
                                const hmoSafe = statusApplied ? hmoAmt : 0;
                                const total = Number(selectedInvoice?.total_amount || 0);
                                const due = Math.max(0, total - Math.max(0, Math.min(total, ph)) - hmoSafe);
                                return (
                                  <div className="office-hmo-chip-pro">
                                    <Shield size={13} />
                                    {provider}
                                    <span style={{ fontWeight: 800, color: '#059669' }}>−₱ {toMoney(ph + hmoSafe)}</span>
                                    <span className="chip-due">₱ {toMoney(due)}</span>
                                  </div>
                                );
                              })()}
                              <div className="office-payment-badge">
                                {String(selectedInvoice.status || '').toLowerCase() === 'paid' ? 'Settled' : 'Ready to collect'}
                              </div>
                            </div>
                          </div>

                          <div className="office-payment-metrics">
                            <div className="office-payment-metric total-due">
                              <span>Net Amount Due</span>
                              <strong>PHP {toMoney(selectedInvoiceDue)}</strong>
                            </div>
                            <div className={`office-payment-metric ${payMethod === 'Cash' && paymentEntryValue > 0 ? 'accent' : ''}`}>
                              <span>{payMethod === 'Cash' ? 'Cash Received' : 'Payment Amount'}</span>
                              <strong>PHP {toMoney(paymentEntryValue)}</strong>
                            </div>
                            <div className={`office-payment-metric ${paymentChange > 0 ? 'success' : ''}`}>
                              <span>Change / Sukli</span>
                              <strong>PHP {toMoney(paymentChange)}</strong>
                            </div>
                          </div>

                          <div className="office-payment-quick-cash" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {[100, 500, 1000].map(amount => (
                              <button 
                                key={amount}
                                type="button" 
                                className="office-btn ghost" 
                                style={{ border: '1px solid #e2e8f0', flex: 1, minWidth: 90 }}
                                onClick={() => {
                                  setCashReceived(String(amount));
                                  setPayAmount(String(amount));
                                }}
                              >
                                ₱ {amount}
                              </button>
                            ))}
                            <button 
                              type="button" 
                              className="office-btn ghost" 
                              style={{ border: '2px solid #ea580c', color: '#ea580c', flex: 1.5, minWidth: 140 }}
                              onClick={() => {
                                setCashReceived(String(selectedInvoiceDue));
                                setPayAmount(String(selectedInvoiceDue));
                              }}
                            >
                              Exact Amount
                            </button>
                          </div>

                          <div className="office-hmo-card-pro" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
                            <div className="office-hmo-head-pro">
                              <div className="office-hmo-head-icon-pro">
                                <Shield size={20} />
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <div className="office-hmo-head-title-pro">PhilHealth & HMO Deductions</div>
                                <div className="office-hmo-head-subtitle-pro">PhilHealth first, then HMO covers excess per LOA.</div>
                              </div>
                            </div>

                            <div className="office-hmo-quick-pro">
                              <button
                                type="button"
                                className="office-hmo-quick-btn-pro ph"
                                onClick={() => {
                                  const total = Number(selectedInvoice?.total_amount || 0);
                                  if (!Number.isFinite(total) || total <= 0) return;
                                  const next = Math.max(0, Math.round(total * 0.2 * 100) / 100);
                                  setPhilhealthDeduction(String(next));
                                }}
                              >
                                <span style={{ fontWeight: 900 }}>PH 20%</span>
                              </button>
                              <button
                                type="button"
                                className="office-hmo-quick-btn-pro ph"
                                onClick={() => setPhilhealthDeduction('500')}
                              >
                                PH ₱500
                              </button>
                              <button
                                type="button"
                                className="office-hmo-quick-btn-pro hmo"
                                onClick={() => {
                                  const total = Number(selectedInvoice?.total_amount || 0);
                                  const ph = Number(philhealthDeduction || 0);
                                  const after = Math.max(0, Math.min(total, ph));
                                  const excess = Math.max(0, total - after);
                                  setHmoCoverage(String(Math.round(excess * 100) / 100));
                                  if (!hmoProvider) setHmoProvider('Cocolife');
                                  if (!hmoStatus || hmoStatus === 'Pending') setHmoStatus('Approved');
                                }}
                              >
                                <Check size={14} />
                                HMO = EXCESS
                              </button>
                              <button
                                type="button"
                                className="office-hmo-quick-btn-pro ghost"
                                onClick={() => {
                                  setPhilhealthDeduction(''); setHmoCoverage(''); setHmoProvider('');
                                  setLoaNumber(''); setHmoStatus('Pending'); setHmoNotes('');
                                }}
                              >
                                <X size={14} />
                                CLEAR
                              </button>
                            </div>

                            <div className="office-hmo-fields-pro">
                              <div className="office-hmo-field-pro">
                                <label className="office-hmo-field-label-pro">
                                  <span className="label-dot-ph"></span> PhilHealth Share
                                </label>
                                <div className="office-hmo-input-wrap-pro">
                                  <CreditCard size={15} className="office-hmo-input-icon-pro" />
                                  <input
                                    className="office-hmo-input-pro"
                                    type="number"
                                    value={philhealthDeduction}
                                    onChange={(e) => setPhilhealthDeduction(e.target.value)}
                                    placeholder="₱ 0.00"
                                  />
                                </div>
                              </div>
                              <div className="office-hmo-field-pro">
                                <label className="office-hmo-field-label-pro">
                                  <span className="label-dot-hmo"></span> HMO Provider
                                </label>
                                <div className="office-hmo-input-wrap-pro">
                                  <Shield size={15} className="office-hmo-input-icon-pro" />
                                  <select className="office-hmo-select-pro" value={hmoProvider} onChange={(e) => setHmoProvider(e.target.value)}>
                                    <option value="">None</option>
                                    <option value="Cocolife">Cocolife</option>
                                    <option value="Philcare">Philcare</option>
                                    <option value="Value Care">Value Care</option>
                                    <option value="Eastwest">Eastwest</option>
                                    <option value="IMS">IMS</option>
                                    <option value="Medocare">Medocare</option>
                                    <option value="Sunlife">Sunlife</option>
                                    <option value="AMAPHIL">AMAPHIL</option>
                                    <option value="Other">Other</option>
                                  </select>
                                </div>
                              </div>
                              <div className="office-hmo-field-pro">
                                <label className="office-hmo-field-label-pro">
                                  <span className="label-dot-hmo"></span> HMO Covered Amount
                                </label>
                                <div className="office-hmo-input-wrap-pro">
                                  <Check size={15} className="office-hmo-input-icon-pro" />
                                  <input
                                    className="office-hmo-input-pro"
                                    type="number"
                                    value={hmoCoverage}
                                    onChange={(e) => setHmoCoverage(e.target.value)}
                                    placeholder="₱ 0.00"
                                  />
                                </div>
                              </div>
                              <div className="office-hmo-field-pro">
                                <label className="office-hmo-field-label-pro">
                                  <span className="label-dot-loa"></span> LOA / Reference No.
                                </label>
                                <div className="office-hmo-input-wrap-pro">
                                  <FileText size={15} className="office-hmo-input-icon-pro" />
                                  <input
                                    className="office-hmo-input-pro"
                                    type="text"
                                    value={loaNumber}
                                    onChange={(e) => setLoaNumber(e.target.value)}
                                    placeholder="e.g. LOA-2026-00123"
                                  />
                                </div>
                              </div>
                              <div className="office-hmo-field-pro">
                                <label className="office-hmo-field-label-pro">
                                  <span className="label-dot-hmo"></span> HMO Card Number
                                </label>
                                <div className="office-hmo-input-wrap-pro">
                                  <IdCard size={15} className="office-hmo-input-icon-pro" />
                                  <input
                                    className="office-hmo-input-pro"
                                    type="text"
                                    value={hmoCardNumber}
                                    onChange={(e) => setHmoCardNumber(e.target.value)}
                                    placeholder="e.g. 1234-5678-9012"
                                  />
                                </div>
                              </div>
                              <div className="office-hmo-field-pro">
                                <label className="office-hmo-field-label-pro">
                                  <span className="label-dot-st"></span> Claim Status
                                </label>
                                <div className="office-hmo-input-wrap-pro">
                                  <ClipboardList size={15} className="office-hmo-input-icon-pro" />
                                  <select className="office-hmo-select-pro" value={hmoStatus} onChange={(e) => setHmoStatus(e.target.value)}>
                                    <option value="Pending">Pending</option>
                                    <option value="Awaiting LOA">Awaiting LOA</option>
                                    <option value="Approved">Approved</option>
                                    <option value="Partially Approved">Partially Approved</option>
                                    <option value="Rejected">Rejected</option>
                                  </select>
                                </div>
                              </div>
                              <div className="office-hmo-field-pro wide">
                                <label className="office-hmo-field-label-pro">
                                  <span className="label-dot-st" style={{ background: '#64748b' }}></span> Approval Notes
                                </label>
                                <div className="office-hmo-input-wrap-pro">
                                  <FileText size={15} className="office-hmo-input-icon-pro" />
                                  <input
                                    className="office-hmo-input-pro"
                                    type="text"
                                    value={hmoNotes}
                                    onChange={(e) => setHmoNotes(e.target.value)}
                                    placeholder="Optional — HMO approval notes"
                                  />
                                </div>
                              </div>
                            </div>

                            {(() => {
                              const total = Number(selectedInvoice?.total_amount || 0);
                              const phRaw = Number(philhealthDeduction || 0);
                              const phSafe = Math.max(0, Math.min(total, phRaw));
                              const phClamped = Number.isFinite(phRaw) && phRaw > 0 && Math.abs(phRaw - phSafe) > 0.0001;
                              const afterPH = Math.max(0, total - phSafe);
                              const statusApplied = hmoStatus === 'Approved' || hmoStatus === 'Partially Approved';
                              const hmoRaw = Number(hmoCoverage || 0);
                              const hmoSafe = statusApplied ? Math.max(0, Math.min(afterPH, hmoRaw)) : 0;
                              const hmoClamped = statusApplied && Number.isFinite(hmoRaw) && hmoRaw > 0 && Math.abs(hmoRaw - hmoSafe) > 0.0001;
                              const hmoWarn = !statusApplied && hmoRaw > 0;
                              const totalDeduct = phSafe + hmoSafe;
                              const net = Math.max(0, total - totalDeduct);
                              const providerLabel = String(hmoProvider || '').trim();
                              return (
                                <div>
                                  {phClamped ? (
                                    <div className="office-hmo-warn-pro">
                                      <ShieldAlert size={15} />
                                      PhilHealth clamped — cannot exceed total bill.
                                    </div>
                                  ) : null}
                                  {hmoClamped ? (
                                    <div className="office-hmo-warn-pro">
                                      <ShieldAlert size={15} />
                                      HMO clamped — cannot exceed PhilHealth excess.
                                    </div>
                                  ) : null}
                                  {hmoWarn ? (
                                    <div className="office-hmo-warn-pro">
                                      <ShieldAlert size={15} />
                                      HMO not deducted — status not Approved / Partially Approved.
                                    </div>
                                  ) : null}

                                  <div className="office-hmo-summary-pro">
                                    <div className="office-hmo-summary-row-pro gross">
                                      <span>Gross Bill</span>
                                      <strong>₱ {toMoney(total)}</strong>
                                    </div>
                                    <div className="office-hmo-summary-row-pro ph-row">
                                      <span>Less PhilHealth</span>
                                      <strong>−₱ {toMoney(phSafe)}</strong>
                                    </div>
                                    <div className="office-hmo-summary-row-pro hmo-row">
                                      <span>
                                        Less HMO {providerLabel ? `· ${providerLabel}` : ''}
                                      </span>
                                      <strong>−₱ {toMoney(hmoSafe)}</strong>
                                    </div>
                                    {totalDeduct > 0 ? (
                                      <div className="office-hmo-summary-row-pro deduct-total">
                                        <span>Total Deductions</span>
                                        <strong>−₱ {toMoney(totalDeduct)}</strong>
                                      </div>
                                    ) : null}
                                    <div className="office-hmo-summary-divider-pro" />
                                    <div className="office-hmo-summary-row-pro total-row">
                                      <span>Patient Pays</span>
                                      <strong>₱ {toMoney(net)}</strong>
                                    </div>
                                    {loaNumber ? (
                                      <div className="office-hmo-loa-pro">
                                        <FileText size={12} />
                                        LOA: <span style={{ fontWeight: 900, color: '#4c1d95' }}>{String(loaNumber)}</span>
                                      </div>
                                    ) : null}
                                    {hmoCardNumber ? (
                                      <div className="office-hmo-loa-pro" style={{ marginTop: 4, background: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0' }}>
                                        <IdCard size={12} />
                                        HMO Card: <span style={{ fontWeight: 700, color: '#0f172a' }}>{String(hmoCardNumber)}</span>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })()}

                            <div className="office-hmo-actions-pro">
                              <button
                                type="button"
                                className="office-btn primary"
                                onClick={async () => {
                                  if (!selectedInvoice?.id) return;
                                  try {
                                    const result = await saveHmoClaim(selectedInvoice.id);
                                    if (result) {
                                      setSelectedInvoice(result);
                                      const bal = Number(result.balance_amount || 0);
                                      if (bal > 0) setPayAmount(String(bal));
                                    }
                                  } catch (e) {
                                    setPaymentError(String(e?.message || 'Failed to save HMO details'));
                                  }
                                }}
                                disabled={savingHmoClaim || !selectedInvoice?.id}
                              >
                                <Save size={15} />
                                {savingHmoClaim ? 'Saving…' : 'Save Deductions'}
                              </button>
                              <button
                                type="button"
                                className="office-btn ghost"
                                style={{ border: '1px solid #e2e8f0', color: '#64748b' }}
                                onClick={() => {
                                  setPhilhealthDeduction(''); setHmoCoverage(''); setHmoProvider('');
                                  setLoaNumber(''); setHmoStatus('Pending'); setHmoNotes('');
                                }}
                              >
                                <RefreshCw size={15} />
                                Reset
                              </button>
                            </div>
                          </div>

                          {paymentError ? <div className="admin-alert error" style={{ margin: 0 }}>{paymentError}</div> : null}
                          {payMethod === 'Cash' && paymentShort ? (
                            <div className="office-payment-warning" style={{ margin: 0 }}>
                              Cash received is below the amount due of PHP {toMoney(selectedInvoiceDue)}.
                            </div>
                          ) : null}

                          <div className="office-payment-form">
                            <div className="office-billing-payform-grid">
                              <div className="office-payment-field">
                                <label>Payment method</label>
                                <div style={{ position: 'relative' }}>
                                  <select className="office-select" value={payMethod} onChange={(e) => setPayMethod(e.target.value)} style={{ paddingLeft: '40px', width: '100%' }}>
                                    <option value="Cash">Cash</option>
                                    <option value="Card">Card</option>
                                  </select>
                                  <div style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }}>
                                    <CreditCard size={18} />
                                  </div>
                                </div>
                              </div>

                              <div className="office-payment-field">
                                <label>{payMethod === 'Cash' ? 'Cash received' : 'Amount to post'}</label>
                                <input
                                  className="office-input"
                                  style={{ width: '100%' }}
                                  value={payMethod === 'Cash' ? (cashReceived || payAmount) : payAmount}
                                  onChange={(e) => {
                                    if (payMethod === 'Cash') {
                                      setCashReceived(e.target.value);
                                      setPayAmount(e.target.value);
                                      return;
                                    }
                                    setPayAmount(e.target.value);
                                  }}
                                  placeholder={payMethod === 'Cash' ? 'e.g. 1000' : `e.g. ${toMoney(selectedInvoiceDue)}`}
                                />
                              </div>

                              <div className="office-payment-field full">
                                <label>{payMethod === 'Cash' ? 'Receipt / Reference No. (optional)' : 'Receipt / Reference No.'}</label>
                                <input
                                  className="office-input"
                                  style={{ width: '100%' }}
                                  value={payReference}
                                  onChange={(e) => setPayReference(e.target.value)}
                                  placeholder={payMethod === 'Cash' ? 'Optional for cash payments' : 'Enter OR / receipt / card slip reference'}
                                />
                              </div>
                            </div>
                          </div>

                          <div className="office-payment-actions">
                            <div className="office-payment-note">
                              {payMethod === 'Cash'
                                ? 'Records the exact balance and shows change for the patient.'
                                : 'Enter a full or partial non-cash payment. The remaining balance stays open.'}
                            </div>
                            <button
                              type="button"
                              className="office-btn primary office-payment-submit"
                              onClick={createPayment}
                              disabled={paymentLoading || selectedInvoice.status === 'Paid' || Number(selectedInvoice.balance_amount || 0) <= 0}
                            >
                              {paymentLoading ? 'Processing payment…' : 'Accept Payment'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="office-billing-right">
                        <div className="office-billing-card">
                          <div className="office-billing-card-head">
                            <span>Actions</span>
                          </div>
                          <div className="office-billing-sec-tight" style={{ textAlign: 'center', color: '#64748b', fontSize: '0.86rem' }}>
                            Billing controls are only available for the cashier role.
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

        </div>
      </main>

      {showSuccessModal ? (
        <div className="office-modal-overlay" onClick={() => setShowSuccessModal(false)}>
          <div className="office-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div style={{
              textAlign: 'center',
              padding: '12px 8px 4px 8px'
            }}>
              <div style={{
                width: 58, height: 58, borderRadius: '50%',
                background: modalType === 'success' ? 'linear-gradient(180deg,#dcfce7 0%, #bbf7d0 100%)' : 'linear-gradient(180deg,#fee2e2 0%, #fecaca 100%)',
                border: modalType === 'success' ? '2px solid #22c55e' : '2px solid #ef4444',
                color: modalType === 'success' ? '#15803d' : '#b91c1c',
                fontSize: '1.9rem',
                fontWeight: 900,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 3px 8px rgba(15,23,42,0.08)'
              }}>
                {modalType === 'success' ? '✓' : '!'}
              </div>
            </div>
            <div className="office-title" style={{ textAlign: 'center', marginTop: 8, fontSize: '1.1rem' }}>
              {modalType === 'success' ? 'Success' : 'Notice'}
            </div>
            <div style={{ textAlign: 'center', color: '#334155', marginTop: 6, padding: '0 8px', lineHeight: 1.5 }}>
              {String(successMessage || '')}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 22 }}>
              <button
                type="button"
                className="office-btn primary"
                onClick={() => setShowSuccessModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <PatientFullRecordModal
        open={centralRecordOpen}
        onClose={() => setCentralRecordOpen(false)}
        patientId={centralRecordPatientId}
        patientLabel={centralRecordPatientLabel}
        role={String(role || '').toLowerCase() || 'staff'}
        user={user}
      />

      <SignOutConfirmModal
        open={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={handleLogout}
      />
    </div>
  );
}

