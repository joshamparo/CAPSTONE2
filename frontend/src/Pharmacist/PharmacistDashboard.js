import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, BarChart3, Bell, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, FileText, LogOut, Menu, Package, Pill, QrCode, Search, ShoppingCart, Trash2, X, Plus, Minus, CreditCard, ReceiptText, Printer, RefreshCw, Upload, User, Mail, Briefcase, Phone, Key, Save, Shield, Eye, EyeOff, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './PharmacistDashboard.css';
import AccountHeaderActions from '../components/AccountHeaderActions';
import PatientFullRecordModal from '../components/PatientFullRecordModal';
import { checkBackendHealth, fetchJson, normalizeApiAssetUrl } from '../utils/api';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';
const EXPIRY_SOON_DAYS = 30;
const EXPIRY_CRITICAL_DAYS = 7;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const normalizeDateValue = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

const getDaysUntil = (value) => {
  const date = normalizeDateValue(value);
  if (!date) return null;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((date.getTime() - start.getTime()) / 86400000);
};

const getExpiryMeta = (value) => {
  const days = getDaysUntil(value);
  if (days == null) return null;
  if (days < 0) return { days, label: 'Expired', tone: 'danger', sortRank: 3, isExpired: true, isSoon: true };
  if (days <= EXPIRY_CRITICAL_DAYS) return { days, label: `Expires in ${days}d`, tone: 'danger', sortRank: 2, isSoon: true };
  if (days <= EXPIRY_SOON_DAYS) return { days, label: `Expires in ${days}d`, tone: 'warn', sortRank: 1, isSoon: true };
  return { days, label: `Expires in ${days}d`, tone: 'safe', sortRank: 0, isSoon: false };
};

const getStockMeta = (stockRaw, minRaw) => {
  const stock = Math.max(0, Number(stockRaw || 0));
  const minLevel = Math.max(0, Number(minRaw || 0));
  if (stock <= 0) return { stock, minLevel, label: 'Out of stock', tone: 'danger', sortRank: 3, isLow: true };
  if (stock <= minLevel) return { stock, minLevel, label: 'Low stock', tone: 'warn', sortRank: 2, isLow: true };
  if (stock <= minLevel + 5) return { stock, minLevel, label: 'Watch stock', tone: 'watch', sortRank: 1, isLow: false };
  return { stock, minLevel, label: 'Ready', tone: 'safe', sortRank: 0, isLow: false };
};

const formatDaysLabel = (days) => {
  if (days == null) return 'No expiry date';
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days === 0) return 'Expires today';
  return `${days} day${days === 1 ? '' : 's'} left`;
};

const toIsoDate = (d) => {
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const buildUtcRange = (preset, fromRaw, toRaw) => {
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  if (preset === 'yesterday') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0));
    const end = todayStart;
    return { from: start.toISOString(), to: end.toISOString(), fromDate: toIsoDate(start), toDate: toIsoDate(end) };
  }
  if (preset === 'week') {
    const day = todayStart.getUTCDay();
    const diff = (day + 6) % 7;
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff, 0, 0, 0));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
    return { from: start.toISOString(), to: end.toISOString(), fromDate: toIsoDate(start), toDate: toIsoDate(end) };
  }
  if (preset === 'custom') {
    const from = fromRaw ? new Date(`${String(fromRaw).trim()}T00:00:00.000Z`) : todayStart;
    const to = toRaw ? new Date(`${String(toRaw).trim()}T00:00:00.000Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
    const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() + 1, 0, 0, 0));
    return { from: from.toISOString(), to: end.toISOString(), fromDate: toIsoDate(from), toDate: toIsoDate(end) };
  }
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return { from: todayStart.toISOString(), to: end.toISOString(), fromDate: toIsoDate(todayStart), toDate: toIsoDate(end) };
};

function PharmacistDashboard() {
  const navigate = useNavigate();

  const [currentUser, setCurrentUser] = useState(null);
  const [backendHealth, setBackendHealth] = useState({ checked: false, ok: true, error: '' });
  const [centralRecordOpen, setCentralRecordOpen] = useState(false);
  const [centralRecordPatientId, setCentralRecordPatientId] = useState(null);
  const [centralRecordPatientLabel, setCentralRecordPatientLabel] = useState('');
  const avatarInputRef = useRef(null);
  const [profileForm, setProfileForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    profilePicture: '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordCriteria, setPasswordCriteria] = useState({ length: false, hasNumber: false, hasSpecial: false });
  const [updateNotice, setUpdateNotice] = useState('');

  useEffect(() => {
    const val = profileForm.newPassword || '';
    setPasswordCriteria({
      length: val.length >= 8,
      hasNumber: /\d/.test(val),
      hasSpecial: /[!@#$%^&*(),.?":{}|<>]/.test(val)
    });
  }, [profileForm.newPassword]);

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
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileImage, setProfileImage] = useState(null);
  const [profilePreview, setProfilePreview] = useState(null);
  const pharmacistName = useMemo(() => {
    const u = currentUser || {};
    if (u.firstName) return u.firstName;
    if (u.first_name) return u.first_name;
    if (u.name) return u.name;
    if (u.email) return String(u.email).split('@')[0];
    return 'Pharmacist';
  }, [currentUser]);

  const welcomeDateText = useMemo(() => {
    const now = new Date();
    return now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }, []);

  const welcomeQuote = useMemo(() => {
    const quotes = [
      'Accuracy first. Safety always.',
      'Every dose matters.',
      'Clear labels. Clear care.',
      'Stay organized. Stay calm.',
      'One check more can prevent one error.'
    ];
    const daySeed = new Date().toISOString().slice(0, 10);
    let hash = 0;
    for (let i = 0; i < daySeed.length; i += 1) hash = (hash * 31 + daySeed.charCodeAt(i)) % 2147483647;
    return quotes[hash % quotes.length];
  }, []);

  const [activeTab, setActiveTab] = useState('pos'); // Set POS as default or medicines
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [medPage, setMedPage] = useState(1);
  const [supPage, setSupPage] = useState(1);

  const [medicines, setMedicines] = useState([]);
  const [supplies, setSupplies] = useState([]);
  const [requests, setRequests] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [restockRequests, setRestockRequests] = useState([]);
  const [lowStockPage, setLowStockPage] = useState(1);

  // POS State
  const [cart, setCart] = useState([]);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [discountType, setDiscountType] = useState('none'); // none | pwd | senior | custom_percent | custom_amount
  const [discountValue, setDiscountValue] = useState('');
  const [discountRef, setDiscountRef] = useState('');
  const [patientSearch, setPatientSearch] = useState('');
  const [patientOptions, setPatientOptions] = useState([]);
  const [patientSearchLoading, setPatientSearchLoading] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [createBillingInvoice, setCreateBillingInvoice] = useState(false);
  const [posFromPrescription, setPosFromPrescription] = useState(false);
  const [isBulkOrder, setIsBulkOrder] = useState(false);
  const [bulkReference, setBulkReference] = useState('');
  const [bulkDiscountPercent, setBulkDiscountPercent] = useState('');
  const [bulkQuickQuery, setBulkQuickQuery] = useState('');
  const [bulkQuickQty, setBulkQuickQty] = useState(10);
  const [posSearch, setPosSearch] = useState('');
  const [posCategoryId, setPosCategoryId] = useState('all');
  const [posSafetyFilter, setPosSafetyFilter] = useState('all');
  const [posCategories, setPosCategories] = useState([]);
  const [posProducts, setPosProducts] = useState([]);
  const [loadingPos, setLoadingPos] = useState(false);
  const [posError, setPosError] = useState('');
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [inventoryScan, setInventoryScan] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const scanInputRef = useRef(null);
  const [barcodeSave, setBarcodeSave] = useState({}); // key -> { saving?: boolean, error?: string, ok?: boolean }
  const [inventoryFocus, setInventoryFocus] = useState(null); // { kind: 'medicine'|'supply', id: string }
  const [scanMode, setScanMode] = useState('restock'); // restock | dispense | find
  const [scanBanner, setScanBanner] = useState(null); // { type: 'ok'|'error'|'info', text: string }
  const [scanLog, setScanLog] = useState([]); // [{ at, code, kind, status, message }]
  const [scanAssignModal, setScanAssignModal] = useState(null); // { code, kind }
  const [scanAssignTarget, setScanAssignTarget] = useState(null); // { id, label }
  const [scanAssignKindChoice, setScanAssignKindChoice] = useState('medicine'); // medicine | supply
  const [scanCenterOpen, setScanCenterOpen] = useState(false);
  const [scanCenterKind, setScanCenterKind] = useState('auto'); // auto | medicine | supply
  const [scanCenterMatch, setScanCenterMatch] = useState(null); // { kind, item }
  const [movementReason, setMovementReason] = useState('restock'); // restock | dispense | manual
  const [movementExpiry, setMovementExpiry] = useState('');
  const [movementLot, setMovementLot] = useState('');
  const [recentMovements, setRecentMovements] = useState([]);
  const [undoBusy, setUndoBusy] = useState(false);
  const [queueMode, setQueueMode] = useState(false);
  const [scanQueue, setScanQueue] = useState([]); // [{ key, kind, id, name, barcode, qty, lot, expiry }]
  const [queueApplying, setQueueApplying] = useState(false);
  const [newProductForm, setNewProductForm] = useState({
    type: 'medicine',
    barcode: '',
    name: '',
    categoryId: 'all',
    stock: 0,
    minLevel: 10,
    unit: '',
    price: ''
  });
  const [productSaving, setProductSaving] = useState(false);
  const [productError, setProductError] = useState('');
  const [barcodeLookupLoading, setBarcodeLookupLoading] = useState(false);
  const [barcodeMatchedMedicine, setBarcodeMatchedMedicine] = useState(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryError, setCategoryError] = useState('');
  const categoryImageInputRef = useRef(null);
  const [categoryImageTargetId, setCategoryImageTargetId] = useState(null);
  const productImageInputRef = useRef(null);
  const [productImageTarget, setProductImageTarget] = useState(null);
  const barcodeInputRef = useRef(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [showReceipt, setShowReceipt] = useState(null);
  const [showRxImport, setShowRxImport] = useState(false);

  const [salesTab, setSalesTab] = useState('summary'); // summary | transactions | items
  const [salesPreset, setSalesPreset] = useState('today'); // today | yesterday | week | custom
  const [salesFrom, setSalesFrom] = useState('');
  const [salesTo, setSalesTo] = useState('');
  const [salesQuery, setSalesQuery] = useState('');
  const [salesPharmacist, setSalesPharmacist] = useState('');
  const [salesDiscountType, setSalesDiscountType] = useState('all'); // all | none | pwd | senior | custom
  const [salesPayMin, setSalesPayMin] = useState('');
  const [salesPayMax, setSalesPayMax] = useState('');
  const [salesSummary, setSalesSummary] = useState(null);
  const [salesTransactions, setSalesTransactions] = useState([]);
  const [salesTotal, setSalesTotal] = useState(0);
  const [salesPage, setSalesPage] = useState(1);
  const [salesItems, setSalesItems] = useState([]);
  const [salesItemsMeta, setSalesItemsMeta] = useState(null);
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesError, setSalesError] = useState('');
  const [salesExporting, setSalesExporting] = useState(false);
  const [saleDetails, setSaleDetails] = useState(null);
  const [saleDetailsLoading, setSaleDetailsLoading] = useState(false);

  const [loadingMeds, setLoadingMeds] = useState(false);
  const [loadingSupplies, setLoadingSupplies] = useState(false);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [loadingPrescriptions, setLoadingPrescriptions] = useState(false);
  const [loadingRestocks, setLoadingRestocks] = useState(false);

  const [searchText, setSearchText] = useState('');
  const categoryIdsAreNumeric = useMemo(() => {
    const list = Array.isArray(posCategories) ? posCategories : [];
    if (list.length === 0) return false;
    return list.every((c) => /^\d+$/.test(String(c.id || '').trim()));
  }, [posCategories]);

  const buildAuthHeaders = () => {
    const u = currentUser || {};
    const roleRaw = String(u.role || u.account_type || u.accountType || u.roles || '').toLowerCase();
    const role = roleRaw || 'pharmacist';
    const email = String(u.email || '').trim();
    const name = String(u.name || `${u.firstName || u.first_name || ''} ${u.lastName || u.last_name || ''}`.trim()).trim();
    return {
      'x-user-role': role,
      ...(email ? { 'x-user-email': email } : {}),
      ...(name ? { 'x-user-name': name } : {})
    };
  };
  const buildJsonHeaders = () => ({ 'Content-Type': 'application/json', ...buildAuthHeaders() });
  const normalizeBarcode = (value) => String(value || '').trim();

  useEffect(() => {
    if (!showAddProductModal) return;
    const t = setTimeout(() => {
      barcodeInputRef.current?.focus();
      barcodeInputRef.current?.select?.();
    }, 0);
    return () => clearTimeout(t);
  }, [showAddProductModal]);

  useEffect(() => {
    if (!scanCenterOpen) return;
    const t = setTimeout(() => {
      scanInputRef.current?.focus?.();
      scanInputRef.current?.select?.();
    }, 0);
    return () => clearTimeout(t);
  }, [scanCenterOpen]);

  const [stockModal, setStockModal] = useState(null);
  const [stockQty, setStockQty] = useState(1);
  const [stockMode, setStockMode] = useState('add');
  const [stockSaving, setStockSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const apiDownToastAt = useRef(0);
  const restockSeenIds = useRef(new Set());
  const [lowStockSelected, setLowStockSelected] = useState({});
  const [restockFulfillModal, setRestockFulfillModal] = useState(null);
  const [restockFulfillQty, setRestockFulfillQty] = useState(1);
  const [restockSaving, setRestockSaving] = useState(false);
  const [restockRequestModal, setRestockRequestModal] = useState(null);
  const [restockRequestQty, setRestockRequestQty] = useState(1);
  const [restockRequestSaving, setRestockRequestSaving] = useState(false);

  const [rxModal, setRxModal] = useState(null);
  const [rxQuantities, setRxQuantities] = useState({});
  const [rxSaving, setRxSaving] = useState(false);

  useEffect(() => {
    let u = null;
    try {
      u = JSON.parse(localStorage.getItem('currentUser'));
    } catch (_) {
      u = null;
    }
    setCurrentUser(u);
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const pic = currentUser.profilePicture || currentUser.profile_picture || currentUser.avatar_url || '';
    setProfileForm({
      firstName: currentUser.firstName || currentUser.first_name || '',
      lastName: currentUser.lastName || currentUser.last_name || '',
      email: currentUser.email || '',
      profilePicture: pic,
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    });
    setProfilePreview(pic || null);
    setProfileImage(null);
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    fetchPosCategories();
    fetchPosProducts();
  }, [currentUser]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (cart.length !== 0) return;
    if (!posFromPrescription && !createBillingInvoice && !selectedPatient && !patientSearch) return;
    setPosFromPrescription(false);
    setCreateBillingInvoice(false);
    setSelectedPatient(null);
    setPatientSearch('');
    setPatientOptions([]);
  }, [cart.length, createBillingInvoice, patientSearch, posFromPrescription, selectedPatient]);

  useEffect(() => {
    setMedPage(1);
    setSupPage(1);
  }, [searchText, activeTab]);

  useEffect(() => {
    if (activeTab !== 'medicines' && activeTab !== 'supplies') {
      if (inventoryFocus) setInventoryFocus(null);
      return;
    }
    if (String(searchText || '').trim()) {
      if (inventoryFocus) setInventoryFocus(null);
    }
  }, [activeTab, inventoryFocus, searchText]);

  const downloadCsv = (filename, rows) => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const printSalesReport = (title, htmlBody) => {
    const w = window.open('', '_blank', 'noopener,noreferrer');
    if (!w) return;
    w.document.open();
    w.document.write(`
      <html>
        <head>
          <title>${String(title || 'Sales Report')}</title>
          <style>
            body{font-family:Arial, sans-serif; padding:24px; color:#0f172a;}
            h1{font-size:18px; margin:0 0 10px;}
            .meta{color:#64748b; font-size:12px; margin-bottom:16px;}
            table{width:100%; border-collapse:collapse; font-size:12px;}
            th,td{border:1px solid #e2e8f0; padding:8px; text-align:left;}
            th{background:#f8fafc;}
          </style>
        </head>
        <body>
          ${htmlBody || ''}
          <script>window.onload = () => { window.print(); };</script>
        </body>
      </html>
    `);
    w.document.close();
  };

  const notifyApiDown = (fallbackText) => {
    const now = Date.now();
    if (now - Number(apiDownToastAt.current || 0) < 5000) return;
    apiDownToastAt.current = now;
    setToast({ type: 'error', text: fallbackText || 'Backend API not reachable. Start the backend (port 5000) then refresh.' });
  };

  const fetchAllSalesTransactions = async ({ includeItems = false } = {}) => {
    const pageSize = 200;
    const rng = buildUtcRange(salesPreset, salesFrom, salesTo);
    const base = new URLSearchParams();
    base.set('from', rng.from);
    base.set('to', rng.to);
    if (salesPharmacist.trim()) base.set('pharmacist', salesPharmacist.trim());
    if (salesQuery.trim()) base.set('q', salesQuery.trim());
    if (salesDiscountType && salesDiscountType !== 'all') base.set('discountType', salesDiscountType);
    if (String(salesPayMin).trim() !== '') base.set('paymentMin', String(salesPayMin).trim());
    if (String(salesPayMax).trim() !== '') base.set('paymentMax', String(salesPayMax).trim());
    if (includeItems) base.set('includeItems', '1');

    const out = [];
    let total = 0;
    let skip = 0;
    for (;;) {
      const params = new URLSearchParams(base);
      params.set('take', String(pageSize));
      params.set('skip', String(skip));
      const data = await fetchJson(`/api/sales?${params.toString()}`, { apiBase: API_BASE, headers: buildAuthHeaders() });
      const items = Array.isArray(data?.items) ? data.items : [];
      total = Number(data?.total || 0);
      out.push(...items);
      skip += pageSize;
      if (items.length === 0 || out.length >= total) break;
      if (skip > 200000) break;
    }
    return { rng, total, items: out };
  };

  const exportTransactionsCsvAll = async () => {
    setSalesExporting(true);
    try {
      const { items } = await fetchAllSalesTransactions({ includeItems: false });
      const rows = [
        ['Transaction #', 'Date/Time', 'Pharmacist', 'Subtotal', 'Discount', 'Total Due', 'Payment', 'Change', 'Discount Type', 'Discount Ref'],
        ...(items || []).map((t) => [
          t.transaction_no || '',
          t.created_at ? new Date(t.created_at).toLocaleString() : '',
          t.pharmacist_name || '',
          round2(Number(t.subtotal || 0)),
          round2(Number(t.discount_amount || 0)),
          round2(Number(t.total_due || 0)),
          round2(Number(t.payment_received || 0)),
          round2(Number(t.change_amount || 0)),
          t.discount_type || 'none',
          t.discount_ref || ''
        ])
      ];
      downloadCsv(`sales_transactions_${new Date().toISOString().slice(0, 10)}.csv`, rows);
    } catch (e) {
      setToast({ type: 'error', text: String(e?.message || 'Export failed') });
    } finally {
      setSalesExporting(false);
    }
  };

  const exportItemizedCsvAll = async () => {
    setSalesExporting(true);
    try {
      const { items } = await fetchAllSalesTransactions({ includeItems: true });
      const rows = [
        [
          'Transaction #',
          'Date/Time',
          'Pharmacist',
          'Item',
          'Type',
          'Qty',
          'Unit Price',
          'Line Total',
          'Subtotal',
          'Discount',
          'Discount Type',
          'Discount Ref',
          'Total Due',
          'Payment',
          'Change'
        ]
      ];

      for (const t of items || []) {
        const lineItems = Array.isArray(t.items) ? t.items : [];
        const purchased = lineItems.filter((it) => String(it?.item_type || '') !== 'discount');
        if (purchased.length === 0) {
          rows.push([
            t.transaction_no || '',
            t.created_at ? new Date(t.created_at).toLocaleString() : '',
            t.pharmacist_name || '',
            '',
            '',
            '',
            '',
            '',
            round2(Number(t.subtotal || 0)),
            round2(Number(t.discount_amount || 0)),
            t.discount_type || 'none',
            t.discount_ref || '',
            round2(Number(t.total_due || 0)),
            round2(Number(t.payment_received || 0)),
            round2(Number(t.change_amount || 0))
          ]);
          continue;
        }
        for (const it of purchased) {
          const qty = Number(it.quantity || 0);
          const unit = Number(it.price_at_sale || 0);
          rows.push([
            t.transaction_no || '',
            t.created_at ? new Date(t.created_at).toLocaleString() : '',
            t.pharmacist_name || '',
            String(it.item_name || ''),
            String(it.item_type || ''),
            qty,
            round2(unit),
            round2(qty * unit),
            round2(Number(t.subtotal || 0)),
            round2(Number(t.discount_amount || 0)),
            t.discount_type || 'none',
            t.discount_ref || '',
            round2(Number(t.total_due || 0)),
            round2(Number(t.payment_received || 0)),
            round2(Number(t.change_amount || 0))
          ]);
        }
      }

      downloadCsv(`sales_itemized_${new Date().toISOString().slice(0, 10)}.csv`, rows);
    } catch (e) {
      setToast({ type: 'error', text: String(e?.message || 'Export failed') });
    } finally {
      setSalesExporting(false);
    }
  };

  const openSaleDetails = async (saleId) => {
    setSaleDetails(null);
    setSaleDetailsLoading(true);
    try {
      const data = await fetchJson(`/api/sales/${saleId}`, { apiBase: API_BASE, headers: buildAuthHeaders() });
      setSaleDetails(data);
    } catch (e) {
      setToast({ type: 'error', text: String(e?.message || 'Unable to load transaction') });
    } finally {
      setSaleDetailsLoading(false);
    }
  };

  const fetchMedicines = async () => {
    setLoadingMeds(true);
    try {
      const data = await fetchJson(`/api/inventory`, { apiBase: API_BASE, headers: buildAuthHeaders() });
      const normalized = (Array.isArray(data) ? data : []).map((item) => ({
        ...item,
        image_url: normalizeApiAssetUrl(item?.image_url, API_BASE)
      }));
      setMedicines(normalized);
    } catch (e) {
      setMedicines([]);
      notifyApiDown(String(e?.message || 'Failed to load medicines'));
    } finally {
      setLoadingMeds(false);
    }
  };

  const fetchSupplies = async () => {
    setLoadingSupplies(true);
    try {
      const data = await fetchJson(`/api/supplies`, { apiBase: API_BASE, headers: buildAuthHeaders() });
      const normalized = (Array.isArray(data) ? data : []).map((item) => ({
        ...item,
        image_url: normalizeApiAssetUrl(item?.image_url, API_BASE)
      }));
      setSupplies(normalized);
    } catch (e) {
      setSupplies([]);
      notifyApiDown(String(e?.message || 'Failed to load supplies'));
    } finally {
      setLoadingSupplies(false);
    }
  };

  const fetchPosCategories = async () => {
    if (!currentUser) return;
    try {
      setCategoryError('');
      const data = await fetchJson(`/api/product-categories`, { apiBase: API_BASE, headers: buildAuthHeaders(), timeoutMs: 90000 });
      const normalized = (Array.isArray(data) ? data : []).map((item) => ({
        ...item,
        image_url: normalizeApiAssetUrl(item?.image_url, API_BASE)
      }));
      setPosCategories(normalized);
    } catch (e) {
      setPosCategories([]);
      setCategoryError(String(e.message || 'Failed to load categories'));
    }
  };

  const fetchPosProducts = async () => {
    if (!currentUser) return;
    setLoadingPos(true);
    try {
      setPosError('');
      const data = await fetchJson(`/api/pharmacy/products?includeOutOfStock=0`, { apiBase: API_BASE, headers: buildAuthHeaders(), timeoutMs: 90000 });
      const normalized = (Array.isArray(data) ? data : []).map((item) => ({
        ...item,
        imageUrl: normalizeApiAssetUrl(item?.imageUrl, API_BASE),
        categoryImageUrl: normalizeApiAssetUrl(item?.categoryImageUrl, API_BASE)
      }));
      setPosProducts(normalized);
    } catch (e) {
      setPosProducts([]);
      setPosError(String(e.message || 'Failed to load products'));
    } finally {
      setLoadingPos(false);
    }
  };

  const fetchRequests = async () => {
    setLoadingRequests(true);
    try {
      const data = await fetchJson(`/api/requests`, { apiBase: API_BASE, headers: buildAuthHeaders() });
      setRequests(Array.isArray(data) ? data : []);
    } catch (e) {
      setRequests([]);
      notifyApiDown(String(e?.message || 'Failed to load requests'));
    } finally {
      setLoadingRequests(false);
    }
  };

  const fetchPrescriptions = async () => {
    setLoadingPrescriptions(true);
    try {
      const data = await fetchJson(`/api/prescriptions?all=true`, { apiBase: API_BASE, headers: buildAuthHeaders() });
      
      const mapped = (Array.isArray(data) ? data : []).map(p => ({
        ...p,
        patientName: p.patientName || (p.patients ? `${p.patients.first_name} ${p.patients.last_name}` : 'Unknown Patient')
      }));
      setPrescriptions(mapped);
    } catch (err) {
      setPrescriptions([]);
      notifyApiDown(String(err?.message || 'Failed to load prescriptions'));
    } finally {
      setLoadingPrescriptions(false);
    }
  };

  useEffect(() => {
    if (!currentUser || activeTab !== 'pos') return;
    const q = String(patientSearch || '').trim();
    if (!q) {
      setPatientOptions([]);
      setPatientSearchLoading(false);
      return undefined;
    }

    let cancelled = false;
    setPatientSearchLoading(true);
    const t = setTimeout(async () => {
      try {
        const data = await fetchJson(`/api/patients?q=${encodeURIComponent(q)}&take=8`, { apiBase: API_BASE, headers: buildAuthHeaders() });
        if (cancelled) return;
        setPatientOptions(Array.isArray(data) ? data : []);
      } catch (_) {
        if (!cancelled) setPatientOptions([]);
      } finally {
        if (!cancelled) setPatientSearchLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [activeTab, currentUser, patientSearch]);

  const fetchRestocks = async (silent = false) => {
    if (!silent) setLoadingRestocks(true);
    try {
      // Fetch only "Approved" restocks meant for the pharmacist to fulfill
      const data = await fetchJson(`/api/restock-requests?take=200`, { apiBase: API_BASE, headers: buildAuthHeaders() });
      setRestockRequests(Array.isArray(data) ? data : []);
    } catch (e) {
      setRestockRequests([]);
      if (!silent) notifyApiDown(String(e?.message || 'Failed to load restocks'));
    } finally {
      if (!silent) setLoadingRestocks(false);
    }
  };

  const fetchSalesReports = async (opts = {}) => {
    const pageSize = 20;
    const page = Math.max(1, Number(opts.page || salesPage || 1));
    const rng = buildUtcRange(salesPreset, salesFrom, salesTo);
    if (salesPreset === 'custom') {
      if (!salesFrom) setSalesFrom(rng.fromDate);
      if (!salesTo) setSalesTo(rng.toDate);
    }
    setSalesLoading(true);
    setSalesError('');
    try {
      const paramsBase = new URLSearchParams();
      paramsBase.set('from', rng.from);
      paramsBase.set('to', rng.to);
      if (salesPharmacist.trim()) paramsBase.set('pharmacist', salesPharmacist.trim());

      const sumData = await fetchJson(`/api/sales/summary?${paramsBase.toString()}`, { apiBase: API_BASE, headers: buildAuthHeaders() });
      setSalesSummary(sumData);

      const txParams = new URLSearchParams(paramsBase);
      if (salesQuery.trim()) txParams.set('q', salesQuery.trim());
      if (salesDiscountType && salesDiscountType !== 'all') txParams.set('discountType', salesDiscountType);
      if (String(salesPayMin).trim() !== '') txParams.set('paymentMin', String(salesPayMin).trim());
      if (String(salesPayMax).trim() !== '') txParams.set('paymentMax', String(salesPayMax).trim());
      txParams.set('take', String(pageSize));
      txParams.set('skip', String((page - 1) * pageSize));

      const txData = await fetchJson(`/api/sales?${txParams.toString()}`, { apiBase: API_BASE, headers: buildAuthHeaders() });
      setSalesTransactions(Array.isArray(txData?.items) ? txData.items : []);
      setSalesTotal(Number(txData?.total || 0));
      setSalesPage(page);

      const itData = await fetchJson(`/api/sales/items?${paramsBase.toString()}`, { apiBase: API_BASE, headers: buildAuthHeaders() });
      setSalesItems(Array.isArray(itData?.items) ? itData.items : []);
      setSalesItemsMeta({ discounts_total: itData?.discounts_total ?? 0, from: itData?.from, to: itData?.to });
    } catch (e) {
      setSalesError(String(e?.message || 'Failed to load sales report'));
    } finally {
      setSalesLoading(false);
    }
  };

  const submitSalesToAdmin = async () => {
    try {
      const rng = buildUtcRange(salesPreset, salesFrom, salesTo);
      await fetchJson(`/api/sales/submit-to-admin`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: buildJsonHeaders(),
        body: JSON.stringify({
          from: rng.from,
          to: rng.to,
          summary: salesSummary || null
        })
      });
      setToast({ type: 'success', text: 'Sales report submitted to Admin.' });
    } catch (e) {
      setToast({ type: 'error', text: String(e?.message || 'Submit failed') });
    }
  };

  const openReceiptFromSale = async (saleId) => {
    try {
      const data = await fetchJson(`/api/sales/${saleId}`, { apiBase: API_BASE, headers: buildAuthHeaders() });
      const items = Array.isArray(data.items) ? data.items : [];
      const purchased = items
        .filter((it) => String(it.item_type || '') !== 'discount')
        .map((it) => ({
          id: String(it.item_id || ''),
          name: String(it.item_name || ''),
          type: String(it.item_type || ''),
          quantity: Number(it.quantity || 0),
          price: Number(it.price_at_sale || 0)
        }));
      setShowReceipt({
        transactionNo: data.transaction_no || null,
        items: purchased,
        subtotal: Number(data.subtotal || 0),
        discountLabel: data.discount_type ? String(data.discount_type).toUpperCase() : null,
        discountAmount: Number(data.discount_amount || 0),
        discountRef: data.discount_ref || '',
        totalDue: Number(data.total_due || 0),
        payment: Number(data.payment_received || 0),
        change: Number(data.change_amount || 0),
        date: data.created_at ? new Date(data.created_at).toLocaleString() : new Date().toLocaleString(),
        pharmacist: data.pharmacist_name || pharmacistName
      });
    } catch (e) {
      setToast({ type: 'error', text: String(e?.message || 'Unable to reprint receipt') });
    }
  };

  const lowStockItems = useMemo(() => {
    const threshold = 10; // Custom threshold or from settings
    const medLow = medicines.filter(m => (m.stock ?? 0) <= (m.min_level ?? threshold));
    const supLow = supplies.filter(s => (s.stock ?? 0) <= (s.min_level ?? threshold));
    return [...medLow.map(m => ({ ...m, type: 'medicine' })), ...supLow.map(s => ({ ...s, type: 'supply', name: s.item_name }))];
  }, [medicines, supplies]);

  const inventoryLookup = useMemo(() => {
    const map = new Map();
    medicines.forEach((item) => {
      map.set(`medicine-${String(item.id)}`, {
        ...item,
        type: 'medicine',
        name: item.name || '',
        minLevel: Number(item.min_level ?? item.minLevel ?? 5) || 5,
        expiryDate: item.expiry_date || item.expiryDate || null,
        imageUrl: item.image_url || item.imageUrl || null
      });
    });
    supplies.forEach((item) => {
      map.set(`supply-${String(item.id)}`, {
        ...item,
        type: 'supply',
        name: item.item_name || item.name || '',
        minLevel: Number(item.min_level ?? item.minLevel ?? 10) || 10,
        expiryDate: item.expiry_date || item.expiryDate || null,
        imageUrl: item.image_url || item.imageUrl || null
      });
    });
    return map;
  }, [medicines, supplies]);

  const enrichedPosProducts = useMemo(() => {
    const base = (posProducts || []).map((product) => {
      const live = inventoryLookup.get(`${String(product.type)}-${String(product.id)}`) || {};
      const stock = Number(live.stock ?? product.stock ?? 0) || 0;
      const minLevel = Number(live.minLevel ?? live.min_level ?? product.minLevel ?? product.min_level ?? 10) || 10;
      const expiryDate = live.expiryDate || live.expiry_date || product.expiryDate || product.expiry_date || null;
      const stockMeta = getStockMeta(stock, minLevel);
      const expiryMeta = String(product.type) === 'medicine' ? getExpiryMeta(expiryDate) : null;
      const urgencyScore = (stockMeta.sortRank * 10) + (expiryMeta?.sortRank || 0);
      return {
        ...product,
        ...live,
        name: live.name || product.name || '',
        categoryName: live.categoryName || live.category || product.categoryName || 'Uncategorized',
        imageUrl: live.imageUrl || product.imageUrl || null,
        stock,
        minLevel,
        expiryDate,
        stockMeta,
        expiryMeta,
        urgencyScore
      };
    });

    return base.map((product) => {
      const comparable = base.filter((candidate) => (
        candidate.id !== product.id &&
        candidate.type === product.type &&
        String(candidate.categoryName || '') === String(product.categoryName || '') &&
        Number(candidate.stock || 0) > 0 &&
        !(candidate.expiryMeta && candidate.expiryMeta.isExpired)
      ));
      const cheaperAlternative = comparable
        .filter((candidate) => Number(candidate.price || 0) < Number(product.price || 0))
        .sort((a, b) => Number(a.price || 0) - Number(b.price || 0))[0] || null;
      return {
        ...product,
        alternativeCount: comparable.length,
        cheaperAlternative
      };
    });
  }, [inventoryLookup, posProducts]);

  const lowStockKey = (item) => `${String(item?.type || '')}-${String(item?.id || '')}`;
  const lowStockSelectedCount = useMemo(() => Object.values(lowStockSelected || {}).filter(Boolean).length, [lowStockSelected]);
  const allLowStockSelected = useMemo(() => {
    if (!Array.isArray(lowStockItems) || lowStockItems.length === 0) return false;
    return lowStockItems.every((it) => Boolean(lowStockSelected[lowStockKey(it)]));
  }, [lowStockItems, lowStockSelected]);

  const toggleLowStock = (item) => {
    const key = lowStockKey(item);
    setLowStockSelected((prev) => ({ ...(prev || {}), [key]: !prev?.[key] }));
  };

  const toggleSelectAllLowStock = () => {
    if (!Array.isArray(lowStockItems) || lowStockItems.length === 0) return;
    if (allLowStockSelected) {
      setLowStockSelected({});
      return;
    }
    const next = {};
    lowStockItems.forEach((it) => {
      next[lowStockKey(it)] = true;
    });
    setLowStockSelected(next);
  };

  const requestSelectedRestocks = async () => {
    const selected = (Array.isArray(lowStockItems) ? lowStockItems : []).filter((it) => Boolean(lowStockSelected[lowStockKey(it)]));
    if (selected.length === 0) {
      setToast({ type: 'error', text: 'Select at least one item.' });
      return;
    }
    setRestockRequestSaving(true);
    try {
      for (const it of selected) {
        const isPending = restockRequests.some(
          (r) => String(r.itemId || r.item_id || '') === String(it.id) && String(r.status || '') === 'Pending'
        );
        if (isPending) continue;
        const stock = Number(it.stock ?? 0) || 0;
        const minLevel = Number(it.min_level ?? it.minLevel ?? 10) || 10;
        const suggested = Math.max(1, Math.max(0, minLevel - stock));
        await fetchJson(`/api/restock-requests`, {
          apiBase: API_BASE,
          method: 'POST',
          headers: buildJsonHeaders(),
          body: JSON.stringify({
            itemType: String(it.type || '').toLowerCase(),
            itemId: it.id,
            requestedQty: suggested,
            priority: 'High',
            requestedBy: pharmacistName
          })
        });
      }
      setToast({ type: 'success', text: 'Restock request(s) sent to Admin!' });
      setLowStockSelected({});
      fetchRestocks(true);
    } catch (e) {
      setToast({ type: 'error', text: String(e?.message || 'Failed to send restock request.') });
    } finally {
      setRestockRequestSaving(false);
    }
  };

  const openRestockRequest = (raw) => {
    if (!raw) return;
    const itemType = String(raw.type || raw.item_type || raw.itemType || '').toLowerCase();
    const itemId = raw.id ?? raw.item_id ?? raw.itemId;
    const itemName = raw.name || raw.item_name || raw.itemName || '';
    const stock = Number(raw.stock ?? 0) || 0;
    const minLevel = Number(raw.min_level ?? raw.minLevel ?? 10) || 10;
    const suggested = Math.max(1, Math.max(0, minLevel - stock));
    setRestockRequestModal({ itemType, itemId, itemName, stock, minLevel });
    setRestockRequestQty(String(suggested));
  };

  const submitRestockRequest = async () => {
    if (!restockRequestModal) return;
    const qty = Math.max(1, Math.floor(Number(restockRequestQty || 1)));
    if (!Number.isFinite(qty) || qty <= 0) {
      setToast({ type: 'error', text: 'Requested quantity must be greater than 0.' });
      return;
    }

    setRestockRequestSaving(true);
    try {
      await fetchJson(`/api/restock-requests`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: buildJsonHeaders(),
        body: JSON.stringify({
          itemType: restockRequestModal.itemType,
          itemId: restockRequestModal.itemId,
          requestedQty: qty,
          priority: 'High',
          requestedBy: pharmacistName
        })
      });
      setToast({ type: 'success', text: 'Restock request sent to Admin!' });
      setRestockRequestModal(null);
      fetchRestocks(true);
    } catch (e) {
      setToast({ type: 'error', text: String(e?.message || 'Failed to send restock request.') });
    } finally {
      setRestockRequestSaving(false);
    }
  };

  useEffect(() => {
    fetchMedicines();
    fetchSupplies();
    fetchRequests();
    fetchPrescriptions();
    fetchRestocks();
  }, []);

  useEffect(() => {
    if (activeTab !== 'sales') return;
    setSalesTab('summary');
    setSalesPage(1);
    fetchSalesReports({ page: 1 });
  }, [activeTab]);

  useEffect(() => {
    if (salesPreset !== 'custom') return;
    const rng = buildUtcRange('custom', salesFrom, salesTo);
    if (!salesFrom) setSalesFrom(rng.fromDate);
    if (!salesTo) setSalesTo(rng.toDate);
  }, [salesPreset]);

  useEffect(() => {
    const t = setInterval(() => {
      fetchRestocks(true);
    }, 20000);
    return () => clearInterval(t);
  }, []);

  const parseOrderMessage = (msg, row) => {
    const t = String(msg || '');
    const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
    const map = {};
    lines.forEach((l) => {
      const idx = l.indexOf(':');
      if (idx > 0) {
        const k = l.slice(0, idx).trim().toLowerCase().replace(/\s+/g, '');
        const v = l.slice(idx + 1).trim();
        map[k] = v;
      }
    });
    let items = [];
    const itemsJsonRaw = map.itemsjson || '';
    if (itemsJsonRaw) {
      try {
        const parsed = JSON.parse(itemsJsonRaw);
        items = Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        items = [];
      }
    }
    const type = String(map.type || '').trim();
    const item = String(map.item || '').trim();
    const qty = Math.max(0, Number(map.quantity || 0) || 0);
    const unitPrice = Number(map.unitprice || 0) || 0;
    const totalAmount = Number(map.totalamount || 0) || 0;
    const patientFromRow = String(row?.patient_name || '').trim();
    const patient = String(map.patient || patientFromRow || '').trim();
    const priority = map.priority || '';
    const normalizedItems = (Array.isArray(items) ? items : [])
      .map((it) => ({
        type: String(it?.type || it?.itemType || '').trim().toLowerCase(),
        itemId: String(it?.itemId || it?.id || '').trim(),
        name: String(it?.name || it?.item || '').trim(),
        qty: Math.max(1, Math.trunc(Number(it?.qty || it?.quantity || 1))),
        unitPrice: Number(it?.unitPrice ?? it?.unit_price ?? it?.price ?? 0) || 0,
        lineTotal: Number(it?.lineTotal ?? it?.line_total ?? 0) || 0
      }))
      .filter((it) => it.type === 'medicine' || it.type === 'supply');

    const fallbackItems =
      normalizedItems.length
        ? normalizedItems
        : item
          ? [
              {
                type: String(type || '').toLowerCase() === 'medication' ? 'medicine' : 'supply',
                itemId: '',
                name: item,
                qty: Math.max(1, qty || 1),
                unitPrice,
                lineTotal: totalAmount || round2(unitPrice * Math.max(1, qty || 1))
              }
            ]
          : [];

    const computedTotal = round2(
      (fallbackItems || []).reduce((sum, it) => sum + (Number(it.lineTotal) || round2(Number(it.unitPrice || 0) * Number(it.qty || 0))), 0)
    );

    return {
      type,
      item,
      qty,
      patient,
      priority,
      items: fallbackItems,
      totalAmount: computedTotal
    };
  };

  const pharmacyRequests = useMemo(() => {
    const q = String(searchText || '').trim().toLowerCase();
    return requests
      .map((r) => ({ ...r, _parsed: parseOrderMessage(r.message, r) }))
      .filter((r) => {
        const type = String(r._parsed.type || '').toLowerCase();
        const isPharmacy = type === 'medication' || type === 'supply';
        if (!isPharmacy) return false;
        if (!q) return true;
        return (
          String(r._parsed.item || '').toLowerCase().includes(q) ||
          String(r._parsed.patient || '').toLowerCase().includes(q) ||
          String(r.requested_by || '').toLowerCase().includes(q) ||
          String(r.status || '').toLowerCase().includes(q)
        );
      });
  }, [requests, searchText]);

  const filteredMedicines = useMemo(() => {
    if (activeTab === 'medicines' && inventoryFocus?.kind === 'medicine' && inventoryFocus?.id) {
      return medicines.filter((m) => String(m.id) === String(inventoryFocus.id));
    }
    const q = String(searchText || '').trim().toLowerCase();
    if (!q) return medicines;
    return medicines.filter((m) => (
      String(m.name || '').toLowerCase().includes(q) ||
      String(m.barcode || '').toLowerCase().includes(q) ||
      String(m.category || '').toLowerCase().includes(q) ||
      String(m.status || '').toLowerCase().includes(q)
    ));
  }, [activeTab, inventoryFocus, medicines, searchText]);

  const pagedMedicines = useMemo(() => {
    const perPage = 10;
    const totalPages = Math.max(1, Math.ceil(filteredMedicines.length / perPage));
    const currentPage = Math.min(Math.max(1, medPage), totalPages);
    const startIndex = (currentPage - 1) * perPage;
    return {
      totalPages,
      currentPage,
      items: filteredMedicines.slice(startIndex, startIndex + perPage)
    };
  }, [filteredMedicines, medPage]);

  const filteredSupplies = useMemo(() => {
    if (activeTab === 'supplies' && inventoryFocus?.kind === 'supply' && inventoryFocus?.id) {
      return supplies.filter((s) => String(s.id) === String(inventoryFocus.id));
    }
    const q = String(searchText || '').trim().toLowerCase();
    if (!q) return supplies;
    return supplies.filter((s) => (
      String(s.item_name || '').toLowerCase().includes(q) ||
      String(s.barcode || '').toLowerCase().includes(q) ||
      String(s.status || '').toLowerCase().includes(q)
    ));
  }, [activeTab, inventoryFocus, supplies, searchText]);

  const pagedSupplies = useMemo(() => {
    const perPage = 10;
    const totalPages = Math.max(1, Math.ceil(filteredSupplies.length / perPage));
    const currentPage = Math.min(Math.max(1, supPage), totalPages);
    const startIndex = (currentPage - 1) * perPage;
    return {
      totalPages,
      currentPage,
      items: filteredSupplies.slice(startIndex, startIndex + perPage)
    };
  }, [filteredSupplies, supPage]);

  const filteredPrescriptions = useMemo(() => {
    const q = String(searchText || '').trim().toLowerCase();
    if (!q) return prescriptions;
    return prescriptions.filter((p) => {
      const patient = String(p.patientName || '').toLowerCase();
      const doctor = String(p.doctorName || p.doctor_name || '').toLowerCase();
      const diagnosis = String(p.diagnosis || '').toLowerCase();
      return patient.includes(q) || doctor.includes(q) || diagnosis.includes(q);
    });
  }, [prescriptions, searchText]);

  const openStockModal = (kind, item) => {
    setStockModal({ kind, item });
    setStockQty(1);
    setStockMode(scanMode === 'dispense' ? 'subtract' : 'add');
    setMovementReason(scanMode === 'dispense' ? 'dispense' : 'restock');
    setMovementExpiry('');
    setMovementLot('');
  };

  const handleInventoryScan = async (kind) => {
    const code = String(inventoryScan || '').trim();
    if (!code || scanBusy) return;
    setScanBusy(true);
    setScanBanner({ type: 'info', text: 'Looking up barcode…' });
    try {
      const endpoint = kind === 'supply' ? 'supplies' : 'inventory';
      const found = await fetchJson(`/api/${endpoint}/barcode/${encodeURIComponent(code)}`, {
        apiBase: API_BASE,
        headers: buildAuthHeaders()
      });
      if (found) {
        const focusedId = String(found.id || found.item_id || '').trim();
        if (focusedId) {
          setInventoryFocus({ kind, id: focusedId });
          if (kind === 'supply') setSupPage(1);
          else setMedPage(1);
        } else {
          setInventoryFocus(null);
        }
        const unitLabel = String(found.unit || '').trim() || 'pcs';
        if (scanMode === 'find') {
          setScanBanner({ type: 'ok', text: `Matched: ${found.item_name || found.name || 'Item'} • ${unitLabel}` });
        } else {
          openStockModal(kind, found);
          setScanBanner({ type: 'ok', text: `Matched: ${found.item_name || found.name || 'Item'} • ${unitLabel}` });
        }
        setScanLog((prev) => [{ at: Date.now(), code, kind, status: 'matched', message: found.item_name || found.name || '' }, ...prev].slice(0, 12));
        setInventoryScan('');
      }
    } catch (e) {
      const msg = String(e?.message || '');
      const isNotFound = msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('404');
      if (isNotFound) {
        setScanBanner({ type: 'error', text: `Barcode not registered: ${code}` });
        setScanAssignModal({ code, kind });
        setInventoryFocus(null);
      } else {
        setScanBanner({ type: 'error', text: msg || 'Barcode lookup failed.' });
        setInventoryFocus(null);
      }
      setScanLog((prev) => [{ at: Date.now(), code, kind, status: isNotFound ? 'not_found' : 'error', message: msg }, ...prev].slice(0, 12));
    } finally {
      setScanBusy(false);
      setTimeout(() => scanInputRef.current?.focus?.(), 0);
    }
  };

  const handleScanCenterLookup = async (rawValue) => {
    const code = String(rawValue !== undefined ? rawValue : inventoryScan || '').trim();
    if (!code || scanBusy) return;
    setScanBusy(true);
    setScanCenterMatch(null);
    setScanBanner({ type: 'info', text: 'Looking up barcode…' });
    try {
      const tryOrder =
        scanCenterKind === 'medicine'
          ? ['medicine']
          : scanCenterKind === 'supply'
            ? ['supply']
            : ['medicine', 'supply'];

      let found = null;
      let foundKind = null;
      for (const k of tryOrder) {
        const endpoint = k === 'supply' ? 'supplies' : 'inventory';
        try {
          found = await fetchJson(`/api/${endpoint}/barcode/${encodeURIComponent(code)}`, {
            apiBase: API_BASE,
            headers: buildAuthHeaders()
          });
          if (found) {
            foundKind = k;
            break;
          }
        } catch (e) {
          const msg = String(e?.message || '');
          if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('404')) continue;
          throw e;
        }
      }

      if (!found) {
        setScanBanner({ type: 'error', text: `Barcode not registered: ${code}` });
        setInventoryScan('');
        setScanCenterMatch(null);
        setScanCenterOpen(false);
        setScanAssignTarget(null);
        if (scanCenterKind === 'supply') setScanAssignKindChoice('supply');
        else setScanAssignKindChoice('medicine');
        setScanAssignModal({ code, kind: scanCenterKind === 'auto' ? 'auto' : scanCenterKind });
        setScanLog((prev) => [{ at: Date.now(), code, kind: scanCenterKind, status: 'not_found', message: '' }, ...prev].slice(0, 12));
        return;
      }
      setScanCenterMatch({ kind: foundKind, item: found });

      if (queueMode && scanMode !== 'find') {
        const itemId = String(found.id || found.item_id || '');
        const itemKey = `${String(foundKind)}-${itemId}`;
        const displayName = found.item_name || found.name || `Item ${itemId}`;
        setScanQueue((prev) => {
          const existing = prev.find((x) => x.key === itemKey);
          if (existing) {
            return prev.map((x) => (x.key === itemKey ? { ...x, qty: Math.max(1, Number(x.qty || 1) + 1) } : x));
          }
          return [
            { key: itemKey, kind: foundKind, id: itemId, name: displayName, barcode: code, qty: 1, lot: '', expiry: '' },
            ...prev
          ].slice(0, 200);
        });
        const unitLabel = String(found.unit || '').trim() || 'pcs';
        setScanBanner({ type: 'ok', text: `Queued: ${displayName} • ${unitLabel}` });
      } else if (scanMode === 'find') {
        const unitLabel = String(found.unit || '').trim() || 'pcs';
        setScanBanner({ type: 'ok', text: `Matched: ${found.item_name || found.name || 'Item'} • ${unitLabel}` });
      } else {
        setScanCenterOpen(false);
        openStockModal(foundKind, found);
        const unitLabel = String(found.unit || '').trim() || 'pcs';
        setScanBanner({ type: 'ok', text: `Matched: ${found.item_name || found.name || 'Item'} • ${unitLabel}` });
      }
      setScanLog((prev) => [{ at: Date.now(), code, kind: foundKind, status: 'matched', message: found.item_name || found.name || '' }, ...prev].slice(0, 12));
      setInventoryScan('');
    } catch (e) {
      setScanBanner({ type: 'error', text: String(e?.message || 'Lookup failed') });
    } finally {
      setScanBusy(false);
      setTimeout(() => scanInputRef.current?.focus?.(), 0);
    }
  };

  const applyQueue = async () => {
    if (!scanQueue.length || queueApplying) return;
    setQueueApplying(true);
    try {
      const items = scanQueue.map((q) => {
        const qtyNum = Math.max(1, Math.trunc(Number(q.qty || 1)));
        const delta = scanMode === 'dispense' ? -qtyNum : qtyNum;
        const reason = scanMode === 'dispense' ? 'dispense' : 'restock';
        const note = JSON.stringify({ lot: q.lot || null, expiry: q.expiry || null }).slice(0, 300);
        return { itemType: q.kind === 'supply' ? 'supply' : 'medicine', itemId: String(q.id), delta, reason, note };
      });
      await fetchJson(`/api/stock-movements/batch-apply`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: buildAuthHeaders(),
        body: JSON.stringify({ items })
      });
      await Promise.all([fetchMedicines(), fetchSupplies(), fetchPosProducts()]);
      setScanBanner({ type: 'ok', text: 'Queue applied.' });
      setScanQueue([]);
    } catch (e) {
      setScanBanner({ type: 'error', text: String(e?.message || 'Failed to apply queue') });
    } finally {
      setQueueApplying(false);
    }
  };

  useEffect(() => {
    const code = String(inventoryScan || '').trim();
    if (!code) return;
    if (scanBusy) return;
    if (activeTab !== 'medicines' && activeTab !== 'supplies') return;
    if (code.length < 6) return;

    const kind = activeTab === 'supplies' ? 'supply' : 'medicine';
    const t = setTimeout(() => {
      handleInventoryScan(kind);
    }, 400);

    return () => clearTimeout(t);
  }, [activeTab, inventoryScan, scanBusy]);

  useEffect(() => {
    if (activeTab !== 'medicines' && activeTab !== 'supplies') return;
    setTimeout(() => scanInputRef.current?.focus?.(), 0);
  }, [activeTab]);

  useEffect(() => {
    if (!scanBanner) return;
    const t = setTimeout(() => setScanBanner(null), 1800);
    return () => clearTimeout(t);
  }, [scanBanner]);

  const saveBarcode = async (kind, id, value) => {
    const key = `${String(kind)}-${String(id)}`;
    const barcode = String(value || '').trim();
    setBarcodeSave((prev) => ({ ...prev, [key]: { saving: true, error: '', ok: false } }));
    try {
      const endpoint = kind === 'supply' ? 'supplies' : 'inventory';
      await fetchJson(`/api/${endpoint}/${id}`, {
        apiBase: API_BASE,
        method: 'PUT',
        headers: buildJsonHeaders(),
        body: JSON.stringify({ barcode })
      });
      if (kind === 'supply') await fetchSupplies();
      else await fetchMedicines();
      setBarcodeSave((prev) => ({ ...prev, [key]: { saving: false, error: '', ok: true } }));
      setTimeout(() => {
        setBarcodeSave((prev) => {
          const next = { ...prev };
          if (next[key]?.ok) delete next[key];
          return next;
        });
      }, 1500);
    } catch (err) {
      setBarcodeSave((prev) => ({ ...prev, [key]: { saving: false, error: String(err?.message || 'Failed to save'), ok: false } }));
    }
  };

  const saveStock = async () => {
    if (!stockModal?.item) return;
    const qty = Math.max(1, Number(stockQty) || 1);
    setStockSaving(true);
    try {
      if (stockModal.kind === 'medicine') {
        const current = medicines.find((m) => String(m.id) === String(stockModal.item.id));
        if (!current) return;
        const next = stockMode === 'add' ? (Number(current.stock || 0) + qty) : Math.max(0, Number(current.stock || 0) - qty);
        await fetchJson(`/api/inventory/${current.id}`, {
          apiBase: API_BASE,
          method: 'PUT',
          headers: buildJsonHeaders(),
          body: JSON.stringify({
            stock: next,
            movementReason: movementReason === 'dispense' ? 'dispense' : movementReason === 'restock' ? 'restock' : 'manual_adjust',
            movementNote: JSON.stringify({ lot: movementLot || null, expiry: movementExpiry || null }).slice(0, 300)
          })
        });
        await fetchMedicines();
        setToast({ type: 'success', text: 'Medicine stock updated.' });
      } else {
        const current = supplies.find((s) => String(s.id) === String(stockModal.item.id));
        if (!current) return;
        const next = stockMode === 'add' ? (Number(current.stock || 0) + qty) : Math.max(0, Number(current.stock || 0) - qty);
        await fetchJson(`/api/supplies/${current.id}`, {
          apiBase: API_BASE,
          method: 'PUT',
          headers: buildJsonHeaders(),
          body: JSON.stringify({
            stock: next,
            movementReason: movementReason === 'dispense' ? 'dispense' : movementReason === 'restock' ? 'restock' : 'manual_adjust',
            movementNote: JSON.stringify({ lot: movementLot || null, expiry: movementExpiry || null }).slice(0, 300)
          })
        });
        await fetchSupplies();
        setToast({ type: 'success', text: 'Supply stock updated.' });
      }
      setStockModal(null);
    } catch (_) {
      setToast({ type: 'error', text: 'Stock update failed.' });
    } finally {
      setStockSaving(false);
      setTimeout(() => scanInputRef.current?.focus?.(), 0);
    }
  };

  const fetchRecentMovements = async (kind, id) => {
    try {
      const rows = await fetchJson(`/api/stock-movements/recent?itemType=${encodeURIComponent(kind)}&itemId=${encodeURIComponent(String(id))}&limit=8`, {
        apiBase: API_BASE,
        headers: buildAuthHeaders()
      });
      setRecentMovements(Array.isArray(rows) ? rows : []);
    } catch (_) {
      setRecentMovements([]);
    }
  };

  useEffect(() => {
    if (!stockModal?.item?.id) return;
    fetchRecentMovements(stockModal.kind === 'medicine' ? 'medicine' : 'supply', stockModal.item.id);
  }, [stockModal?.item?.id, stockModal?.kind]);

  const undoMovement = async (movementId) => {
    if (!movementId || undoBusy) return;
    setUndoBusy(true);
    try {
      await fetchJson(`/api/stock-movements/${movementId}/undo`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: buildAuthHeaders()
      });
      setToast({ type: 'success', text: 'Undone.' });
      if (stockModal?.kind === 'medicine') await fetchMedicines();
      if (stockModal?.kind === 'supply') await fetchSupplies();
      if (stockModal?.item?.id) {
        await fetchRecentMovements(stockModal.kind === 'medicine' ? 'medicine' : 'supply', stockModal.item.id);
      }
    } catch (e) {
      setToast({ type: 'error', text: String(e?.message || 'Undo failed') });
    } finally {
      setUndoBusy(false);
    }
  };

  const updateRequestStatus = async (id, status) => {
    try {
      await fetchJson(`/api/requests/${id}`, {
        apiBase: API_BASE,
        method: 'PUT',
        headers: buildJsonHeaders(),
        body: JSON.stringify({ status })
      });
      await fetchRequests();
      setToast({ type: 'success', text: `Request marked ${status}.` });
    } catch (_) {
      setToast({ type: 'error', text: 'Request update failed.' });
    }
  };

  const fulfillRequest = async (r) => {
    try {
      const data = await fetchJson(`/api/requests/${r.id}/fulfill`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: buildJsonHeaders(),
        body: JSON.stringify({})
      });
      await Promise.all([fetchRequests(), fetchMedicines(), fetchSupplies()]);
      setToast({ type: 'success', text: `Fulfilled. Added ₱${String(data.addedAmount || '').trim() || '0.00'} to billing.` });
    } catch (_) {
      setToast({ type: 'error', text: 'Fulfillment failed.' });
    }
  };

  const openRestockFulfill = (r) => {
    setRestockFulfillModal(r);
    setRestockFulfillQty(r.requestedQty || r.requested_qty || 1);
  };

  const rejectRestock = async (r) => {
    try {
      await fetchJson(`/api/restock-requests/${r.id}`, {
        apiBase: API_BASE,
        method: 'PATCH',
        headers: buildJsonHeaders(),
        body: JSON.stringify({ status: 'Rejected', fulfilledBy: pharmacistName })
      });
      await fetchRestocks();
      setToast({ type: 'success', text: 'Restock request rejected.' });
    } catch (_) {
      setToast({ type: 'error', text: 'Request update failed.' });
    }
  };

  const fulfillRestock = async () => {
    if (!restockFulfillModal) return;
    const qty = Math.max(1, Number(restockFulfillQty || 1));
    setRestockSaving(true);
    try {
      await fetchJson(`/api/restock-requests/${restockFulfillModal.id}`, {
        apiBase: API_BASE,
        method: 'PATCH',
        headers: buildJsonHeaders(),
        body: JSON.stringify({ status: 'Completed', fulfilledQty: qty, fulfilledBy: pharmacistName })
      });
      await fetchRestocks();
      await fetchMedicines();
      await fetchSupplies();
      setRestockFulfillModal(null);
      setToast({ type: 'success', text: 'Restock completed and inventory updated.' });
    } catch (_) {
      setToast({ type: 'error', text: 'Restock fulfill failed.' });
    } finally {
      setRestockSaving(false);
    }
  };

  const openPrescription = (p) => {
    const items = Array.isArray(p.items) ? p.items : [];
    const q = {};
    items.forEach((it, idx) => {
      q[idx] = 1;
    });
    setRxQuantities(q);
    setRxModal(p);
  };

  const fulfillPrescription = async () => {
    const p = rxModal;
    if (!p) return;
    const items = Array.isArray(p.items) ? p.items : [];
    setRxSaving(true);
    try {
      let matchedCount = 0;
      let fulfilledCount = 0;
      const unmatched = [];
      for (let i = 0; i < items.length; i += 1) {
        const it = items[i];
        const medName = String(it.medication || '').trim();
        const qty = Math.max(1, Number(rxQuantities[i] || 1));
        if (!medName) continue;
        const match = medicines.find((m) => String(m.name || '').toLowerCase() === medName.toLowerCase());
        if (!match) {
          unmatched.push(medName);
          continue;
        }
        matchedCount += 1;
        if (Number(match.stock || 0) < qty) {
          unmatched.push(`${medName} (insufficient stock)`);
          continue;
        }
        const next = Math.max(0, Number(match.stock || 0) - qty);
        await fetchJson(`/api/inventory/${match.id}`, {
          apiBase: API_BASE,
          method: 'PUT',
          headers: buildJsonHeaders(),
          body: JSON.stringify({ stock: next })
        });
        fulfilledCount += 1;
      }
      const pharmacyStatus = fulfilledCount === 0 ? 'Unavailable' : fulfilledCount < items.length ? 'Partially Fulfilled' : 'Dispensed';
      const pharmacyNotes = unmatched.length ? `Unfilled items: ${unmatched.join(', ')}` : 'Dispensed through hospital pharmacy.';
      await fetchJson(`/api/prescriptions/${encodeURIComponent(String(p.id || ''))}/pharmacy`, {
        apiBase: API_BASE,
        method: 'PATCH',
        headers: buildJsonHeaders(),
        body: JSON.stringify({
          pharmacySource: 'hospital',
          pharmacyStatus,
          isSentToPharmacy: true,
          dispensedBy: pharmacistName,
          dispensedAt: fulfilledCount > 0 ? new Date().toISOString() : null,
          pharmacyNotes
        })
      });
      await fetchMedicines();
      await fetchPrescriptions();
      setToast({ type: fulfilledCount > 0 ? 'success' : 'error', text: pharmacyStatus === 'Dispensed' ? 'Prescription dispensed and stock updated.' : pharmacyStatus === 'Partially Fulfilled' ? 'Prescription partially fulfilled. Review pharmacy notes.' : 'Prescription could not be fulfilled from current stock.' });
      setRxModal(null);
    } catch (_) {
      setToast({ type: 'error', text: 'Dispense failed.' });
    } finally {
      setRxSaving(false);
    }
  };

  const confirmLogout = async () => {
    try {
      const session = JSON.parse(localStorage.getItem('currentUser'));
      if (session?.id && session?.accountType) {
        fetch(`${API_BASE}/api/staff/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: session.id, accountType: session.accountType })
        }).catch(() => {});
      }
    } catch (_) {}

    localStorage.removeItem('currentUser');
    localStorage.removeItem('tempUserDetails');
    localStorage.removeItem('tempLoginEmail');
    localStorage.removeItem('tempLoginRole');
    localStorage.removeItem('generatedOTP');
    navigate('/login');
  };

  const resetPosCheckoutState = () => {
    setCart([]);
    setPaymentAmount('');
    setPaymentMethod('Cash');
    setDiscountType('none');
    setDiscountValue('');
    setDiscountRef('');
    setPatientSearch('');
    setPatientOptions([]);
    setSelectedPatient(null);
    setCreateBillingInvoice(false);
    setPosFromPrescription(false);
    setIsBulkOrder(false);
    setBulkReference('');
    setBulkDiscountPercent('');
  };

  const saveMyProfile = async () => {
    if (!currentUser?.id) return;
    setUpdateNotice('');

    const wantsPasswordChange = Boolean(String(profileForm.newPassword || '').trim()) || Boolean(String(profileForm.confirmPassword || '').trim());

    if (wantsPasswordChange) {
      if (!String(profileForm.currentPassword || '').trim()) {
        setUpdateNotice('Current Password is required to set a new password.');
        setToast({ type: 'error', text: 'Current Password is required.' });
        return;
      }
      if (profileForm.newPassword !== profileForm.confirmPassword) {
        setUpdateNotice('New and Confirm passwords do not match.');
        setToast({ type: 'error', text: 'Passwords do not match.' });
        return;
      }
      const pw = String(profileForm.newPassword || '');
      if (pw.length < 8) {
        setUpdateNotice('New password must be at least 8 characters.');
        setToast({ type: 'error', text: 'Password must be at least 8 characters.' });
        return;
      }
      if (!/\d/.test(pw) || !/[!@#$%^&*(),.?":{}|<>]/.test(pw)) {
        setUpdateNotice('New password must contain at least one number and one special character.');
        setToast({ type: 'error', text: 'Password missing required number or special character.' });
        return;
      }
    }

    setSavingProfile(true);
    try {
      let avatarUrl = profileForm.profilePicture || '';

      if (profileImage) {
        const formData = new FormData();
        formData.append('avatar', profileImage);
        formData.append('id', String(currentUser.id));
        formData.append('accountType', 'pharmacist');

        const uploadData = await fetchJson(`/api/staff/avatar`, {
          apiBase: API_BASE,
          method: 'POST',
          headers: { ...buildAuthHeaders() },
          body: formData
        });
        avatarUrl = String(uploadData?.avatarUrl || '').trim();
        if (!avatarUrl) throw new Error(uploadData?.message || 'Failed to upload image');
      }

      const payload = {
        first_name: profileForm.firstName,
        last_name: profileForm.lastName,
        email: profileForm.email,
        avatar_url: avatarUrl
      };

      if (wantsPasswordChange) {
        payload.currentPassword = String(profileForm.currentPassword || '');
        payload.password = String(profileForm.newPassword || '').trim();
        payload.requiresPasswordAuth = true;
      }

      const data = await fetchJson(`/api/staff/${currentUser.id}`, {
        apiBase: API_BASE,
        method: 'PUT',
        headers: buildJsonHeaders(),
        body: JSON.stringify(payload)
      });

      const updatedUser = {
        ...currentUser,
        ...data,
        firstName: profileForm.firstName,
        lastName: profileForm.lastName,
        profilePicture: avatarUrl
      };

      setCurrentUser(updatedUser);
      localStorage.setItem('currentUser', JSON.stringify(updatedUser));
      setProfileImage(null);
      setProfilePreview(avatarUrl || null);
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);
      setToast({ type: 'success', text: 'Profile updated successfully.' });
      setProfileForm((prev) => ({
        ...prev,
        profilePicture: avatarUrl,
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      }));
      setUpdateNotice('');
    } catch (e) {
      const msg = String(e?.message || 'Update failed');
      setUpdateNotice(msg);
      setToast({ type: 'error', text: msg });
    } finally {
      setSavingProfile(false);
    }
  };

  const pageTitle = useMemo(() => {
    if (activeTab === 'profile') return 'My Profile';
    if (activeTab === 'pos') return 'Point of Sale';
    if (activeTab === 'medicines') return 'Medicines Inventory';
    if (activeTab === 'supplies') return 'Supplies Inventory';
    if (activeTab === 'requests') return 'Nurse Requests';
    if (activeTab === 'restocks') return 'Restock Requests';
    if (activeTab === 'sales') return 'Sales Reports';
    return 'Pharmacist';
  }, [activeTab]);

  // POS Logic
  const addToCart = (item, type) => {
    if (item?.expiryMeta?.isExpired) {
      setToast({ type: 'error', text: 'Expired items cannot be added to the cart.' });
      return;
    }
    const existing = cart.find(c => c.id === item.id && c.type === type);
    if (existing) {
      if (existing.quantity >= (item.stock || 0)) {
        setToast({ type: 'error', text: 'Insufficient stock!' });
        return;
      }
      setCart(cart.map(c => c.id === item.id && c.type === type ? { ...c, quantity: c.quantity + 1 } : c));
    } else {
      if ((item.stock || 0) <= 0) {
        setToast({ type: 'error', text: 'Out of stock!' });
        return;
      }
      setCart([...cart, { ...item, quantity: 1, type, price: Number(item.price || 0) }]);
    }
  };

  const addToCartWithQty = (item, type, qty) => {
    if (!item) return;
    const qtyNum = Math.max(1, Math.trunc(Number(qty)));
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) return;

    if (item?.expiryMeta?.isExpired) {
      setToast({ type: 'error', text: 'Expired items cannot be added to the cart.' });
      return;
    }

    const key = `${String(type)}-${String(item.id)}`;
    const originalItem = inventoryLookup.get(key) || item;
    const maxStock = Number(originalItem?.stock || 0);
    if (maxStock <= 0) {
      setToast({ type: 'error', text: 'Out of stock!' });
      return;
    }

    const existing = cart.find((c) => c.id === item.id && c.type === type);
    const nextQty = Math.min(maxStock, (existing?.quantity || 0) + qtyNum);

    if (existing) {
      if (nextQty <= (existing.quantity || 0)) {
        setToast({ type: 'error', text: 'Insufficient stock!' });
        return;
      }
      setCart(cart.map((c) => (c.id === item.id && c.type === type ? { ...c, quantity: nextQty } : c)));
      return;
    }

    setCart([...cart, { ...item, quantity: nextQty, type, price: Number(item.price || 0) }]);
  };

  const isLikelyBarcode = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return false;
    if (raw.length < 6 || raw.length > 64) return false;
    if (/\s/.test(raw)) return false;
    if (/^\d{6,}$/.test(raw)) return true;
    const digitCount = (raw.match(/\d/g) || []).length;
    return digitCount >= 6;
  };

  const buildCartItemFromInventoryRow = (type, row) => {
    if (!row) return null;
    const id = String(row.id || '').trim();
    if (!id) return null;
    const name = type === 'supply' ? String(row.item_name || row.name || '').trim() : String(row.name || '').trim();
    const stock = Number(row.stock ?? 0) || 0;
    const unit = String(row.unit || '').trim() || null;
    const price = Number(row.price ?? 0) || 0;
    const expiryDate = type === 'medicine' ? (row.expiryDate || row.expiry_date || null) : null;
    const expiryMeta = type === 'medicine' ? getExpiryMeta(expiryDate) : null;
    return { id, name, stock, unit, price, expiryDate, expiryMeta };
  };

  const lookupPosBarcodeAndAdd = async (rawCode) => {
    const code = String(rawCode || '').trim();
    if (!isLikelyBarcode(code)) return false;

    const medLocal = (Array.isArray(medicines) ? medicines : []).find((m) => String(m?.barcode || '').trim() === code) || null;
    if (medLocal) {
      const item = buildCartItemFromInventoryRow('medicine', medLocal);
      if (item) addToCart(item, 'medicine');
      setPosSearch('');
      return true;
    }

    const supLocal = (Array.isArray(supplies) ? supplies : []).find((s) => String(s?.barcode || '').trim() === code) || null;
    if (supLocal) {
      const item = buildCartItemFromInventoryRow('supply', supLocal);
      if (item) addToCart(item, 'supply');
      setPosSearch('');
      return true;
    }

    let found = null;
    let foundType = null;
    try {
      found = await fetchJson(`/api/inventory/barcode/${encodeURIComponent(code)}`, { apiBase: API_BASE, headers: buildAuthHeaders() });
      foundType = 'medicine';
    } catch (e) {
      const msg = String(e?.message || '').toLowerCase();
      if (!msg.includes('not found') && !msg.includes('404')) throw e;
    }

    if (!found) {
      try {
        found = await fetchJson(`/api/supplies/barcode/${encodeURIComponent(code)}`, { apiBase: API_BASE, headers: buildAuthHeaders() });
        foundType = 'supply';
      } catch (e) {
        const msg = String(e?.message || '').toLowerCase();
        if (!msg.includes('not found') && !msg.includes('404')) throw e;
      }
    }

    if (!found || !foundType) {
      setToast({ type: 'error', text: `Barcode not found: ${code}` });
      return false;
    }

    if (foundType === 'medicine') {
      setMedicines((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const id = String(found.id || '').trim();
        if (!id) return list;
        const next = list.some((m) => String(m?.id || '') === id)
          ? list.map((m) => (String(m?.id || '') === id ? { ...m, ...found } : m))
          : [{ ...found }, ...list];
        return next;
      });
    } else {
      setSupplies((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const id = String(found.id || '').trim();
        if (!id) return list;
        const next = list.some((s) => String(s?.id || '') === id)
          ? list.map((s) => (String(s?.id || '') === id ? { ...s, ...found } : s))
          : [{ ...found }, ...list];
        return next;
      });
    }

    const cartItem = buildCartItemFromInventoryRow(foundType, found);
    if (cartItem) addToCart(cartItem, foundType);
    setPosSearch('');
    setToast({ type: 'success', text: `Added to cart: ${cartItem?.name || 'Item'}` });
    return true;
  };

  const removeFromCart = (id, type) => {
    setCart(cart.filter(c => !(c.id === id && c.type === type)));
  };

  const updateCartQty = (id, type, qty) => {
    const item = cart.find(c => c.id === id && c.type === type);
    if (!item) return;
    
    const newQty = Math.max(1, Number(qty));
    const originalItem = inventoryLookup.get(`${String(type)}-${String(id)}`);
    
    if (newQty > (originalItem?.stock || 0)) {
      setToast({ type: 'error', text: 'Insufficient stock!' });
      return;
    }
    
    setCart(cart.map(c => c.id === id && c.type === type ? { ...c, quantity: newQty } : c));
  };

  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  }, [cart]);

  const discountInfo = useMemo(() => {
    const subtotal = Math.max(0, Number(cartTotal) || 0);
    const type = String(discountType || 'none').toLowerCase();
    const raw = Number(discountValue);

    if (!Number.isFinite(subtotal) || subtotal <= 0) return { amount: 0, label: null };

    if (type === 'pwd') {
      const amt = round2((subtotal * 20) / 100);
      return { amount: Math.min(subtotal, Math.max(0, amt)), label: 'PWD (20%)' };
    }
    if (type === 'senior') {
      const amt = round2((subtotal * 20) / 100);
      return { amount: Math.min(subtotal, Math.max(0, amt)), label: 'Senior (20%)' };
    }
    if (type === 'custom_percent') {
      const pct = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
      const amt = round2((subtotal * pct) / 100);
      return { amount: Math.min(subtotal, Math.max(0, amt)), label: `Custom (${pct}%)` };
    }
    if (type === 'custom_amount') {
      const amt = Number.isFinite(raw) ? round2(raw) : 0;
      return { amount: Math.min(subtotal, Math.max(0, amt)), label: `Custom (₱${round2(amt)})` };
    }
    return { amount: 0, label: null };
  }, [cartTotal, discountType, discountValue]);

  const totalDue = useMemo(() => {
    const subtotal = Math.max(0, Number(cartTotal) || 0);
    return round2(Math.max(0, subtotal - Number(discountInfo.amount || 0)));
  }, [cartTotal, discountInfo.amount]);

  const cartItemsCount = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }, [cart]);

  const processCheckout = async () => {
    if (cart.length === 0) return;
    const paymentNum = Number(paymentAmount);
    if (!paymentAmount || !Number.isFinite(paymentNum) || paymentNum < totalDue) {
      setToast({ type: 'error', text: 'Insufficient payment amount!' });
      return;
    }

    setRxSaving(true); // Reuse rxSaving for checkout loading
    try {
      // Stock deduction is now safely handled atomically inside the /api/sales POST endpoint backend.
      // We no longer need to manually fire individual PUT requests per item here.

      const receiptDraft = {
        items: [...cart],
        patientName: selectedPatient ? `${selectedPatient.first_name || ''} ${selectedPatient.last_name || ''}`.trim() : '',
        subtotal: round2(cartTotal),
        discountType,
        discountValue,
        discountRef: String(discountRef || '').trim(),
        discountLabel: discountInfo.label,
        discountAmount: round2(Number(discountInfo.amount || 0)),
        totalDue: round2(Number(totalDue || 0)),
        payment: round2(paymentNum),
        paymentMethod,
        change: round2(paymentNum - Number(totalDue || 0)),
        date: new Date().toLocaleString(),
        pharmacist: pharmacistName
      };

      await fetchMedicines();
      await fetchSupplies();
      await fetchPosProducts();

      const saleData = await fetchJson(`/api/sales`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: buildJsonHeaders(),
        body: JSON.stringify({
          items: cart,
          total: receiptDraft.totalDue,
          payment: receiptDraft.payment,
          change: receiptDraft.change,
          pharmacist: pharmacistName,
          discountType,
          discountValue,
          discountRef: receiptDraft.discountRef,
          patientId: selectedPatient?.id || null,
          createInvoice: createBillingInvoice,
          bulkOrder: Boolean(isBulkOrder),
          bulkMeta: {
            reference: String(bulkReference || '').trim() || null,
            discountPercent: bulkDiscountPercent === '' ? null : Number(bulkDiscountPercent)
          },
          paymentMethod,
          paymentReference: receiptDraft.discountRef
        })
      });

      setShowReceipt({
        ...receiptDraft,
        bulkOrder: Boolean(isBulkOrder),
        bulkMeta: { reference: bulkReference, discountPercent: bulkDiscountPercent },
        saleId: saleData.id || null,
        transactionNo: saleData.transaction_no || null,
        invoiceId: saleData.invoice_id || null,
        statusLabel: createBillingInvoice ? 'Sale recorded in pharmacy and billing.' : 'Sale recorded in pharmacy.',
        subtotal: round2(Number(saleData.subtotal ?? receiptDraft.subtotal)),
        discountAmount: round2(Number(saleData.discount_amount ?? receiptDraft.discountAmount)),
        totalDue: round2(Number(saleData.total_due ?? receiptDraft.totalDue)),
        date: saleData.created_at ? new Date(saleData.created_at).toLocaleString() : receiptDraft.date
      });
      resetPosCheckoutState();
      setToast({ type: 'success', text: createBillingInvoice ? 'Transaction completed and sent to billing.' : 'Transaction completed successfully!' });
    } catch (err) {
      setToast({ type: 'error', text: err.message || 'Checkout failed.' });
    } finally {
      setRxSaving(false);
    }
  };

  const categoryAlertCounts = useMemo(() => {
    const counts = {};
    enrichedPosProducts.forEach((item) => {
      const key = String(item.categoryId || '');
      if (!key) return;
      const urgent = item.stockMeta?.isLow || item.expiryMeta?.isSoon;
      if (!urgent) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [enrichedPosProducts]);

  const nearExpiryItems = useMemo(() => {
    return enrichedPosProducts
      .filter((item) => item.expiryMeta?.isSoon)
      .sort((a, b) => Number(a.expiryMeta?.days || 0) - Number(b.expiryMeta?.days || 0));
  }, [enrichedPosProducts]);

  const restockPendingCount = useMemo(() => {
    return restockRequests.filter((r) => String(r.status || '').toLowerCase() === 'pending').length;
  }, [restockRequests]);

  const approvedRestockCount = useMemo(() => {
    return restockRequests.filter((r) => String(r.status || '').toLowerCase() === 'approved').length;
  }, [restockRequests]);

  const urgentQueue = useMemo(() => {
    const queue = [];
    lowStockItems.slice(0, 3).forEach((item) => {
      queue.push({
        key: `low-${item.type}-${item.id}`,
        tone: 'warn',
        title: `${item.name || item.item_name} is running low`,
        meta: `Stock ${Number(item.stock || 0)} / Min ${Number(item.min_level || 0)}`,
        actionLabel: 'Open restock',
        onAction: () => setActiveTab('restocks')
      });
    });
    nearExpiryItems.slice(0, 3).forEach((item) => {
      queue.push({
        key: `expiry-${item.type}-${item.id}`,
        tone: item.expiryMeta?.isExpired ? 'danger' : 'warn',
        title: `${item.name} needs expiry review`,
        meta: formatDaysLabel(item.expiryMeta?.days),
        actionLabel: 'Focus item',
        onAction: () => {
          setActiveTab('pos');
          setPosSearch(item.name || '');
          setPosCategoryId(String(item.categoryId || 'all'));
          setPosSafetyFilter('expiry');
        }
      });
    });
    if (restockPendingCount > 0) {
      queue.unshift({
        key: 'restock-pending',
        tone: 'danger',
        title: `${restockPendingCount} restock request${restockPendingCount === 1 ? '' : 's'} pending`,
        meta: 'Review and follow up with Admin if needed.',
        actionLabel: 'View requests',
        onAction: () => setActiveTab('restocks')
      });
    }
    return queue.slice(0, 5);
  }, [lowStockItems, nearExpiryItems, restockPendingCount]);

  const cartValidation = useMemo(() => {
    const warnings = [];
    const blocking = [];
    const lineMeta = {};

    cart.forEach((item) => {
      const live = inventoryLookup.get(`${String(item.type)}-${String(item.id)}`) || item;
      const stock = Math.max(0, Number(live.stock ?? item.stock ?? 0));
      const minLevel = Math.max(0, Number(live.minLevel ?? live.min_level ?? item.minLevel ?? item.min_level ?? 10));
      const expiryMeta = item.type === 'medicine' ? getExpiryMeta(live.expiryDate || live.expiry_date || item.expiryDate || item.expiry_date) : null;
      const remaining = stock - Number(item.quantity || 0);
      const notes = [];

      if (Number(item.quantity || 0) > stock) {
        const message = `${item.name} exceeds available stock.`;
        blocking.push(message);
        notes.push(message);
      } else if (remaining <= minLevel) {
        notes.push(`Stock after dispense: ${Math.max(0, remaining)}. This reaches the minimum level.`);
      } else {
        notes.push(`Stock after dispense: ${Math.max(0, remaining)} remaining.`);
      }

      if (expiryMeta?.isExpired) {
        const message = `${item.name} is already expired.`;
        blocking.push(message);
        notes.push(message);
      } else if (expiryMeta?.isSoon) {
        warnings.push(`${item.name} should be double-checked: ${formatDaysLabel(expiryMeta.days)}.`);
        notes.push(`Expiry review: ${formatDaysLabel(expiryMeta.days)}.`);
      }

      lineMeta[`${item.type}-${item.id}`] = {
        remaining,
        stock,
        minLevel,
        expiryMeta,
        notes
      };
    });

    if (discountType !== 'none' && !String(discountRef || '').trim()) {
      warnings.push('Discount reference is empty. Add an ID if you need an audit trail.');
    }
    if (createBillingInvoice && !selectedPatient?.id) {
      blocking.push('Select a patient before creating a billing invoice.');
    }

    const checklist = [
      { label: 'Stock available for every cart item', done: blocking.every((message) => !message.includes('stock')) },
      { label: 'Expiry-sensitive items reviewed', done: !warnings.some((message) => message.includes('double-checked')) && !blocking.some((message) => message.includes('expired')) },
      { label: 'Payment covers total due', done: Number(paymentAmount || 0) >= Number(totalDue || 0) && Number(totalDue || 0) > 0 },
      { label: 'Discount details complete', done: discountType === 'none' || Boolean(String(discountRef || '').trim()) || String(discountType).startsWith('custom') },
      { label: 'Patient selected for billing linkage', done: !createBillingInvoice || Boolean(selectedPatient?.id) }
    ];

    return { warnings, blocking, lineMeta, checklist };
  }, [cart, createBillingInvoice, discountRef, discountType, inventoryLookup, paymentAmount, selectedPatient, totalDue]);

  const posResults = useMemo(() => {
    const q = String(posSearch || '').toLowerCase().trim();
    const cid = String(posCategoryId || 'all');
    return enrichedPosProducts
      .filter((p) => {
        if (cid !== 'all' && String(p.categoryId || '') !== cid) return false;
        if (posSafetyFilter === 'critical' && !(p.stockMeta?.isLow || p.expiryMeta?.isExpired)) return false;
        if (posSafetyFilter === 'low' && !p.stockMeta?.isLow) return false;
        if (posSafetyFilter === 'expiry' && !p.expiryMeta?.isSoon) return false;
        if (!q) return true;
        return (
          String(p.name || '').toLowerCase().includes(q) ||
          String(p.barcode || '').toLowerCase().includes(q) ||
          String(p.categoryName || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (
        Number(b.urgencyScore || 0) - Number(a.urgencyScore || 0) ||
        String(a.name || '').localeCompare(String(b.name || ''))
      ));
  }, [enrichedPosProducts, posSearch, posCategoryId, posSafetyFilter]);

  const createCategory = async () => {
    if (!currentUser) return;
    const name = String(newCategoryName || '').trim();
    if (!name) return;
    setCategorySaving(true);
    try {
      setCategoryError('');
      await fetchJson(`/api/product-categories`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: buildJsonHeaders(),
        body: JSON.stringify({ name })
      });
      setNewCategoryName('');
      await fetchPosCategories();
    } catch (e) {
      setCategoryError(String(e.message || 'Failed to create category'));
    } finally {
      setCategorySaving(false);
    }
  };

  const submitNewProduct = async () => {
    if (!currentUser) return;
    const type = String(newProductForm.type || 'medicine').trim().toLowerCase();
    const name = String(newProductForm.name || '').trim();
    const stock = Math.max(0, Math.trunc(Number(newProductForm.stock || 0)));
    const minLevel = Math.max(0, Math.trunc(Number(newProductForm.minLevel || 0)));
    const unit = String(newProductForm.unit || '').trim();
    const priceRaw = Number(newProductForm.price || 0);
    const price = Number.isFinite(priceRaw) ? Math.max(0, priceRaw) : 0;
    const categoryId = String(newProductForm.categoryId || 'all').trim();
    const selectedCategory = (Array.isArray(posCategories) ? posCategories : []).find((c) => String(c.id) === categoryId) || null;
    const categoryName = selectedCategory ? String(selectedCategory.name || '').trim() : '';

    if (!name) {
      setProductError('Product name is required.');
      return;
    }

    setProductSaving(true);
    setProductError('');
    try {
      let createdItem = null;
      if (type === 'medicine') {
        const body = {
          name,
          barcode: String(newProductForm.barcode || '').trim() || undefined,
          category: categoryName || 'Uncategorized',
          categoryId: categoryIdsAreNumeric && categoryId !== 'all' ? categoryId : undefined,
          stock,
          minLevel,
          unit: unit || null,
          price
        };
        createdItem = await fetchJson(`/api/inventory`, { apiBase: API_BASE, method: 'POST', headers: buildJsonHeaders(), body: JSON.stringify(body) });
        await fetchMedicines();
      } else if (type === 'supply') {
        const body = {
          itemName: name,
          barcode: String(newProductForm.barcode || '').trim() || undefined,
          categoryId: categoryIdsAreNumeric && categoryId !== 'all' ? categoryId : undefined,
          stock,
          minLevel,
          unit: unit || null,
          price
        };
        createdItem = await fetchJson(`/api/supplies`, { apiBase: API_BASE, method: 'POST', headers: buildJsonHeaders(), body: JSON.stringify(body) });
        await fetchSupplies();
      } else {
        throw new Error('Invalid product type');
      }


      await Promise.all([fetchPosProducts(), fetchPosCategories()]);
      setShowAddProductModal(false);
      setNewProductForm({ type: 'medicine', name: '', categoryId: 'all', stock: 0, minLevel: 10, unit: '', price: '' });
      setToast({ type: 'success', text: 'Product added successfully.' });
    } catch (e) {
      setProductError(String(e?.message || 'Failed to add product'));
    } finally {
      setProductSaving(false);
    }
  };

  const uploadCategoryImage = async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    const data = await fetchJson(`/api/product-categories/upload`, {
      apiBase: API_BASE,
      method: 'POST',
      headers: buildAuthHeaders(),
      body: fd
    });
    return String(data?.url || '');
  };

  const setCategoryImage = async (categoryId, imageUrl) => {
    return fetchJson(`/api/product-categories/${categoryId}`, {
      apiBase: API_BASE,
      method: 'PUT',
      headers: buildJsonHeaders(),
      body: JSON.stringify({ imageUrl })
    });
  };

  const requestCategoryImageUpload = (categoryId) => {
    setCategoryImageTargetId(String(categoryId));
    if (categoryImageInputRef.current) categoryImageInputRef.current.click();
  };

  const requestProductImageUpload = (type, id) => {
    setProductImageTarget({ type, id: String(id) });
    if (productImageInputRef.current) productImageInputRef.current.click();
  };

  const uploadProductImage = async (target, file) => {
    if (!target) return null;
    const endpoint = target.type === 'medicine' ? 'inventory' : 'supplies';
    const fd = new FormData();
    fd.append('file', file);
    return fetchJson(`/api/${endpoint}/${target.id}/upload-image`, {
      apiBase: API_BASE,
      method: 'POST',
      headers: buildAuthHeaders(),
      body: fd
    });
  };

  const updateItemCategory = async (type, id, nextCategoryId) => {
    const endpoint = type === 'medicine' ? 'inventory' : 'supplies';
    return fetchJson(`/api/${endpoint}/${id}`, {
      apiBase: API_BASE,
      method: 'PUT',
      headers: buildJsonHeaders(),
      body: JSON.stringify({ categoryId: nextCategoryId || null })
    });
  };

  const importPrescriptionToCart = (rx) => {
    setPosFromPrescription(true);
    const rxItems = Array.isArray(rx.items) ? rx.items : [];
    let addedCount = 0;
    
    rxItems.forEach(rxItem => {
      // Find matching medicine by name
      const matchedMed = medicines.find(m => 
        m.name.toLowerCase().trim() === rxItem.medication.toLowerCase().trim()
      );
      
      if (matchedMed) {
        // Use regex to extract quantity from dosage or instructions if possible, 
        // but for now let's just add 1 or a default
        addToCart({ ...matchedMed, id: matchedMed.id }, 'medicine');
        addedCount++;
      }
    });
    
    if (addedCount > 0) {
      setToast({ type: 'success', text: `Imported ${addedCount} items from prescription.` });
    } else {
      setToast({ type: 'error', text: 'No matching medicines found in inventory.' });
    }
    setShowRxImport(false);
  };

  const sentPrescriptions = useMemo(() => {
    const list = Array.isArray(prescriptions) ? prescriptions : [];
    const filtered = list.filter((p) => {
      const source = String(p.pharmacySource || '').toLowerCase();
      const status = String(p.pharmacyStatus || '').toLowerCase();
      const sent = p.is_sent_to_pharmacy === true || p.isSentToPharmacy === true || p.is_sent_to_pharmacy === 1;
      if (!(source === 'hospital' || sent)) return false;
      return status !== 'dispensed' && status !== 'bought outside' && status !== 'cancelled';
    });
    return filtered;
  }, [prescriptions]);

  return (
    <div className="pharm-shell" style={{ paddingTop: backendHealth.checked && !backendHealth.ok ? 44 : 0 }}>
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
      <aside className={`pharm-sidebar ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="pharm-sidebar-head">
          <div className="pharm-brand">
            <img className="pharm-brand-logo" src="/images/pgh%20logo.png" alt="PASCUALINGA" />
            {!isCollapsed ? <span className="pharm-brand-text">PASCUALINGA</span> : null}
          </div>
          <button type="button" className="pharm-sidebar-toggle" onClick={() => setIsCollapsed((v) => !v)}>
            <Menu size={18} />
          </button>
        </div>

        <nav className="pharm-nav">
          <button type="button" className={`pharm-nav-item ${activeTab === 'pos' ? 'active' : ''}`} onClick={() => setActiveTab('pos')}>
            <ShoppingCart size={20} />
            {!isCollapsed && <span>POS System</span>}
          </button>
          {!isCollapsed && <div className="pharm-nav-group-title">Inventory</div>}
          <button type="button" className="pharm-nav-item" onClick={() => setScanCenterOpen(true)}>
            <QrCode size={20} />
            {!isCollapsed && <span>Scan Center</span>}
          </button>
          <button type="button" className={`pharm-nav-item ${activeTab === 'medicines' ? 'active' : ''}`} onClick={() => setActiveTab('medicines')}>
            <Pill size={20} />
            {!isCollapsed && <span>Medicines</span>}
          </button>
          <button type="button" className={`pharm-nav-item ${activeTab === 'supplies' ? 'active' : ''}`} onClick={() => setActiveTab('supplies')}>
            <Package size={20} />
            {!isCollapsed && <span>Supplies</span>}
          </button>
          <button type="button" className={`pharm-nav-item ${activeTab === 'requests' ? 'active' : ''}`} onClick={() => setActiveTab('requests')}>
            <ClipboardList size={20} />
            {!isCollapsed && <span>Requests</span>}
          </button>
          <button type="button" className={`pharm-nav-item ${activeTab === 'restocks' ? 'active' : ''}`} onClick={() => setActiveTab('restocks')}>
            <Bell size={20} />
            {!isCollapsed && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Stock Alerts
                {(lowStockItems.length > 0 || restockRequests.filter(r => r.status === 'Approved').length > 0) && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 22,
                      height: 22,
                      borderRadius: 999,
                      padding: '0 8px',
                      fontWeight: 900,
                      background: '#fef2f2',
                      color: '#b91c1c',
                      border: '1px solid #fecaca'
                    }}
                  >
                    {lowStockItems.length + restockRequests.filter(r => r.status === 'Approved').length}
                  </span>
                )}
              </span>
            )}
          </button>
          <button type="button" className={`pharm-nav-item ${activeTab === 'sales' ? 'active' : ''}`} onClick={() => setActiveTab('sales')}>
            <BarChart3 size={20} />
            {!isCollapsed && <span>Sales Reports</span>}
          </button>
        </nav>
      </aside>

      <main className="pharm-main">
        <header className="pharm-header">
          <div className="pharm-header-left">
            {isCollapsed ? (
              <button type="button" className="app-mobile-menu-btn" onClick={() => setIsCollapsed(false)} aria-label="Open menu">
                <Menu size={18} />
              </button>
            ) : null}
            <div className="pharm-header-meta">
              <div className="pharm-header-title">{pageTitle}</div>
              <div className="pharm-header-sub">Welcome back, {pharmacistName}</div>
            </div>
          </div>
          <div className="pharm-header-right">
            <div className="pharm-search">
              <Search size={18} className="pharm-search-icon" />
              <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search..." />
            </div>
            <AccountHeaderActions user={currentUser} showChangePasswordMenu={false} onMyProfile={() => setActiveTab('profile')} onSignOut={confirmLogout} onOpenNotification={(n) => {
              const type = String(n?.type || '').toLowerCase();
              if (type.includes('inventory') || type.includes('stock') || type.includes('restock')) {
                setActiveTab('restocks');
              } else if (type.includes('request') || type.includes('prescription')) {
                setActiveTab('requests');
              } else if (type.includes('sale') || type.includes('pos') || type.includes('transaction')) {
                setActiveTab('sales');
              } else {
                setActiveTab('pos');
              }
            }} />
          </div>
        </header>

        <div className="pharm-content">
          <div className="pharm-welcome">
            <div className="pharm-welcome-left">
              <div className="pharm-welcome-title">
                Welcome, <span className="pharm-welcome-accent">{pharmacistName}</span>
              </div>
              <div className="pharm-welcome-quote">“{welcomeQuote}”</div>
            </div>
            <div className="pharm-welcome-date">{welcomeDateText}</div>
          </div>

        {activeTab === 'profile' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="pharm-card">
              <div className="pharm-card-head">
                <div className="pharm-card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <User size={18} />
                  My Profile
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button type="button" className="pharm-btn sm" onClick={() => avatarInputRef.current?.click()}>
                    <Upload size={16} />
                    Photo
                  </button>
                  <button type="button" className="pharm-btn primary sm" onClick={saveMyProfile} disabled={savingProfile}>
                    {savingProfile ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 20, alignItems: 'start' }}>
                <div className="profile-column" style={{ minWidth: 0 }}>
                  <div className="profile-card" style={{ boxShadow: 'none', border: 'none', padding: 0 }}>
                    <h3 className="column-title">
                      <User size={20} color="#475569" />
                      Personal Information
                    </h3>

                    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 16, alignItems: 'start' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
                        <div
                          style={{
                            width: 120,
                            height: 120,
                            borderRadius: 999,
                            overflow: 'hidden',
                            background: '#f1f5f9',
                            border: '1px solid #e2e8f0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 900,
                            color: '#0f172a'
                          }}
                        >
                          {profilePreview ? (
                            <img src={profilePreview} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <span style={{ fontSize: 34 }}>{String(pharmacistName || 'P').trim()[0]?.toUpperCase() || 'P'}</span>
                          )}
                        </div>
                        <input
                          ref={avatarInputRef}
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                            setProfileImage(file);
                            if (file) {
                              const url = URL.createObjectURL(file);
                              setProfilePreview(url);
                            }
                          }}
                        />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6, fontWeight: 800 }}>First Name</div>
                          <input
                            className="pharm-input"
                            value={profileForm.firstName}
                            onChange={(e) => setProfileForm((p) => ({ ...p, firstName: e.target.value }))}
                            placeholder="First name"
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6, fontWeight: 800 }}>Last Name</div>
                          <input
                            className="pharm-input"
                            value={profileForm.lastName}
                            onChange={(e) => setProfileForm((p) => ({ ...p, lastName: e.target.value }))}
                            placeholder="Last name"
                          />
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6, fontWeight: 800 }}>Email</div>
                          <input
                            className="pharm-input"
                            value={profileForm.email}
                            onChange={(e) => setProfileForm((p) => ({ ...p, email: e.target.value }))}
                            placeholder="Email"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="profile-column" style={{ minWidth: 0 }}>
                  <div className="profile-card" style={{ boxShadow: 'none', border: 'none', padding: 0 }}>
                    <h3 className="column-title">
                      <Shield size={20} color="#475569" />
                      Security & Password
                    </h3>

                    <div className="profile-input-group">
                      <label>Current Password</label>
                      <div className="input-wrapper-relative">
                        <Key size={18} className="absolute-icon-left text-slate-400" />
                        <input
                          type={showCurrentPassword ? 'text' : 'password'}
                          value={profileForm.currentPassword}
                          onChange={(e) => setProfileForm((p) => ({ ...p, currentPassword: e.target.value }))}
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
                          type={showNewPassword ? 'text' : 'password'}
                          value={profileForm.newPassword}
                          onChange={(e) => setProfileForm((p) => ({ ...p, newPassword: e.target.value }))}
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
                          <span>At least 8 characters</span>
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
                          type={showConfirmPassword ? 'text' : 'password'}
                          value={profileForm.confirmPassword}
                          onChange={(e) => setProfileForm((p) => ({ ...p, confirmPassword: e.target.value }))}
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
                      {profileForm.confirmPassword && (
                        <p className={`match-indicator ${profileForm.newPassword === profileForm.confirmPassword ? 'match-success' : 'match-error'}`}>
                          {profileForm.newPassword === profileForm.confirmPassword ? 'Passwords match' : 'Passwords do not match'}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {updateNotice && (
                <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>
                  {updateNotice}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'pos' && (
          <div className="pharm-pos-container">
            <div className="pharm-pos-left">
              <div className="pharm-card">
                <div className="pharm-card-head">
                  <div className="pharm-card-title">Search Products</div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button
                      className="pharm-btn sm"
                      style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                      type="button"
                      onClick={() => setShowCategoryManager(true)}
                    >
                      <FileText size={16} />
                      Categories
                    </button>
                    <button
                      className="pharm-btn primary sm"
                      style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                      onClick={() => {
                        setInventoryScan('');
                        setScanCenterMatch(null);
                        setScanAssignModal(null);
                        setScanAssignTarget(null);
                        setScanMode('find');
                        setQueueMode(false);
                        setScanCenterKind('auto');
                        setScanCenterOpen(true);
                        setScanBanner({ type: 'info', text: 'Scan a barcode to add/register a product.' });
                      }}
                      type="button"
                    >
                      <Plus size={16} />
                      Add Product
                    </button>
                  </div>
                </div>
                <div className="pharm-command-center">
                  <div className="pharm-command-grid">
                    <button type="button" className={`pharm-command-card ${posSafetyFilter === 'all' ? 'active' : ''}`} onClick={() => setPosSafetyFilter('all')}>
                      <div className="pharm-command-label">Available products</div>
                      <div className="pharm-command-value">{enrichedPosProducts.length}</div>
                      <div className="pharm-command-meta">Complete catalog in the current shift</div>
                    </button>
                    <button type="button" className={`pharm-command-card warn ${posSafetyFilter === 'low' ? 'active' : ''}`} onClick={() => setPosSafetyFilter('low')}>
                      <div className="pharm-command-label">Low stock watch</div>
                      <div className="pharm-command-value">{lowStockItems.length}</div>
                      <div className="pharm-command-meta">Items at or below minimum level</div>
                    </button>
                    <button type="button" className={`pharm-command-card danger ${posSafetyFilter === 'expiry' ? 'active' : ''}`} onClick={() => setPosSafetyFilter('expiry')}>
                      <div className="pharm-command-label">Expiry review</div>
                      <div className="pharm-command-value">{nearExpiryItems.length}</div>
                      <div className="pharm-command-meta">Medicines expiring within {EXPIRY_SOON_DAYS} days</div>
                    </button>
                    <button type="button" className="pharm-command-card" onClick={() => setActiveTab('restocks')}>
                      <div className="pharm-command-label">Restock queue</div>
                      <div className="pharm-command-value">{restockPendingCount + approvedRestockCount}</div>
                      <div className="pharm-command-meta">{restockPendingCount} pending, {approvedRestockCount} approved</div>
                    </button>
                  </div>
                  {urgentQueue.length > 0 && (
                    <div className="pharm-urgent-queue">
                      <div className="pharm-urgent-head">
                        <Bell size={16} />
                        <span>Urgent queue</span>
                      </div>
                      <div className="pharm-urgent-list">
                        {urgentQueue.map((entry) => (
                          <div key={entry.key} className={`pharm-urgent-item ${entry.tone}`}>
                            <div>
                              <div className="pharm-urgent-title">{entry.title}</div>
                              <div className="pharm-urgent-meta">{entry.meta}</div>
                            </div>
                            <button type="button" className="pharm-btn sm" onClick={entry.onAction}>{entry.actionLabel}</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="pharm-urgent-queue" style={{ marginBottom: 10 }}>
                  <div className="pharm-urgent-head">
                    <ClipboardList size={16} />
                    <span>Pending prescriptions</span>
                  </div>
                  {loadingPrescriptions ? (
                    <div className="pharm-empty">Loading prescriptions…</div>
                  ) : sentPrescriptions.length === 0 ? (
                    <div className="pharm-empty">No prescriptions waiting for hospital pharmacy.</div>
                  ) : (
                    <div className="pharm-urgent-list">
                      {sentPrescriptions.slice(0, 5).map((rx) => (
                        <div key={rx.id} className="pharm-urgent-item">
                          <div>
                            <div className="pharm-urgent-title">{rx.patientName || 'Patient'} • {rx.diagnosis || 'Prescription'}</div>
                            <div className="pharm-urgent-meta">
                              {rx.doctorName || rx.doctor_name || 'Doctor'} • {rx.pharmacyStatus || 'Pending'} • {(Array.isArray(rx.items) ? rx.items.length : 0)} item(s)
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="pharm-btn sm"
                              onClick={() => {
                                const pid = String(rx.patientId || rx.patient_id || '').trim();
                                if (!pid) return;
                                setCentralRecordPatientId(pid);
                                setCentralRecordPatientLabel(String(rx.patientName || 'Patient'));
                                setCentralRecordOpen(true);
                              }}
                              disabled={!String(rx.patientId || rx.patient_id || '').trim()}
                              title={!String(rx.patientId || rx.patient_id || '').trim() ? 'Missing patient id' : 'View central patient record'}
                            >
                              Record
                            </button>
                            <button type="button" className="pharm-btn sm" onClick={() => importPrescriptionToCart(rx)}>Import</button>
                            <button type="button" className="pharm-btn primary sm" onClick={() => openPrescription(rx)}>Review</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="pharm-pos-search-box">
                  <Search size={20} className="pharm-pos-search-icon" />
                  <input 
                    type="text" 
                    placeholder="Search products by name or category..." 
                    className="pharm-pos-input"
                    value={posSearch}
                    onChange={(e) => setPosSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      const code = String(posSearch || '').trim();
                      if (!isLikelyBarcode(code)) return;
                      e.preventDefault();
                      lookupPosBarcodeAndAdd(code).catch((err) => {
                        setToast({ type: 'error', text: String(err?.message || 'Barcode lookup failed') });
                      });
                    }}
                  />
                </div>

                <div className="pharm-pos-categories">
                  <button
                    type="button"
                    className={`pharm-cat-chip ${posCategoryId === 'all' ? 'active' : ''}`}
                    onClick={() => setPosCategoryId('all')}
                  >
                    <div className="pharm-cat-img">
                      <Package size={18} />
                    </div>
                    <div className="pharm-cat-name">All</div>
                  </button>
                  {posCategories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`pharm-cat-chip ${String(posCategoryId) === String(c.id) ? 'active' : ''}`}
                      onClick={() => setPosCategoryId(String(c.id))}
                      title={c.name}
                      >
                        <div className="pharm-cat-img">
                          {c.image_url ? (
                            <img src={c.image_url} alt={c.name} />
                        ) : (
                          <Package size={18} />
                        )}
                        </div>
                        <div className="pharm-cat-name">{c.name}</div>
                        <div className="pharm-cat-count">{Number(c.available_count || 0)}</div>
                        {Number(categoryAlertCounts[String(c.id)] || 0) > 0 && (
                          <div className="pharm-cat-alert">{Number(categoryAlertCounts[String(c.id)] || 0)} alert</div>
                        )}
                      </button>
                    ))}
                </div>
                
                {categoryError ? <div className="pharm-empty">{categoryError}</div> : null}
                {posError ? <div className="pharm-empty">{posError}</div> : null}

                <div className="pharm-products-grid">
                  {loadingPos ? (
                    <div className="pharm-empty">Loading products…</div>
                  ) : posResults.length === 0 ? (
                    <div className="pharm-empty">No available products found.</div>
                  ) : (
                    posResults.map((item) => (
                      <div key={`${item.type}-${item.id}`} className="pharm-product-card">
                        <div className="pharm-product-img">
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt={item.name} />
                          ) : (
                            <div className="pharm-product-img-placeholder">
                              <Package size={22} />
                            </div>
                          )}
                        </div>
                        <div className="pharm-product-meta">
                          <div className="pharm-product-badges">
                            <span className={`pharm-risk-badge ${item.stockMeta?.tone || 'safe'}`}>{item.stockMeta?.label || 'Ready'}</span>
                            {item.expiryMeta && (
                              <span className={`pharm-risk-badge ${item.expiryMeta.tone}`}>{item.expiryMeta.label}</span>
                            )}
                            {item.unit && <span className="pharm-risk-badge neutral">{item.unit}</span>}
                          </div>
                          <div className="pharm-product-name">{item.name}</div>
                          <div className="pharm-product-sub">
                            {item.categoryName || 'Uncategorized'} • Stock: {item.stock} {String(item.unit || '').trim() || 'pcs'}
                          </div>
                          {item.expiryMeta && (
                            <div className="pharm-product-tip">{formatDaysLabel(item.expiryMeta.days)}</div>
                          )}
                          {item.cheaperAlternative && (
                            <div className="pharm-product-tip alt">
                              Lower-cost alternative: {item.cheaperAlternative.name} at ₱{Number(item.cheaperAlternative.price || 0).toLocaleString()}
                            </div>
                          )}
                          <div className="pharm-product-footer">
                            <div className="pharm-product-price">₱{Number(item.price || 0).toLocaleString()}</div>
                            <button
                              type="button"
                              className="pharm-pos-add-btn"
                              onClick={() => addToCart(item, item.type)}
                              disabled={item.stock <= 0 || item.expiryMeta?.isExpired}
                            >
                              <Plus size={18} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="pharm-pos-right">
              <div className="pharm-card pharm-pos-cart-card">
                <div className="pharm-card-head">
                  <div className="pharm-card-title flex-row gap-8">
                    <ShoppingCart size={20} />
                    Current Cart
                    {cart.length > 0 && <span className="pharm-badge-count">{cartItemsCount}</span>}
                  </div>
                  {cart.length > 0 && (
                    <button
                      className="pharm-btn-text"
                      onClick={resetPosCheckoutState}
                    >
                      Clear All
                    </button>
                  )}
                </div>

                <div className="pharm-pos-cart-list">
                  {cart.length === 0 ? (
                    <div className="pharm-empty-cart">
                      <ShoppingCart size={48} className="pharm-empty-icon" />
                      <div>Your cart is empty</div>
                    </div>
                  ) : (
                    cart.map(item => (
                      <div key={`${item.type}-${item.id}`} className="pharm-cart-item">
                        <div className="pharm-cart-item-info">
                          <div className="pharm-cart-item-name">{item.name}</div>
                          <div className="pharm-cart-item-price">₱{item.price.toLocaleString()}</div>
                          <div className="pharm-cart-item-note">Unit: {String(item.unit || '').trim() || 'pcs'}</div>
                          {(cartValidation.lineMeta[`${item.type}-${item.id}`]?.notes || []).map((note, idx) => (
                            <div key={idx} className="pharm-cart-item-note">{note}</div>
                          ))}
                        </div>
                        <div className="pharm-cart-qty-ctrl">
                          <button onClick={() => updateCartQty(item.id, item.type, item.quantity - 1)} className="pharm-qty-btn">
                            <Minus size={14} />
                          </button>
                          <input 
                            type="number" 
                            className="pharm-qty-input" 
                            value={item.quantity} 
                            onChange={(e) => updateCartQty(item.id, item.type, e.target.value)}
                          />
                          <button onClick={() => updateCartQty(item.id, item.type, item.quantity + 1)} className="pharm-qty-btn">
                            <Plus size={14} />
                          </button>
                        </div>
                        <div className="pharm-cart-item-total">
                          ₱{(item.price * item.quantity).toLocaleString()}
                        </div>
                        <button onClick={() => removeFromCart(item.id, item.type)} className="pharm-cart-remove">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {cart.length > 0 && (
                  <div className="pharm-pos-checkout">
                    <div className="pharm-verify-panel">
                      <div className="pharm-verify-head">
                        <ClipboardList size={16} />
                        <span>Dispense verification</span>
                      </div>
                      {cartValidation.blocking.length > 0 && (
                        <div className="pharm-verify-list danger">
                          {cartValidation.blocking.map((warning) => (
                            <div key={warning} className="pharm-verify-item">
                              <AlertCircle size={14} />
                              <span>{warning}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {cartValidation.warnings.length > 0 && (
                        <div className="pharm-verify-list warn">
                          {cartValidation.warnings.map((warning) => (
                            <div key={warning} className="pharm-verify-item">
                              <AlertCircle size={14} />
                              <span>{warning}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="pharm-checklist">
                        {cartValidation.checklist.map((entry) => (
                          <div key={entry.label} className={`pharm-checklist-item ${entry.done ? 'done' : 'pending'}`}>
                            {entry.done ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                            <span>{entry.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="pharm-pos-summary">
                      <div className="pharm-summary-row">
                        <span>Subtotal</span>
                        <span>₱{cartTotal.toLocaleString()}</span>
                      </div>
                      {Number(discountInfo.amount || 0) > 0 && (
                        <div className="pharm-summary-row">
                          <span>Discount</span>
                          <span>- ₱{Number(discountInfo.amount || 0).toLocaleString()}</span>
                        </div>
                      )}
                      <div className="pharm-summary-row total">
                        <span>Total Due</span>
                        <span>₱{Number(totalDue || 0).toLocaleString()}</span>
                      </div>
                    </div>

                    {posFromPrescription ? (
                      <div className="pharm-field">
                        <div className="pharm-label">Patient Billing Link</div>
                        <input
                          className="pharm-input"
                          placeholder="Search patient by name or email"
                          value={patientSearch}
                          onChange={(e) => setPatientSearch(e.target.value)}
                        />
                        {patientSearchLoading ? <div className="pharm-cart-item-note" style={{ marginTop: 6 }}>Searching patients…</div> : null}
                        {selectedPatient ? (
                          <div className="pharm-cart-item-note" style={{ marginTop: 8 }}>
                            Selected: {`${selectedPatient.first_name || ''} ${selectedPatient.last_name || ''}`.trim() || selectedPatient.email || 'Patient'}
                          </div>
                        ) : null}
                        {!selectedPatient && patientOptions.length > 0 ? (
                          <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                            {patientOptions.map((patient) => {
                              const label = `${patient.first_name || ''} ${patient.last_name || ''}`.trim() || patient.email || `Patient ${patient.id}`;
                              return (
                                <button
                                  key={patient.id}
                                  type="button"
                                  className="pharm-btn"
                                  style={{ justifyContent: 'flex-start' }}
                                  onClick={() => {
                                    setSelectedPatient(patient);
                                    setPatientSearch(label);
                                    setPatientOptions([]);
                                    setCreateBillingInvoice(true);
                                  }}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontWeight: 700, color: '#334155' }}>
                          <input
                            type="checkbox"
                            checked={createBillingInvoice}
                            onChange={(e) => setCreateBillingInvoice(e.target.checked)}
                          />
                          Create paid billing invoice for this sale
                        </label>
                      </div>
                    ) : null}

                    <div className="pharm-field">
                      <div className="pharm-label">Bulk Sale</div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontWeight: 700, color: '#334155' }}>
                        <input type="checkbox" checked={isBulkOrder} onChange={(e) => setIsBulkOrder(e.target.checked)} />
                        Enable quick add for bulk quantities
                      </label>
                      {isBulkOrder && (
                        <>
                          <div style={{ marginTop: 10, padding: 10, border: '1px solid #e2e8f0', borderRadius: 12, background: '#f8fafc' }}>
                            <div style={{ fontSize: 12, fontWeight: 900, color: '#0f172a', marginBottom: 8 }}>Quick Add (Bulk)</div>
                            <input
                              className="pharm-input"
                              placeholder="Search medicine/supply name…"
                              value={bulkQuickQuery}
                              onChange={(e) => setBulkQuickQuery(e.target.value)}
                            />
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 8, marginTop: 8 }}>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {[10, 50, 100].map((preset) => (
                                  <button
                                    key={preset}
                                    type="button"
                                    className="pharm-btn sm"
                                    onClick={() => setBulkQuickQty(preset)}
                                    style={{ padding: '6px 10px', background: Number(bulkQuickQty) === preset ? '#0f172a' : undefined, color: Number(bulkQuickQty) === preset ? '#fff' : undefined }}
                                  >
                                    +{preset}
                                  </button>
                                ))}
                              </div>
                              <input
                                className="pharm-input"
                                type="number"
                                min="1"
                                value={bulkQuickQty}
                                onChange={(e) => setBulkQuickQty(e.target.value)}
                              />
                            </div>
                            {(() => {
                              const q = String(bulkQuickQuery || '').trim().toLowerCase();
                              if (!q) return null;
                              const options = (Array.isArray(enrichedPosProducts) ? enrichedPosProducts : [])
                                .filter((p) => String(p.name || '').toLowerCase().includes(q))
                                .slice(0, 6);
                              if (options.length === 0) {
                                return <div className="pharm-cart-item-note" style={{ marginTop: 8 }}>No matches.</div>;
                              }
                              return (
                                <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                                  {options.map((p) => (
                                    <button
                                      key={`${p.type}-${p.id}`}
                                      type="button"
                                      className="pharm-btn"
                                      style={{ justifyContent: 'space-between' }}
                                      onClick={() => {
                                        addToCartWithQty(p, p.type, bulkQuickQty);
                                        setBulkQuickQuery('');
                                      }}
                                    >
                                      <span style={{ fontWeight: 900 }}>{p.name}</span>
                                      <span style={{ color: '#64748b', fontWeight: 800 }}>Stock {Number(p.stock || 0)} {String(p.unit || '').trim() || 'pcs'}</span>
                                    </button>
                                  ))}
                                </div>
                              );
                            })()}
                          </div>
                          <input
                            className="pharm-input"
                            placeholder="Bulk reference (order no., optional)"
                            value={bulkReference}
                            onChange={(e) => setBulkReference(e.target.value)}
                            style={{ marginTop: 8 }}
                          />
                          <input
                            className="pharm-input"
                            type="number"
                            placeholder="Bulk discount % (optional)"
                            value={bulkDiscountPercent}
                            onChange={(e) => setBulkDiscountPercent(e.target.value)}
                            style={{ marginTop: 8 }}
                          />
                        </>
                      )}
                    </div>

                    <div className="pharm-field">
                      <div className="pharm-label">Discount</div>
                      <div className="pharm-discount-row">
                        <select
                          className="pharm-select"
                          value={discountType}
                          onChange={(e) => {
                            const v = String(e.target.value || 'none');
                            setDiscountType(v);
                            if (v !== 'custom_percent' && v !== 'custom_amount') setDiscountValue('');
                            if (v === 'none') setDiscountRef('');
                          }}
                        >
                          <option value="none">None</option>
                          <option value="pwd">PWD (20%)</option>
                          <option value="senior">Senior (20%)</option>
                          <option value="custom_percent">Custom %</option>
                          <option value="custom_amount">Custom Amount</option>
                        </select>
                        {(discountType === 'custom_percent' || discountType === 'custom_amount') && (
                          <input
                            className="pharm-input"
                            type="number"
                            placeholder={discountType === 'custom_percent' ? 'Percent' : 'Amount'}
                            value={discountValue}
                            onChange={(e) => setDiscountValue(e.target.value)}
                          />
                        )}
                      </div>
                      {discountType !== 'none' && (
                        <input
                          className="pharm-input"
                          placeholder="Discount ID / Ref (optional)"
                          value={discountRef}
                          onChange={(e) => setDiscountRef(e.target.value)}
                        />
                      )}
                    </div>

                    <div className="pharm-field">
                      <div className="pharm-label">Payment Method</div>
                      <select className="pharm-select" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                        <option value="Cash">Cash</option>
                        <option value="GCash">GCash</option>
                        <option value="Card">Card</option>
                      </select>
                    </div>

                    <div className="pharm-field">
                      <div className="pharm-label">Payment Received</div>
                      <div className="pharm-pos-payment-box">
                        <span className="pharm-currency">₱</span>
                        <input 
                          type="number" 
                          placeholder="0.00"
                          className="pharm-payment-input"
                          value={paymentAmount}
                          onChange={(e) => setPaymentAmount(e.target.value)}
                        />
                      </div>
                    </div>

                    {paymentAmount && Number(paymentAmount) >= totalDue && (
                      <div className="pharm-summary-row change">
                        <span>Change</span>
                        <span>₱{round2(Number(paymentAmount) - Number(totalDue || 0)).toLocaleString()}</span>
                      </div>
                    )}

                    <button 
                      className="pharm-pos-checkout-btn"
                      onClick={processCheckout}
                      disabled={rxSaving || cart.length === 0 || !paymentAmount || Number(paymentAmount) < totalDue || cartValidation.blocking.length > 0}
                    >
                      {rxSaving ? 'Processing...' : (
                        <>
                          <CreditCard size={18} />
                          Complete Checkout (₱{Number(totalDue || 0).toLocaleString()})
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'medicines' && (
          <div className="pharm-card">
            <div className="pharm-card-head">
              <div className="pharm-card-title">Medicines Inventory</div>
              <div className="pharm-page">
                <button
                  type="button"
                  className="pharm-page-btn"
                  onClick={() => setMedPage((p) => Math.max(1, p - 1))}
                  disabled={pagedMedicines.currentPage <= 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={18} />
                </button>
                <div className="pharm-page-indicator">
                  <span className="pharm-page-strong">{pagedMedicines.currentPage}</span>
                  <span className="pharm-page-muted">/ {pagedMedicines.totalPages}</span>
                </div>
                <button
                  type="button"
                  className="pharm-page-btn"
                  onClick={() => setMedPage((p) => Math.min(pagedMedicines.totalPages, p + 1))}
                  disabled={pagedMedicines.currentPage >= pagedMedicines.totalPages}
                  aria-label="Next page"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
            <div className="pharm-field" style={{ marginTop: 10 }}>
              <div className="pharm-label">Scan To Restock</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <select
                  className="pharm-select"
                  value={scanMode}
                  onChange={(e) => setScanMode(e.target.value)}
                  style={{ width: 180 }}
                >
                  <option value="restock">Restock (Add)</option>
                  <option value="dispense">Dispense (Subtract)</option>
                  <option value="find">Find Only</option>
                </select>
                {scanBanner ? (
                  <div
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: 12,
                      border: '1px solid #e2e8f0',
                      fontWeight: 800,
                      background: scanBanner.type === 'error' ? '#fef2f2' : '#ecfdf5',
                      color: scanBanner.type === 'error' ? '#991b1b' : '#065f46'
                    }}
                  >
                    {scanBanner.text}
                  </div>
                ) : null}
              </div>
              <input
                ref={scanInputRef}
                className="pharm-input"
                placeholder="Scan medicine barcode…"
                value={inventoryScan}
                onChange={(e) => setInventoryScan(e.target.value)}
                onFocus={() => setInventoryFocus(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleInventoryScan('medicine');
                }}
                disabled={scanBusy}
              />
              <div className="pharm-cart-item-note" style={{ marginTop: 6 }}>
                Tip: click the box once, then scan. It will open the Adjust Stock modal.
              </div>
              {scanLog.length ? (
                <div className="pharm-cart-item-note" style={{ marginTop: 8 }}>
                  Last scans: {scanLog.slice(0, 3).map((x) => x.code).join(' • ')}
                </div>
              ) : null}
            </div>
            {loadingMeds ? (
              <div className="pharm-empty">Loading medicines…</div>
            ) : filteredMedicines.length === 0 ? (
              <div className="pharm-empty">No medicines found.</div>
            ) : (
              <div className="pharm-table-wrap">
                <table className="pharm-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Barcode</th>
                      <th>Category</th>
                      <th>Image</th>
                      <th>Stock</th>
                      <th>Status</th>
                      <th className="pharm-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedMedicines.items.map((m) => (
                      <tr key={m.id}>
                        <td className="pharm-strong">{m.name}</td>
                        <td style={{ width: 190 }}>
                          <input
                            className="pharm-input"
                            placeholder="Scan / type"
                            value={m.barcode || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setMedicines((prev) => prev.map((x) => (String(x.id) === String(m.id) ? { ...x, barcode: val } : x)));
                            }}
                            onKeyDown={async (e) => {
                              if (e.key !== 'Enter') return;
                              await saveBarcode('medicine', m.id, e.currentTarget.value);
                            }}
                            onBlur={(e) => saveBarcode('medicine', m.id, e.currentTarget.value)}
                          />
                          {(() => {
                            const st = barcodeSave?.[`medicine-${String(m.id)}`];
                            if (st?.saving) return <div className="pharm-cart-item-note">Saving…</div>;
                            if (st?.error) return <div className="pharm-cart-item-note" style={{ color: '#b91c1c' }}>{st.error}</div>;
                            if (st?.ok) return <div className="pharm-cart-item-note" style={{ color: '#065f46' }}>Saved</div>;
                            return <div className="pharm-cart-item-note">Press Enter or click outside to save</div>;
                          })()}
                        </td>
                        <td>
                          {!categoryIdsAreNumeric ? (
                            <span>{m.categoryName || m.category || '—'}</span>
                          ) : (
                            <select
                              className="pharm-select"
                              value={m.categoryId || ''}
                              onChange={async (e) => {
                                try {
                                  const nextId = e.target.value ? String(e.target.value) : null;
                                  await updateItemCategory('medicine', m.id, nextId);
                                  await fetchMedicines();
                                  await fetchPosProducts();
                                  await fetchPosCategories();
                                } catch (err) {
                                  setToast({ type: 'error', text: String(err?.message || 'Failed to update category') });
                                }
                              }}
                            >
                              <option value="">Uncategorized</option>
                              {posCategories.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td>
                          <div className="pharm-img-cell">
                            {m.image_url ? <img className="pharm-mini-img" src={m.image_url} alt={m.name} /> : <div className="pharm-mini-img placeholder" />}
                            <button type="button" className="pharm-btn sm" onClick={() => requestProductImageUpload('medicine', m.id)} disabled={imageUploading || !categoryIdsAreNumeric}>
                              Upload
                            </button>
                          </div>
                        </td>
                        <td>{m.stock ?? 0} {String(m.unit || '').trim() || 'pcs'}</td>
                        <td>
                          <span className={`pharm-badge ${String(m.status || '').toLowerCase().replace(/\s/g, '-')}`}>{m.status || '—'}</span>
                        </td>
                        <td className="pharm-right">
                          {(() => {
                            const isPending = restockRequests.some(
                              (r) =>
                                String(r.itemType || r.item_type || '').toLowerCase() === 'medicine' &&
                                String(r.itemId || r.item_id || '') === String(m.id) &&
                                String(r.status || '') === 'Pending'
                            );
                            return (
                              <div className="pharm-actions">
                                <button type="button" className="pharm-btn" onClick={() => openStockModal('medicine', m)}>Adjust</button>
                                {isPending ? (
                                  <span className="pharm-badge pending">Request Pending</span>
                                ) : (
                                  <button type="button" className="pharm-btn primary" onClick={() => openRestockRequest({ ...m, type: 'medicine' })}>
                                    Request Restock
                                  </button>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'supplies' && (
          <div className="pharm-card">
            <div className="pharm-card-head">
              <div className="pharm-card-title">Supplies Inventory</div>
              <div className="pharm-page">
                <button
                  type="button"
                  className="pharm-page-btn"
                  onClick={() => setSupPage((p) => Math.max(1, p - 1))}
                  disabled={pagedSupplies.currentPage <= 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={18} />
                </button>
                <div className="pharm-page-indicator">
                  <span className="pharm-page-strong">{pagedSupplies.currentPage}</span>
                  <span className="pharm-page-muted">/ {pagedSupplies.totalPages}</span>
                </div>
                <button
                  type="button"
                  className="pharm-page-btn"
                  onClick={() => setSupPage((p) => Math.min(pagedSupplies.totalPages, p + 1))}
                  disabled={pagedSupplies.currentPage >= pagedSupplies.totalPages}
                  aria-label="Next page"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
            <div className="pharm-field" style={{ marginTop: 10 }}>
              <div className="pharm-label">Scan To Restock</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <select
                  className="pharm-select"
                  value={scanMode}
                  onChange={(e) => setScanMode(e.target.value)}
                  style={{ width: 180 }}
                >
                  <option value="restock">Restock (Add)</option>
                  <option value="dispense">Dispense (Subtract)</option>
                  <option value="find">Find Only</option>
                </select>
                {scanBanner ? (
                  <div
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: 12,
                      border: '1px solid #e2e8f0',
                      fontWeight: 800,
                      background: scanBanner.type === 'error' ? '#fef2f2' : '#ecfdf5',
                      color: scanBanner.type === 'error' ? '#991b1b' : '#065f46'
                    }}
                  >
                    {scanBanner.text}
                  </div>
                ) : null}
              </div>
              <input
                ref={scanInputRef}
                className="pharm-input"
                placeholder="Scan supply barcode…"
                value={inventoryScan}
                onChange={(e) => setInventoryScan(e.target.value)}
                onFocus={() => setInventoryFocus(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleInventoryScan('supply');
                }}
                disabled={scanBusy}
              />
              {scanLog.length ? (
                <div className="pharm-cart-item-note" style={{ marginTop: 8 }}>
                  Last scans: {scanLog.slice(0, 3).map((x) => x.code).join(' • ')}
                </div>
              ) : null}
            </div>
            {loadingSupplies ? (
              <div className="pharm-empty">Loading supplies…</div>
            ) : filteredSupplies.length === 0 ? (
              <div className="pharm-empty">No supplies found.</div>
            ) : (
              <div className="pharm-table-wrap">
                <table className="pharm-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Barcode</th>
                      <th>Category</th>
                      <th>Image</th>
                      <th>Stock</th>
                      <th>Min Level</th>
                      <th>Status</th>
                      <th className="pharm-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedSupplies.items.map((s) => (
                      <tr key={s.id}>
                        <td className="pharm-strong">{s.item_name}</td>
                        <td style={{ width: 190 }}>
                          <input
                            className="pharm-input"
                            placeholder="Scan / type"
                            value={s.barcode || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSupplies((prev) => prev.map((x) => (String(x.id) === String(s.id) ? { ...x, barcode: val } : x)));
                            }}
                            onKeyDown={async (e) => {
                              if (e.key !== 'Enter') return;
                              await saveBarcode('supply', s.id, e.currentTarget.value);
                            }}
                            onBlur={(e) => saveBarcode('supply', s.id, e.currentTarget.value)}
                          />
                          {(() => {
                            const st = barcodeSave?.[`supply-${String(s.id)}`];
                            if (st?.saving) return <div className="pharm-cart-item-note">Saving…</div>;
                            if (st?.error) return <div className="pharm-cart-item-note" style={{ color: '#b91c1c' }}>{st.error}</div>;
                            if (st?.ok) return <div className="pharm-cart-item-note" style={{ color: '#065f46' }}>Saved</div>;
                            return <div className="pharm-cart-item-note">Press Enter or click outside to save</div>;
                          })()}
                        </td>
                        <td>
                          {!categoryIdsAreNumeric ? (
                            <span>{s.categoryName || '—'}</span>
                          ) : (
                            <select
                              className="pharm-select"
                              value={s.categoryId || ''}
                              onChange={async (e) => {
                                try {
                                  const nextId = e.target.value ? String(e.target.value) : null;
                                  await updateItemCategory('supply', s.id, nextId);
                                  await fetchSupplies();
                                  await fetchPosProducts();
                                  await fetchPosCategories();
                                } catch (err) {
                                  setToast({ type: 'error', text: String(err?.message || 'Failed to update category') });
                                }
                              }}
                            >
                              <option value="">Uncategorized</option>
                              {posCategories.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td>
                          <div className="pharm-img-cell">
                            {s.image_url ? (
                              <img className="pharm-mini-img" src={s.image_url} alt={s.item_name} />
                            ) : (
                              <div className="pharm-mini-img placeholder" />
                            )}
                            <button type="button" className="pharm-btn sm" onClick={() => requestProductImageUpload('supply', s.id)} disabled={imageUploading || !categoryIdsAreNumeric}>
                              Upload
                            </button>
                          </div>
                        </td>
                        <td>{s.stock ?? 0} {String(s.unit || '').trim() || 'pcs'}</td>
                        <td>{s.min_level ?? 10}</td>
                        <td>
                          <span className={`pharm-badge ${String(s.status || '').toLowerCase().replace(/\s/g, '-')}`}>{s.status || '—'}</span>
                        </td>
                        <td className="pharm-right">
                          {(() => {
                            const isPending = restockRequests.some(
                              (r) =>
                                String(r.itemType || r.item_type || '').toLowerCase() === 'supply' &&
                                String(r.itemId || r.item_id || '') === String(s.id) &&
                                String(r.status || '') === 'Pending'
                            );
                            return (
                              <div className="pharm-actions">
                                <button type="button" className="pharm-btn" onClick={() => openStockModal('supply', s)}>Adjust</button>
                                {isPending ? (
                                  <span className="pharm-badge pending">Request Pending</span>
                                ) : (
                                  <button type="button" className="pharm-btn primary" onClick={() => openRestockRequest({ ...s, type: 'supply', name: s.item_name })}>
                                    Request Restock
                                  </button>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}


        {activeTab === 'requests' && (
          <div className="pharm-card">
            <div className="pharm-card-title">Nurse Requests (Medication / Supply)</div>
            {loadingRequests ? (
              <div className="pharm-empty">Loading requests…</div>
            ) : pharmacyRequests.length === 0 ? (
              <div className="pharm-empty">No nurse requests found.</div>
            ) : (
              <div className="pharm-table-wrap">
                <table className="pharm-table">
                  <thead>
                    <tr>
                      <th>Patient</th>
                      <th>Type</th>
                      <th>Items</th>
                      <th className="pharm-right">Total</th>
                      <th>Requested By</th>
                      <th>Status</th>
                      <th className="pharm-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pharmacyRequests.map((r) => (
                      <tr key={r.id}>
                        <td>{r._parsed.patient || '—'}</td>
                        <td className="pharm-strong">{r._parsed.type || '—'}</td>
                        <td>
                          {(() => {
                            const items = Array.isArray(r._parsed.items) ? r._parsed.items : [];
                            if (items.length === 0) return r._parsed.item || '—';
                            const parts = items.map((it) => `${String(it.name || 'Item')} x${Number(it.qty || 1)}`).slice(0, 2);
                            const extra = items.length > 2 ? ` +${items.length - 2} more` : '';
                            return `${parts.join(', ')}${extra}`;
                          })()}
                        </td>
                        <td className="pharm-right">₱{round2(Number(r._parsed.totalAmount || 0)).toLocaleString()}</td>
                        <td>{r.requested_by || '—'}</td>
                        <td>
                          <span className={`pharm-badge ${String(r.status || '').toLowerCase().replace(/\s/g, '-')}`}>{r.status || 'Pending'}</span>
                        </td>
                        <td className="pharm-right">
                          <div className="pharm-actions">
                            {String(r.status || '').toLowerCase() !== 'completed' && (
                              <>
                                <button type="button" className="pharm-btn" onClick={() => updateRequestStatus(r.id, 'Processing')}>Process</button>
                                <button type="button" className="pharm-btn primary" onClick={() => fulfillRequest(r)}>Fulfill</button>
                              </>
                            )}
                            {String(r.status || '').toLowerCase() === 'completed' && (
                              <span className="pharm-done"><CheckCircle2 size={16} /> Done</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'restocks' && (
          <div className="pharm-card">
            <div className="pharm-card-title">Low Stock Alerts & Requests</div>
            <div className="pharm-modal-text" style={{ marginBottom: '16px' }}>
              Items below minimum level are listed here. Send a request to Admin for approval.
            </div>
            <div className="pharm-actions" style={{ marginBottom: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 900, color: '#334155' }}>
                  <input type="checkbox" checked={allLowStockSelected} onChange={toggleSelectAllLowStock} />
                  Select All
                </label>
                <span className="pharm-badge" style={{ background: '#f1f5f9', color: '#334155' }}>
                  Selected: {lowStockSelectedCount}
                </span>
                <button
                  type="button"
                  className="pharm-btn primary"
                  onClick={requestSelectedRestocks}
                  disabled={restockRequestSaving || lowStockSelectedCount === 0}
                >
                  Request Selected
                </button>
              </div>
              {lowStockItems.length > 5 ? (
                <div className="patient-pagination" style={{ margin: 0 }}>
                  <button
                    type="button"
                    className="patient-page-btn"
                    disabled={lowStockPage === 1}
                    onClick={() => setLowStockPage(Math.max(1, lowStockPage - 1))}
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    type="button"
                    className="patient-page-btn"
                    disabled={lowStockPage >= Math.max(1, Math.ceil(lowStockItems.length / 5))}
                    onClick={() => setLowStockPage(lowStockPage + 1)}
                    aria-label="Next page"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              ) : null}
            </div>
            {lowStockItems.length === 0 ? (
              <div className="pharm-empty">No low stock items detected.</div>
            ) : (
              <>
                <div className="pharm-table-wrap">
                  <table className="pharm-table">
                    <thead>
                      <tr>
                        <th style={{ width: 40 }} />
                        <th>Item</th>
                        <th>Type</th>
                        <th>Current Stock</th>
                        <th>Status</th>
                        <th className="pharm-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lowStockItems.slice((lowStockPage - 1) * 5, lowStockPage * 5).map((item) => {
                        const isPending = restockRequests.some(
                          (r) => String(r.itemId || r.item_id || '') === String(item.id) && String(r.status || '') === 'Pending'
                        );
                        return (
                          <tr key={`${item.type}-${item.id}`}>
                            <td>
                              <input
                                type="checkbox"
                                checked={Boolean(lowStockSelected[lowStockKey(item)])}
                                onChange={() => toggleLowStock(item)}
                                disabled={isPending}
                              />
                            </td>
                            <td className="pharm-strong">{item.name}</td>
                            <td>{item.type}</td>
                            <td>{item.stock} {String(item.unit || '').trim() || 'pcs'}</td>
                            <td>
                              <span className={`pharm-badge ${item.stock <= 0 ? 'out-of-stock' : 'low-stock'}`}>
                                {item.stock <= 0 ? 'Out of Stock' : 'Low Stock'}
                              </span>
                            </td>
                            <td className="pharm-right">
                              {isPending ? (
                                <span className="pharm-badge pending">Request Pending</span>
                              ) : (
                                <button 
                                  type="button" 
                                  className="pharm-btn primary" 
                                  onClick={() => openRestockRequest(item)}
                                >
                                  Request Restock
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="pharm-divider" style={{ margin: '32px 0' }} />
            
            <div className="pharm-card-title">Approved Restocks (Ready to Fulfill)</div>
            <div className="pharm-modal-text" style={{ marginBottom: '16px' }}>
              Admin has approved these requests. Click Fulfill once you receive the items.
            </div>
            {restockRequests.filter(r => r.status === 'Approved').length === 0 ? (
              <div className="pharm-empty">No approved restocks to fulfill.</div>
            ) : (
              <div className="pharm-table-wrap">
                <table className="pharm-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                      <th>Approved By</th>
                      <th className="pharm-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {restockRequests.filter(r => r.status === 'Approved').map(r => (
                      <tr key={r.id}>
                        <td className="pharm-strong">{r.item_name || r.itemName}</td>
                        <td>{r.requestedQty || r.requested_qty}</td>
                        <td>{r.fulfilled_by || r.fulfilledBy || 'Admin'}</td>
                        <td className="pharm-right">
                          <button type="button" className="pharm-btn primary" onClick={() => openRestockFulfill(r)}>
                            Fulfill & Add Stock
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="pharm-divider" style={{ margin: '32px 0' }} />
            
            <div className="pharm-card-title">Recent Request History</div>
            <div className="pharm-table-wrap">
              <table className="pharm-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {restockRequests.slice(0, 10).map(r => (
                    <tr key={r.id}>
                      <td>{r.item_name || r.itemName}</td>
                      <td>{r.requestedQty || r.requested_qty}</td>
                      <td>{new Date(r.createdAt || r.created_at).toLocaleDateString()}</td>
                      <td>
                        <span className={`pharm-badge ${String(r.status).toLowerCase()}`}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'sales' && (
          <div className="pharm-card">
            <div className="pharm-card-head">
              <div className="pharm-card-title">Sales Reports</div>
              <div className="pharm-actions">
                <button type="button" className="pharm-btn" onClick={() => fetchSalesReports({ page: 1 })} disabled={salesLoading}>
                  Refresh
                </button>
                <button
                  type="button"
                  className="pharm-btn"
                  disabled={salesLoading || salesExporting || Number(salesTotal || 0) <= 0}
                  onClick={exportTransactionsCsvAll}
                >
                  CSV (Transactions)
                </button>
                <button
                  type="button"
                  className="pharm-btn"
                  disabled={salesLoading || salesExporting || Number(salesTotal || 0) <= 0}
                  onClick={exportItemizedCsvAll}
                >
                  CSV (Itemized)
                </button>
                <button
                  type="button"
                  className="pharm-btn"
                  disabled={!Array.isArray(salesItems) || salesItems.length === 0}
                  onClick={() => {
                    const rows = [
                      ['Item', 'Type', 'Qty', 'Revenue', 'Discount Impact', 'Estimated Net'],
                      ...(salesItems || []).map((r) => [
                        r.item_name || '',
                        r.item_type || '',
                        Number(r.quantity || 0),
                        round2(Number(r.revenue || 0)),
                        round2(Number(r.discount_impact || 0)),
                        round2(Number(r.estimated_net || 0))
                      ])
                    ];
                    downloadCsv(`sales_items_${new Date().toISOString().slice(0, 10)}.csv`, rows);
                  }}
                >
                  CSV (Items)
                </button>
                <button
                  type="button"
                  className="pharm-btn"
                  disabled={salesLoading || !salesSummary}
                  onClick={submitSalesToAdmin}
                >
                  Submit to Admin
                </button>
                <button
                  type="button"
                  className="pharm-btn primary"
                  onClick={async () => {
                    const rng = buildUtcRange(salesPreset, salesFrom, salesTo);
                    const title = `Sales Report`;
                    const meta = `<div class="meta">Range: ${rng.fromDate} to ${rng.toDate} • Generated: ${new Date().toLocaleString()}</div>`;
                    if (salesTab === 'summary') {
                      const s = salesSummary || {};
                      const top = Array.isArray(s.top_items) ? s.top_items : [];
                      const html = `
                        <h1>${title} (Daily Summary)</h1>
                        ${meta}
                        <table>
                          <tbody>
                            <tr><th>Gross Sales</th><td>₱${round2(Number(s.gross_sales || 0)).toLocaleString()}</td></tr>
                            <tr><th>Discounts Total</th><td>₱${round2(Number(s.discounts_total || 0)).toLocaleString()}</td></tr>
                            <tr><th>Net Sales</th><td>₱${round2(Number(s.net_sales || 0)).toLocaleString()}</td></tr>
                            <tr><th># Transactions</th><td>${Number(s.transactions_count || 0)}</td></tr>
                          </tbody>
                        </table>
                        <h1 style="margin-top:18px;">Top Items</h1>
                        <table>
                          <thead><tr><th>Item</th><th>Type</th><th>Qty</th><th>Revenue</th></tr></thead>
                          <tbody>
                            ${top
                              .map(
                                (r) =>
                                  `<tr><td>${String(r.item_name || '')}</td><td>${String(r.item_type || '')}</td><td>${Number(r.quantity || 0)}</td><td>₱${round2(Number(r.revenue || 0)).toLocaleString()}</td></tr>`
                              )
                              .join('')}
                          </tbody>
                        </table>
                      `;
                      return printSalesReport(title, html);
                    }
                    if (salesTab === 'transactions') {
                      const allTx = await fetchAllSalesTransactions({ includeItems: false });
                      const txList = Array.isArray(allTx?.items) ? allTx.items : [];
                      const html = `
                        <h1>${title} (Transactions)</h1>
                        ${meta}
                        <table>
                          <thead><tr><th>Transaction #</th><th>Date/Time</th><th>Pharmacist</th><th>Subtotal</th><th>Discount</th><th>Total Due</th><th>Payment</th><th>Change</th></tr></thead>
                          <tbody>
                            ${(txList || [])
                              .map(
                                (t) =>
                                  `<tr>
                                    <td>${String(t.transaction_no || '')}</td>
                                    <td>${t.created_at ? new Date(t.created_at).toLocaleString() : ''}</td>
                                    <td>${String(t.pharmacist_name || '')}</td>
                                    <td>₱${round2(Number(t.subtotal || 0)).toLocaleString()}</td>
                                    <td>₱${round2(Number(t.discount_amount || 0)).toLocaleString()}</td>
                                    <td>₱${round2(Number(t.total_due || 0)).toLocaleString()}</td>
                                    <td>₱${round2(Number(t.payment_received || 0)).toLocaleString()}</td>
                                    <td>₱${round2(Number(t.change_amount || 0)).toLocaleString()}</td>
                                  </tr>`
                              )
                              .join('')}
                          </tbody>
                        </table>
                      `;
                      return printSalesReport(title, html);
                    }
                    const html = `
                      <h1>${title} (Items Sold)</h1>
                      ${meta}
                      <table>
                        <thead><tr><th>Item</th><th>Type</th><th>Qty</th><th>Revenue</th><th>Discount Impact</th><th>Estimated Net</th></tr></thead>
                        <tbody>
                          ${(salesItems || [])
                            .map(
                              (r) =>
                                `<tr>
                                  <td>${String(r.item_name || '')}</td>
                                  <td>${String(r.item_type || '')}</td>
                                  <td>${Number(r.quantity || 0)}</td>
                                  <td>₱${round2(Number(r.revenue || 0)).toLocaleString()}</td>
                                  <td>₱${round2(Number(r.discount_impact || 0)).toLocaleString()}</td>
                                  <td>₱${round2(Number(r.estimated_net || 0)).toLocaleString()}</td>
                                </tr>`
                            )
                            .join('')}
                        </tbody>
                      </table>
                    `;
                    return printSalesReport(title, html);
                  }}
                  disabled={salesLoading || salesExporting}
                >
                  Print
                </button>
              </div>
            </div>

            <div className="pharm-sales-toolbar">
              <div className="pharm-sales-filters">
                <div className="pharm-field">
                  <div className="pharm-label">Date Range</div>
                  <select
                    className="pharm-select"
                    value={salesPreset}
                    onChange={(e) => {
                      const v = String(e.target.value || 'today');
                      setSalesPreset(v);
                      if (v !== 'custom') {
                        setSalesFrom('');
                        setSalesTo('');
                      }
                    }}
                  >
                    <option value="today">Today</option>
                    <option value="yesterday">Yesterday</option>
                    <option value="week">This Week</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>

                {salesPreset === 'custom' && (
                  <>
                    <div className="pharm-field">
                      <div className="pharm-label">From</div>
                      <input className="pharm-input" type="date" value={salesFrom} onChange={(e) => setSalesFrom(e.target.value)} />
                    </div>
                    <div className="pharm-field">
                      <div className="pharm-label">To</div>
                      <input className="pharm-input" type="date" value={salesTo} onChange={(e) => setSalesTo(e.target.value)} />
                    </div>
                  </>
                )}

                <div className="pharm-field">
                  <div className="pharm-label">Search</div>
                  <input className="pharm-input" placeholder="Transaction # or keyword" value={salesQuery} onChange={(e) => setSalesQuery(e.target.value)} />
                </div>

                <div className="pharm-field">
                  <div className="pharm-label">Pharmacist</div>
                  <input className="pharm-input" placeholder="Name" value={salesPharmacist} onChange={(e) => setSalesPharmacist(e.target.value)} />
                </div>

                <div className="pharm-field">
                  <div className="pharm-label">Discount</div>
                  <select className="pharm-select" value={salesDiscountType} onChange={(e) => setSalesDiscountType(e.target.value)}>
                    <option value="all">All</option>
                    <option value="none">None</option>
                    <option value="pwd">PWD</option>
                    <option value="senior">Senior</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>

                <div className="pharm-field">
                  <div className="pharm-label">Payment Min</div>
                  <input className="pharm-input" type="number" placeholder="0" value={salesPayMin} onChange={(e) => setSalesPayMin(e.target.value)} />
                </div>

                <div className="pharm-field">
                  <div className="pharm-label">Payment Max</div>
                  <input className="pharm-input" type="number" placeholder="0" value={salesPayMax} onChange={(e) => setSalesPayMax(e.target.value)} />
                </div>

                <div className="pharm-field">
                  <div className="pharm-label"> </div>
                  <button type="button" className="pharm-btn primary" onClick={() => fetchSalesReports({ page: 1 })} disabled={salesLoading}>
                    Apply
                  </button>
                </div>
              </div>

              <div className="pharm-sales-tabs">
                <button type="button" className={`pharm-tab ${salesTab === 'summary' ? 'active' : ''}`} onClick={() => setSalesTab('summary')}>
                  Daily Summary
                </button>
                <button type="button" className={`pharm-tab ${salesTab === 'transactions' ? 'active' : ''}`} onClick={() => setSalesTab('transactions')}>
                  Transactions
                </button>
                <button type="button" className={`pharm-tab ${salesTab === 'items' ? 'active' : ''}`} onClick={() => setSalesTab('items')}>
                  Items Sold
                </button>
              </div>
            </div>

            {salesError ? <div className="pharm-empty">{salesError}</div> : null}
            {salesLoading ? (
              <div className="pharm-empty">Loading sales reports…</div>
            ) : salesTab === 'summary' ? (
              <>
                <div className="pharm-table-wrap">
                  <table className="pharm-table">
                    <tbody>
                      <tr>
                        <td className="pharm-strong">Gross Sales</td>
                        <td>₱{round2(Number(salesSummary?.gross_sales || 0)).toLocaleString()}</td>
                      </tr>
                      <tr>
                        <td className="pharm-strong">Discounts Total</td>
                        <td>₱{round2(Number(salesSummary?.discounts_total || 0)).toLocaleString()}</td>
                      </tr>
                      <tr>
                        <td className="pharm-strong">Net Sales</td>
                        <td>₱{round2(Number(salesSummary?.net_sales || 0)).toLocaleString()}</td>
                      </tr>
                      <tr>
                        <td className="pharm-strong"># Transactions</td>
                        <td>{Number(salesSummary?.transactions_count || 0)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="pharm-divider" />

                <div className="pharm-card-title">Top 5 Items</div>
                <div className="pharm-table-wrap">
                  <table className="pharm-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Type</th>
                        <th>Qty</th>
                        <th className="pharm-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Array.isArray(salesSummary?.top_items) ? salesSummary.top_items : []).map((r, idx) => (
                        <tr key={idx}>
                          <td className="pharm-strong">{r.item_name}</td>
                          <td>{r.item_type}</td>
                          <td>{Number(r.quantity || 0)}</td>
                          <td className="pharm-right">₱{round2(Number(r.revenue || 0)).toLocaleString()}</td>
                        </tr>
                      ))}
                      {(Array.isArray(salesSummary?.top_items) ? salesSummary.top_items : []).length === 0 ? (
                        <tr>
                          <td colSpan="4" className="pharm-empty">No data for selected range.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            ) : salesTab === 'transactions' ? (
              <>
                <div className="pharm-card-head" style={{ padding: 0, marginBottom: 10 }}>
                  <div className="pharm-page" style={{ marginLeft: 'auto' }}>
                    <button
                      type="button"
                      className="pharm-page-btn"
                      onClick={() => fetchSalesReports({ page: Math.max(1, salesPage - 1) })}
                      disabled={salesPage <= 1 || salesLoading}
                      aria-label="Previous page"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <div className="pharm-page-indicator">
                      <span className="pharm-page-strong">{salesPage}</span>
                      <span className="pharm-page-muted">/ {Math.max(1, Math.ceil((salesTotal || 0) / 20))}</span>
                    </div>
                    <button
                      type="button"
                      className="pharm-page-btn"
                      onClick={() => fetchSalesReports({ page: Math.min(Math.max(1, Math.ceil((salesTotal || 0) / 20)), salesPage + 1) })}
                      disabled={salesPage >= Math.max(1, Math.ceil((salesTotal || 0) / 20)) || salesLoading}
                      aria-label="Next page"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </div>

                <div className="pharm-table-wrap">
                  <table className="pharm-table">
                    <thead>
                      <tr>
                        <th>Transaction #</th>
                        <th>Date/Time</th>
                        <th>Pharmacist</th>
                        <th className="pharm-right">Subtotal</th>
                        <th className="pharm-right">Discount</th>
                        <th className="pharm-right">Total Due</th>
                        <th className="pharm-right">Payment</th>
                        <th className="pharm-right">Change</th>
                        <th className="pharm-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(salesTransactions || []).map((t) => (
                        <tr key={String(t.id)}>
                          <td className="pharm-strong">
                            <button type="button" className="pharm-btn-text" onClick={() => openSaleDetails(t.id)} disabled={saleDetailsLoading}>
                              {t.transaction_no}
                            </button>
                          </td>
                          <td>{t.created_at ? new Date(t.created_at).toLocaleString() : '—'}</td>
                          <td>{t.pharmacist_name || '—'}</td>
                          <td className="pharm-right">₱{round2(Number(t.subtotal || 0)).toLocaleString()}</td>
                          <td className="pharm-right">₱{round2(Number(t.discount_amount || 0)).toLocaleString()}</td>
                          <td className="pharm-right">₱{round2(Number(t.total_due || 0)).toLocaleString()}</td>
                          <td className="pharm-right">₱{round2(Number(t.payment_received || 0)).toLocaleString()}</td>
                          <td className="pharm-right">₱{round2(Number(t.change_amount || 0)).toLocaleString()}</td>
                          <td className="pharm-right">
                            <button type="button" className="pharm-btn" onClick={() => openReceiptFromSale(t.id)}>
                              Reprint
                            </button>
                          </td>
                        </tr>
                      ))}
                      {(salesTransactions || []).length === 0 ? (
                        <tr>
                          <td colSpan="9" className="pharm-empty">No transactions found.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <div className="pharm-modal-text" style={{ marginBottom: 12 }}>
                  Discounts total: ₱{round2(Number(salesItemsMeta?.discounts_total || 0)).toLocaleString()}
                </div>
                <div className="pharm-table-wrap">
                  <table className="pharm-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Type</th>
                        <th>Qty</th>
                        <th className="pharm-right">Revenue</th>
                        <th className="pharm-right">Discount Impact</th>
                        <th className="pharm-right">Estimated Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(salesItems || []).map((r, idx) => (
                        <tr key={idx}>
                          <td className="pharm-strong">{r.item_name}</td>
                          <td>{r.item_type}</td>
                          <td>{Number(r.quantity || 0)}</td>
                          <td className="pharm-right">₱{round2(Number(r.revenue || 0)).toLocaleString()}</td>
                          <td className="pharm-right">₱{round2(Number(r.discount_impact || 0)).toLocaleString()}</td>
                          <td className="pharm-right">₱{round2(Number(r.estimated_net || 0)).toLocaleString()}</td>
                        </tr>
                      ))}
                      {(salesItems || []).length === 0 ? (
                        <tr>
                          <td colSpan="6" className="pharm-empty">No items found.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </main>

    {toast && (
        <div className={`pharm-toast ${toast.type}`}>
          {toast.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          <span>{toast.text}</span>
        </div>
      )}

      {restockRequestModal && (
        <div className="pharm-modal-overlay" onClick={() => (restockRequestSaving ? null : setRestockRequestModal(null))}>
          <div className="pharm-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="pharm-modal-head">
              <div className="pharm-modal-title">Request Restock</div>
              <button className="pharm-icon-btn" type="button" onClick={() => (restockRequestSaving ? null : setRestockRequestModal(null))}>
                <X size={18} />
              </button>
            </div>
            <div className="pharm-modal-body">
              <div className="pharm-modal-row">
                <div className="pharm-label">Item</div>
                <div className="pharm-value">{restockRequestModal.itemName || '—'}</div>
              </div>
              <div className="pharm-modal-grid">
                <div className="pharm-field">
                  <div className="pharm-label">Type</div>
                  <div className="pharm-value">{String(restockRequestModal.itemType || '').toUpperCase() || '—'}</div>
                </div>
                <div className="pharm-field">
                  <div className="pharm-label">Item ID</div>
                  <div className="pharm-value">{String(restockRequestModal.itemId ?? '—')}</div>
                </div>
                <div className="pharm-field">
                  <div className="pharm-label">Current Stock</div>
                  <div className="pharm-value">{Number(restockRequestModal.stock || 0)}</div>
                </div>
                <div className="pharm-field">
                  <div className="pharm-label">Min Level</div>
                  <div className="pharm-value">{Number(restockRequestModal.minLevel || 0)}</div>
                </div>
              </div>
              <div className="pharm-field" style={{ marginTop: 12 }}>
                <div className="pharm-label">Requested Quantity</div>
                <input
                  type="number"
                  min={1}
                  className="pharm-input"
                  value={restockRequestQty}
                  onChange={(e) => setRestockRequestQty(e.target.value)}
                  disabled={restockRequestSaving}
                />
              </div>
            </div>
            <div className="pharm-modal-actions">
              <button type="button" className="pharm-btn" onClick={() => setRestockRequestModal(null)} disabled={restockRequestSaving}>
                Cancel
              </button>
              <button type="button" className="pharm-btn primary" onClick={submitRestockRequest} disabled={restockRequestSaving}>
                {restockRequestSaving ? 'Sending…' : 'Send Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {restockFulfillModal && (
        <div className="pharm-modal-overlay" onClick={() => (restockSaving ? null : setRestockFulfillModal(null))}>
          <div className="pharm-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="pharm-modal-head">
              <div className="pharm-modal-title">Fulfill Restock</div>
              <button className="pharm-icon-btn" type="button" onClick={() => (restockSaving ? null : setRestockFulfillModal(null))}>
                <X size={18} />
              </button>
            </div>
            <div className="pharm-modal-body">
              <div className="pharm-modal-row">
                <div className="pharm-label">Item</div>
                <div className="pharm-value">{restockFulfillModal.item_name || restockFulfillModal.itemName || '—'}</div>
              </div>
              <div className="pharm-modal-grid">
                <div className="pharm-field">
                  <div className="pharm-label">Requested Qty</div>
                  <div className="pharm-value">{restockFulfillModal.requestedQty || restockFulfillModal.requested_qty || 0}</div>
                </div>
                <div className="pharm-field">
                  <div className="pharm-label">Delivered Qty</div>
                  <input type="number" min={1} value={restockFulfillQty} onChange={(e) => setRestockFulfillQty(e.target.value)} className="pharm-input" />
                </div>
              </div>
            </div>
            <div className="pharm-modal-actions">
              <button type="button" className="pharm-btn" onClick={() => setRestockFulfillModal(null)} disabled={restockSaving}>Cancel</button>
              <button type="button" className="pharm-btn primary" onClick={fulfillRestock} disabled={restockSaving}>
                {restockSaving ? 'Saving…' : 'Complete & Add Stock'}
              </button>
            </div>
          </div>
        </div>
      )}

      {stockModal && (
        <div className="pharm-modal-overlay" onClick={() => (stockSaving ? null : setStockModal(null))}>
          <div className="pharm-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="pharm-modal-head">
              <div className="pharm-modal-title">Adjust Stock</div>
              <button className="pharm-icon-btn" type="button" onClick={() => (stockSaving ? null : setStockModal(null))}>
                <X size={18} />
              </button>
            </div>
            <div className="pharm-modal-body">
              <div className="pharm-modal-row">
                <div className="pharm-label">Item</div>
                <div className="pharm-value">{stockModal.kind === 'medicine' ? stockModal.item.name : stockModal.item.item_name}</div>
              </div>
              <div className="pharm-modal-row">
                <div className="pharm-label">Unit</div>
                <div className="pharm-value">{String(stockModal.item.unit || '').trim() || 'pcs'}</div>
              </div>
              <div className="pharm-modal-row">
                <div className="pharm-label">Current Stock</div>
                <div className="pharm-value">
                  {Number(stockModal.item.stock ?? 0)} {String(stockModal.item.unit || '').trim() || 'pcs'}
                </div>
              </div>
              <div className="pharm-modal-grid">
                <div className="pharm-field">
                  <div className="pharm-label">Mode</div>
                  <select value={stockMode} onChange={(e) => setStockMode(e.target.value)} className="pharm-input">
                    <option value="add">Add</option>
                    <option value="remove">Remove</option>
                  </select>
                </div>
                <div className="pharm-field">
                  <div className="pharm-label">Quantity ({String(stockModal.item.unit || '').trim() || 'pcs'})</div>
                  <input type="number" min={1} value={stockQty} onChange={(e) => setStockQty(e.target.value)} className="pharm-input" />
                </div>
                <div className="pharm-field">
                  <div className="pharm-label">Reason</div>
                  <select value={movementReason} onChange={(e) => setMovementReason(e.target.value)} className="pharm-input">
                    <option value="restock">Restock</option>
                    <option value="dispense">Dispense</option>
                    <option value="manual">Manual</option>
                  </select>
                </div>
                <div className="pharm-field">
                  <div className="pharm-label">Lot (Optional)</div>
                  <input value={movementLot} onChange={(e) => setMovementLot(e.target.value)} className="pharm-input" placeholder="Lot / batch" />
                </div>
                <div className="pharm-field" style={{ gridColumn: '1 / -1' }}>
                  <div className="pharm-label">Expiry (Optional)</div>
                  <input type="date" value={movementExpiry} onChange={(e) => setMovementExpiry(e.target.value)} className="pharm-input" />
                </div>
              </div>

              {recentMovements.length ? (
                <div style={{ marginTop: 10 }}>
                  <div className="pharm-label">Recent Movements</div>
                  <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                    {recentMovements.slice(0, 5).map((mv) => (
                      <div key={mv.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                        <div className="pharm-cart-item-note">
                          {new Date(mv.created_at).toLocaleString()} • {mv.reason} • {Number(mv.delta) > 0 ? `+${mv.delta}` : mv.delta}
                        </div>
                        <button type="button" className="pharm-btn sm" disabled={undoBusy} onClick={() => undoMovement(mv.id)}>
                          Undo
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="pharm-modal-actions">
              <button type="button" className="pharm-btn" onClick={() => setStockModal(null)} disabled={stockSaving}>Cancel</button>
              <button type="button" className="pharm-btn primary" onClick={saveStock} disabled={stockSaving}>
                {stockSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {rxModal && (
        <div className="pharm-modal-overlay" onClick={() => (rxSaving ? null : setRxModal(null))}>
          <div className="pharm-modal-card wide" onClick={(e) => e.stopPropagation()}>
            <div className="pharm-modal-head">
              <div className="pharm-modal-title">Dispense Prescription</div>
              <button className="pharm-icon-btn" type="button" onClick={() => (rxSaving ? null : setRxModal(null))}>
                <X size={18} />
              </button>
            </div>
            <div className="pharm-modal-body">
              <div className="pharm-modal-row">
                <div className="pharm-label">Patient</div>
                <div className="pharm-value">{rxModal.patientName || '—'}</div>
              </div>
              <div className="pharm-modal-row">
                <div className="pharm-label">Doctor</div>
                <div className="pharm-value">{rxModal.doctorName || rxModal.doctor_name || '—'}</div>
              </div>
              <div className="pharm-divider" />
              <div className="pharm-rx-list">
                {(Array.isArray(rxModal.items) ? rxModal.items : []).map((it, idx) => (
                  <div key={`${rxModal.id}-${idx}`} className="pharm-rx-item">
                    <div className="pharm-rx-main">
                      <div className="pharm-rx-med">{it.medication}</div>
                      <div className="pharm-rx-sub">{[it.dosage, it.frequency, it.duration].filter(Boolean).join(' • ')}</div>
                    </div>
                    <div className="pharm-rx-qty">
                      <div className="pharm-label">Qty</div>
                      <input
                        type="number"
                        min={1}
                        className="pharm-input"
                        value={rxQuantities[idx] || 1}
                        onChange={(e) => setRxQuantities((prev) => ({ ...prev, [idx]: e.target.value }))}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="pharm-modal-actions">
              <button type="button" className="pharm-btn" onClick={() => setRxModal(null)} disabled={rxSaving}>Cancel</button>
              <button type="button" className="pharm-btn primary" onClick={fulfillPrescription} disabled={rxSaving}>
                {rxSaving ? 'Dispensing…' : 'Dispense & Deduct Stock'}
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={categoryImageInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files && e.target.files[0];
          e.target.value = '';
          if (!file || !categoryImageTargetId) return;
          setImageUploading(true);
          try {
            const url = await uploadCategoryImage(file);
            await setCategoryImage(categoryImageTargetId, url);
            await fetchPosCategories();
            await fetchPosProducts();
            await fetchMedicines();
            await fetchSupplies();
            setToast({ type: 'success', text: 'Category image updated.' });
          } catch (err) {
            setToast({ type: 'error', text: String(err?.message || 'Upload failed') });
          } finally {
            setImageUploading(false);
            setCategoryImageTargetId(null);
          }
        }}
      />
      <input
        ref={productImageInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files && e.target.files[0];
          e.target.value = '';
          if (!file || !productImageTarget) return;
          setImageUploading(true);
          try {
            await uploadProductImage(productImageTarget, file);
            await fetchPosProducts();
            await fetchMedicines();
            await fetchSupplies();
            setToast({ type: 'success', text: 'Product image updated.' });
          } catch (err) {
            setToast({ type: 'error', text: String(err?.message || 'Upload failed') });
          } finally {
            setImageUploading(false);
            setProductImageTarget(null);
          }
        }}
      />

      {showCategoryManager && (
        <div className="pharm-modal-overlay">
          <div className="pharm-modal-card wide" onClick={(e) => e.stopPropagation()}>
            <div className="pharm-modal-head">
              <div className="pharm-modal-title flex-row gap-8">
                <FileText size={20} />
                Manage Categories
              </div>
              <button className="pharm-icon-btn" type="button" onClick={() => setShowCategoryManager(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="pharm-modal-body">
              <div className="pharm-modal-grid">
                <div className="pharm-field">
                  <div className="pharm-label">New Category</div>
                  <input
                    className="pharm-input"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="Category name"
                  />
                </div>
                <div className="pharm-field">
                  <div className="pharm-label">Actions</div>
                  <div className="flex-row gap-8">
                    <button type="button" className="pharm-btn primary" onClick={createCategory} disabled={categorySaving}>
                      {categorySaving ? 'Saving…' : 'Create'}
                    </button>
                    <button type="button" className="pharm-btn" onClick={() => fetchPosCategories()} disabled={categorySaving || imageUploading}>
                      <RefreshCw size={18} /> Refresh
                    </button>
                  </div>
                </div>
              </div>

              {categoryError ? <div className="pharm-empty" style={{ marginTop: 10 }}>{categoryError}</div> : null}

              <div className="pharm-table-wrap" style={{ marginTop: 12, maxHeight: 420, overflowY: 'auto' }}>
                <table className="pharm-table">
                  <thead>
                    <tr>
                      <th>Image</th>
                      <th>Name</th>
                      <th>Available</th>
                      <th className="pharm-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {posCategories.length === 0 ? (
                      <tr>
                        <td colSpan="4" className="pharm-empty">No categories.</td>
                      </tr>
                    ) : (
                      posCategories.map((c) => (
                        <tr key={c.id}>
                          <td>{c.image_url ? <img className="pharm-mini-img" src={c.image_url} alt={c.name} /> : <div className="pharm-mini-img placeholder" />}</td>
                          <td className="pharm-strong">{c.name}</td>
                          <td>{Number(c.available_count || 0)}</td>
                          <td className="pharm-right">
                            <button type="button" className="pharm-btn sm" onClick={() => requestCategoryImageUpload(c.id)} disabled={imageUploading}>
                              Upload Image
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="pharm-modal-actions">
              <button type="button" className="pharm-btn" onClick={() => setShowCategoryManager(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showAddProductModal && (
        <div className="pharm-modal-overlay">
          <div className="pharm-modal-card wide" onClick={(e) => e.stopPropagation()}>
            <div className="pharm-modal-head">
              <div className="pharm-modal-title flex-row gap-8">
                <Plus size={20} />
                Add New Product
              </div>
              <button className="pharm-icon-btn" type="button" onClick={() => setShowAddProductModal(false)} disabled={productSaving}>
                <X size={18} />
              </button>
            </div>

            <div className="pharm-modal-body">
              {productError ? <div className="pharm-empty" style={{ marginBottom: 10 }}>{productError}</div> : null}
              <div className="pharm-modal-grid">
                <div className="pharm-field">
                  <div className="pharm-label">Type</div>
                  <select
                    className="pharm-select"
                    value={newProductForm.type}
                    onChange={(e) => setNewProductForm((p) => ({ ...p, type: e.target.value }))}
                  >
                    <option value="medicine">Medicine</option>
                    <option value="supply">Supply</option>
                  </select>
                </div>
                <div className="pharm-field">
                  <div className="pharm-label">Barcode</div>
                  <input
                    ref={barcodeInputRef}
                    className="pharm-input"
                    value={newProductForm.barcode}
                    onChange={(e) => setNewProductForm((p) => ({ ...p, barcode: e.target.value }))}
                    placeholder="Scan / type barcode"
                  />
                </div>
                <div className="pharm-field">
                  <div className="pharm-label">Category</div>
                  <select
                    className="pharm-select"
                    value={newProductForm.categoryId}
                    onChange={(e) => setNewProductForm((p) => ({ ...p, categoryId: e.target.value }))}
                  >
                    <option value="all">Uncategorized</option>
                    {(posCategories || []).map((c) => (
                      <option key={`cat-${c.id}`} value={String(c.id)}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="pharm-field" style={{ gridColumn: '1 / -1' }}>
                  <div className="pharm-label">Product Name</div>
                  <input
                    className="pharm-input"
                    value={newProductForm.name}
                    onChange={(e) => setNewProductForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g., Amoxicillin 500mg / Sterile Gloves"
                  />
                </div>
                <div className="pharm-field">
                  <div className="pharm-label">Stock</div>
                  <input
                    className="pharm-input"
                    type="number"
                    min="0"
                    value={newProductForm.stock}
                    onChange={(e) => setNewProductForm((p) => ({ ...p, stock: e.target.value }))}
                  />
                </div>
                <div className="pharm-field">
                  <div className="pharm-label">Min Level</div>
                  <input
                    className="pharm-input"
                    type="number"
                    min="0"
                    value={newProductForm.minLevel}
                    onChange={(e) => setNewProductForm((p) => ({ ...p, minLevel: e.target.value }))}
                  />
                </div>
                <div className="pharm-field">
                  <div className="pharm-label">Unit</div>
                  <input
                    className="pharm-input"
                    value={newProductForm.unit}
                    onChange={(e) => setNewProductForm((p) => ({ ...p, unit: e.target.value }))}
                    placeholder="box / bottle / piece"
                  />
                </div>
                <div className="pharm-field">
                  <div className="pharm-label">Price</div>
                  <input
                    className="pharm-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={newProductForm.price}
                    onChange={(e) => setNewProductForm((p) => ({ ...p, price: e.target.value }))}
                    placeholder="₱"
                  />
                </div>
              </div>
            </div>

            <div className="pharm-modal-actions">
              <button type="button" className="pharm-btn" onClick={() => setShowAddProductModal(false)} disabled={productSaving}>Cancel</button>
              <button type="button" className="pharm-btn primary" onClick={submitNewProduct} disabled={productSaving}>
                {productSaving ? 'Saving…' : 'Add Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {scanAssignModal && (
        <div
          className="pharm-modal-overlay"
          onClick={() => {
            setScanAssignModal(null);
            setScanAssignTarget(null);
            setScanAssignKindChoice('medicine');
          }}
        >
          <div className="pharm-modal-card wide" onClick={(e) => e.stopPropagation()}>
            <div className="pharm-modal-head">
              <div className="pharm-modal-title">Barcode Not Registered</div>
              <button className="pharm-icon-btn" type="button" onClick={() => { setScanAssignModal(null); setScanAssignTarget(null); setScanAssignKindChoice('medicine'); }}>
                <X size={18} />
              </button>
            </div>

            <div className="pharm-modal-body">
              <div className="pharm-modal-text">
                Barcode <span className="pharm-strong">{scanAssignModal.code}</span> not found for {(scanAssignModal.kind === 'auto' ? scanAssignKindChoice : scanAssignModal.kind) === 'supply' ? 'supplies' : 'medicines'}.
              </div>
              {scanAssignModal.kind === 'auto' ? (
                <div className="pharm-field" style={{ marginTop: 12 }}>
                  <div className="pharm-label">Type</div>
                  <select
                    className="pharm-select"
                    value={scanAssignKindChoice}
                    onChange={(e) => {
                      setScanAssignKindChoice(e.target.value);
                      setScanAssignTarget(null);
                    }}
                  >
                    <option value="medicine">Medicine</option>
                    <option value="supply">Supply</option>
                  </select>
                </div>
              ) : null}
              <div className="pharm-field" style={{ marginTop: 12 }}>
                <div className="pharm-label">Assign To Existing Item</div>
                <select
                  className="pharm-select"
                  value={scanAssignTarget?.id || ''}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return setScanAssignTarget(null);
                    const effectiveKind = scanAssignModal.kind === 'auto' ? scanAssignKindChoice : scanAssignModal.kind;
                    const list = effectiveKind === 'supply' ? supplies : medicines;
                    const found = (Array.isArray(list) ? list : []).find((it) => String(it.id) === String(id));
                    setScanAssignTarget(found ? { id: String(found.id), label: found.item_name || found.name || String(found.id) } : { id: String(id), label: String(id) });
                  }}
                >
                  <option value="">Select item…</option>
                  {((scanAssignModal.kind === 'auto' ? scanAssignKindChoice : scanAssignModal.kind) === 'supply' ? supplies : medicines).map((it) => (
                    <option key={it.id} value={String(it.id)}>
                      {it.item_name || it.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="pharm-cart-item-note" style={{ marginTop: 8 }}>
                Or click “Add Product” to create a new item using this barcode.
              </div>
            </div>

            <div className="pharm-modal-actions">
              <button type="button" className="pharm-btn" onClick={() => { setScanAssignModal(null); setScanAssignTarget(null); setScanAssignKindChoice('medicine'); }}>
                Close
              </button>
              <button
                type="button"
                className="pharm-btn"
                onClick={() => {
                  const effectiveKind = scanAssignModal.kind === 'auto' ? scanAssignKindChoice : scanAssignModal.kind;
                  setScanAssignModal(null);
                  setScanAssignTarget(null);
                  setScanAssignKindChoice('medicine');
                  setProductError('');
                  setShowAddProductModal(true);
                  setNewProductForm((p) => ({ ...p, type: effectiveKind, barcode: scanAssignModal.code }));
                }}
              >
                Add Product
              </button>
              <button
                type="button"
                className="pharm-btn primary"
                disabled={!scanAssignTarget?.id}
                onClick={async () => {
                  try {
                    const effectiveKind = scanAssignModal.kind === 'auto' ? scanAssignKindChoice : scanAssignModal.kind;
                    const endpoint = effectiveKind === 'supply' ? 'supplies' : 'inventory';
                    await fetchJson(`/api/${endpoint}/${scanAssignTarget.id}`, {
                      apiBase: API_BASE,
                      method: 'PUT',
                      headers: buildJsonHeaders(),
                      body: JSON.stringify({ barcode: scanAssignModal.code })
                    });
                    if (effectiveKind === 'supply') await fetchSupplies();
                    else await fetchMedicines();
                    setScanBanner({ type: 'ok', text: `Assigned barcode to ${scanAssignTarget.label}` });
                    setScanAssignModal(null);
                    setScanAssignTarget(null);
                    setScanAssignKindChoice('medicine');
                  } catch (err) {
                    setScanBanner({ type: 'error', text: String(err?.message || 'Failed to assign barcode') });
                  }
                }}
              >
                Assign Barcode
              </button>
            </div>
          </div>
        </div>
      )}

      {scanCenterOpen && (
        <div className="pharm-modal-overlay" onClick={() => setScanCenterOpen(false)}>
          <div className="pharm-modal-card wide" onClick={(e) => e.stopPropagation()}>
            <div className="pharm-modal-head">
              <div className="pharm-modal-title">Scan Center</div>
              <button className="pharm-icon-btn" type="button" onClick={() => setScanCenterOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="pharm-modal-body">
              <div className="pharm-modal-grid">
                <div className="pharm-field">
                  <div className="pharm-label">Mode</div>
                  <select value={scanMode} onChange={(e) => setScanMode(e.target.value)} className="pharm-input">
                    <option value="restock">Restock (Add)</option>
                    <option value="dispense">Dispense (Subtract)</option>
                    <option value="find">Find Only</option>
                  </select>
                </div>
                <div className="pharm-field">
                  <div className="pharm-label">Type</div>
                  <select value={scanCenterKind} onChange={(e) => setScanCenterKind(e.target.value)} className="pharm-input">
                    <option value="auto">Auto (Try both)</option>
                    <option value="medicine">Medicines</option>
                    <option value="supply">Supplies</option>
                  </select>
                </div>
                <div className="pharm-field">
                  <div className="pharm-label">Queue</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 900, color: '#334155' }}>
                    <input type="checkbox" checked={queueMode} onChange={(e) => setQueueMode(e.target.checked)} disabled={scanMode === 'find'} />
                    Queue scans (delivery)
                  </label>
                </div>
              </div>

              {scanBanner ? (
                <div
                  style={{
                    marginTop: 10,
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: scanBanner.type === 'error' ? '1px solid #fecaca' : scanBanner.type === 'info' ? '1px solid #bfdbfe' : '1px solid #bbf7d0',
                    fontWeight: 900,
                    background: scanBanner.type === 'error' ? '#fef2f2' : scanBanner.type === 'info' ? '#eff6ff' : '#ecfdf5',
                    color: scanBanner.type === 'error' ? '#991b1b' : scanBanner.type === 'info' ? '#1d4ed8' : '#065f46'
                  }}
                >
                  {scanBanner.text}
                </div>
              ) : null}

              {scanCenterMatch ? (
                <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid #e2e8f0', background: '#ffffff' }}>
                  <div style={{ fontWeight: 1000, color: '#0f172a' }}>
                    {scanCenterMatch.item.item_name || scanCenterMatch.item.name || 'Item'}
                  </div>
                  <div className="pharm-cart-item-note" style={{ marginTop: 4 }}>
                    {String(scanCenterMatch.kind || '').toUpperCase()} • ₱{Number(scanCenterMatch.item.price || 0).toLocaleString()} • Stock {Number(scanCenterMatch.item.stock || 0)} {String(scanCenterMatch.item.unit || '').trim() || 'pcs'}
                  </div>
                </div>
              ) : null}

              <div className="pharm-field" style={{ marginTop: 10 }}>
                <div className="pharm-label">Scan Barcode</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input
                    ref={scanInputRef}
                    className="pharm-input"
                    placeholder="Scan barcode…"
                    value={inventoryScan}
                    onChange={(e) => {
                      const cleaned = String(e.target.value || '').replace(/[\r\n]+/g, '');
                      setInventoryScan(cleaned);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleScanCenterLookup();
                    }}
                    disabled={scanBusy}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="pharm-btn primary"
                    onClick={() => handleScanCenterLookup()}
                    disabled={scanBusy || !String(inventoryScan || '').trim()}
                    style={{ whiteSpace: 'nowrap', padding: '10px 14px' }}
                  >
                    {scanBusy ? 'Checking…' : 'Enter'}
                  </button>
                </div>
                <div className="pharm-cart-item-note" style={{ marginTop: 6 }}>
                  Scan barcode, then press Enter or click the Enter button.
                </div>
              </div>

              {queueMode && scanMode !== 'find' ? (
                <div style={{ marginTop: 12 }}>
                  <div className="pharm-label">Receiving Queue</div>
                  {scanQueue.length === 0 ? (
                    <div className="pharm-cart-item-note" style={{ marginTop: 8 }}>Scan items to build a queue, then apply once.</div>
                  ) : (
                    <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                      {scanQueue.slice(0, 50).map((q) => (
                        <div key={q.key} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 140px 140px 44px', gap: 8, alignItems: 'center' }}>
                          <div className="pharm-cart-item-note" style={{ fontWeight: 900, color: '#0f172a' }}>
                            {q.name} <span style={{ color: '#64748b', fontWeight: 800 }}>({q.kind})</span>
                          </div>
                          <input
                            className="pharm-input"
                            type="number"
                            min="1"
                            value={q.qty}
                            onChange={(e) => {
                              const v = e.target.value;
                              setScanQueue((prev) => prev.map((x) => (x.key === q.key ? { ...x, qty: v } : x)));
                            }}
                          />
                          <input
                            className="pharm-input"
                            placeholder="Lot"
                            value={q.lot}
                            onChange={(e) => setScanQueue((prev) => prev.map((x) => (x.key === q.key ? { ...x, lot: e.target.value } : x)))}
                          />
                          <input
                            className="pharm-input"
                            type="date"
                            value={q.expiry}
                            onChange={(e) => setScanQueue((prev) => prev.map((x) => (x.key === q.key ? { ...x, expiry: e.target.value } : x)))}
                          />
                          <button type="button" className="pharm-icon-btn" onClick={() => setScanQueue((prev) => prev.filter((x) => x.key !== q.key))}>
                            <X size={16} />
                          </button>
                        </div>
                      ))}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
                        <button type="button" className="pharm-btn" onClick={() => setScanQueue([])} disabled={queueApplying}>
                          Clear
                        </button>
                        <button type="button" className="pharm-btn primary" onClick={applyQueue} disabled={queueApplying || scanQueue.length === 0}>
                          {queueApplying ? 'Applying…' : `Apply (${scanQueue.length})`}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {scanLog.length ? (
                <div style={{ marginTop: 12 }}>
                  <div className="pharm-label">Recent Scans</div>
                  <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                    {scanLog.slice(0, 8).map((x, idx) => (
                      <div key={`${x.at}-${idx}`} className="pharm-cart-item-note">
                        {new Date(x.at).toLocaleTimeString()} • {x.kind} • {x.code} • {x.status}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="pharm-modal-actions">
              <button type="button" className="pharm-btn" onClick={() => setScanCenterOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {saleDetails && (
        <div className="pharm-modal-overlay" onClick={() => (saleDetailsLoading ? null : setSaleDetails(null))}>
          <div className="pharm-modal-card lg" onClick={(e) => e.stopPropagation()}>
            <div className="pharm-modal-head">
              <div className="pharm-modal-title">Transaction Details</div>
              <button className="pharm-icon-btn" type="button" onClick={() => (saleDetailsLoading ? null : setSaleDetails(null))}>
                <X size={18} />
              </button>
            </div>

            <div className="pharm-modal-body">
              <div className="pharm-modal-row">
                <div className="pharm-label">Transaction #</div>
                <div className="pharm-value">{saleDetails.transaction_no || '—'}</div>
              </div>
              <div className="pharm-modal-row">
                <div className="pharm-label">Date/Time</div>
                <div className="pharm-value">{saleDetails.created_at ? new Date(saleDetails.created_at).toLocaleString() : '—'}</div>
              </div>
              <div className="pharm-modal-row">
                <div className="pharm-label">Pharmacist</div>
                <div className="pharm-value">{saleDetails.pharmacist_name || '—'}</div>
              </div>
              <div className="pharm-modal-row">
                <div className="pharm-label">Subtotal</div>
                <div className="pharm-value">₱{round2(Number(saleDetails.subtotal || 0)).toLocaleString()}</div>
              </div>
              <div className="pharm-modal-row">
                <div className="pharm-label">Discount</div>
                <div className="pharm-value">
                  ₱{round2(Number(saleDetails.discount_amount || 0)).toLocaleString()}
                  {saleDetails.discount_type ? ` (${String(saleDetails.discount_type).toUpperCase()})` : ''}
                </div>
              </div>
              <div className="pharm-modal-row">
                <div className="pharm-label">Discount Ref/ID</div>
                <div className="pharm-value">{saleDetails.discount_ref || '—'}</div>
              </div>
              <div className="pharm-modal-row">
                <div className="pharm-label">Total Due</div>
                <div className="pharm-value">₱{round2(Number(saleDetails.total_due || 0)).toLocaleString()}</div>
              </div>
              <div className="pharm-modal-row">
                <div className="pharm-label">Payment Received</div>
                <div className="pharm-value">₱{round2(Number(saleDetails.payment_received || 0)).toLocaleString()}</div>
              </div>
              <div className="pharm-modal-row">
                <div className="pharm-label">Change</div>
                <div className="pharm-value">₱{round2(Number(saleDetails.change_amount || 0)).toLocaleString()}</div>
              </div>

              <div className="pharm-divider" />

              <div className="pharm-card-title">Items</div>
              <div className="pharm-table-wrap" style={{ maxHeight: '280px', overflowY: 'auto' }}>
                <table className="pharm-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Type</th>
                      <th>Qty</th>
                      <th className="pharm-right">Unit</th>
                      <th className="pharm-right">Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const items = Array.isArray(saleDetails.items) ? saleDetails.items : [];
                      const purchased = items.filter((it) => String(it?.item_type || '') !== 'discount');
                      if (purchased.length === 0) {
                        return (
                          <tr>
                            <td colSpan="5" className="pharm-empty">No items found.</td>
                          </tr>
                        );
                      }
                      return purchased.map((it, idx) => {
                        const qty = Number(it.quantity || 0);
                        const unit = Number(it.price_at_sale || 0);
                        return (
                          <tr key={idx}>
                            <td className="pharm-strong">{String(it.item_name || '')}</td>
                            <td>{String(it.item_type || '')}</td>
                            <td>{qty}</td>
                            <td className="pharm-right">₱{round2(unit).toLocaleString()}</td>
                            <td className="pharm-right">₱{round2(qty * unit).toLocaleString()}</td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="pharm-modal-actions">
              <button type="button" className="pharm-btn" onClick={() => openReceiptFromSale(saleDetails.id)} disabled={saleDetailsLoading}>
                Reprint Receipt
              </button>
              <button type="button" className="pharm-btn primary" onClick={() => setSaleDetails(null)} disabled={saleDetailsLoading}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showReceipt && (
        <div className="pharm-modal-overlay">
          <div className="pharm-modal-card receipt" onClick={(e) => e.stopPropagation()}>
            <div className="pharm-modal-head">
              <div className="pharm-modal-title flex-row gap-8">
                <ReceiptText size={20} />
                Transaction Receipt
              </div>
              <button className="pharm-icon-btn" type="button" onClick={() => setShowReceipt(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="pharm-receipt-content">
              <div className="receipt-header">
                <div className="receipt-brand">Pascual General Hospital</div>
                <div className="receipt-sub">Pharmacy Department</div>
                {showReceipt.transactionNo ? <div className="receipt-txn">Transaction #: {showReceipt.transactionNo}</div> : null}
                <div className="receipt-date">{showReceipt.date}</div>
              </div>
              
              <div className="receipt-items">
                {showReceipt.items.map((item, idx) => (
                  <div key={idx} className="receipt-item">
                    <div className="receipt-item-main">
                      <span>{item.name} x {item.quantity}</span>
                      <span>₱{(item.price * item.quantity).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="receipt-divider" />
              
              <div className="pharm-verify-panel" style={{ marginBottom: 14 }}>
                <div className="pharm-verify-head">
                  <CheckCircle2 size={16} />
                  <span>Checkout complete</span>
                </div>
                <div className="pharm-checklist">
                  <div className="pharm-checklist-item done">
                    <CheckCircle2 size={14} />
                    <span>{showReceipt.statusLabel || 'Sale recorded successfully.'}</span>
                  </div>
                  {showReceipt.transactionNo ? (
                    <div className="pharm-checklist-item done">
                      <CheckCircle2 size={14} />
                      <span>Receipt reference: {showReceipt.transactionNo}</span>
                    </div>
                  ) : null}
                  {showReceipt.invoiceId ? (
                    <div className="pharm-checklist-item done">
                      <CheckCircle2 size={14} />
                      <span>Billing invoice #{showReceipt.invoiceId} is available on the cashier side.</span>
                    </div>
                  ) : null}
                </div>
              </div>
              
              <div className="receipt-summary">
                {showReceipt.patientName ? (
                  <div className="receipt-row">
                    <span>Patient</span>
                    <span>{showReceipt.patientName}</span>
                  </div>
                ) : null}
                {showReceipt.invoiceId ? (
                  <div className="receipt-row">
                    <span>Billing Invoice</span>
                    <span>#{showReceipt.invoiceId}</span>
                  </div>
                ) : null}
                <div className="receipt-row">
                  <span>Subtotal</span>
                  <span className="receipt-strong">₱{Number(showReceipt.subtotal || 0).toLocaleString()}</span>
                </div>
                {Number(showReceipt.discountAmount || 0) > 0 && (
                  <div className="receipt-row">
                    <span>
                      Discount{showReceipt.discountLabel ? ` (${showReceipt.discountLabel})` : ''}
                      {showReceipt.discountRef ? ` Ref: ${showReceipt.discountRef}` : ''}
                    </span>
                    <span>- ₱{Number(showReceipt.discountAmount || 0).toLocaleString()}</span>
                  </div>
                )}
                <div className="receipt-row">
                  <span>Total Due</span>
                  <span className="receipt-strong">₱{Number(showReceipt.totalDue || 0).toLocaleString()}</span>
                </div>
                <div className="receipt-row">
                  <span>Payment Method</span>
                  <span>{showReceipt.paymentMethod || 'Cash'}</span>
                </div>
                <div className="receipt-row">
                  <span>Payment Received</span>
                  <span>₱{Number(showReceipt.payment || 0).toLocaleString()}</span>
                </div>
                <div className="receipt-row change">
                  <span>Change</span>
                  <span className="receipt-strong">₱{Number(showReceipt.change || 0).toLocaleString()}</span>
                </div>
              </div>

              <div className="receipt-footer">
                <div>Pharmacist: {showReceipt.pharmacist}</div>
                <div className="receipt-thank-you">Thank you for your purchase!</div>
              </div>
            </div>
            <div className="pharm-modal-actions no-print">
              <button type="button" className="pharm-btn" onClick={() => window.print()}>
                <Printer size={18} /> Print
              </button>
              {showReceipt.saleId ? (
                <button
                  type="button"
                  className="pharm-btn"
                  onClick={() => {
                    setShowReceipt(null);
                    openSaleDetails(showReceipt.saleId);
                  }}
                >
                  View Sale Record
                </button>
              ) : null}
              {showReceipt.invoiceId ? (
                <button
                  type="button"
                  className="pharm-btn"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(String(showReceipt.invoiceId));
                      setToast({ type: 'success', text: `Billing invoice #${showReceipt.invoiceId} copied.` });
                    } catch (_) {
                      setToast({ type: 'error', text: 'Unable to copy invoice number.' });
                    }
                  }}
                >
                  Copy Invoice #
                </button>
              ) : null}
              <button
                type="button"
                className="pharm-btn"
                onClick={() => {
                  setShowReceipt(null);
                  setActiveTab('pos');
                }}
              >
                Start New Sale
              </button>
              <button type="button" className="pharm-btn primary" onClick={() => setShowReceipt(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <PatientFullRecordModal
        open={centralRecordOpen}
        onClose={() => setCentralRecordOpen(false)}
        patientId={centralRecordPatientId}
        patientLabel={centralRecordPatientLabel}
        role="pharmacist"
        user={currentUser}
      />
    </div>
  );
}

export default PharmacistDashboard;
