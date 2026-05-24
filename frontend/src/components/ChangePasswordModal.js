import React, { useMemo, useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import './ChangePasswordModal.css';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

const getUserId = (u) => {
  const raw = u?._id ?? u?.id;
  if (raw == null) return null;
  const s = String(raw).trim();
  return s ? s : null;
};

const getRole = (u) => {
  const raw = u?.role ?? u?.account_type ?? u?.accountType ?? u?.roles;
  return String(raw || '').trim();
};

const getEmail = (u) => String(u?.email || '').trim();

const buildHeaders = (u) => {
  const role = getRole(u).toLowerCase();
  const email = getEmail(u);
  return {
    'Content-Type': 'application/json',
    ...(role ? { 'x-user-role': role } : {}),
    ...(email ? { 'x-user-email': email } : {})
  };
};

export default function ChangePasswordModal({ open, user, onClose }) {
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const criteria = useMemo(() => {
    const v = String(newPassword || '');
    return {
      length: v.length >= 11,
      hasNumber: /\d/.test(v),
      hasSpecial: /[!@#$%^&*(),.?":{}|<>]/.test(v),
      matches: !!v && String(confirmPassword || '') === v
    };
  }, [newPassword, confirmPassword]);

  const canSubmit =
    String(currentPassword || '').trim() &&
    String(newPassword || '').trim() &&
    String(confirmPassword || '').trim() &&
    criteria.length &&
    criteria.hasNumber &&
    criteria.hasSpecial &&
    criteria.matches;

  const reset = () => {
    setNotice('');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    if (onClose) onClose();
  };

  const submit = async () => {
    const id = getUserId(user);
    if (!id) {
      setNotice('Session error. Please login again.');
      return;
    }
    if (!canSubmit) {
      setNotice('Please complete all password fields and meet the requirements.');
      return;
    }
    setSaving(true);
    setNotice('');
    try {
      const res = await fetch(`${API_BASE}/api/staff/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: buildHeaders(user),
        body: JSON.stringify({
          currentPassword: String(currentPassword || '').trim(),
          password: String(newPassword || '').trim(),
          requiresPasswordAuth: true
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || 'Failed to update password');
      setNotice('Password updated successfully.');
      setTimeout(() => handleClose(), 800);
    } catch (e) {
      setNotice(String(e?.message || 'Failed to update password'));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="cpm-overlay" onClick={handleClose}>
      <div className="cpm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cpm-head">
          <div className="cpm-title">
            <KeyRound size={18} />
            Change Password
          </div>
          <button type="button" className="cpm-x" onClick={handleClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="cpm-body">
          <div className="cpm-field">
            <div className="cpm-label">Current Password</div>
            <input type="password" className="cpm-input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} disabled={saving} />
          </div>
          <div className="cpm-field">
            <div className="cpm-label">New Password</div>
            <input type="password" className="cpm-input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={saving} />
          </div>
          <div className="cpm-field">
            <div className="cpm-label">Confirm New Password</div>
            <input type="password" className="cpm-input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} disabled={saving} />
          </div>

          <div className="cpm-criteria">
            <div className={`cpm-crit ${criteria.length ? 'ok' : ''}`}>Minimum 11 characters</div>
            <div className={`cpm-crit ${criteria.hasNumber ? 'ok' : ''}`}>Contains a number</div>
            <div className={`cpm-crit ${criteria.hasSpecial ? 'ok' : ''}`}>Contains a special character</div>
            <div className={`cpm-crit ${criteria.matches ? 'ok' : ''}`}>Passwords match</div>
          </div>

          {notice ? <div className={`cpm-notice ${notice.toLowerCase().includes('success') ? 'ok' : ''}`}>{notice}</div> : null}
        </div>

        <div className="cpm-actions">
          <button type="button" className="cpm-btn" onClick={handleClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="cpm-btn primary" onClick={submit} disabled={saving || !canSubmit}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

