import React, { useEffect, useState } from 'react';
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
  error,
  requiredText = ''
}) {
  const [confirmation, setConfirmation] = useState('');
  useEffect(() => { if (open) setConfirmation(''); }, [open, requiredText]);
  if (!open) return null;

  const textMatches = !requiredText || confirmation === requiredText;

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
        {requiredText ? (
          <label className="aha-confirm-type">
            Type <strong>{requiredText}</strong> to continue
            <input
              className="aha-confirm-input"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              autoFocus
            />
          </label>
        ) : null}

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
            onClick={() => onConfirm(confirmation)}
            disabled={confirmDisabled || !textMatches}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
