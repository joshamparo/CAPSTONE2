import React from 'react';
import './AccountHeaderActions.css';

export default function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  subtext,
  cancelLabel = 'Cancel',
  confirmLabel = 'Confirm',
  confirmVariant = 'primary', // 'primary' | 'danger'
  confirmDisabled = false,
  cancelDisabled = false,
  error
}) {
  if (!open) return null;

  const confirmClass =
    confirmVariant === 'danger' ? 'aha-confirm-btn danger' : 'aha-confirm-btn primary';

  return (
    <div className="aha-confirm-overlay" onClick={onClose} role="presentation">
      <div
        className="aha-confirm-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Confirm action'}
      >
        {title ? <div className="aha-confirm-title">{title}</div> : null}
        {message ? <div className="aha-confirm-text">{message}</div> : null}
        {subtext ? <div className="aha-confirm-subtext">{subtext}</div> : null}
        {error ? <div className="aha-confirm-error">{error}</div> : null}

        <div className="aha-confirm-actions">
          <button
            type="button"
            className="aha-confirm-btn"
            onClick={onClose}
            disabled={cancelDisabled}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={confirmClass}
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

