import React, { useMemo, useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { API_BASE, buildAuthHeaders, fetchJson, getCurrentUser } from '../utils/api';
import './ChangePasswordModal.css';

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
      hasUpper: /[A-Z]/.test(v),
      hasLower: /[a-z]/.test(v),
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
    criteria.hasUpper &&
    criteria.hasLower &&
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
    if (!canSubmit) {
      setNotice('Please complete all password fields and meet the requirements.');
      return;
    }
    setSaving(true);
    setNotice('');
    try {
      const sessionUser = getCurrentUser() || {};
      const effectiveUser = {
        ...sessionUser,
        ...(user || {}),
        sessionToken: sessionUser?.sessionToken || user?.sessionToken || ''
      };
      const email = getEmail(effectiveUser) || getEmail(sessionUser);
      const headers = {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(effectiveUser, getRole(effectiveUser))
      };
      let id = getUserId(effectiveUser) || getUserId(sessionUser);
      if (!id) {
        if (!email) throw new Error('Your session is incomplete. Please log in again.');
        const profile = await fetchJson(`/api/staff/by-email?email=${encodeURIComponent(email)}`, {
          apiBase: API_BASE,
          headers
        });
        id = getUserId(profile);
      }
      if (!id) throw new Error('Unable to resolve your staff account. Please log in again.');

      const updated = await fetchJson(`/api/staff/${encodeURIComponent(id)}`, {
        apiBase: API_BASE,
        method: 'PUT',
        headers,
        body: JSON.stringify({
          currentPassword: String(currentPassword || ''),
          password: String(newPassword || '').trim(),
          requiresPasswordAuth: true
        })
      });
      const refreshedSession = {
        ...sessionUser,
        ...(updated || {}),
        sessionToken: updated?.sessionToken || sessionUser?.sessionToken
      };
      localStorage.setItem('currentUser', JSON.stringify(refreshedSession));
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
            <input type="password" aria-label="Current Password" className="cpm-input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} disabled={saving} />
          </div>
          <div className="cpm-field">
            <div className="cpm-label">New Password</div>
            <input type="password" aria-label="New Password" className="cpm-input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={saving} />
          </div>
          <div className="cpm-field">
            <div className="cpm-label">Confirm New Password</div>
            <input type="password" aria-label="Confirm New Password" className="cpm-input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} disabled={saving} />
          </div>

          <div className="cpm-criteria">
            <div className={`cpm-crit ${criteria.length ? 'ok' : ''}`}>Minimum 11 characters</div>
            <div className={`cpm-crit ${criteria.hasUpper ? 'ok' : ''}`}>Contains an uppercase letter</div>
            <div className={`cpm-crit ${criteria.hasLower ? 'ok' : ''}`}>Contains a lowercase letter</div>
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
