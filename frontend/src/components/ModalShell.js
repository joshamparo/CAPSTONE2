import React from 'react';
import { X } from 'lucide-react';
import './ModalShell.css';

export default function ModalShell({
  open,
  onClose,
  children,
  title = null,
  subtitle = null,
  maxWidth = 600,
  maxHeight = null,
  showCloseButton = true,
  closeOnOverlayClick = true,
  className = '',
  contentClassName = '',
  bodyClassName = ''
}) {
  if (!open) return null;

  return (
    <div
      className="ms-overlay"
      onClick={(e) => {
        if (closeOnOverlayClick && e.target === e.currentTarget && onClose) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`ms-card ${className}`}
        style={{ maxWidth: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth, ...(maxHeight ? { maxHeight } : {}) }}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || showCloseButton) ? (
          <div className={`ms-header ${contentClassName}`}>
            <div className="ms-title-wrap">
              {title ? <h2 className="ms-title">{title}</h2> : null}
              {subtitle ? <p className="ms-subtitle">{subtitle}</p> : null}
            </div>
            {showCloseButton && onClose ? (
              <button
                type="button"
                className="ms-close-btn"
                onClick={onClose}
                aria-label="Close modal"
              >
                <X size={18} strokeWidth={2.25} />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className={`ms-body ${bodyClassName}`}>{children}</div>
      </div>
    </div>
  );
}
