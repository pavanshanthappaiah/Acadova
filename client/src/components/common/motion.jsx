import React, { useEffect, useMemo, useRef, useState } from 'react';

/* ------------------------------------------------------------------ */
/* Motion primitives                                                   */
/*                                                                     */
/* Three rules hold everywhere in this file:                           */
/*   1. Motion is short and settles. Nothing loops for decoration.     */
/*   2. `prefers-reduced-motion` resolves everything to its final      */
/*      state immediately rather than merely running faster.           */
/*   3. Nothing moves the layout. Transforms and opacity only, so      */
/*      scroll-snap containers keep their geometry.                    */
/* ------------------------------------------------------------------ */

/** Live-updating reduced-motion preference. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/* ------------------------------------------------------------------ */
/* Reveal — a section settling into place as it enters the viewport    */
/*                                                                     */
/* Deliberately conservative: it observes once, unobserves immediately */
/* after firing, and never delays content that is already on screen.   */
/* IntersectionObserver accounts for clipping by ancestor scroll       */
/* containers, so this behaves correctly inside the scroll-snap        */
/* viewports on Academics and Problems without a custom root.          */
/* ------------------------------------------------------------------ */
export function Reveal({
  children,
  className = '',
  delay = 0,
  as: Tag = 'div',
  threshold = 0.12,
  ...rest
}) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  // `none` means: not yet allowed to hide. The class is only added once we
  // know we can observe, so a missing IntersectionObserver can never leave
  // content stuck at opacity 0.
  const [phase, setPhase] = useState('none');

  useEffect(() => {
    const node = ref.current;
    if (!node || reduced) return undefined;
    if (typeof IntersectionObserver === 'undefined') return undefined;

    // Anything already on screen at mount reveals on the next frame instead
    // of waiting for a scroll that may never happen.
    setPhase('hidden');

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setPhase('shown');
            io.unobserve(entry.target);
          }
        }
      },
      { threshold, rootMargin: '0px 0px -8% 0px' }
    );
    io.observe(node);

    // Safety net: reveal unconditionally if the observer has not fired by now.
    // IntersectionObserver only fires when the page produces frames, so a
    // backgrounded tab, a print job or a frame-less webview would otherwise
    // leave real content permanently invisible at opacity 0. Setting the final
    // phase twice is harmless, so no condition is needed here.
    const failsafe = setTimeout(() => setPhase('shown'), 1200);

    return () => {
      clearTimeout(failsafe);
      io.disconnect();
    };
  }, [reduced, threshold]);

  const classes = [
    'reveal',
    className,
    phase === 'shown' ? 'is-in' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tag
      ref={ref}
      className={classes}
      style={delay ? { '--reveal-delay': `${delay}ms` } : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------ */
/* useTween — drive a number to its target over a fixed, short window   */
/* ------------------------------------------------------------------ */
// Used by the goal rings and the metric counters. Reduced motion skips the
// tween entirely and renders the real value on the first frame.
export function useTween(target, { duration = 420 } = {}) {
  const reduced = useReducedMotion();
  const to = Number(target);
  const safeTarget = Number.isFinite(to) ? to : 0;
  const [value, setValue] = useState(reduced ? safeTarget : 0);
  const fromRef = useRef(reduced ? safeTarget : 0);

  useEffect(() => {
    if (reduced) {
      fromRef.current = safeTarget;
      setValue(safeTarget);
      return undefined;
    }

    const from = fromRef.current;
    if (from === safeTarget) {
      setValue(safeTarget);
      return undefined;
    }

    let frame = 0;
    const start = performance.now();
    const settle = () => {
      fromRef.current = safeTarget;
      setValue(safeTarget);
    };
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic — quick to leave zero, gentle on arrival.
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (safeTarget - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else settle();
    };
    frame = requestAnimationFrame(tick);

    // requestAnimationFrame is throttled to nothing in a backgrounded tab or a
    // frame-less webview. This guarantees the real value is always shown, so a
    // metric or a goal ring can never be stuck displaying zero.
    const failsafe = setTimeout(settle, duration + 120);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(failsafe);
    };
  }, [safeTarget, duration, reduced]);

  return value;
}

/** A real number counting to its real value. Never invents a figure. */
export function AnimatedValue({ value, format, className = '' }) {
  const numeric = typeof value === 'number' && Number.isFinite(value);
  const tweened = useTween(numeric ? value : 0);
  if (!numeric) return <span className={className}>{value}</span>;
  const shown = format ? format(tweened) : Math.round(tweened);
  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {shown}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* ProgressRing — goal progress drawn from the real value              */
/* ------------------------------------------------------------------ */
// `value` is 0-100. `null` means no target is configured, which is shown as
// an honest empty ring with the reason spelled out beneath it.
export function ProgressRing({
  value,
  size = 96,
  stroke = 3.5,
  label,
  caption,
  emptyLabel = 'No target',
  className = '',
}) {
  const hasTarget = value != null && Number.isFinite(Number(value));
  const clamped = hasTarget ? Math.max(0, Math.min(100, Number(value))) : 0;
  const drawn = useTween(clamped, { duration: 520 });
  const reduced = useReducedMotion();
  const radius = 15.5;
  const center = 18;

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90" aria-hidden="true">
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="#EAE5DD"
            strokeWidth={stroke}
          />
          {hasTarget && drawn > 0.5 && (
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke="#0F6E63"
              strokeWidth={stroke}
              strokeLinecap="round"
              pathLength="100"
              strokeDasharray={`${drawn} 100`}
              style={reduced ? undefined : { transition: 'none' }}
            />
          )}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="font-display text-lg font-semibold text-ink-900" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {hasTarget ? `${Math.round(drawn)}%` : emptyLabel}
          </span>
        </span>
      </div>
      {/* Label and figures stay in text, so the ring is never the only
          carrier of the information (contrast and colour-blind safety). */}
      {(label || caption) && (
        <div className="text-center leading-tight">
          {label && <p className="text-xs font-medium text-ink-700">{label}</p>}
          {caption && (
            <p className="text-2xs text-ink-500 mt-0.5" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {caption}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* useInView — one-shot visibility for charts that should draw on entry */
/* ------------------------------------------------------------------ */
export function useInView({ threshold = 0.2 } = {}) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            io.unobserve(entry.target);
          }
        }
      },
      { threshold }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [threshold]);

  return [ref, inView];
}

/**
 * Chart data that arrives from zero.
 *
 * Recharts accepts `animationDuration` directly; this hook just decides the
 * duration from the real data and the motion preference, so no chart has to
 * hard-code a number.
 */
export function useChartMotion() {
  const reduced = useReducedMotion();
  const motion = useMemo(
    () => (reduced
      ? { isAnimationActive: false, animationDuration: 0 }
      : { isAnimationActive: true, animationDuration: 420, animationEasing: 'ease-out' }),
    [reduced]
  );
  return motion;
}

/* No default export: a barrel object would reference every helper and defeat
   tree-shaking, and it also blocks Fast Refresh in development. */
