import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Info, AlertCircle, CheckCircle2, AlertTriangle } from './Icons';

/* ================================================================== */
/* The shared visual system                                            */
/*                                                                     */
/* Every page composes from these primitives so that page padding,      */
/* heading rhythm, control heights, radii and states stay identical     */
/* across Today, My Day, Semester, Projects, Problems, Reviews and      */
/* Settings. Nothing here knows about business logic.                   */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/* Page header                                                         */
/*                                                                     */
/* One page-title pattern for the whole app: title, one line of         */
/* description, actions flush to the same right edge as the content     */
/* below it. Pages previously hand-rolled this block with drifting      */
/* sizes and baselines.                                                */
/* ------------------------------------------------------------------ */
export function PageHeader({ title, description, hint, actions, meta, className = '' }) {
  return (
    <header className={`flex flex-col gap-5 md:flex-row md:items-end md:justify-between ${className}`}>
      <div className="min-w-0">
        {meta && (
          <p className="mb-2 text-2xs font-medium uppercase tracking-wide2 text-ink-400">{meta}</p>
        )}
        <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tightest text-ink-900 sm:text-[2rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-500">
            {description}
            {hint && <HelpHint label={hint} className="ml-1 align-middle" />}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 md:justify-end">{actions}</div>}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Section header — inside a page, above a group of content            */
/* ------------------------------------------------------------------ */
export function SectionHeader({ title, description, hint, aside, level = 2, className = '' }) {
  const Tag = level === 2 ? 'h2' : 'h3';
  return (
    <div className={`flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Tag
            className={
              level === 2
                ? 'font-display text-lg font-semibold tracking-tightest text-ink-900'
                : 'text-sm font-semibold tracking-tight text-ink-900'
            }
          >
            {title}
          </Tag>
          {hint && <HelpHint label={hint} />}
        </div>
        {description && (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-500">{description}</p>
        )}
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/*                                                                     */
/* Four ranks, so a screen never shows two primary actions competing:  */
/*   primary   the one main action                                     */
/*   secondary a real but supporting action (bordered surface)         */
/*   tertiary  low-emphasis text action (never bordered)               */
/*   danger    destructive                                             */
/* ------------------------------------------------------------------ */
const buttonBase =
  'pressable inline-flex select-none items-center justify-center gap-1.5 font-medium ' +
  'disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none aria-disabled:cursor-not-allowed';

const buttonSizes = {
  xs: 'h-7 rounded-sm px-2.5 text-xs',
  sm: 'h-8 rounded px-3 text-xs',
  md: 'h-9 rounded px-4 text-sm',
};

const buttonVariants = {
  primary: 'bg-accent text-white hover:bg-accent-strong',
  secondary:
    'border border-line-strong bg-surface text-ink-700 hover:border-ink-300 hover:bg-paper-deep hover:text-ink-900',
  tertiary: 'text-ink-600 hover:bg-paper-deep hover:text-ink-900',
  danger: 'bg-danger text-white hover:bg-danger/85',
  /* An action on an already-tinted accent surface (for example inside the
     sync card), where a solid primary button would over-weight it. */
  'accent-quiet': 'bg-accent-soft text-accent-strong hover:bg-accent/15',
};

// Shared so a <Link> can wear the exact same skin as a button without nesting.
export const buttonStyles = (variant = 'primary', size = 'md') =>
  `${buttonBase} ${buttonSizes[size]} ${buttonVariants[variant] || buttonVariants.primary}`;

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  loading = false,
  children,
  disabled,
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${buttonStyles(variant, size)} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */
// A hairline border does the separation work; the shadow is a 1px optical
// settle, never a floating panel.
export const Card = ({ children, className = '', as: Tag = 'div', ...props }) => (
  <Tag className={`rounded-lg border border-line bg-surface shadow-card ${className}`} {...props}>
    {children}
  </Tag>
);

/* ------------------------------------------------------------------ */
/* Form controls                                                       */
/* ------------------------------------------------------------------ */
const inputBase =
  'pressable w-full rounded border border-line-strong bg-surface px-3 py-2 text-sm text-ink-900 ' +
  'placeholder-ink-300 focus:border-accent focus:shadow-focus-accent focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:bg-paper-deep disabled:text-ink-400';

// className must be pulled out BEFORE the spread: otherwise a caller-passed
// className would land after the JSX className and replace the whole base
// style (that exact bug wiped the border off the password field and stripped
// the History filter selects down to bare native elements).
export const Input = ({ className = '', ...props }) => (
  <input className={`${inputBase} ${className}`} {...props} />
);
export const Textarea = ({ className = '', ...props }) => (
  <textarea className={`${inputBase} ${className}`} {...props} />
);
export const Select = ({ className = '', ...props }) => (
  <select
    className={`${inputBase} ${className} cursor-pointer appearance-none bg-no-repeat pr-8`}
    style={{
      backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2378716C' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9.5 6 6 6-6'/%3E%3C/svg%3E\")",
      backgroundPosition: 'right 10px center',
    }}
    {...props}
  />
);

/**
 * Field — one label/control/hint/error pattern.
 * The label is always programmatically tied to the control, and an error is
 * announced (`role="alert"`) rather than only coloured.
 */
export function Field({ label, hint, error, required, children, className = '' }) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint && !error ? hintId : null]
    .filter(Boolean)
    .join(' ');
  const control = React.isValidElement(children)
    ? React.cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy || undefined,
        'aria-required': required || undefined,
      })
    : children;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-ink-600">
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
      </label>
      {control}
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-2xs text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="mt-1.5 text-2xs text-ink-400">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Badge — the ONE compact metadata chip                               */
/*                                                                     */
/* Audit result: status, difficulty, technology, sync state, academic   */
/* state, project state and review state all render through this.       */
/* Fixed height, fixed padding, fixed type size, hairline border. No    */
/* pill is ever used as a button.                                       */
/* ------------------------------------------------------------------ */
const badgeTones = {
  neutral: 'border-line-strong bg-paper-deep text-ink-600',
  quiet: 'border-line bg-surface-muted text-ink-500',
  accent: 'border-accent-fade bg-accent-soft text-accent-strong',
  ok: 'border-ok/25 bg-ok-soft text-ok',
  warn: 'border-warn/25 bg-warn-soft text-warn',
  danger: 'border-danger/25 bg-danger-soft text-danger',
};

const badgeDot = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  accent: 'bg-accent',
  neutral: 'bg-ink-400',
  quiet: 'bg-ink-300',
};

/**
 * Badge — the ONE compact metadata chip.
 *
 * Audit result (36 call sites): status, difficulty, technology, session type,
 * academic state, project state, sync state and review metadata all render
 * through this, and every one of them is the same shape. There is no second
 * capsule variant: a rounded capsule is not a different kind of information,
 * it is just an inconsistently rounded chip, so all chips are 22px tall with a
 * 5px corner, fixed padding and fixed 11px type.
 *
 * Opposed to buttons in every case: a badge is never clickable, and an icon may
 * be passed either as children (the common case) or through `icon`.
 */
export function Badge({ tone = 'neutral', dot = false, className = '', children }) {
  return (
    <span
      className={[
        'inline-flex h-[22px] shrink-0 select-none items-center gap-1.5 border',
        'rounded-sm px-2 text-2xs font-medium',
        badgeTones[tone] || badgeTones.neutral,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* A dot separates live state from static metadata without relying on
          colour alone: the word inside the badge always states the state too. */}
      {dot && (
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${badgeDot[tone] || badgeDot.neutral}`}
        />
      )}
      {children}
    </span>
  );
}

/* `Pill` is the same chip under its original name, kept so existing call sites
   keep working. New code should prefer `Badge`. */
export function Pill({ tone = 'neutral', dot = false, className = '', children }) {
  return (
    <Badge tone={tone} dot={dot} className={className}>
      {children}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Meters                                                              */
/* ------------------------------------------------------------------ */
// The numeric value always sits beside the bar, so progress is readable
// without perceiving colour or width alone.
export function ProgressBar({ value, tone = 'accent', className = '', label }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const tones = { accent: 'bg-accent', ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger' };
  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full bg-line ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className={`meter-fill h-full rounded-full ${tones[tone] || tones.accent}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Segmented control                                                   */
/* ------------------------------------------------------------------ */
export function SegmentedControl({ options, value, onChange, ariaLabel = 'View', className = '' }) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-0.5 rounded-md border border-line bg-paper-deep p-0.5 ${className}`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`pressable h-8 rounded-[5px] px-3 text-xs font-medium ${
              active
                ? 'border border-line bg-surface text-ink-900 shadow-card'
                : 'border border-transparent text-ink-500 hover:text-ink-900'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Switch & checkbox                                                   */
/* ------------------------------------------------------------------ */
export function Switch({ checked, onChange, label, disabled, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel || label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${
        checked ? 'bg-accent' : 'bg-line-strong'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-card transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}

// A real <input type="checkbox"> drives state, focus and keyboard support;
// the box next to it is purely visual. Nothing decorative is drawn around
// it, and no native browser chrome leaks through (hence `sr-only` + own box).
const CHECK_GLYPH =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23FFFFFF' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4.75 12.5 9.5 17.25 19.25 6.75'/%3E%3C/svg%3E\")";

export function Checkbox({
  checked = false,
  onChange,
  disabled = false,
  label,
  ariaLabel,
  id,
  className = '',
}) {
  return (
    <label
      className={`inline-flex select-none items-start gap-2.5 ${
        disabled ? 'cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
    >
      <span className="relative -m-1 inline-flex shrink-0 items-center justify-center p-1">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          aria-label={label ? undefined : ariaLabel}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          style={{ backgroundImage: checked ? CHECK_GLYPH : 'none' }}
          className={`h-[18px] w-[18px] rounded-[5px] border bg-center bg-no-repeat bg-[length:12px_12px] transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-accent/30 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface ${
            checked ? 'border-accent bg-accent' : 'border-line-strong bg-surface'
          } ${disabled ? 'opacity-45' : checked ? '' : 'peer-hover:border-accent-fade'}`}
        />
      </span>
      {label && (
        <span
          className={`text-sm leading-6 ${checked ? 'text-ink-500' : 'text-ink-900'} ${
            disabled ? 'text-ink-300' : ''
          }`}
        >
          {label}
        </span>
      )}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Modal & confirm dialog                                              */
/* ------------------------------------------------------------------ */
export function Modal({ open, onClose, title, subtitle, children, wide, footer }) {
  const panelRef = useRef(null);
  // Keep the latest handler without re-running the open/close effects: callers
  // pass inline arrows, so an identity-based dep would re-run on every keystroke.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current?.();
    };
    window.addEventListener('keydown', onKey);
    // A modal that locks the page behind it stops the background from
    // scrolling under a scroll-snap container.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Move focus into the dialog once, when it opens. Never again while it is
  // open — doing it on every render stole focus from the field being typed in.
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      if (panel.contains(document.activeElement)) return;
      panel.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  /* Render through a portal on document.body. Page wrappers keep entrance
     transforms (page-enter, reveal), and any transformed ancestor becomes the
     containing block for position: fixed descendants — a modal rendered in
     place would position against the page frame instead of the viewport and
     could land below the fold, unreachable while body scroll is locked. A
     portal detaches the dialog from that subtree entirely. */
  if (!open) return null;
  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : undefined}
    >
      <div className="absolute inset-0 bg-ink-900/35" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`animate-pop-in relative flex max-h-[92vh] w-full ${
          wide ? 'max-w-2xl' : 'max-w-lg'
        } flex-col rounded-t-xl border border-line bg-surface shadow-overlay focus:outline-none sm:rounded-xl`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 pb-4 pt-5 sm:px-6">
          <div>
            <h2 className="font-display text-base font-semibold tracking-tightest text-ink-900">
              {title}
            </h2>
            {subtitle && <p className="mt-1 text-xs text-ink-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="pressable -m-1.5 rounded p-1.5 text-ink-400 hover:bg-paper-deep hover:text-ink-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && <div className="border-t border-line px-5 py-4 sm:px-6">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = 'Confirm',
  danger,
  busy = false,
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm leading-relaxed text-ink-600">{body}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Loading, empty and error states                                     */
/*                                                                     */
/* These are real states, not decoration: a skeleton only renders while  */
/* a request is genuinely in flight, and an error always says what       */
/* failed. Nothing here fakes a delay or a result.                      */
/* ------------------------------------------------------------------ */
export function Skeleton({ className = '', as: Tag = 'div' }) {
  return (
    <Tag
      aria-hidden="true"
      className={`animate-pulse rounded-sm bg-paper-deep ${className}`}
    />
  );
}

/** A panel-shaped placeholder for a full card that is still loading. */
export function SkeletonPanel({ lines = 3, className = '', height }) {
  return (
    <Card className={`p-5 sm:p-6 ${className}`}>
      <Skeleton className="h-3 w-28" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
        ))}
      </div>
      {height && <Skeleton className={`mt-4 ${height}`} />}
    </Card>
  );
}

/**
 * StateNote — the single place a page says "working", "done", "failed" or
 * "nothing here yet". Errors carry role="alert" so they are announced.
 */
export function StateNote({ tone = 'info', title, children, action, className = '' }) {
  const tones = {
    info: { wrap: 'border-line bg-paper-deep/60 text-ink-600', Icon: Info, icon: 'text-ink-400' },
    success: { wrap: 'border-accent-fade bg-accent-wash text-accent-strong', Icon: CheckCircle2, icon: 'text-accent' },
    warn: { wrap: 'border-warn/25 bg-warn-soft text-warn', Icon: AlertTriangle, icon: 'text-warn' },
    error: { wrap: 'border-danger/25 bg-danger-soft text-danger', Icon: AlertCircle, icon: 'text-danger' },
  };
  const t = tones[tone] || tones.info;
  const Icon = t.Icon;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start justify-between gap-3 rounded-md border px-3.5 py-3 text-xs ${t.wrap} ${className}`}
    >
      <span className="flex min-w-0 items-start gap-2">
        <Icon className={`mt-px h-4 w-4 shrink-0 ${t.icon}`} />
        <span className="min-w-0">
          {title && <span className="block font-medium">{title}</span>}
          {children && <span className="block leading-relaxed">{children}</span>}
        </span>
      </span>
      {action && <span className="shrink-0">{action}</span>}
    </div>
  );
}

export function EmptyState({ title, description, action, icon: Icon, className = '' }) {
  return (
    <div className={`px-6 py-14 text-center ${className}`}>
      {Icon && (
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-paper-deep text-ink-400">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      {description && (
        <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-ink-500">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* HelpHint — the ONE global info tooltip                              */
/*                                                                     */
/* For non-critical explanations only. Validation requirements,        */
/* warnings, restrictions and empty-state guidance stay visible.       */
/* Opens on hover (desktop), focus (keyboard) and tap (touch); Esc or  */
/* an outside tap dismisses. Fixed positioning flips above/below the   */
/* trigger and clamps inside the viewport, so it survives scrolling    */
/* containers and card edges without a portal.                         */
/* ------------------------------------------------------------------ */
export function HelpHint({ label, className = '' }) {
  const [hovered, setHovered] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);
  const [pos, setPos] = React.useState(null);
  const wrapRef = useRef(null);
  const tipRef = useRef(null);
  const id = useId();
  const open = hovered || pinned;

  const place = React.useCallback(() => {
    const wrap = wrapRef.current;
    const tip = tipRef.current;
    if (!wrap || !tip) return;
    const wr = wrap.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    const x = Math.max(8, Math.min(wr.left + wr.width / 2 - tr.width / 2, window.innerWidth - tr.width - 8));
    let y = wr.top - tr.height - 8;
    if (y < 8) y = Math.min(wr.bottom + 8, window.innerHeight - tr.height - 8);
    if (y < 8) y = 8; // cramped viewport: keep it on screen, anchored near the top
    setPos({ x, y });
  }, []);

  React.useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setHovered(false);
        setPinned(false);
      }
    };
    const reflow = () => place();
    document.addEventListener('pointerdown', onDocDown, true);
    window.addEventListener('scroll', reflow, true);
    window.addEventListener('resize', reflow);
    return () => {
      document.removeEventListener('pointerdown', onDocDown, true);
      window.removeEventListener('scroll', reflow, true);
      window.removeEventListener('resize', reflow);
    };
  }, [open, place]);

  return (
    <span ref={wrapRef} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        aria-label="More information"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        /* The tap target is 26px even though the glyph is 14px: an 18px icon
           box is under the minimum comfortable touch size on a phone. */
        className="pressable -m-1 inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-ink-400 hover:bg-accent-soft hover:text-accent-strong focus-visible:shadow-focus-accent focus-visible:outline-none"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={() => setPinned((p) => !p)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setHovered(false);
            setPinned(false);
          }
        }}
      >
        <Info className="h-3.5 w-3.5" strokeWidth={1.9} />
      </button>
      {open && (
        <span
          ref={tipRef}
          id={id}
          role="tooltip"
          className="fixed z-50 rounded border border-line-strong bg-surface px-3 py-2 text-xs leading-relaxed text-ink-700 shadow-card"
          style={
            pos
              ? { left: pos.x, top: pos.y, width: Math.min(288, window.innerWidth - 16) }
              : { visibility: 'hidden', width: 288 }
          }
        >
          {label}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Metric composition                                                  */
/*                                                                     */
/* Deliberately NOT a row of four identical boxes. A dashboard gains a  */
/* hierarchy from a primary figure, a supporting set of secondary       */
/* figures on a quieter surface, and the context that explains them.    */
/* ------------------------------------------------------------------ */
export function Metric({ label, value, unit, hint, className = '', emphasis = 'secondary' }) {
  const primary = emphasis === 'primary';
  return (
    <div className={className}>
      <p className="text-2xs font-medium uppercase tracking-wide2 text-ink-400">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1.5">
        <span
          className={
            primary
              ? 'font-display text-[2.75rem] font-semibold leading-none tracking-tightest text-ink-900'
              : 'font-display text-xl font-semibold leading-none tracking-tightest text-ink-900'
          }
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {value}
        </span>
        {unit && <span className="text-xs font-medium text-ink-500">{unit}</span>}
      </p>
      {hint && <p className="mt-1.5 text-2xs leading-relaxed text-ink-400">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Date helpers                                                        */
/* ------------------------------------------------------------------ */
// Local calendar date — `toISOString()` would hand back the UTC day, which is
// the wrong "today" for anyone east or west of Greenwich.
export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DateNavigator({ value, onChange, display, isToday }) {
  const shift = (days) => {
    const [y, m, d] = value.split('-').map(Number);
    const dt = new Date(y, m - 1, d + days);
    const next = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    onChange(next);
  };
  return (
    <div className="flex items-center gap-1.5">
      <Button variant="secondary" size="sm" onClick={() => shift(-1)} aria-label="Previous day" title="Previous day">
        &larr;
      </Button>
      <div className="flex h-8 items-center gap-2 rounded border border-line-strong bg-surface px-3">
        <span className="whitespace-nowrap text-xs font-medium text-ink-900">{display}</span>
        <input
          type="date"
          value={value}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          aria-label="Pick a date"
          className="h-4 w-4 cursor-pointer border-0 bg-transparent p-0 text-ink-400 focus:shadow-focus-accent"
        />
      </div>
      <Button variant="secondary" size="sm" onClick={() => shift(1)} aria-label="Next day" title="Next day">
        &rarr;
      </Button>
      {!isToday && (
        <Button variant="tertiary" size="sm" onClick={() => onChange(localDateStr())}>
          Today
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page frame                                                          */
/*                                                                     */
/* The single content rhythm: sections separated by a consistent space  */
/* and a routed page that settles in once on entry.                     */
/* ------------------------------------------------------------------ */
export function PageFrame({ children, className = '' }) {
  return <div className={`page-enter space-y-8 pb-6 ${className}`}>{children}</div>;
}
