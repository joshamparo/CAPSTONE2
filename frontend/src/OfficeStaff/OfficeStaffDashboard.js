import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, CreditCard, FileText, LogOut, Plus, RefreshCw, Search, User, Upload, Save, KeyRound, Eye, EyeOff, ShieldAlert, Menu, Mail, Briefcase, Phone, Key, Shield, Check, X, Edit2 } from 'lucide-react';
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

const buildConsultationReceipt = ({ invoice, payment, user, amountReceivedOverride, philhealthDeduction, hmoCoverage, hmoProvider }) => {
  if (!invoice || !payment) return null;
  const source = inferInvoiceSource(invoice);
  const patientName = invoice.patients
    ? `${String(invoice.patients.first_name || '').trim()} ${String(invoice.patients.last_name || '').trim()}`.trim()
    : 'Patient';
  
  const originalBalance = Number(invoice.balance_amount || invoice.total_amount || 0);
  const ph = Number(philhealthDeduction || 0);
  const hmo = Number(hmoCoverage || 0);
  const amountDueAfterDeductions = Math.max(0, originalBalance - ph - hmo);

  const amountReceived = Number.isFinite(Number(amountReceivedOverride))
    ? Number(amountReceivedOverride)
    : Number(payment.amount || 0);
  
  const remainingBalance = Math.max(0, amountDueAfterDeductions - amountReceived);
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
    amountDue: originalBalance,
    philhealthDeduction: ph,
    hmoCoverage: hmo,
    hmoProvider: hmoProvider || '',
    netAmountDue: amountDueAfterDeductions,
    amountReceived,
    change: Math.max(0, amountReceived - amountDueAfterDeductions),
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
    newPassword: '',
    confirmPassword: ''
  });
  const [showPasswords, setShowPasswords] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [profileMessage, setProfileMessage] = useState({ text: '', type: '' });

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
      if (profileForm.newPassword && profileForm.newPassword !== profileForm.confirmPassword) {
        throw new Error('Passwords do not match');
      }

      const payload = {
        firstName: profileForm.firstName,
        lastName: profileForm.lastName,
      };

      if (profileForm.newPassword) {
        payload.password = profileForm.newPassword;
      }

      const data = await fetchJson(`/api/staff/${user.id || user._id}`, {
        apiBase: API_BASE,
        method: 'PUT',
        headers: buildHeaders(user),
        body: JSON.stringify(payload)
      });

      const updatedUser = { ...user, ...data.user };
      localStorage.setItem('currentUser', JSON.stringify(updatedUser));
      setProfileMessage({ text: 'Profile updated successfully!', type: 'success' });
      setProfileForm(prev => ({ ...prev, newPassword: '', confirmPassword: '' }));
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
  const [philhealthDeduction, setPhilhealthDeduction] = useState('');
  const [hmoCoverage, setHmoCoverage] = useState('');
  const [loaNumber, setLoaNumber] = useState('');
  const [hmoStatus, setHmoStatus] = useState('Pending');
  const [hmoNotes, setHmoNotes] = useState('');
  const [savingHmoClaim, setSavingHmoClaim] = useState(false);

  const [hmoQueue, setHmoQueue] = useState([]);
  const [hmoQueueLoading, setHmoQueueLoading] = useState(false);
  const [hmoQueueError, setHmoQueueError] = useState('');
  const [hmoQueueStatus, setHmoQueueStatus] = useState('All');
  const [hmoQueueQuery, setHmoQueueQuery] = useState('');
  const [hmoQuickEdit, setHmoQuickEdit] = useState(null);
  const [hmoQuickSaving, setHmoQuickSaving] = useState(false);

  const [labOrders, setLabOrders] = useState([]);
  const [labOrdersLoading, setLabOrdersLoading] = useState(false);
  const [labOrdersError, setLabOrdersError] = useState('');
  const [labOrdersRange, setLabOrdersRange] = useState('All');
  const [labOrdersQuery, setLabOrdersQuery] = useState('');
  const [selectedLabOrder, setSelectedLabOrder] = useState(null);
  const [labPaymentMethod, setLabPaymentMethod] = useState('Cash');
  const [labPaymentAmount, setLabPaymentAmount] = useState('');
  const [labPaymentReference, setLabPaymentReference] = useState('');
  const [labPaymentLoading, setLabPaymentLoading] = useState(false);
  const [labPaymentError, setLabPaymentError] = useState('');
  const [paymentHistory, setPaymentHistory] = useState([]);
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

  const refreshInvoices = async () => {
    if (!user) return;
    setInvoiceLoading(true);
    setInvoiceError('');
    try {
      const params = new URLSearchParams();
      if (invoiceStatus && invoiceStatus !== 'All') params.set('status', invoiceStatus);
      if (invoiceQuery.trim()) params.set('q', invoiceQuery.trim());
      const data = await fetchJson(`/api/billing/invoices?${params.toString()}`, { apiBase: API_BASE, headers: buildHeaders(user) });
      setInvoices(Array.isArray(data) ? data : []);
    } catch (e) {
      setInvoices([]);
      setInvoiceError(String(e.message || 'Failed to load invoices'));
    } finally {
      setInvoiceLoading(false);
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
      params.set('status', 'For Payment');
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

  const refreshPaymentHistory = useCallback(async () => {
    if (!user || role !== 'cashier') return;
    setPaymentHistoryLoading(true);
    setPaymentHistoryError('');
    try {
      const params = new URLSearchParams();
      params.set('take', '200');
      const data = await fetchJson(`/api/billing/payments?${params.toString()}`, {
        apiBase: API_BASE,
        headers: buildHeaders(user)
      });
      setPaymentHistory(Array.isArray(data) ? data : []);
    } catch (e) {
      setPaymentHistory([]);
      setPaymentHistoryError(String(e.message || 'Failed to load payment history'));
    } finally {
      setPaymentHistoryLoading(false);
    }
  }, [role, user]);

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
      amountReceived,
      change: Math.max(0, amountReceived - amountDue),
      source
    };
  }, []);

  const openLabOrderPos = useCallback((order) => {
    const due = Number(order?.amountDue ?? order?.unitPrice ?? 0);
    setSelectedLabOrder(order || null);
    setLabPaymentMethod('Cash');
    setLabPaymentAmount(Number.isFinite(due) && due > 0 ? due.toFixed(2) : '');
    setLabPaymentReference('');
    setLabPaymentError('');
  }, []);

  const printPaymentReceipt = useCallback((receipt) => {
    if (!receipt || typeof window === 'undefined') return;
    const popup = window.open('', '_blank', 'width=420,height=720');
    if (!popup) return;
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
  }, []);

  const refreshHmoQueue = useCallback(async () => {
    if (!user) return;
    setHmoQueueLoading(true);
    setHmoQueueError('');
    try {
      const params = new URLSearchParams();
      if (hmoQueueStatus && hmoQueueStatus !== 'All') params.set('status', hmoQueueStatus);
      if (hmoQueueQuery.trim()) params.set('q', hmoQueueQuery.trim());
      const data = await fetchJson(`/api/billing/hmo-queue?${params.toString()}`, { apiBase: API_BASE, headers: buildHeaders(user) });
      setHmoQueue(Array.isArray(data) ? data : []);
    } catch (e) {
      setHmoQueue([]);
      setHmoQueueError(String(e.message || 'Failed to load HMO queue'));
    } finally {
      setHmoQueueLoading(false);
    }
  }, [user, hmoQueueStatus, hmoQueueQuery]);

  useEffect(() => {
    if (!user) return;
    if (view === 'hmo') refreshHmoQueue();
  }, [refreshHmoQueue, user, view]);

  const saveHmoClaim = async (invoiceId, opts = {}) => {
    if (!user) return Promise.resolve(null);
    const providerRaw = String(opts.provider ?? hmoProvider ?? '').trim();
    const loaNumberRaw = String(opts.loaNumber ?? loaNumber ?? '').trim();
    const statusRaw = String(opts.status ?? hmoStatus ?? 'Pending').trim();
    const notesRaw = String(opts.notes ?? hmoNotes ?? '').trim();
    const philhealth = Number(opts.philhealthDeduction ?? philhealthDeduction ?? 0) || 0;
    const loaApproved = Number(opts.loaApprovedAmount ?? hmoCoverage ?? 0) || 0;

    const hasAnything = Boolean(
      providerRaw || loaNumberRaw || notesRaw ||
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
    setHmoStatus('Pending');
    setHmoNotes('');
    try {
      const data = await fetchJson(`/api/billing/invoices/${invoiceId}`, { apiBase: API_BASE, headers: buildHeaders(user) });
      setSelectedInvoice(data);
      const claim = data?.hmo_claim || null;
      if (claim) {
        if (claim.provider) setHmoProvider(String(claim.provider));
        if (claim.loa_number) setLoaNumber(String(claim.loa_number));
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
    const rawBalance = Number(selectedInvoice?.balance_amount || 0);
    const ph = Number(philhealthDeduction || 0);
    const hmo = Number(hmoCoverage || 0);
    return Math.max(0, rawBalance - ph - hmo);
  }, [selectedInvoice, philhealthDeduction, hmoCoverage]);

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
    } catch (_) {
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
    try {
      let workingInvoice = selectedInvoice;
      try {
        const updated = await saveHmoClaim(selectedInvoice.id);
        if (updated) {
          workingInvoice = updated;
        }
      } catch (hmoErr) {
        // Don't block payment on HMO save error unless it's a validation error (message)
        const msg = String(hmoErr?.message || '');
        if (msg && /provider|deduction cannot exceed|HMO approved amount/i.test(msg)) {
          throw new Error(`HMO: ${msg}`);
        }
      }
      const priorPaymentIds = new Set(
        (Array.isArray(workingInvoice.payments) ? workingInvoice.payments : [])
          .map((p) => String(p?.id || '').trim())
          .filter(Boolean)
      );
      const priorBalance = Number(workingInvoice.balance_amount || 0);
      const due = Number(workingInvoice.balance_amount || 0);
      if (!Number.isFinite(due) || due <= 0) throw new Error('No outstanding balance.');
      const method = String(payMethod || 'Cash').trim();
      if (method === 'GCash') throw new Error('GCash is currently unavailable.');
      const ref = String(payReference || '').trim();
      if (method !== 'Cash' && !ref) throw new Error('Receipt/reference is required.');
      if (method === 'Cash') {
        const received = Number(String(cashReceived || payAmount || '').trim());
        if (!Number.isFinite(received) || received <= 0) throw new Error('Enter cash received.');
        if (received + 0.0001 < due) throw new Error(`Cash received is below the amount due of PHP ${toMoney(due)}.`);
      }
      const createdPayment = await fetchJson(`/api/billing/payments`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: buildHeaders(user),
        timeoutMs: 90000,
        body: JSON.stringify({
          invoiceId: workingInvoice.id,
          amount: due,
          method,
          reference: ref || null
        })
      });
      setPayReference('');
      const received = method === 'Cash' ? Number(String(cashReceived || payAmount || '').trim()) : due;
      setCashReceived('');
      setPayAmount('');
      const receipt = buildConsultationReceipt({ 
        invoice: workingInvoice, 
        payment: createdPayment, 
        user, 
        amountReceivedOverride: received,
        philhealthDeduction,
        hmoCoverage,
        hmoProvider
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
              hmoProvider
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
    const amountDue = Number(selectedLabOrder?.amountDue ?? selectedLabOrder?.unitPrice ?? 0);
    const method = String(labPaymentMethod || 'Cash').trim();
    const ref = String(labPaymentReference || '').trim();
    if (!selectedLabOrder?.priceConfigured || !(amountDue > 0)) {
      setLabPaymentError('No configured cashier price is available for this lab service yet.');
      return;
    }
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
    setLabPaymentLoading(true);
    setLabPaymentError('');
    try {
      const receiptPayload = {
        orderId: String(selectedLabOrder.id),
        patientName: selectedLabOrder.patientName || 'Patient',
        serviceLabel: selectedLabOrder.priceLabel || selectedLabOrder.service || selectedLabOrder.kind || 'Lab Service',
        amountDue,
        amountReceived,
        change: Math.max(0, amountReceived - amountDue),
        method,
        reference: ref || '—',
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
          paymentReference: ref,
          paymentMethod: labPaymentMethod || null,
          paymentAmount: amountReceived,
          actorName: user.name || user.first_name || user.firstName || user.email || 'Cashier',
          actorRole: 'cashier',
          eventNote: `Payment recorded • ${labPaymentMethod || 'method'} • ${ref}`
        })
      });
      setSelectedLabOrder(null);
      setLabPaymentMethod('Cash');
      setLabPaymentAmount('');
      setLabPaymentReference('');
      setPaymentReceipt({ ...receiptPayload, source: 'Lab Payment' });
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
  }, [invoices]);

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
    const query = String(paymentsQuery || '').trim().toLowerCase();
    return (Array.isArray(paymentHistory) ? paymentHistory : []).filter((payment) => {
      const source = String(payment.source || inferInvoiceSource(payment.invoice || {}) || '').trim();
      if (paymentsSource !== 'All' && source !== paymentsSource) return false;
      if (!query) return true;
      const haystack = [
        payment.patientName,
        payment.serviceLabel,
        payment.method,
        payment.reference,
        payment.cashierName,
        payment.receiptNumber,
        payment.id,
        payment.invoice_id,
        source
      ]
        .map((v) => String(v || '').toLowerCase())
        .join(' ');
      return haystack.includes(query);
    });
  }, [paymentHistory, paymentsQuery, paymentsSource]);

  useEffect(() => {
    setPaymentsPage(1);
  }, [paymentsQuery, paymentsSource]);

  const pagedPaymentHistory = useMemo(() => {
    const perPage = 15;
    const list = filteredPaymentHistory;
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    const currentPage = Math.min(Math.max(1, paymentsPage), totalPages);
    const startIndex = (currentPage - 1) * perPage;
    return {
      perPage,
      totalPages,
      currentPage,
      items: list.slice(startIndex, startIndex + perPage)
    };
  }, [filteredPaymentHistory, paymentsPage]);

  const paymentHistorySummary = useMemo(() => {
    const list = filteredPaymentHistory;
    const sourceCount = (label) => list.filter((payment) => String(payment.source || '') === label).length;
    const totalCollected = list.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    return {
      totalCollected,
      transactionCount: list.length,
      consultationCount: sourceCount('Onsite Consultation'),
      videoCount: sourceCount('Video Consultation'),
      labCount: sourceCount('Lab')
    };
  }, [filteredPaymentHistory]);

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
      const hay = `${o.patientName || ''} ${o.service || ''} ${o.kind || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [labOrders, labOrdersQuery, labOrdersRange]);

  const selectedLabOrderDue = useMemo(() => {
    const due = Number(selectedLabOrder?.amountDue ?? selectedLabOrder?.unitPrice ?? 0);
    return Number.isFinite(due) ? due : 0;
  }, [selectedLabOrder]);

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
        <div className="office-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            {collapsed ? (
              <button type="button" className="app-mobile-menu-btn" onClick={() => setCollapsed(false)} aria-label="Open menu">
                <Menu size={18} />
              </button>
            ) : null}
            <div>
              <div className="office-title">{roleLabel}</div>
              <div className="office-subtitle">{view === 'dashboard' ? 'Overview' : view === 'profile' ? 'My Profile' : view.charAt(0).toUpperCase() + view.slice(1)}</div>
            </div>
          </div>
          <div className="office-row">
            <button type="button" className="office-btn ghost" onClick={refreshInvoices} disabled={!user || invoiceLoading} title="Refresh">
              <RefreshCw size={16} />
              Refresh
            </button>
            <AccountHeaderActions user={user} roleLabel={roleLabel} onSignOut={() => setShowLogoutConfirm(true)} onMyProfile={() => setView('profile')} />
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
                            <td className="text-sm font-medium text-slate-700">#{o.id}</td>
                            <td className="text-sm text-slate-600">{o.patientName || '—'}</td>
                            <td className="text-sm text-slate-600">{o.service || o.kind || '—'}</td>
                            <td className="text-sm text-slate-600">
                              {o.priceConfigured ? `₱ ${toMoney(o.amountDue)}` : 'Needs setup'}
                            </td>
                            <td>
                              <span className="status-badge-table status-upcoming">{o.status || 'For Payment'}</span>
                            </td>
                            <td className="inc-right">
                              <button
                                type="button"
                                className="office-btn ghost"
                                onClick={() => openLabOrderPos(o)}
                              >
                                Record Payment
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
                <div className="sec-profile-form-grid">
                  <div className="sec-form-section">
                    <h4>Personal Information</h4>
                    <div className="sec-form-row-2">
                      <div className="sec-field">
                        <label>First Name</label>
                        <input 
                          type="text" 
                          className="sec-input" 
                          value={profileForm.firstName} 
                          onChange={(e) => setProfileForm(v => ({ ...v, firstName: e.target.value }))} 
                        />
                      </div>
                      <div className="sec-field">
                        <label>Last Name</label>
                        <input 
                          type="text" 
                          className="sec-input" 
                          value={profileForm.lastName} 
                          onChange={(e) => setProfileForm(v => ({ ...v, lastName: e.target.value }))} 
                        />
                      </div>
                      </div>
                      <div className="sec-field">
                      <label>Email Address (Not changeable)</label>
                      <input 
                        type="email" 
                        className="sec-input readonly" 
                        value={profileForm.email} 
                        readOnly 
                      />
                    </div>
                  </div>

                  <div className="sec-form-section">
                    <h4>Security</h4>
                    <div className="sec-form-row-2">
                      <div className="sec-field">
                        <label>New Password</label>
                        <div className="sec-password-wrap">
                          <input 
                            type={showPasswords ? 'text' : 'password'} 
                            className="sec-input" 
                            placeholder="Leave blank to keep current"
                            value={profileForm.newPassword} 
                            onChange={(e) => setProfileForm(v => ({ ...v, newPassword: e.target.value }))} 
                          />
                          <button type="button" onClick={() => setShowPasswords(!showPasswords)} className="sec-eye-btn">
                            {showPasswords ? <EyeOff size={18} /> : <Eye size={18} />}
                          </button>
                        </div>
                        <div style={{ marginTop: 10, color: '#64748b', fontSize: '0.9rem' }}>
                          Change your password here. Leave the fields blank if you want to keep your current password.
                        </div>
                      </div>
                      <div className="sec-field">
                        <label>Confirm Password</label>
                        <input 
                          type={showPasswords ? 'text' : 'password'} 
                          className="sec-input" 
                          placeholder="Re-type new password"
                          value={profileForm.confirmPassword} 
                          onChange={(e) => setProfileForm(v => ({ ...v, confirmPassword: e.target.value }))} 
                        />
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

                <div className="sec-profile-footer">
                  <button className="sec-btn primary" onClick={saveProfile} disabled={savingProfile}>
                    <Save size={16} />
                    {savingProfile ? 'Saving Changes...' : 'Save Changes'}
                  </button>
                </div>
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
            <div className="office-grid-4">
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
                <div className="office-kpi-k">Pending Lab Payments</div>
                <div className="office-kpi-v">{displayedLabOrders.length}</div>
                <div className="office-kpi-meta">Separate pay-before-exam queue</div>
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
                      if (e.key === 'Enter') refreshInvoices();
                    }}
                    placeholder="Search patient, invoice ID, appointment ID, doctor, or service"
                  />
                </div>
                <button type="button" className="office-btn primary" onClick={refreshInvoices} disabled={invoiceLoading || !user}>
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
                  <button type="button" className="office-btn primary" onClick={refreshInvoices} disabled={invoiceLoading || !user}>
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

            <div className="office-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div className="office-title" style={{ fontSize: '1.05rem' }}>Invoices</div>
                  <div className="office-subtitle">Select to view details</div>
                </div>
                <div className="office-row">
                  <select className="office-select" value={invoiceStatus} onChange={(e) => setInvoiceStatus(e.target.value)}>
                    <option value="All">All</option>
                    <option value="Draft">Draft</option>
                    <option value="Ready">Ready</option>
                    <option value="Paid">Paid</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                  <select className="office-select" value={invoiceRange} onChange={(e) => setInvoiceRange(e.target.value)}>
                    <option value="All">All Dates</option>
                    <option value="Today">Today</option>
                    <option value="Week">This Week</option>
                  </select>
                  <button type="button" className="office-btn" onClick={refreshInvoices} disabled={invoiceLoading || !user}>
                    <RefreshCw size={16} />
                    Refresh
                  </button>
                </div>
              </div>

              {invoiceError ? <div className="admin-alert error" style={{ margin: 12 }}>{invoiceError}</div> : null}

              <div className="logs-table-container" style={{ maxHeight: '520px' }}>
                <table className="staff-table">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Patient</th>
                      <th>Status</th>
                      <th>Total</th>
                      <th>Balance</th>
                      <th className="inc-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceLoading ? (
                      <tr>
                        <td colSpan="6" className="text-center py-8 text-slate-500">Loading…</td>
                      </tr>
                    ) : displayedInvoices.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="text-center py-8 text-slate-500">No invoices match your filters.</td>
                      </tr>
                    ) : (
                      displayedInvoices.slice(0, 80).map((inv) => {
                        const p = inv.patients;
                        const patientName = p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : '—';
                        const status = inv.status || 'Draft';
                        const balance = inv.balance_amount || inv.total_amount;
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
                            <td className="text-sm text-slate-600">₱ {toMoney(inv.total_amount)}</td>
                            <td className="text-sm text-slate-600">₱ {toMoney(balance)}</td>
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
            </div>
          </div>
          </div>
        ) : null}

        {view === 'lab-payments' && role === 'cashier' ? (
          <div className="office-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div className="office-title" style={{ fontSize: '1.05rem' }}>Lab Payments</div>
                <div className="office-subtitle">Orders waiting for pay-before-exam</div>
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
                    <th>Amount Due</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th className="inc-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {labOrdersLoading ? (
                    <tr>
                      <td colSpan="7" className="text-center py-8 text-slate-500">Loading…</td>
                    </tr>
                  ) : displayedLabOrders.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="text-center py-8 text-slate-500">No lab orders waiting for payment.</td>
                    </tr>
                  ) : (
                    displayedLabOrders.slice(0, 120).map((o) => (
                      <tr key={String(o.id)}>
                        <td className="text-sm font-medium text-slate-700">#{o.id}</td>
                        <td className="text-sm text-slate-600">{o.patientName || '—'}</td>
                        <td className="text-sm text-slate-600">{o.service || o.kind || '—'}</td>
                        <td className="text-sm text-slate-600">
                          {o.priceConfigured ? `₱ ${toMoney(o.amountDue)}` : 'Needs setup'}
                        </td>
                        <td>
                          <span className={`status-badge-table ${
                            String(o.status || '').toLowerCase() === 'paid' ? 'status-duty' :
                            String(o.status || '').toLowerCase() === 'for payment' ? 'status-upcoming' :
                            'status-scheduled'
                          }`}>{o.status || '—'}</span>
                        </td>
                        <td className="text-sm text-slate-600">{o.createdAt ? new Date(o.createdAt).toLocaleString() : '—'}</td>
                        <td className="inc-right">
                          <button
                            type="button"
                            className="office-btn ghost"
                            onClick={() => openLabOrderPos(o)}
                          >
                            Record Payment
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
                <div className="office-kpi-meta">Onsite consultation receipts</div>
              </div>
              <div className="office-kpi">
                <div className="office-kpi-k">Video Consultation</div>
                <div className="office-kpi-v">{paymentHistorySummary.videoCount}</div>
                <div className="office-kpi-meta">Online consult collections</div>
              </div>
              <div className="office-kpi">
                <div className="office-kpi-k">Lab Payments</div>
                <div className="office-kpi-v">{paymentHistorySummary.labCount}</div>
                <div className="office-kpi-meta">Pre-exam cashier payments</div>
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
                    />
                  </div>
                  <select className="office-select" value={paymentsSource} onChange={(e) => setPaymentsSource(e.target.value)}>
                    <option value="All">All Sources</option>
                    <option value="Onsite Consultation">Onsite Consultation</option>
                    <option value="Video Consultation">Video Consultation</option>
                    <option value="Lab">Lab</option>
                    <option value="Radiology">Radiology</option>
                    <option value="Manual Invoice">Manual Invoice</option>
                  </select>
                  <button type="button" className="office-btn ghost" onClick={refreshPaymentHistory} disabled={paymentHistoryLoading}>
                    <RefreshCw size={16} />
                    Refresh
                  </button>
                </div>
              </div>

              {paymentHistoryError ? <div className="admin-alert error" style={{ marginTop: 12 }}>{paymentHistoryError}</div> : null}

              <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div className="office-subtitle">{filteredPaymentHistory.length} result(s)</div>
                <div className="office-row">
                  <button
                    type="button"
                    className="office-btn ghost"
                    onClick={() => setPaymentsPage((p) => Math.max(1, p - 1))}
                    disabled={paymentHistoryLoading || pagedPaymentHistory.currentPage <= 1}
                    title="Previous page"
                  >
                    <ChevronLeft size={16} />
                    Prev
                  </button>
                  <div style={{ fontWeight: 800, color: '#0f172a' }}>
                    Page {pagedPaymentHistory.currentPage} / {pagedPaymentHistory.totalPages}
                  </div>
                  <button
                    type="button"
                    className="office-btn ghost"
                    onClick={() => setPaymentsPage((p) => Math.min(pagedPaymentHistory.totalPages, p + 1))}
                    disabled={paymentHistoryLoading || pagedPaymentHistory.currentPage >= pagedPaymentHistory.totalPages}
                    title="Next page"
                  >
                    Next
                    <ChevronRight size={16} />
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
      </main>

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
                    <div className="office-pos-label">Amount Due</div>
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
                  <div className="office-row">
                    <select className="office-select" value={labPaymentMethod} onChange={(e) => setLabPaymentMethod(e.target.value)}>
                      <option value="Cash">Cash</option>
                      <option value="GCash">GCash</option>
                      <option value="Card">Card</option>
                    </select>
                    <input
                      className="office-input"
                      style={{ width: 180, minWidth: 0 }}
                      type="number"
                      min="0"
                      step="0.01"
                      value={labPaymentAmount}
                      onChange={(e) => setLabPaymentAmount(e.target.value)}
                      placeholder="Amount received"
                    />
                    <input className="office-input" style={{ flex: '1 1 220px', minWidth: 0 }} value={labPaymentReference} onChange={(e) => setLabPaymentReference(e.target.value)} placeholder={labPaymentMethod === 'Cash' ? 'Receipt / Reference (optional)' : 'Receipt / Reference (required)'} />
                    <button type="button" className="office-btn primary" onClick={recordLabPayment} disabled={labPaymentLoading || !selectedLabOrder.priceConfigured}>
                      {labPaymentLoading ? 'Saving…' : 'Collect Payment'}
                    </button>
                  </div>
                  <div style={{ marginTop: 10, color: '#64748b', fontSize: '0.9rem' }}>
                    After cashier collection, this lab order moves to <strong>Paid</strong> so the lab staff can proceed with the exam.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {view === 'hmo' ? (
        <>
          <div className="office-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div className="office-title" style={{ fontSize: '1.05rem' }}>HMO Monitoring</div>
                  <div className="office-subtitle">PhilHealth and HMO Letter of Authority (LOA) queue</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div className="input-wrapper-relative" style={{ minWidth: 220 }}>
                    <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                    <input
                      className="office-input"
                      style={{ paddingLeft: 36, height: 40 }}
                      value={hmoQueueQuery}
                      onChange={(e) => setHmoQueueQuery(e.target.value)}
                      placeholder="Search patient / provider / LOA"
                    />
                  </div>
                  <select className="office-select" style={{ minWidth: 160, height: 40 }} value={hmoQueueStatus} onChange={(e) => setHmoQueueStatus(e.target.value)}>
                    <option value="All">All Statuses</option>
                    <option value="Pending">Pending</option>
                    <option value="Awaiting LOA">Awaiting LOA</option>
                    <option value="Approved">Approved</option>
                    <option value="Partially Approved">Partially Approved</option>
                    <option value="Rejected">Rejected</option>
                  </select>
                  <button type="button" className="office-btn ghost" onClick={refreshHmoQueue} disabled={hmoQueueLoading} style={{ height: 40 }}>
                    <RefreshCw size={16} />
                    {hmoQueueLoading ? 'Loading…' : 'Refresh'}
                  </button>
                </div>
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center' }}>
                {[
                  { label: 'All Claims', count: hmoQueue.length, fg: '#0f172a' },
                  { label: 'Pending', count: hmoQueue.filter(r => String(r?.hmo_claim?.status || '') === 'Pending').length, fg: '#ea580c' },
                  { label: 'Awaiting LOA', count: hmoQueue.filter(r => String(r?.hmo_claim?.status || '') === 'Awaiting LOA').length, fg: '#dc2626' },
                  { label: 'Approved / Partial', count: hmoQueue.filter(r => { const s = String(r?.hmo_claim?.status || ''); return s === 'Approved' || s === 'Partially Approved'; }).length, fg: '#16a34a' },
                  { label: 'Rejected', count: hmoQueue.filter(r => String(r?.hmo_claim?.status || '') === 'Rejected').length, fg: '#64748b' }
                ].map((it) => (
                  <div key={it.label} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{it.label}</span>
                    <span style={{ fontSize: '1.05rem', fontWeight: 800, color: it.fg }}>{it.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {hmoQueueError ? <div className="admin-alert error" style={{ margin: 12 }}>{hmoQueueError}</div> : null}

            <div className="logs-table-container" style={{ maxHeight: 'calc(100vh - 340px)' }}>
              <table className="staff-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Patient</th>
                    <th>HMO Provider</th>
                    <th>LOA #</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Total Bill</th>
                    <th style={{ textAlign: 'right' }}>PhilHealth</th>
                    <th style={{ textAlign: 'right' }}>HMO Covered</th>
                    <th style={{ textAlign: 'right' }}>Patient Pays</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {hmoQueueLoading ? (
                    <tr><td colSpan="10" className="text-center py-12 text-slate-500">Loading…</td></tr>
                  ) : hmoQueue.length === 0 ? (
                    <tr>
                      <td colSpan="10" className="text-center py-12 text-slate-500">
                        <div style={{ opacity: 0.6 }}>
                          <Shield size={32} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
                          <div style={{ fontWeight: 700 }}>No HMO claims yet</div>
                          <div style={{ fontSize: '0.85rem', marginTop: 4, color: '#94a3b8' }}>
                            Open an invoice in Billing to add PhilHealth / HMO deductions.
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : hmoQueue.map((row) => {
                    const claim = row?.hmo_claim || {};
                    const status = String(claim.status || 'Pending');
                    const statusColor =
                      status === 'Approved' ? { bg: '#dcfce7', fg: '#166534' } :
                      status === 'Partially Approved' ? { bg: '#fef9c3', fg: '#854d0e' } :
                      status === 'Awaiting LOA' ? { bg: '#fee2e2', fg: '#991b1b' } :
                      status === 'Rejected' ? { bg: '#f1f5f9', fg: '#475569' } :
                      { bg: '#ffedd5', fg: '#c2410c' };
                    return (
                      <tr key={String(row.id || row.invoice_id)}>
                        <td>#{String(row.invoice_id || '—')}</td>
                        <td>
                          <div style={{ fontWeight: 600, color: '#0f172a' }}>{row.patient_name || '—'}</div>
                          {row.contact_number ? <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{String(row.contact_number)}</div> : null}
                        </td>
                        <td style={{ color: claim.provider ? '#0f172a' : '#cbd5e1' }}>
                          {claim.provider ? String(claim.provider) : '—'}
                        </td>
                        <td>
                          {claim.loa_number ? (
                            <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#2563eb', fontSize: '0.85rem' }}>{String(claim.loa_number)}</span>
                          ) : (
                            <span style={{ color: '#cbd5e1' }}>—</span>
                          )}
                        </td>
                        <td>
                          <span style={{
                            display: 'inline-block', padding: '4px 10px', borderRadius: 999,
                            fontSize: '0.72rem', fontWeight: 700,
                            background: statusColor.bg, color: statusColor.fg
                          }}>
                            {status}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', color: '#0f172a' }}>₱ {toMoney(row.total_amount || 0)}</td>
                        <td style={{ textAlign: 'right', color: '#ea580c', fontWeight: 600 }}>−₱ {toMoney(claim.philhealth_deduction || 0)}</td>
                        <td style={{ textAlign: 'right', color: '#2563eb', fontWeight: 600 }}>−₱ {toMoney(claim.applied_hmo_amount || 0)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 800, color: '#f97316' }}>₱ {toMoney(row.patient_due_amount || claim.patient_payable || 0)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              className="office-btn ghost"
                              style={{ padding: '6px 10px', fontSize: '0.8rem', height: 34, borderRadius: 10 }}
                              onClick={() => setHmoQuickEdit(row)}
                            >
                              <Edit2 size={14} />
                              Update
                            </button>
                            <button
                              type="button"
                              className="office-btn primary"
                              style={{ padding: '6px 10px', fontSize: '0.8rem', height: 34, borderRadius: 10 }}
                              onClick={async () => {
                                await openInvoice(String(row.invoice_id));
                                setView('billing');
                              }}
                            >
                              <FileText size={14} />
                              Invoice
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
        </>
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
              <div className="office-payment-field-group">
                <div className="office-payment-field">
                  <label style={{ color: '#475569' }}>HMO Provider</label>
                  <select
                    className="office-select"
                    value={hmoQuickEdit._provider ?? String(hmoQuickEdit?.hmo_claim?.provider || '')}
                    onChange={(e) => setHmoQuickEdit({ ...hmoQuickEdit, _provider: e.target.value })}
                  >
                    <option value="">None</option>
                    <option value="Maxicare">Maxicare</option>
                    <option value="Medicard">Medicard</option>
                    <option value="Intellicare">Intellicare</option>
                    <option value="PhilCare">PhilCare</option>
                    <option value="Cocolife">Cocolife</option>
                    <option value="Pru Life">Pru Life</option>
                    <option value="Sun Life">Sun Life</option>
                    <option value="Generali">Generali</option>
                    <option value="AIA">AIA</option>
                    <option value="Eastwest HealthCare">Eastwest</option>
                    <option value="Caritas">Caritas</option>
                    <option value="Blue Cross">Blue Cross</option>
                    <option value="Insular Life">Insular Life</option>
                    <option value="FPG">FPG</option>
                    <option value="Malayan">Malayan</option>
                  </select>
                </div>
                <div className="office-payment-field">
                  <label style={{ color: '#475569' }}>Status</label>
                  <select
                    className="office-select"
                    value={hmoQuickEdit._status ?? String(hmoQuickEdit?.hmo_claim?.status || 'Pending')}
                    onChange={(e) => setHmoQuickEdit({ ...hmoQuickEdit, _status: e.target.value })}
                  >
                    <option value="Pending">Pending</option>
                    <option value="Awaiting LOA">Awaiting LOA</option>
                    <option value="Approved">Approved</option>
                    <option value="Partially Approved">Partial</option>
                    <option value="Rejected">Rejected</option>
                  </select>
                </div>
                <div className="office-payment-field">
                  <label style={{ color: '#475569' }}>LOA #</label>
                  <input
                    className="office-input"
                    value={hmoQuickEdit._loa ?? String(hmoQuickEdit?.hmo_claim?.loa_number || '')}
                    onChange={(e) => setHmoQuickEdit({ ...hmoQuickEdit, _loa: e.target.value })}
                    placeholder="Reference"
                  />
                </div>
                <div className="office-payment-field">
                  <label style={{ color: '#475569' }}>PhilHealth</label>
                  <input
                    className="office-input"
                    type="number"
                    value={hmoQuickEdit._ph ?? (hmoQuickEdit?._ph === 0 ? 0 : String(hmoQuickEdit?.hmo_claim?.philhealth_deduction ?? ''))}
                    onChange={(e) => setHmoQuickEdit({ ...hmoQuickEdit, _ph: e.target.value })}
                    placeholder="₱ 0"
                  />
                </div>
                <div className="office-payment-field">
                  <label style={{ color: '#475569' }}>HMO Covered</label>
                  <input
                    className="office-input"
                    type="number"
                    value={hmoQuickEdit._hmoAmt ?? (hmoQuickEdit?._hmoAmt === 0 ? 0 : String(hmoQuickEdit?.hmo_claim?.loa_approved_amount ?? ''))}
                    onChange={(e) => setHmoQuickEdit({ ...hmoQuickEdit, _hmoAmt: e.target.value })}
                    placeholder="₱ 0"
                  />
                </div>
                <div className="office-payment-field office-payment-field-wide">
                  <label style={{ color: '#475569' }}>Notes</label>
                  <input
                    className="office-input"
                    value={hmoQuickEdit._notes ?? String(hmoQuickEdit?.hmo_claim?.notes || '')}
                    onChange={(e) => setHmoQuickEdit({ ...hmoQuickEdit, _notes: e.target.value })}
                    placeholder="Optional notes"
                  />
                </div>
              </div>

              <div style={{ marginTop: 12, padding: '10px 14px', background: '#f8fafc', borderRadius: 10 }}>
                {(() => {
                  const total = Number(hmoQuickEdit.total_amount || 0);
                  const ph = Number(hmoQuickEdit._ph ?? hmoQuickEdit?.hmo_claim?.philhealth_deduction ?? 0) || 0;
                  const statusQ = String(hmoQuickEdit._status ?? hmoQuickEdit?.hmo_claim?.status ?? 'Pending');
                  const hmoAmt = (statusQ === 'Approved' || statusQ === 'Partially Approved')
                    ? (Number(hmoQuickEdit._hmoAmt ?? hmoQuickEdit?.hmo_claim?.loa_approved_amount ?? 0) || 0)
                    : 0;
                  const net = Math.max(0, total - ph - hmoAmt);
                  return (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.88rem', color: '#475569' }}>Patient Pays</span>
                      <span style={{ fontSize: '1.1rem', fontWeight: 900, color: '#f97316' }}>₱ {toMoney(net)}</span>
                    </div>
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
                <div className="office-receipt-row"><span>Amount Due</span><strong>₱ {toMoney(paymentReceipt.amountDue)}</strong></div>
                <div className="office-receipt-row"><span>Amount Received</span><strong>₱ {toMoney(paymentReceipt.amountReceived)}</strong></div>
                <div className="office-receipt-row"><span>Change</span><strong>₱ {toMoney(paymentReceipt.change)}</strong></div>
                <div className="office-receipt-row"><span>Status</span><strong>Paid</strong></div>
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
          <div className="office-modal" onClick={(e) => e.stopPropagation()}>
            <div className="office-modal-head">
              <div className="office-modal-title">{role === 'cashier' ? `Cashier POS • Invoice #${selectedInvoice?.id || ''}` : `Invoice #${selectedInvoice?.id || ''}`}</div>
              <button type="button" className="office-btn ghost" onClick={() => setSelectedInvoice(null)}>Close</button>
            </div>
            <div className="office-modal-body">
              {selectedInvoiceLoading ? (
                <div className="text-slate-500">Loading…</div>
              ) : selectedInvoice ? (
                <>
                  <div className="office-row" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 900, color: '#0f172a' }}>
                        {selectedInvoice.patients ? `${selectedInvoice.patients.first_name || ''} ${selectedInvoice.patients.last_name || ''}`.trim() : 'Patient'}
                      </div>
                      <div style={{ color: '#64748b', fontSize: '0.9rem' }}>
                        Status: <strong>{selectedInvoice.status || 'Draft'}</strong>
                      </div>
                      <div style={{ color: '#64748b', fontSize: '0.9rem' }}>
                        Source: <strong>{inferInvoiceSource(selectedInvoice)}</strong>{selectedInvoice.appointment_id ? ` • Appointment #${selectedInvoice.appointment_id}` : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 900, color: '#0f172a' }}>Total: ₱ {toMoney(selectedInvoice.total_amount)}</div>
                      <div style={{ color: '#64748b' }}>Paid: ₱ {toMoney(selectedInvoice.net_paid_amount ?? selectedInvoice.paid_amount ?? 0)}</div>
                      {Number(selectedInvoice.refunded_amount || 0) > 0 ? (
                        <div style={{ color: '#64748b' }}>Refunded: ₱ {toMoney(selectedInvoice.refunded_amount)}</div>
                      ) : null}
                      <div style={{ color: '#64748b' }}>Balance: ₱ {toMoney(selectedInvoice.balance_amount)}</div>
                    </div>
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontWeight: 900, marginBottom: 8 }}>Items</div>
                    <div className="logs-table-container" style={{ maxHeight: 220 }}>
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

                  {role === 'doctor_secretary' ? (
                    <div style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
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
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontWeight: 900, marginBottom: 8 }}>Payments</div>
                      <div className="logs-table-container" style={{ maxHeight: 200 }}>
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

                      <div className="office-payment-panel">
  <div className="office-payment-panel-head">
    <div>
      <div className="office-payment-title">
        {String(selectedInvoice.status || '').toLowerCase() === 'ready' && Number(selectedInvoice.balance_amount || 0) > 0 ? 'POS Payment Entry' : 'Payment Record'}
      </div>
      <div className="office-payment-subtitle">
        Record the cashier payment here. GCash is currently unavailable.
      </div>
    </div>
    <div className="office-payment-badge">
      {String(selectedInvoice.status || '').toLowerCase() === 'paid' ? 'Settled' : 'Ready to collect'}
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

  <div className="office-payment-quick-cash" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
    {[100, 500, 1000].map(amount => (
      <button 
        key={amount}
        type="button" 
        className="office-btn ghost" 
        style={{ border: '1px solid #e2e8f0', flex: 1, height: '44px', borderRadius: '14px' }}
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
      style={{ border: '2px solid #ea580c', color: '#ea580c', flex: 1.5, height: '44px', borderRadius: '14px' }}
      onClick={() => {
        setCashReceived(String(selectedInvoiceDue));
        setPayAmount(String(selectedInvoiceDue));
      }}
    >
      Exact Amount
    </button>
  </div>

  <div style={{ marginTop: 14, border: '1px solid #f1f5f9', borderRadius: 14, padding: 18, background: '#fff', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f97316' }}>
        <Shield size={16} />
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#0f172a' }}>PhilHealth & HMO</div>
        <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Deductions are subtracted before payment</div>
      </div>
    </div>

    <div className="office-payment-field-group">
      <div className="office-payment-field">
        <label style={{ color: '#475569' }}>PhilHealth</label>
        <input
          className="office-input"
          type="number"
          value={philhealthDeduction}
          onChange={(e) => setPhilhealthDeduction(e.target.value)}
          placeholder="₱ 0.00"
        />
      </div>
      <div className="office-payment-field">
        <label style={{ color: '#475569' }}>HMO Provider</label>
        <select className="office-select" value={hmoProvider} onChange={(e) => setHmoProvider(e.target.value)}>
          <option value="">None</option>
          <option value="Maxicare">Maxicare</option>
          <option value="Medicard">Medicard</option>
          <option value="Intellicare">Intellicare</option>
          <option value="PhilCare">PhilCare</option>
          <option value="Cocolife">Cocolife</option>
          <option value="Pru Life">Pru Life</option>
          <option value="Sun Life">Sun Life</option>
          <option value="Generali">Generali</option>
          <option value="AIA">AIA</option>
          <option value="Eastwest HealthCare">Eastwest</option>
          <option value="Caritas">Caritas</option>
          <option value="Blue Cross">Blue Cross</option>
          <option value="Insular Life">Insular Life</option>
          <option value="FPG">FPG</option>
          <option value="Malayan">Malayan</option>
        </select>
      </div>
      <div className="office-payment-field">
        <label style={{ color: '#475569' }}>HMO Covered</label>
        <input
          className="office-input"
          type="number"
          value={hmoCoverage}
          onChange={(e) => setHmoCoverage(e.target.value)}
          placeholder="₱ 0.00"
        />
      </div>
      <div className="office-payment-field">
        <label style={{ color: '#475569' }}>LOA #</label>
        <input
          className="office-input"
          type="text"
          value={loaNumber}
          onChange={(e) => setLoaNumber(e.target.value)}
          placeholder="Reference"
        />
      </div>
      <div className="office-payment-field">
        <label style={{ color: '#475569' }}>Status</label>
        <select className="office-select" value={hmoStatus} onChange={(e) => setHmoStatus(e.target.value)}>
          <option value="Pending">Pending</option>
          <option value="Awaiting LOA">Awaiting LOA</option>
          <option value="Approved">Approved</option>
          <option value="Partially Approved">Partial</option>
          <option value="Rejected">Rejected</option>
        </select>
      </div>
      <div className="office-payment-field office-payment-field-wide">
        <label style={{ color: '#475569' }}>Notes</label>
        <input
          className="office-input"
          type="text"
          value={hmoNotes}
          onChange={(e) => setHmoNotes(e.target.value)}
          placeholder="Optional notes"
        />
      </div>
    </div>

    {(() => {
      const total = Number(selectedInvoice?.total_amount || 0);
      const ph = Number(philhealthDeduction || 0);
      const hmoApplied = (hmoStatus === 'Approved' || hmoStatus === 'Partially Approved') ? Number(hmoCoverage || 0) : 0;
      const totalDed = ph + hmoApplied;
      const net = Math.max(0, total - totalDed);
      const hmoWarn = hmoStatus !== 'Approved' && hmoStatus !== 'Partially Approved' && Number(hmoCoverage || 0) > 0;
      return (
        <div style={{ marginTop: 14, padding: '12px 14px', background: '#f8fafc', borderRadius: 10 }}>
          {hmoWarn ? (
            <div style={{ fontSize: '0.75rem', color: '#b45309', marginBottom: 8, fontWeight: 500 }}>
              ⚠ HMO amount not deducted — status is not Approved / Partial
            </div>
          ) : null}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.86rem', color: '#64748b' }}>
            <span>Total Bill</span>
            <span style={{ color: '#0f172a', fontWeight: 600 }}>₱ {toMoney(total)}</span>
          </div>
          {totalDed > 0 ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.86rem', color: '#64748b' }}>
              <span>Total Deductions</span>
              <span style={{ color: '#ea580c', fontWeight: 600 }}>−₱ {toMoney(totalDed)}</span>
            </div>
          ) : null}
          <div style={{ height: 1, background: '#e2e8f0', margin: '8px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#0f172a' }}>Patient Pays</span>
            <span style={{ fontSize: '1.15rem', fontWeight: 900, color: '#f97316' }}>₱ {toMoney(net)}</span>
          </div>
        </div>
      );
    })()}

    <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
      <button
        type="button"
        className="office-btn ghost"
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
        style={{ height: 40, borderRadius: 10, border: '1px solid #f97316', color: '#f97316', fontWeight: 600 }}
      >
        {savingHmoClaim ? 'Saving…' : 'Save'}
      </button>
      <button
        type="button"
        className="office-btn ghost"
        onClick={() => {
          setPhilhealthDeduction(''); setHmoCoverage(''); setHmoProvider('');
          setLoaNumber(''); setHmoStatus('Pending'); setHmoNotes('');
        }}
        style={{ height: 40, borderRadius: 10, color: '#94a3b8', fontWeight: 500 }}
      >
        Clear
      </button>
    </div>
  </div>

  {paymentError ? <div className="admin-alert error" style={{ marginBottom: 10 }}>{paymentError}</div> : null}
  {payMethod === 'Cash' && paymentShort ? (
    <div className="office-payment-warning" style={{ marginBottom: 12 }}>
      Cash received is below the amount due of PHP {toMoney(selectedInvoiceDue)}.
    </div>
  ) : null}

  <div className="office-payment-form" style={{ marginTop: '12px' }}>
    <div className="office-payment-field">
      <label>Payment method</label>
      <div style={{ position: 'relative' }}>
        <select className="office-select" value={payMethod} onChange={(e) => setPayMethod(e.target.value)} style={{ paddingLeft: '40px' }}>
          <option value="Cash">Cash</option>
          <option value="GCash" disabled>GCash (Unavailable)</option>
          <option value="Card">Card</option>
        </select>
        <div style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }}>
          {payMethod === 'Cash' ? <CreditCard size={18} /> : payMethod === 'Card' ? <CreditCard size={18} /> : <CreditCard size={18} />}
        </div>
      </div>
    </div>

    <div className="office-payment-field">
      <label>{payMethod === 'Cash' ? 'Cash received' : 'Amount to post'}</label>
      <input
        className="office-input"
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

    <div className="office-payment-field office-payment-field-wide">
      <label>{payMethod === 'Cash' ? 'Receipt / Reference No. (optional)' : 'Receipt / Reference No.'}</label>
      <input
        className="office-input"
        value={payReference}
        onChange={(e) => setPayReference(e.target.value)}
        placeholder={payMethod === 'Cash' ? 'Optional for cash payments' : 'Enter OR / receipt / card slip reference'}
      />
    </div>
  </div>

  <div className="office-payment-actions">
    <div className="office-payment-note">
      {payMethod === 'Cash'
        ? 'The system records the exact invoice balance and shows the change for the patient.'
        : 'Non-cash posting will still settle only the current invoice balance.'}
    </div>
    <button
      type="button"
      className="office-btn primary office-payment-submit"
      onClick={createPayment}
      disabled={paymentLoading || selectedInvoice.status === 'Paid' || Number(selectedInvoice.balance_amount || 0) <= 0}
    >
      {paymentLoading ? 'Processing payment�' : 'Accept Payment'}
    </button>
  </div>
</div>

<div style={{ marginTop: 12, borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
                        <div style={{ fontWeight: 900, marginBottom: 8 }}>Adjustments</div>
                        {adjustmentError ? <div className="admin-alert error" style={{ marginBottom: 10 }}>{adjustmentError}</div> : null}
                        <div className="logs-table-container" style={{ maxHeight: 180 }}>
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

                        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <div style={{ border: '1px solid #f1f5f9', borderRadius: 12, padding: 12 }}>
                            <div style={{ fontWeight: 900, marginBottom: 8 }}>Issue Refund</div>
                            <div className="office-row" style={{ flexWrap: 'wrap' }}>
                              <input className="office-input" style={{ flex: '1 1 140px', minWidth: 0 }} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} placeholder="Amount" />
                              <input className="office-input" style={{ flex: '1 1 180px', minWidth: 0 }} value={refundReference} onChange={(e) => setRefundReference(e.target.value)} placeholder="Refund reference (required)" />
                            </div>
                            <input className="office-input" style={{ marginTop: 10, width: '100%' }} value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="Reason (optional)" />
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

                          <div style={{ border: '1px solid #f1f5f9', borderRadius: 12, padding: 12 }}>
                            <div style={{ fontWeight: 900, marginBottom: 8 }}>Void Invoice</div>
                            <input className="office-input" style={{ width: '100%' }} value={voidReference} onChange={(e) => setVoidReference(e.target.value)} placeholder="Void reference (optional)" />
                            <input className="office-input" style={{ marginTop: 10, width: '100%' }} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Reason (required)" />
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
                  ) : null}
                </>
              ) : null}
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

