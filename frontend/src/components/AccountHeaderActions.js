import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, ChevronDown, LayoutGrid, LogOut, RefreshCw, Settings, User } from 'lucide-react';
import ChangePasswordModal from './ChangePasswordModal';
import SignOutConfirmModal from './SignOutConfirmModal';
import './AccountHeaderActions.css';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

const isWithinQuietHoursWindow = (d = new Date()) => {
  const h = d.getHours();
  return h >= 22 || h < 7;
};

const canonicalizeRole = (value) => {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  if (v === 'administrator') return 'admin';
  if (v === 'clinical staff' || v === 'clinical_staff') return 'staff';
  if (v === 'doctor secretary' || v === 'doctor_secretary') return 'doctor_secretary';
  if (v === 'ecg operator' || v === 'ecg_operator' || v === 'ecg') return 'ecg_operator';
  if (v === 'physical therapist' || v === 'physical_therapist' || v === 'pt') return 'physical_therapist';
  return v.replace(/\s+/g, '_');
};

const getRole = (u) => {
  const raw = u?.role ?? u?.account_type ?? u?.accountType ?? u?.roles;
  return String(raw || '').trim();
};

const getDisplayName = (u) => {
  const first = u?.firstName || u?.first_name || '';
  const last = u?.lastName || u?.last_name || '';
  const full = `${first} ${last}`.trim();
  if (full) return full;
  if (u?.name) return String(u.name);
  const email = String(u?.email || '').trim();
  if (email) return email.split('@')[0];
  return 'User';
};

const getRoleLabel = (u, fallback) => {
  if (fallback) return fallback;
  const r = getRole(u).toLowerCase();
  if (!r) return 'User';
  if (r === 'admin') return 'Administrator';
  if (r === 'doctor') {
    const spec = String(u?.specialization || '').trim();
    return spec ? `Doctor • ${spec}` : 'Doctor';
  }
  if (r === 'nurse') return 'Nurse';
  if (r === 'pharmacist') return 'Pharmacist';
  if (r === 'cashier') return 'Cashier';
  if (r === 'doctor_secretary') return 'Doctor Secretary';
  if (r === 'medtech') return 'Medtech';
  if (r === 'radiographer') return 'Radiographer';
  if (r === 'ecg') return 'ECG Operator';
  if (r === 'pt') return 'Physical Therapist';
  if (r === 'patient') return 'Patient';
  return r.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function AccountHeaderActions({
  user,
  roleLabel,
  showDepartment = false,
  departmentValue,
  departmentOptions,
  onDepartmentChange,
  onMyProfile,
  onSignOut,
  onOpenNotification,
  showChangePasswordMenu = true,
  showNotificationsButton = true,
  showSettingsButton = true
}) {
  const rootRef = useRef(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [announcementToast, setAnnouncementToast] = useState(null);
  const [greetToast, setGreetToast] = useState(null);
  const greetHideRef = useRef(null);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifItems, setNotifItems] = useState([]);
  const [notifUnreadCount, setNotifUnreadCount] = useState(0);
  const [notifError, setNotifError] = useState('');
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsPrefs, setSettingsPrefs] = useState(() => {
    try {
      const saved = localStorage.getItem('systemPreferences');
      return saved ? JSON.parse(saved) : { quietHours: false, privacyMode: false, autoPrint: false };
    } catch (_) {
      return { quietHours: false, privacyMode: false, autoPrint: false };
    }
  });

  // Sync with localStorage
  useEffect(() => {
    localStorage.setItem('systemPreferences', JSON.stringify(settingsPrefs));
    // Trigger storage event for other tabs
    window.dispatchEvent(new Event('storage'));
  }, [settingsPrefs]);

  const togglePreference = (key) => {
    if (settingsSaving) return;
    const nextValue = !Boolean(settingsPrefs?.[key]);
    saveSettings({ [key]: nextValue });
  };
  const [settingsError, setSettingsError] = useState('');
  const announcementHideRef = useRef(null);
  const announcementPollRef = useRef(null);
  const announcementSseRef = useRef(null);
  const notifSseRef = useRef(null);
  const quietHoursRef = useRef(false);

  const name = useMemo(() => getDisplayName(user), [user]);
  const role = useMemo(() => getRoleLabel(user, roleLabel), [user, roleLabel]);
  const letter = useMemo(() => (String(name || 'U').trim()[0] || 'U').toUpperCase(), [name]);
  const canChangePassword = useMemo(() => getRole(user).toLowerCase() !== 'patient', [user]);
  const rawRole = useMemo(() => {
    const direct = canonicalizeRole(getRole(user));
    if (direct) return direct;
    const labeled = canonicalizeRole(roleLabel || role);
    if (labeled) return labeled;
    try {
      const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
      return canonicalizeRole(currentUser?.role || currentUser?.account_type || currentUser?.accountType || currentUser?.roles);
    } catch (_) {
      return '';
    }
  }, [user, roleLabel, role]);
  const userEmail = useMemo(() => {
    const direct = String(user?.email || '').trim();
    if (direct) return direct;
    try {
      const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
      return String(currentUser?.email || '').trim();
    } catch (_) {
      return '';
    }
  }, [user]);
  const roleBucket = useMemo(() => {
    if (rawRole === 'doctor') return 'Doctor';
    if (rawRole === 'nurse') return 'Nurse';
    if (rawRole === 'patient') return 'Patient';
    if (rawRole === 'admin') return 'Admin';
    return 'Staff';
  }, [rawRole]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target)) return;
      setShowNotifications(false);
      setShowSettings(false);
      setShowProfileMenu(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  const authHeaders = useMemo(() => {
    const headers = { 'Content-Type': 'application/json' };
    if (rawRole) headers['x-user-role'] = rawRole;
    if (userEmail) headers['x-user-email'] = userEmail;
    if (name) headers['x-user-name'] = name;
    const idCandidates = [user?.patientId, user?.patient_id, user?.id, user?._id];
    const patientId = idCandidates.find((v) => UUID_PATTERN.test(String(v || '').trim())) || '';
    if (patientId) headers['x-patient-id'] = String(patientId);
    return headers;
  }, [rawRole, userEmail, name]);

  const dismissAnnouncementToast = () => {
    setAnnouncementToast(null);
    if (announcementHideRef.current) {
      clearTimeout(announcementHideRef.current);
      announcementHideRef.current = null;
    }
  };

  const dismissGreetToast = () => {
    setGreetToast(null);
    if (greetHideRef.current) {
      clearTimeout(greetHideRef.current);
      greetHideRef.current = null;
    }
  };

  // Session-scoped login greeting (matches Admin pattern — runs once per tab session, per role+email).
  // Falls back to showing greet even if DB announcement returned nothing on first load.
  useEffect(() => {
    if (!name || !rawRole) return;
    const sessionKey = `greetShown:${rawRole}:${userEmail || name}`;
    let already;
    try { already = sessionStorage.getItem(sessionKey) === '1'; } catch (_) { already = false; }
    if (already) return;
    try { sessionStorage.setItem(sessionKey, '1'); } catch (_) {}
    const now = new Date();
    const hour = now.getHours();
    let greeting = 'Good day';
    if (hour < 12) greeting = 'Good morning';
    else if (hour < 17) greeting = 'Good afternoon';
    else greeting = 'Good evening';
    const dateStr = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const roleEmoji = (() => {
      const r = String(rawRole || '').toLowerCase();
      if (r === 'doctor') return '🩺';
      if (r === 'nurse') return '💉';
      if (r === 'admin') return '🛡️';
      if (r === 'cashier') return '🧾';
      if (r === 'pharmacist') return '💊';
      if (r === 'medtech' || r === 'radiographer' || r === 'ecg_operator' || r === 'ecg' || r === 'physical_therapist' || r === 'pt') return '🔬';
      if (r === 'doctor_secretary') return '📋';
      return '👋';
    })();
    const isDoctor = rawRole && String(rawRole).toLowerCase() === 'doctor';
    const greetName = isDoctor ? `Dr. ${String(name).trim()}` : String(name).trim();
    let title = `${greeting}, ${greetName}!`;
    let message = `Welcome back to Pascualinga Hospital. Today is ${dateStr}.`;
    if (isDoctor) message = `${message} Today may you bring clarity and healing to every patient you see. Have a smooth shift!`;
    else if (rawRole === 'nurse') message = `${message} Thank you for keeping the wards running — your watch matters.`;
    else if (rawRole === 'admin') message = `${message} Review operations, stay on top of incidents, and let's keep standards high.`;
    else if (rawRole === 'cashier') message = `${message} Have an accurate shift — double check change and receipts.`;
    else if (rawRole === 'pharmacist') message = `${message} Dispense safely — double-check names, doses, and allergies first.`;
    setGreetToast({ id: `greet-${Date.now()}`, title, message, author: roleEmoji, priority: 'Normal' });
    if (greetHideRef.current) clearTimeout(greetHideRef.current);
    greetHideRef.current = setTimeout(() => {
      setGreetToast(null);
      greetHideRef.current = null;
    }, 12000);
    return () => {
      if (greetHideRef.current) { clearTimeout(greetHideRef.current); greetHideRef.current = null; }
    };
  }, [name, rawRole, userEmail]);

  useEffect(() => {
    quietHoursRef.current = Boolean(settingsPrefs?.quietHours);
    if (quietHoursRef.current && isWithinQuietHoursWindow()) {
      dismissAnnouncementToast();
      if (greetToast?.id?.startsWith?.('greet-')) dismissGreetToast();
    }
  }, [settingsPrefs?.quietHours, greetToast]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.privacyMode = settingsPrefs?.privacyMode ? 'on' : 'off';
    return () => {
      if (document.documentElement.dataset.privacyMode === 'on') {
        document.documentElement.dataset.privacyMode = 'off';
      }
    };
  }, [settingsPrefs?.privacyMode]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = 'light';
    try {
      localStorage.setItem('appTheme', 'light');
    } catch (_) {}
  }, []);

  const fetchSettings = async () => {
    if (!rawRole || !userEmail) return;
    setSettingsLoading(true);
    setSettingsError('');
    try {
      const res = await fetch(`${API_BASE}/api/staff/settings`, { headers: authHeaders });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.message || 'Failed to load settings');
      setSettingsPrefs(json?.prefs && typeof json.prefs === 'object' ? json.prefs : {});
    } catch (e) {
      setSettingsError(e.message || 'Failed to load settings');
    } finally {
      setSettingsLoading(false);
    }
  };

  const saveSettings = async (patch) => {
    if (!rawRole || !userEmail) return;
    const safePatch = patch && typeof patch === 'object' ? patch : {};
    const optimistic = { ...settingsPrefs, ...safePatch };
    setSettingsPrefs(optimistic);
    setSettingsSaving(true);
    setSettingsError('');
    try {
      const res = await fetch(`${API_BASE}/api/staff/settings`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ prefs: safePatch })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.message || 'Failed to save settings');
      setSettingsPrefs(json?.prefs && typeof json.prefs === 'object' ? json.prefs : optimistic);
    } catch (e) {
      setSettingsPrefs(settingsPrefs);
      setSettingsError(e.message || 'Failed to save settings');
    } finally {
      setSettingsSaving(false);
    }
  };

  const fetchNotifications = async ({ silent = false } = {}) => {
    if (!rawRole || !userEmail) return;
    if (!silent) setNotifLoading(true);
    setNotifError('');
    try {
      const res = await fetch(`${API_BASE}/api/staff/notifications`, { headers: authHeaders });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.message || 'Failed to load notifications');
      const items = Array.isArray(json?.items) ? json.items : [];
      setNotifItems(items);
      setNotifUnreadCount(Number(json?.unreadCount || 0) || 0);
    } catch (e) {
      setNotifError(e.message || 'Failed to load notifications');
    } finally {
      if (!silent) setNotifLoading(false);
    }
  };

  const markAllNotificationsAsRead = async () => {
    if (!rawRole || !userEmail) return;
    const nowIso = new Date().toISOString();
    setNotifItems((prev) => (Array.isArray(prev) ? prev.map((n) => ({ ...n, unreadCount: 0 })) : []));
    setNotifUnreadCount(0);
    if (rawRole === 'admin') {
      setSettingsPrefs((prev) => ({ ...(prev && typeof prev === 'object' ? prev : {}), notificationsLastReadAt: nowIso }));
    }
    try {
      await fetch(`${API_BASE}/api/staff/notifications/mark-all-read`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({})
      });
    } catch (_) {}
    await fetchNotifications({ silent: true });
  };

  const markNotificationAsRead = async (id) => {
    if (!rawRole || !userEmail) return;
    const nowIso = new Date().toISOString();
    if (rawRole === 'admin') {
      setNotifItems((prev) => (Array.isArray(prev) ? prev.map((n) => ({ ...n, unreadCount: 0 })) : []));
      setNotifUnreadCount(0);
      setSettingsPrefs((prev) => ({ ...(prev && typeof prev === 'object' ? prev : {}), notificationsLastReadAt: nowIso }));
    } else {
      setNotifItems((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const next = list.map((n) => (n && n.id === id ? { ...n, unreadCount: 0 } : n));
        const unread = next.reduce((acc, it) => acc + (Number(it?.unreadCount || 0) || 0), 0);
        setNotifUnreadCount(unread);
        return next;
      });
    }
    try {
      await fetch(`${API_BASE}/api/staff/notifications/mark-read`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ id })
      });
    } catch (_) {}
    await fetchNotifications({ silent: true });
  };

  useEffect(() => {
    if (!rawRole || !userEmail) return;
    fetchNotifications({ silent: true });
    fetchSettings();
    const t = setInterval(() => fetchNotifications({ silent: true }), 30000);
    return () => clearInterval(t);
  }, [rawRole, userEmail, authHeaders]);

  useEffect(() => {
    if (!rawRole || !userEmail) return;
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') return;
    if (rawRole === 'admin') return;

    try {
      if (notifSseRef.current) notifSseRef.current.close();
    } catch (_) {}

    const url = `${API_BASE}/api/staff/notifications/stream?role=${encodeURIComponent(rawRole)}&email=${encodeURIComponent(userEmail)}&name=${encodeURIComponent(name)}`;
    const es = new EventSource(url);
    notifSseRef.current = es;

    const onNotif = () => fetchNotifications({ silent: true });
    es.addEventListener('notif', onNotif);
    es.addEventListener('hello', () => {});
    es.addEventListener('error', () => {});
    es.onerror = () => {
      try {
        es.close();
      } catch (_) {}
      if (notifSseRef.current === es) notifSseRef.current = null;
    };

    return () => {
      try {
        es.removeEventListener('notif', onNotif);
        es.close();
      } catch (_) {}
      if (notifSseRef.current === es) notifSseRef.current = null;
    };
  }, [rawRole, userEmail, name, authHeaders]);

  useEffect(() => {
    if (!rawRole || !userEmail) return;

    const storageKey = `lastSeenAnnouncement:${userEmail}:${roleBucket}`;
    const parseSeen = () => {
      try {
        const raw = localStorage.getItem(storageKey);
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    };
    const saveSeen = (payload) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(payload));
      } catch (_) {}
    };
    const parseBigIntId = (value) => {
      const v = String(value || '').trim();
      if (!/^\d+$/.test(v)) return null;
      try {
        return BigInt(v);
      } catch (_) {
        return null;
      }
    };
    const getCreatedAtMs = (row) => {
      const raw = row?.createdAt || row?.created_at || row?.created || row?.timestamp || null;
      if (!raw) return 0;
      const d = new Date(raw);
      const t = d.getTime();
      return Number.isFinite(t) ? t : 0;
    };
    const normalizeTarget = (t) => String(t || 'All').trim().toLowerCase();
    const matchesTarget = (row) => {
      const target = normalizeTarget(row?.target);
      if (!target || target === 'all') return true;
      return target === String(roleBucket).toLowerCase();
    };
    const isNewerThanSeen = (latest, seen) => {
      if (!latest) return false;
      if (!seen) return false;
      const latestId = parseBigIntId(latest?.id);
      const seenId = parseBigIntId(seen?.id);
      if (latestId !== null && seenId !== null) return latestId > seenId;
      const latestAt = getCreatedAtMs(latest);
      const seenAt = getCreatedAtMs(seen);
      return latestAt > seenAt;
    };

    const fetchAnnouncementToast = async ({ initialize = false } = {}) => {
      try {
        const res = await fetch(`${API_BASE}/api/announcements`, { headers: authHeaders });
        const json = await res.json().catch(() => null);
        if (!res.ok) return;
        const list = Array.isArray(json) ? json : [];
        const candidates = list.filter(matchesTarget);
        if (!candidates.length) return;
        const sorted = [...candidates].sort((a, b) => getCreatedAtMs(b) - getCreatedAtMs(a));
        const latest = sorted[0];
        const latestSeenPayload = {
          id: latest?.id ? String(latest.id) : '',
          createdAt: latest?.createdAt || latest?.created_at || null
        };

        const seen = parseSeen();
        if (!seen && initialize) {
          saveSeen(latestSeenPayload);
          return;
        }

        if (seen && isNewerThanSeen(latest, seen)) {
          saveSeen(latestSeenPayload);
          if (quietHoursRef.current && isWithinQuietHoursWindow()) return;
          setAnnouncementToast({
            id: latestSeenPayload.id,
            title: String(latest?.title || 'Announcement'),
            message: String(latest?.content || ''),
            priority: String(latest?.priority || 'Normal'),
            author: String(latest?.author || 'Admin')
          });
          if (announcementHideRef.current) clearTimeout(announcementHideRef.current);
          announcementHideRef.current = setTimeout(() => {
            setAnnouncementToast(null);
            announcementHideRef.current = null;
          }, 15000);
        }
      } catch (_) {}
    };

    const showAnnouncementToast = (latest) => {
      if (!latest) return;
      if (!matchesTarget(latest)) return;
      const latestSeenPayload = {
        id: latest?.id ? String(latest.id) : '',
        createdAt: latest?.createdAt || latest?.created_at || null
      };

      const seen = parseSeen();
      const shouldShow = !seen || isNewerThanSeen(latest, seen);
      if (shouldShow) {
        saveSeen(latestSeenPayload);
        if (quietHoursRef.current && isWithinQuietHoursWindow()) return;
        setAnnouncementToast({
          id: latestSeenPayload.id,
          title: String(latest?.title || 'Announcement'),
          message: String(latest?.content || ''),
          priority: String(latest?.priority || 'Normal'),
          author: String(latest?.author || 'Admin')
        });
        if (announcementHideRef.current) clearTimeout(announcementHideRef.current);
        announcementHideRef.current = setTimeout(() => {
          setAnnouncementToast(null);
          announcementHideRef.current = null;
        }, 15000);
      }
    };

    const startPolling = () => {
      if (announcementPollRef.current) return;
      announcementPollRef.current = setInterval(() => fetchAnnouncementToast({ initialize: false }), 15000);
    };

    const stopPolling = () => {
      if (!announcementPollRef.current) return;
      clearInterval(announcementPollRef.current);
      announcementPollRef.current = null;
    };

    const closeSse = () => {
      if (!announcementSseRef.current) return;
      try {
        announcementSseRef.current.close();
      } catch (_) {}
      announcementSseRef.current = null;
    };

    dismissAnnouncementToast();
    stopPolling();
    closeSse();

    fetchAnnouncementToast({ initialize: true });

    const canUseSse = typeof window !== 'undefined' && typeof window.EventSource !== 'undefined';
    if (canUseSse) {
      const qs = new URLSearchParams();
      qs.set('role', rawRole);
      qs.set('email', userEmail);
      if (name) qs.set('name', name);
      const url = `${API_BASE}/api/announcements/stream?${qs.toString()}`;
      try {
        const source = new window.EventSource(url);
        announcementSseRef.current = source;

        source.addEventListener('announcement', (ev) => {
          try {
            const payload = JSON.parse(ev.data);
            showAnnouncementToast(payload);
          } catch (_) {}
        });

        source.addEventListener('ready', () => {});

        source.onerror = () => {
          closeSse();
          startPolling();
        };
      } catch (_) {
        startPolling();
      }
    } else {
      startPolling();
    }

    return () => {
      stopPolling();
      closeSse();
      if (announcementHideRef.current) {
        clearTimeout(announcementHideRef.current);
        announcementHideRef.current = null;
      }
      if (greetHideRef.current) {
        clearTimeout(greetHideRef.current);
        greetHideRef.current = null;
      }
    };
  }, [rawRole, userEmail, roleBucket, authHeaders, name]);

  return (
    <div className="aha-root" ref={rootRef}>
      {greetToast ? (
        <div className={`aha-announcement-toast pri-greet`} style={{ borderLeft: '4px solid #ea580c', background: 'linear-gradient(135deg,#fff7ed,#ffedd5)' }}>
          <div className="aha-announcement-top">
            <div className="aha-announcement-title" style={{ color: '#9a3412', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span aria-hidden>{greetToast.author || '👋'}</span>
              <span>{greetToast.title}</span>
            </div>
            <button type="button" className="aha-announcement-close" onClick={dismissGreetToast} aria-label="Dismiss greeting" style={{ color: '#9a3412' }}>
              ×
            </button>
          </div>
          <div className="aha-announcement-message" style={{ color: '#7c2d12' }}>{greetToast.message}</div>
          <div className="aha-announcement-meta" style={{ color: '#9a3412' }}>
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      ) : null}
      {announcementToast ? (
        <div className={`aha-announcement-toast pri-${String(announcementToast.priority || 'normal').toLowerCase()}`}>
          <div className="aha-announcement-top">
            <div className="aha-announcement-title">{announcementToast.title}</div>
            <button type="button" className="aha-announcement-close" onClick={dismissAnnouncementToast} aria-label="Dismiss announcement">
              ×
            </button>
          </div>
          <div className="aha-announcement-message">{announcementToast.message}</div>
          <div className="aha-announcement-meta">From {announcementToast.author}</div>
        </div>
      ) : null}
      <div className="aha-actions-group">
        {(showNotificationsButton || showSettingsButton) ? (
          <div className="aha-actions">
            {showNotificationsButton ? (
              <div className="aha-action-slot">
              <button
                type="button"
                className="aha-icon-btn"
                onClick={() => {
                  setShowNotifications((v) => !v);
                  setShowSettings(false);
                  setShowProfileMenu(false);
                }}
                aria-label="Notifications"
              >
                <Bell size={20} className="aha-icon" />
                {notifUnreadCount > 0 ? <span className="aha-badge">{notifUnreadCount > 9 ? '9+' : notifUnreadCount}</span> : null}
              </button>
                {showNotifications ? (
                  <div className="aha-dropdown" onClick={(e) => e.stopPropagation()}>
                    <div className="aha-dropdown-head">
                      <div className="aha-dropdown-title">Notifications</div>
                      <div className="aha-dropdown-head-actions">
                        <button
                          type="button"
                          className="aha-link-btn"
                          onClick={() => fetchNotifications()}
                          disabled={notifLoading}
                          aria-label="Refresh notifications"
                        >
                          <RefreshCw size={14} className={notifLoading ? 'aha-spin' : ''} /> Refresh
                        </button>
                        {notifUnreadCount > 0 ? (
                          <button type="button" className="aha-link-btn" onClick={markAllNotificationsAsRead}>
                            Mark all as read
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="aha-dropdown-body">
                      {notifLoading ? (
                        <div className="aha-muted">Loading…</div>
                      ) : notifError ? (
                        <div className="aha-muted">{notifError}</div>
                      ) : Array.isArray(notifItems) && notifItems.length ? (
                        <div className="aha-notif-list">
                          {notifItems.map((n) => (
                            <button
                              key={n.id}
                              type="button"
                              className={`aha-notif-item ${Number(n.unreadCount || 0) > 0 ? 'unread' : ''}`}
                              onClick={async () => {
                                if (typeof onOpenNotification === 'function') onOpenNotification(n);
                                setShowNotifications(false);
                                setShowSettings(false);
                                setShowProfileMenu(false);
                                await markNotificationAsRead(n.id);
                              }}
                            >
                              {(() => {
                                const severity = String(n?.meta?.severity || '').trim() || (String(n?.type || '').trim() === 'inventory' ? 'alert' : String(n?.type || '').trim() === 'lab_result' ? 'info' : 'info');
                                const rawAt = n?.createdAt || null;
                                const t = rawAt ? new Date(rawAt) : null;
                                const time = t && Number.isFinite(t.getTime()) ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                                return (
                                  <>
                                    <div className={`aha-notif-icon ${severity}`}>
                                      <Bell size={16} />
                                    </div>
                                    <div className="aha-notif-content">
                                      <div className="aha-notif-title">{n.title}</div>
                                      <div className="aha-notif-message">{n.message}</div>
                                      {time ? <div className="aha-notif-time">{time}</div> : null}
                                    </div>
                                  </>
                                );
                              })()}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="aha-muted">You’re all caught up. No notifications right now.</div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {showSettingsButton ? (
              <div className="aha-action-slot">
              <button
                type="button"
                className="aha-icon-btn"
                onClick={() => {
                  setShowSettings((v) => !v);
                  setShowNotifications(false);
                  setShowProfileMenu(false);
                }}
                aria-label="Settings"
              >
                <Settings size={20} className="aha-icon" />
              </button>
                {showSettings ? (
                  <div className="aha-dropdown" onClick={(e) => e.stopPropagation()}>
                    <div className="aha-dropdown-head">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Settings size={14} />
                        <div className="aha-dropdown-title">System Settings</div>
                      </div>
                    </div>
                    <div className="aha-dropdown-body">
                      {settingsLoading ? (
                        <div className="aha-muted">Loading…</div>
                      ) : (
                        <>
                          {settingsError ? <div className="aha-muted">{settingsError}</div> : null}
                          <div className="aha-settings-list">
                            <div className="aha-setting-row">
                              <div className="aha-setting-info">
                                <span className="aha-setting-label">Quiet Hours</span>
                                <span className="aha-setting-desc">Mute alerts at night</span>
                              </div>
                              <button
                                type="button"
                                className={`aha-toggle ${settingsPrefs.quietHours ? 'on' : ''}`}
                                onClick={() => togglePreference('quietHours')}
                                disabled={settingsSaving}
                                aria-pressed={Boolean(settingsPrefs.quietHours)}
                              >
                                <div className="aha-toggle-thumb" />
                              </button>
                            </div>

                            <div className="aha-setting-row">
                              <div className="aha-setting-info">
                                <span className="aha-setting-label">Privacy Mode</span>
                                <span className="aha-setting-desc">Blur sensitive amounts</span>
                              </div>
                              <button
                                type="button"
                                className={`aha-toggle ${settingsPrefs.privacyMode ? 'on' : ''}`}
                                onClick={() => togglePreference('privacyMode')}
                                disabled={settingsSaving}
                                aria-pressed={Boolean(settingsPrefs.privacyMode)}
                              >
                                <div className="aha-toggle-thumb" />
                              </button>
                            </div>

                            <div className="aha-setting-row">
                              <div className="aha-setting-info">
                                <span className="aha-setting-label">Auto Print</span>
                                <span className="aha-setting-desc">Print receipt after payment</span>
                              </div>
                              <button
                                type="button"
                                className={`aha-toggle ${settingsPrefs.autoPrint ? 'on' : ''}`}
                                onClick={() => togglePreference('autoPrint')}
                                disabled={settingsSaving}
                                aria-pressed={Boolean(settingsPrefs.autoPrint)}
                              >
                                <div className="aha-toggle-thumb" />
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {(showNotificationsButton || showSettingsButton) ? <div className="aha-sep"></div> : null}

        <button
          type="button"
          className="aha-profile-wrapper"
          onClick={(e) => {
            e.stopPropagation();
            setShowProfileMenu((v) => !v);
            setShowNotifications(false);
            setShowSettings(false);
          }}
          aria-label="Profile menu"
        >
          <div className="aha-profile-info">
            <span className="aha-profile-name">{name}</span>
            <span className="aha-profile-role">{role}</span>
          </div>
          <div className="aha-avatar-circle">
            {user?.avatarUrl || user?.profilePicture || user?.profile_picture || user?.avatar_url ? (
              <img src={user.avatarUrl || user.profilePicture || user.profile_picture || user.avatar_url} alt="Profile" />
            ) : (
              <span>{letter}</span>
            )}
          </div>
          <ChevronDown size={14} className={`aha-chevron ${showProfileMenu ? 'open' : ''}`} />

          {showProfileMenu ? (
            <div className="aha-profile-menu" onClick={(e) => e.stopPropagation()}>
              <div className="aha-profile-head">
                <div className="aha-user-row">
                  <div className="aha-user-avatar">{letter}</div>
                  <div>
                    <div className="aha-user-name">{name}</div>
                    <div className="aha-user-role">{role}</div>
                  </div>
                </div>
              </div>
              <div className="aha-profile-body">
                {showDepartment ? (
                  <div className="aha-menu-item static">
                    <LayoutGrid size={18} />
                    <span className="aha-menu-label">Department</span>
                    <select
                      className="aha-select"
                      value={departmentValue ?? ''}
                      disabled={!onDepartmentChange}
                      onChange={(e) => (onDepartmentChange ? onDepartmentChange(e.target.value) : null)}
                    >
                      {Array.isArray(departmentOptions) && departmentOptions.length
                        ? departmentOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))
                        : (
                            <option value={departmentValue ?? ''}>{departmentValue ?? '—'}</option>
                          )}
                    </select>
                  </div>
                ) : null}

                <button
                  type="button"
                  className="aha-menu-item"
                  onClick={() => {
                    setShowProfileMenu(false);
                    if (onMyProfile) {
                      onMyProfile();
                      return;
                    }
                    if (canChangePassword && showChangePasswordMenu) setShowPasswordModal(true);
                  }}
                  disabled={!onMyProfile && !(canChangePassword && showChangePasswordMenu)}
                >
                  <User size={18} />
                  <span className="aha-menu-label">My Profile</span>
                </button>

                {onMyProfile && canChangePassword && showChangePasswordMenu ? (
                  <button
                    type="button"
                    className="aha-menu-item"
                    onClick={() => {
                      setShowProfileMenu(false);
                      setShowPasswordModal(true);
                    }}
                  >
                    <Settings size={18} />
                    <span className="aha-menu-label">Change Password</span>
                  </button>
                ) : null}

                <button
                  type="button"
                  className="aha-menu-item danger"
                  onClick={() => {
                    setShowProfileMenu(false);
                    setShowSignOutConfirm(true);
                  }}
                >
                  <LogOut size={18} />
                  <span className="aha-menu-label">Sign Out</span>
                </button>
              </div>
            </div>
          ) : null}
        </button>
      </div>

      <SignOutConfirmModal
        open={showSignOutConfirm}
        onClose={() => setShowSignOutConfirm(false)}
        onConfirm={() => {
          setShowSignOutConfirm(false);
          if (onSignOut) onSignOut();
        }}
      />

      {showChangePasswordMenu ? (
        <ChangePasswordModal open={showPasswordModal} user={user} onClose={() => setShowPasswordModal(false)} />
      ) : null}
    </div>
  );
}
