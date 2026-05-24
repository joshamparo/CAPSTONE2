import React from 'react';
import './AccountHeaderActions.css';

export default function SignOutConfirmModal({
  open,
  onClose,
  onConfirm,
  title = 'Sign out',
  message = 'Are you sure you want to logout?',
  cancelLabel = 'No',
  confirmLabel = 'Yes'
}) {
  if (!open) return null;

  return (
    <div className="aha-confirm-overlay" onClick={onClose}>
      <div className="aha-confirm-card" onClick={(e) => e.stopPropagation()}>
        <div className="aha-confirm-title">{title}</div>
        <div className="aha-confirm-text">{message}</div>
        <div className="aha-confirm-actions">
          <button type="button" className="aha-confirm-btn" onClick={onClose}>
            {cancelLabel}
          </button>
          <button type="button" className="aha-confirm-btn primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
