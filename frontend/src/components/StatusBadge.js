import React from 'react';
import './StatusBadge.css';

const KNOWN_VARIANTS = new Set(['duty', 'upcoming', 'off', 'scheduled']);

export default function StatusBadge({
  variant = 'scheduled',
  label,
  size = 'md',
  tone = null,
  color = null,
  className = '',
  style = null,
  icon = null,
  uppercase = true,
  onClick = null,
  showDot = true
}) {
  const resolvedVariant = tone || variant;
  const useKnown = KNOWN_VARIANTS.has(resolvedVariant);
  const classes = [
    'ui-badge',
    onClick ? 'ui-badge-clickable' : '',
    useKnown ? `ui-badge-${resolvedVariant}` : 'ui-badge-custom',
    size === 'sm' ? 'ui-badge-sm' : size === 'lg' ? 'ui-badge-lg' : 'ui-badge-md',
    className
  ].filter(Boolean).join(' ');

  let inlineStyle = useKnown ? {} : {
    color: color || 'var(--slate-600)',
    background: color ? `${color}1A` : 'var(--slate-100)',
    borderColor: color ? `${color}55` : 'var(--slate-200)'
  };
  if (style) inlineStyle = { ...inlineStyle, ...style };

  const renderedLabel = uppercase && typeof label === 'string'
    ? label.toUpperCase()
    : label;

  const interactionProps = onClick
    ? { onClick, role: 'button', tabIndex: 0, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } } }
    : {};

  return (
    <span className={classes} style={inlineStyle} {...interactionProps}>
      {icon
        ? <span className="ui-badge-icon">{icon}</span>
        : (showDot ? <span className="ui-badge-dot" aria-hidden></span> : null)}
      <span className="ui-badge-label">{renderedLabel}</span>
    </span>
  );
}
