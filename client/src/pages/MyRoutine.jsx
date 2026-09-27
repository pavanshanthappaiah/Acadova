import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {  Plus, Pencil, Trash2, AlertCircle, CheckSquare, GraduationCap, ListChecks, Lock, CalendarOff,
  TrendingUp, Link2, ChevronDown,
} from '../components/common/Icons';
import API from '../services/api';
import {
  Button, Card, Field, Input, Select, Textarea, Pill, Modal, ConfirmDialog, EmptyState,
  SegmentedControl, ProgressBar, DateNavigator, Checkbox, localDateStr, HelpHint,
  PageHeader, PageFrame,
} from '../components/common/ui';

const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const todayStr = localDateStr;

/* ------------------------------------------------------------------ */
/* Local time helpers (mirror of server/utils/time.js)                 */
/* ------------------------------------------------------------------ */
const toMin = (value) => {
  if (!value || typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const mer = m[3] ? m[3].toUpperCase() : null;
  if (Number.isNaN(h) || Number.isNaN(min) || min > 59) return null;
  if (mer) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (mer === 'PM' ? 12 : 0);
  } else if (h > 23) return null;
  return h * 60 + min;
};

const to12h = (value) => {
  const min = toMin(value);
  if (min == null) return value || '';
  const h24 = Math.floor(min / 60);
  const mer = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(min % 60).padStart(2, '0')} ${mer}`;
};

const timeRange = (start, end) => {
  if (!start && !end) return null;
  if (!end || end === start) return to12h(start);
  return `${to12h(start)} to ${to12h(end)}`;
};

/**
 * Compact range for the fixed time column: when both ends share a meridiem
 * it is shown once ("6:00 – 7:00 AM") so the column never wraps.
 */
const timeRangeCompact = (start, end) => {
  const s = toMin(start);
  const e = toMin(end);
  if (s == null) return end ? to12h(end) : null;
  if (e == null || e === s) return to12h(start);
  const mer = (m) => (Math.floor(m / 60) >= 12 ? 'PM' : 'AM');
  const h12 = (m) => {
    const h24 = Math.floor(m / 60);
    return `${h24 % 12 === 0 ? 12 : h24 % 12}:${String(m % 60).padStart(2, '0')}`;
  };
  if (mer(s) === mer(e)) return `${h12(s)} to ${h12(e)} ${mer(e)}`;
  return `${h12(s)} ${mer(s)} to ${h12(e)} ${mer(e)}`;
};

const nowMinutesLocal = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

const longDate = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
};

const shortDay = (dayName) => dayName.slice(0, 3);

/**
 * Display-only formatting of recurrence data: a consecutive run of days
 * collapses to "Mon–Sat", anything else to a compact "Mon, Wed, Fri".
 * The underlying routine data is never touched.
 */
const formatRecurrence = (days) => {
  if (!Array.isArray(days) || days.length === 0) return 'Repeats';
  if (days.includes('Every Day') || days.includes('daily')) return 'Every day';
  const selected = WEEK.filter((d) => days.includes(d));
  if (selected.length === 0) return 'Repeats';
  if (selected.length === 7) return 'Every day';
  const abbr = selected.map((d) => d.slice(0, 3));
  const consecutive = selected.every(
    (d, i) => i === 0 || WEEK.indexOf(d) === WEEK.indexOf(selected[i - 1]) + 1
  );
  if (consecutive) {
    return abbr.length === 1 ? abbr[0] : `${abbr[0]} to ${abbr[abbr.length - 1]}`;
  }
  return abbr.join(', ');
};

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/* ------------------------------------------------------------------ */
/* Category picker — the student's own categories, searchable, with     */
/* inline creation. Nothing is hardcoded; the list comes from the API.  */
/* ------------------------------------------------------------------ */
const CategoryPicker = ({ value, onChange, categories, onCreate, error }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const matches = categories.filter((c) => !q || c.name.toLowerCase().includes(q));
  const exact = q && categories.some((c) => c.name.toLowerCase() === q);

  const create = async () => {
    if (!newName.trim() || busy) return;
    setBusy(true);
    try {
      const name = await onCreate(newName.trim());
      if (name) {
        onChange(name);
        setOpen(false);
      }
    } finally {
      setBusy(false);
      setCreating(false);
      setNewName('');
      setQuery('');
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full h-9 px-3 rounded-md border border-line-strong bg-surface text-sm text-left flex items-center justify-between gap-2 hover:border-accent-fade focus:outline-none focus:border-accent"
      >
        <span className={value ? 'text-ink-900 truncate' : 'text-ink-400 truncate'}>{value || 'Optional'}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-ink-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-line bg-surface shadow-overlay p-1.5" role="listbox" aria-label="Categories">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search categories…"
            aria-label="Search categories"
            className="!h-8 !text-xs mb-1"
          />
          <ul className="max-h-40 overflow-y-auto">
            {matches.map((c) => (
              <li key={c.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={c.name === value}
                  onClick={() => {
                    onChange(c.name);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-2.5 h-8 rounded text-sm transition-colors ${
                    c.name === value ? 'bg-accent-soft text-accent-strong font-medium' : 'text-ink-700 hover:bg-paper-deep'
                  }`}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
          {creating ? (
            <div className="mt-1 pt-1.5 border-t border-line flex items-center gap-1.5">
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    create();
                  }
                }}
                placeholder="New category"
                aria-label="New category name"
                className="!h-8 !text-xs"
              />
              <Button size="xs" onClick={create} disabled={busy || !newName.trim()}>
                Create
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="w-full text-left mt-1 pt-1.5 border-t border-line px-2.5 h-8 rounded text-sm text-accent-strong hover:bg-accent-soft inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              {q && !exact ? `Create “${query.trim()}”` : 'Create new category'}
            </button>
          )}
        </div>
      )}
      {error && <p className="text-2xs text-danger mt-1">{error}</p>}
    </div>
  );
};

/** Compact label/value cell for an expanded row's details panel. */
const DetailItem = ({ label, value }) => (
  <div>
    <p className="text-2xs uppercase tracking-wide2 text-ink-400">{label}</p>
    <p className="text-xs text-ink-700 mt-0.5">{value}</p>
  </div>
);

/* ------------------------------------------------------------------ */
/* Minimal SVG trend line — thin, restrained, real points only         */
/* ------------------------------------------------------------------ */
const TrendChart = ({ slots, emptyMessage, labelEvery = 1 }) => {
  const W = 640;
  const H = 190;
  const PL = 36;
  const PR = 12;
  const PT = 14;
  const PB = 28;
  const iw = W - PL - PR;
  const ih = H - PT - PB;
  const n = slots.length;

  const x = (i) => PL + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v) => PT + ih - (Math.max(0, Math.min(100, v)) / 100) * ih;

  const runs = [];
  let run = [];
  slots.forEach((s, i) => {
    if (s.pct != null) run.push({ ...s, i });
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length) runs.push(run);

  if (runs.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-ink-400 border border-dashed border-line rounded-lg">
        {emptyMessage}
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto"
      role="img"
      aria-label="Completion percentage over time"
    >
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="#E7E2DA" strokeWidth="1" />
          <text x={PL - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#9B948C">{v}</text>
        </g>
      ))}
      {runs.map((r, ri) => (
        <path
          key={ri}
          d={r.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(' ')}
          fill="none"
          stroke="#0F6E63"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {runs.flat().map((p) => (
        <circle
          key={`${p.i}-${p.label}`}
          cx={x(p.i)}
          cy={y(p.pct)}
          r={p.pct === 100 ? 3 : 2.5}
          fill={p.pct === 100 ? '#217A57' : '#0F6E63'}
        >
          <title>{`${p.label}: ${p.pct}%`}</title>
        </circle>
      ))}
      {slots.map((s, i) =>
        i % labelEvery === 0 || i === n - 1 ? (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#9B948C">
            {s.label}
          </text>
        ) : null
      )}
    </svg>
  );
};

/* ------------------------------------------------------------------ */
/* Timeline pieces                                                     */
/* ------------------------------------------------------------------ */
const GroupLabel = ({ children }) => (
  <p className="text-2xs font-medium uppercase tracking-wide2 text-ink-400">{children}</p>
);

/** One consistent status chip for every kind of row. */
const StatusChip = ({ item }) => {
  const isAcademic = item.source === 'academic';
  if (isAcademic) {
    if (item.attendanceStatus === 'attended') return <Pill tone="ok">Present</Pill>;
    if (item.attendanceStatus === 'missed') return <Pill tone="danger">Absent</Pill>;
    if (item.attendanceStatus === 'cancelled') return <Pill>Cancelled</Pill>;
    if (item.locked) {
      return (
        <Pill>
          <Lock className="w-3 h-3" /> After {to12h(item.lockAt)}
        </Pill>
      );
    }
    return <Pill>Not marked</Pill>;
  }
  if (item.completed) return <Pill tone="ok">Completed</Pill>;
  if (item.locked && item.flexible) {
    return (
      <Pill>
        <Lock className="w-3 h-3" /> After timed routines
      </Pill>
    );
  }
  if (item.locked) {
    return (
      <Pill>
        <Lock className="w-3 h-3" /> After {to12h(item.lockAt)}
      </Pill>
    );
  }
  return <Pill>Not completed</Pill>;
};

/**
 * Checklist status cell. The unlock time has its own column here, so this is
 * pure completion state — no duplicated "After …" text.
 */
const RoutineStatusCell = ({ routine }) => {
  if (routine.completed) return <Pill tone="ok">Completed</Pill>;
  if (routine.locked && routine.flexible) return <Pill>After timed routines</Pill>;
  if (routine.locked) return <Pill>Not yet available</Pill>;
  return <Pill>Not completed</Pill>;
};

/** The actionable control for a row: routine checkbox or attendance link. */
const RowControl = ({ item, onToggle }) => {
  if (item.source === 'academic') {
    if (item.attendanceStatus === 'unmarked' && !item.locked) {
      return (
        <a
          href="/academics"
          className="inline-flex items-center gap-1 text-2xs font-medium text-accent hover:text-accent-strong whitespace-nowrap"
          title="Mark attendance in the Academics page"
        >
          Mark <Link2 className="w-3 h-3" />
        </a>
      );
    }
    return null;
  }
  return (
    <Checkbox
      className="mt-px"
      checked={!!item.completed}
      disabled={!!item.locked}
      onChange={onToggle}
      ariaLabel={
        item.locked
          ? item.flexible
            ? `Opens after all timed routines are marked, ${item.title}`
            : `Available after ${to12h(item.lockAt)}, ${item.title}`
          : `Mark “${item.title}” ${item.completed ? 'not done' : 'done'}`
      }
    />
  );
};

/**
 * Desktop column headings for the My Day list — TIME | ACTIVITY | STATUS |
 * COMPLETED — so every row reads as the same table. The rail column has no
 * heading on purpose.
 */
const DayColumnHeader = () => (
  <div
    aria-hidden="true"
    className="hidden xl:grid grid-cols-[7rem_1.25rem_minmax(0,1fr)_10rem_5rem] gap-x-4 pb-2 mb-2 border-b border-line"
  >
    <span className="text-center text-2xs font-medium uppercase tracking-wide2 text-ink-400">Time</span>
    <span />
    <span className="text-center text-2xs font-medium uppercase tracking-wide2 text-ink-400">Activity</span>
    <span className="text-center text-2xs font-medium uppercase tracking-wide2 text-ink-400">Status</span>
    <span className="text-center text-2xs font-medium uppercase tracking-wide2 text-ink-400">Completed</span>
  </div>
);

/**
 * One row of the daily timeline: TIME | marker | ACTIVITY | STATUS | COMPLETED.
 * The marker column carries a continuous hairline; rows sit flush so the
 * line reads as one rail through the day.
 */
const TimelineItem = ({ item, isLast, untimed = false, onToggle }) => {
  const isAcademic = item.source === 'academic';
  const range = untimed ? '-' : timeRangeCompact(item.startTime, item.endTime) || '-';

  const metaParts = isAcademic
    ? [item.entryType === 'lab' ? 'Lab' : 'Theory', item.code, item.room].filter(Boolean)
    : [item.category, capitalize(item.priority), item.isRecurring ? formatRecurrence(item.recurrenceDays) : null].filter(
        Boolean
      );

  const done = isAcademic
    ? item.attendanceStatus === 'attended'
    : item.completed;
  const missed = isAcademic && item.attendanceStatus === 'missed';
  const cancelled = isAcademic && item.attendanceStatus === 'cancelled';

  const dotClass = untimed
    ? 'border-line-strong bg-surface'
    : cancelled
      ? 'border-line-strong bg-surface'
      : missed
        ? 'border-danger bg-surface'
        : done
          ? isAcademic
            ? 'border-accent bg-accent'
            : 'border-accent bg-accent'
          : isAcademic
            ? 'border-accent bg-surface'
            : 'border-ink-400 bg-surface';

  return (
    <li
      className="grid grid-cols-[1.25rem_minmax(0,1fr)] xl:grid-cols-[7rem_1.25rem_minmax(0,1fr)_10rem_5rem] gap-x-3 xl:gap-x-4"
    >
      {/* TIME — fixed column, right-aligned, never shifts or wraps */}
      <div
        className={`hidden xl:block text-center font-mono text-2xs text-ink-500 leading-5 whitespace-nowrap ${
          untimed ? 'italic font-sans text-ink-400' : ''
        }`}
      >
        {range}
      </div>

      {/* TIMELINE — continuous rail + one marker per row */}
      <div className="relative self-stretch">
        {!untimed && !isLast && (
          <span aria-hidden="true" className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-line" />
        )}
        {!untimed && isLast && (
          <span aria-hidden="true" className="absolute left-1/2 -translate-x-1/2 top-0 h-2 w-px bg-line" />
        )}
        <span
          aria-hidden="true"
          className={`absolute left-1/2 -translate-x-1/2 top-1.5 w-2 h-2 rounded-full border-2 ${dotClass}`}
        />
      </div>

      {/* ACTIVITY */}
      <div className="pb-5 min-w-0">
        <div className="xl:hidden font-mono text-2xs text-ink-500 leading-5 mb-0.5">{range}</div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`text-sm leading-5 ${done || cancelled ? 'text-ink-400' : 'font-medium text-ink-900'} ${done ? 'line-through' : ''}`}>
            {item.title}
          </span>
        </div>
        {metaParts.length > 0 && (
          <p className="text-xs text-ink-500 mt-0.5 leading-4">{metaParts.join(' · ')}</p>
        )}
        {/* A locked routine's unlock time already sits in the status chip; no
            second line needed. */}
        {/* STATUS + COMPLETED — stacked under the activity on mobile */}
        <div className="xl:hidden mt-2 flex items-center gap-2.5">
          <StatusChip item={item} />
          <RowControl item={item} onToggle={onToggle} />
        </div>
      </div>

      {/* STATUS — its own fixed column, centred like its heading */}
      <div className="hidden xl:flex items-start justify-center min-w-0">
        <StatusChip item={item} />
      </div>

      {/* COMPLETED — its own narrow column, vertically aligned per row */}
      <div className="hidden xl:flex items-start justify-center pt-0.5">
        <RowControl item={item} onToggle={onToggle} />
      </div>
    </li>
  );
};

/* ------------------------------------------------------------------ */
/* Main page                                                           */
/* ------------------------------------------------------------------ */
export const MyRoutine = () => {
  const [view, setView] = useState('combined'); // 'routines' | 'combined'. My Day opens on the full daily view
  const [range, setRange] = useState('day'); // analytics: 'day' | 'week' | 'month'
  const [date, setDate] = useState(todayStr());

  const [routines, setRoutines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [timeline, setTimeline] = useState([]);
  const [dayInfo, setDayInfo] = useState(null);
  const [dayProgress, setDayProgress] = useState(null);

  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    title: '',
    category: '',
    priority: 'medium',
    startTime: '',
    endTime: '',
    notes: '',
    recurrenceDays: [],
  });
  const [categories, setCategories] = useState([]);
  const [categoryError, setCategoryError] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  const loadRoutines = useCallback(async (d) => {
    setLoading(true);
    try {
      const res = await API.get(`/routines?date=${d}`);
      if (res.data?.success) {
        setRoutines(res.data.routines || []);
        setLoadError('');
      }
    } catch (err) {
      console.error('Error loading routines:', err);
      setLoadError(err.response?.data?.message || 'Could not load your routines. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTimeline = useCallback(async (d) => {
    try {
      const res = await API.get(`/routines/combined-daily?date=${d}`);
      if (res.data?.success) {
        setTimeline(res.data.timeline || []);
        setDayInfo(res.data);
        setDayProgress(res.data.progress || null);
      }
    } catch (err) {
      console.error('Error loading combined timeline:', err);
    }
  }, []);

  const loadAnalytics = useCallback(async (d) => {
    setAnalyticsLoading(true);
    try {
      const res = await API.get(`/routines/analytics?date=${d}`);
      if (res.data?.success) {
        setAnalytics(res.data);
        setAnalyticsError('');
      }
    } catch (err) {
      console.error('Error loading analytics:', err);
      setAnalyticsError(err.response?.data?.message || 'Could not load progress analytics.');
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRoutines(date);
    loadTimeline(date);
    loadAnalytics(date);
  }, [date, loadRoutines, loadTimeline, loadAnalytics]);

  /* ---- Real-time lock release: when a locked item's end time passes on
     the local clock, re-read from the server instead of patching state
     locally, so the server stays the single source of truth. ---- */
  const nowTick = useState(0)[1];
  const refreshForUnlock = useRef(false);
  useEffect(() => {
    const id = setInterval(() => nowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [nowTick]);

  useEffect(() => {
    const today = todayStr();
    const nowMin = nowMinutesLocal();
    const unlockable = [...timeline, ...routines].some(
      (item) =>
        item.locked &&
        // Flexible routines have no clock time to wait for — their gate opens
        // when another action (marking the last timed routine) lands, so the
        // periodic re-read is what notices it.
        ((item.flexible && (item.date || date) === today) ||
          (item.lockAt &&
            (item.date || date) === today &&
            toMin(item.lockAt) != null &&
            nowMin >= toMin(item.lockAt)))
    );
    if (unlockable && !refreshForUnlock.current) {
      refreshForUnlock.current = true;
      loadRoutines(date);
      loadTimeline(date);
      loadAnalytics(date);
    }
    if (!unlockable) refreshForUnlock.current = false;
  }, [nowTick, timeline, routines, date, loadRoutines, loadTimeline, loadAnalytics]);

  const completedCount = routines.filter((r) => r.completed).length;
  const pct = routines.length ? Math.round((completedCount / routines.length) * 100) : 0;

  const refetchAll = useCallback(
    (d) => {
      loadRoutines(d);
      loadTimeline(d);
      loadAnalytics(d);
    },
    [loadRoutines, loadTimeline, loadAnalytics]
  );

  // Server-first: no optimistic checkbox state, so a rejected early completion
  // never flashes as completed. The re-read refreshes every view.
  const toggle = async (routine) => {
    const next = !routine.completed;
    try {
      await API.post(`/routines/${routine._id}/toggle`, { date, completed: next });
      setLoadError('');
      refetchAll(date);
    } catch (err) {
      const msg = err.response?.data?.message;
      setLoadError(msg || 'Could not save that change. Showing the last saved state.');
      loadRoutines(date);
    }
  };

  // Same rule from the My Day timeline — same endpoint, same server-side lock.
  const toggleTimeline = async (item) => {
    try {
      await API.post(`/routines/${item._id}/toggle`, { date, completed: !item.completed });
      setLoadError('');
      refetchAll(date);
    } catch (err) {
      setLoadError(err.response?.data?.message || 'Could not save that change.');
      loadTimeline(date);
    }
  };

  // The student's own categories — real records only, scoped server-side.
  const loadCategories = useCallback(async () => {
    try {
      const res = await API.get('/routines/categories');
      if (res.data?.success) setCategories(res.data.categories || []);
    } catch {
      /* the picker still allows typing if the list can't load */
    }
  }, []);

  const createCategory = async (name) => {
    setCategoryError('');
    try {
      const res = await API.post('/routines/categories', { name });
      if (res.data?.success) {
        const cat = res.data.category;
        if (cat) {
          setCategories((prev) =>
            prev.some((c) => c.name.toLowerCase() === cat.name.toLowerCase())
              ? prev
              : [...prev, { _id: cat._id, name: cat.name }].sort((a, b) => a.name.localeCompare(b.name))
          );
        }
        return cat?.name || name;
      }
    } catch (err) {
      setCategoryError(err.response?.data?.message || 'Could not create the category.');
    }
    return null;
  };

  const openCreate = () => {
    setEditing(null);
    setForm({
      title: '',
      category: '',
      priority: 'medium',
      startTime: '',
      endTime: '',
      notes: '',
      recurrenceDays: [],
    });
    setError('');
    setCategoryError('');
    loadCategories();
    setModalOpen(true);
  };

  const openEdit = (r) => {
    setEditing(r);
    setForm({
      title: r.title || '',
      category: r.category || '',
      priority: r.priority || 'medium',
      startTime: r.startTime || '',
      endTime: r.endTime || '',
      notes: r.notes || '',
      recurrenceDays: r.recurrenceDays?.length ? r.recurrenceDays : [],
    });
    setError('');
    setCategoryError('');
    loadCategories();
    setModalOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setError('');
    // Whether the routine is timed is inferred from the entered times; whether
    // it repeats is inferred from the selected days. No extra checkboxes.
    if (form.endTime && !form.startTime) {
      setError('Add a start time to use an end time.');
      return;
    }
    if (form.startTime && form.endTime && form.endTime <= form.startTime) {
      setError('End time must be after start time.');
      return;
    }
    const payload = {
      title: form.title,
      category: form.category.trim() || 'Personal',
      priority: form.priority,
      startTime: form.startTime || '',
      endTime: form.endTime || '',
      notes: form.notes,
      isRecurring: form.recurrenceDays.length > 0,
      recurrenceDays: form.recurrenceDays,
      date: editing ? editing.date : date,
    };
    try {
      if (editing) {
        await API.put(`/routines/${editing._id}`, payload);
      } else {
        await API.post('/routines', { ...payload, date });
      }
      // The list, the combined timeline and the analytics are all re-read from
      // the server so every view reflects real database state.
      setModalOpen(false);
      setEditing(null);
      refetchAll(date);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save the routine.');
    }
  };

  const remove = async () => {
    try {
      await API.delete(`/routines/${confirmDelete._id}`);
      setConfirmDelete(null);
      refetchAll(date);
    } catch {
      setConfirmDelete(null);
    }
  };

  const toggleRecurrenceDay = (day) => {
    setForm((f) => {
      let next;
      if (day === 'Every Day') {
        next = f.recurrenceDays.includes('Every Day') ? [] : ['Every Day'];
      } else {
        const withoutAll = f.recurrenceDays.filter((d) => d !== 'Every Day');
        next = withoutAll.includes(day) ? withoutAll.filter((d) => d !== day) : [...withoutAll, day];
      }
      return { ...f, recurrenceDays: next };
    });
  };

  /* ---------------- Combined day derivations (real data only) ---------------- */
  const { timedItems, untimedItems } = useMemo(() => {
    const timed = timeline
      .filter((i) => i.startTime)
      .sort(
        (a, b) =>
          (toMin(a.startTime) ?? 0) - (toMin(b.startTime) ?? 0) ||
          (toMin(a.endTime) ?? 0) - (toMin(b.endTime) ?? 0) ||
          String(a.title || '').localeCompare(String(b.title || ''))
      );
    const untimed = timeline.filter((i) => !i.startTime);
    return { timedItems: timed, untimedItems: untimed };
  }, [timeline]);

  /* ---------------- Analytics derivations (real data only) ---------------- */
  const weekSlots = useMemo(
    () =>
      (analytics?.week?.days || []).map((d) => ({
        label: shortDay(d.dayOfWeek),
        pct: d.progress.percentage,
        title: `${longDate(d.date)}, ${
          d.progress.total === 0
            ? 'no items scheduled'
            : d.progress.percentage == null
              ? 'nothing completable'
              : `${d.progress.percentage}%`
        }`,
      })),
    [analytics]
  );

  const monthSlots = useMemo(
    () =>
      (analytics?.month?.days || []).map((d) => ({
        label: String(Number(d.date.slice(8, 10))),
        pct: d.progress.percentage,
      })),
    [analytics]
  );

  const weekTotal = analytics?.week?.totals;
  const monthTotal = analytics?.month?.totals;

  const displayDate = longDate(date);

  const routineCounts = dayInfo
    ? { academicCount: dayInfo.academicCount || 0, routineCount: dayInfo.routineCount || 0 }
    : { academicCount: 0, routineCount: 0 };

  return (
    <PageFrame>
      <PageHeader
        meta="Daily"
        title={view === 'routines' ? 'Routine' : 'My Day'}
        description={
          view === 'routines'
            ? 'Plan personal activities and track what you complete each day.'
            : "See today's classes and routines in one chronological view."
        }
        actions={
          <>
            <SegmentedControl
              ariaLabel="My Day view"
              value={view}
              onChange={setView}
              options={[
                { value: 'routines', label: 'Checklist' },
                { value: 'combined', label: 'My Day' },
              ]}
            />
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add routine
            </Button>
          </>
        }
      />

      {/* Date navigation + progress */}
      <Card className="p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <DateNavigator value={date} onChange={setDate} display={displayDate} isToday={date === todayStr()} />
          {routines.length > 0 && (
            <div className="flex items-center gap-3 min-w-[220px]">
              <div className="flex-1">
                <div className="flex justify-between text-2xs text-ink-500 mb-1">
                  <span>{completedCount} of {routines.length} done</span>
                  <span>{pct}%</span>
                </div>
                <ProgressBar value={pct} tone={pct === 100 ? 'ok' : 'accent'} />
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* ------------------------------ CHECKLIST ------------------------------ */}
      {view === 'routines' && (
        <Card>
          <div className="p-5 sm:p-6">
            {loadError && (
              <div
                role="alert"
                className="mb-4 p-3 rounded-md bg-danger-soft border border-danger/25 text-danger text-xs flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                <span>{loadError}</span>
              </div>
            )}
            {loading ? (
              <div className="py-10 text-center text-sm text-ink-400">Loading…</div>
            ) : routines.length === 0 ? (
              <EmptyState
                icon={ListChecks}
                title="No routines planned for today"
                description="Add anything you want to keep track of, with an optional time, category, priority, and recurrence. Only you create them."
                action={
                  <Button onClick={openCreate}>
                    <Plus className="w-4 h-4" /> Create your first routine
                  </Button>
                }
              />
            ) : (
              <div className="-mx-5 sm:-mx-6 border-t border-line">
                {/* Column headings — desktop only; every row below aligns to them. */}
                <div
                  aria-hidden="true"
                  className="hidden xl:grid grid-cols-[1.25rem_minmax(0,1fr)_5.5rem_5.5rem_8.5rem_7.5rem_8.25rem] gap-x-4 px-5 sm:px-6 py-2 bg-paper-deep/50 border-b border-line"
                >
                  <span />
                  <span className="text-center text-2xs font-medium uppercase tracking-wide2 text-ink-400">Activity</span>
                  <span className="text-center text-2xs font-medium uppercase tracking-wide2 text-ink-400">Start time</span>
                  <span className="text-center text-2xs font-medium uppercase tracking-wide2 text-ink-400">End time</span>
                  <span className="text-center text-2xs font-medium uppercase tracking-wide2 text-ink-400">After time</span>
                  <span className="text-center text-2xs font-medium uppercase tracking-wide2 text-ink-400">Status</span>
                  <span className="text-center text-2xs font-medium uppercase tracking-wide2 text-ink-400">Actions</span>
                </div>
                <ul className="divide-y divide-line">
                {routines.map((r) => {
                  const expanded = expandedId === r._id;
                  // Dates and times occupy their own columns; the unlock time is
                  // its own column too, so the status column never repeats it.
                  const startLabel = r.startTime ? to12h(r.startTime) : '-';
                  const endLabel = r.endTime ? to12h(r.endTime) : '-';
                  const afterLabel =
                    r.startTime
                      ? `After ${to12h(r.endTime || r.startTime)}`
                      : r.locked && r.flexible
                        ? 'After timed routines'
                        : '-';
                  const actions = (
                    <>
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : r._id)}
                        aria-expanded={expanded}
                        aria-controls={`routine-details-${r._id}`}
                        title={expanded ? 'Hide details' : 'Show details'}
                        className={`inline-flex items-center gap-1 h-7 px-2 rounded-md text-2xs font-medium transition-colors whitespace-nowrap ${
                          expanded ? 'text-ink-900 bg-paper-deep' : 'text-ink-400 hover:text-ink-900 hover:bg-paper-deep'
                        }`}
                      >
                        Details
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                      </button>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(r)} aria-label={`Edit ${r.title}`}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-ink-400 hover:text-danger hover:bg-danger-soft"
                        onClick={() => setConfirmDelete(r)}
                        aria-label={`Delete ${r.title}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  );
                  return (
                    <li key={r._id} className="px-5 sm:px-6 py-3">
                      <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] xl:grid-cols-[1.25rem_minmax(0,1fr)_5.5rem_5.5rem_8.5rem_7.5rem_8.25rem] items-start gap-x-3 xl:gap-x-4">
                        <Checkbox
                          className="mt-px"
                          checked={!!r.completed}
                          disabled={!!r.locked}
                          onChange={() => toggle(r)}
                          ariaLabel={
                            r.locked
                              ? r.flexible
                                ? `Opens after all timed routines are marked, ${r.title}`
                                : `Available after ${to12h(r.lockAt)}, ${r.title}`
                              : `Mark “${r.title}” ${r.completed ? 'not done' : 'done'}`
                          }
                        />
                        <div className="min-w-0">
                          <span
                            className={`text-sm leading-[22px] ${
                              r.completed ? 'line-through text-ink-400' : 'font-medium text-ink-900'
                            }`}
                          >
                            {r.title}
                          </span>
                          {/* Mobile keeps the schedule inline — one readable line. */}
                          <p className="xl:hidden mt-0.5 font-mono text-2xs text-ink-500">
                            {startLabel === '-' && endLabel === '-'
                              ? 'Untimed · anytime'
                              : `${startLabel} to ${endLabel}`}
                            {afterLabel !== '-' && !r.completed ? ` · ${afterLabel}` : ''}
                          </p>
                        </div>
                        <span className="hidden xl:block font-mono text-xs text-ink-600 tabular-nums whitespace-nowrap text-center">
                          {startLabel}
                        </span>
                        <span className="hidden xl:block font-mono text-xs text-ink-600 tabular-nums whitespace-nowrap text-center">
                          {endLabel}
                        </span>
                        <span className="hidden xl:block text-xs text-ink-500 whitespace-nowrap text-center">{afterLabel}</span>
                        <span className="hidden xl:block min-w-0 text-center">
                          <RoutineStatusCell routine={r} />
                        </span>
                        <div className="hidden xl:flex items-center justify-center gap-0.5">{actions}</div>
                      </div>
                      <div className="xl:hidden mt-2 flex items-center justify-between gap-2">
                        <RoutineStatusCell routine={r} />
                        <div className="flex items-center gap-0.5">{actions}</div>
                      </div>
                      {/* Secondary metadata — compact and editorial, one row at
                          a time. */}
                      {expanded && (
                        <div
                          id={`routine-details-${r._id}`}
                          className="mt-2.5 ml-7 rounded-md border border-line bg-paper-deep/50 px-3.5 py-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2.5"
                        >
                          <DetailItem label="Category" value={r.category || '-'} />
                          <DetailItem label="Priority" value={capitalize(r.priority)} />
                          <DetailItem label="Repeats" value={r.isRecurring ? formatRecurrence(r.recurrenceDays) : 'Once'} />
                          <DetailItem
                            label="Completable"
                            value={r.startTime
                              ? `After ${to12h(r.endTime || r.startTime)}`
                              : r.flexible
                                ? 'Once timed routines are done'
                                : 'Anytime'}
                          />
                          {r.notes && (
                            <div className="col-span-2 sm:col-span-4">
                              <p className="text-2xs uppercase tracking-wide2 text-ink-400">Notes</p>
                              <p className="text-xs text-ink-700 mt-0.5 leading-relaxed">{r.notes}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ------------------------------ COMBINED ------------------------------ */}
      {view === 'combined' && (
        <Card>
          <div className="p-5 sm:p-6">
            {/* Header and counts share one baseline row */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <p className="text-sm text-ink-600 leading-5">
                Your college classes and personal routines, in one chronological list.
              </p>
              <div className="flex items-center gap-2">
                <Pill tone="accent">
                  <GraduationCap className="w-3 h-3" /> {routineCounts.academicCount} class{routineCounts.academicCount === 1 ? '' : 'es'}
                </Pill>
                <Pill>
                  <CheckSquare className="w-3 h-3" /> {routineCounts.routineCount} routine{routineCounts.routineCount === 1 ? '' : 's'}
                </Pill>
              </div>
            </div>

            {/* Daily progress from the server's summary of the same records */}
            {dayProgress && dayProgress.total > 0 && (
              <div className="rounded-lg border border-line bg-paper-deep/50 p-4 mb-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink-900">
                    {dayProgress.completed} of {dayProgress.eligible} completable done
                    {dayProgress.percentage != null ? ` · ${dayProgress.percentage}%` : ''}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-ink-500">
                    {dayProgress.locked > 0 && <span>{dayProgress.locked} not yet available</span>}
                    {dayProgress.cancelled > 0 && <span>{dayProgress.cancelled} cancelled</span>}
                    {dayProgress.remaining > 0 && <span>{dayProgress.remaining} pending</span>}
                  </div>
                </div>
              </div>
            )}

            {dayInfo?.isHoliday ? (
              <div className="rounded-lg border border-line bg-paper-deep p-5 flex items-start gap-3">
                <CalendarOff className="w-5 h-5 text-warn shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-ink-900">
                    {dayInfo.exception?.title || 'No academic classes scheduled'}
                  </p>
                  <p className="text-xs text-ink-500 mt-0.5">
                    This date is marked as {dayInfo.exception?.type?.replace('_', ' ')} in your exceptions.
                    It does not affect attendance.
                  </p>
                </div>
              </div>
            ) : timedItems.length === 0 && untimedItems.length === 0 ? (
              <EmptyState
                title="Nothing scheduled for this day"
                description="No academic classes scheduled, and no personal routines planned. Classes appear once your timetable is activated and this weekday has assigned slots."
              />
            ) : (
              <>
                <DayColumnHeader />
                {timedItems.length > 0 && (
                  <section>
                    <GroupLabel>Scheduled</GroupLabel>
                    <ol className="mt-3">
                      {timedItems.map((item, idx) => (
                        <TimelineItem
                          key={item.id || idx}
                          item={item}
                          isLast={idx === timedItems.length - 1}
                          onToggle={item.source === 'routine' ? () => toggleTimeline(item) : undefined}
                        />
                      ))}
                    </ol>
                  </section>
                )}
                {untimedItems.length > 0 && (
                  <section className={timedItems.length > 0 ? 'mt-5 pt-5 border-t border-line' : ''}>
                    <GroupLabel>Anytime</GroupLabel>
                    <ol className="mt-3">
                      {untimedItems.map((item, idx) => (
                        <TimelineItem
                          key={item.id || idx}
                          item={item}
                          untimed
                          isLast={idx === untimedItems.length - 1}
                          onToggle={item.source === 'routine' ? () => toggleTimeline(item) : undefined}
                        />
                      ))}
                    </ol>
                  </section>
                )}
              </>
            )}
          </div>
        </Card>
      )}

      {/* ------------------------------ ANALYTICS ------------------------------ */}
      <Card>
        <div className="p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-display font-semibold text-ink-900 tracking-tightest">
                Progress
              </h2>
              <p className="text-sm text-ink-500 mt-0.5 max-w-2xl">
                Computed only from your own records.
                <HelpHint
                  label="Completion percentages are computed from your actual routine completions and recorded attendance. Days with nothing to complete are never counted as 0%."
                  className="ml-0.5"
                />
              </p>
            </div>
            <SegmentedControl
              ariaLabel="Analytics range"
              value={range}
              onChange={setRange}
              options={[
                { value: 'day', label: 'Day' },
                { value: 'week', label: 'Week' },
                { value: 'month', label: 'Month' },
              ]}
            />
          </div>

          {analyticsError && (
            <div role="alert" className="p-3 rounded-md bg-danger-soft border border-danger/25 text-danger text-xs mb-4">
              {analyticsError}
            </div>
          )}

          {analyticsLoading && !analytics ? (
            <div className="py-10 text-center text-sm text-ink-400">Loading progress…</div>
          ) : !analytics ? null : range === 'day' ? (
            <DayPanel stat={analytics.day?.progress} day={analytics.day} />
          ) : range === 'week' ? (
            <PeriodPanel
              title={`Week of ${longDate(analytics.week.start)}`}
              totals={weekTotal}
              slots={weekSlots}
              labelEvery={1}
              emptyRange="No progress data available for this week."
              emptyCompletion="No completion data available for this week."
            />
          ) : (
            <PeriodPanel
              title={new Date(
                Number(analytics.month.month.slice(0, 4)),
                Number(analytics.month.month.slice(5, 7)) - 1,
                1
              ).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              totals={monthTotal}
              slots={monthSlots}
              labelEvery={5}
              emptyRange="No progress data available for this month."
              emptyCompletion="No completion data available for this month."
            />
          )}
        </div>
      </Card>

      {/* Create / edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit routine' : 'New routine'}
        subtitle="Yours to define. Any activity, any category."
      >
        <form onSubmit={save} className="space-y-4">
          {error && (
            <div role="alert" className="p-3 rounded-md bg-danger-soft border border-danger/25 text-danger text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
              <span>{error}</span>
            </div>
          )}

          <Field label="Routine name">
            <Input
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="What do you want to track?"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" hint="Pick one of yours, or create a new one. Categories are yours alone.">
              <CategoryPicker
                value={form.category}
                onChange={(category) => setForm({ ...form, category })}
                categories={categories}
                onCreate={createCategory}
                error={categoryError}
              />
            </Field>
            <Field label="Priority">
              <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </Select>
            </Field>
          </div>

          {/* Time is inferred: leave both empty for an anytime routine. A timed
              routine can be checked off only after its end time. */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start time" hint="Optional. Leave empty for an anytime routine.">
              <Input
                type="time"
                value={form.startTime}
                onChange={(e) => setForm({ ...form, startTime: e.target.value })}
              />
            </Field>
            <Field label="End time" hint="A timed routine can be checked off only after its end time.">
              <Input
                type="time"
                value={form.endTime}
                onChange={(e) => setForm({ ...form, endTime: e.target.value })}
              />
            </Field>
          </div>

          <Field label="Notes (optional)">
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>

          {/* Recurrence is inferred: no days selected means a one-off routine. */}
          <div className="rounded-lg border border-line p-3.5">
            <p className="text-2xs font-medium text-ink-600 mb-2">Repeats on</p>
            <div className="flex flex-wrap gap-1.5">
              {['Every Day', ...WEEK].map((day) => {
                const on = form.recurrenceDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleRecurrenceDay(day)}
                    className={`h-7 px-2.5 rounded-md text-2xs font-medium border transition-colors ${
                      on
                        ? 'bg-accent-soft text-accent-strong border-accent-fade'
                        : 'bg-surface text-ink-400 border-line-strong hover:text-ink-600'
                    }`}
                  >
                    {day === 'Every Day' ? 'Every day' : day.slice(0, 3)}
                  </button>
                );
              })}
            </div>
            <p className="text-2xs text-ink-400 mt-2">
              {form.recurrenceDays.length
                ? 'Each occurrence keeps its own completion state.'
                : 'No days selected. This routine is for one day.'}
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-line">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit">{editing ? 'Save changes' : 'Add routine'}</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={remove}
        danger
        confirmLabel="Delete routine"
        title={`Delete “${confirmDelete?.title}”?`}
        body="This removes the routine and its completion history on all dates."
      />
    </PageFrame>
  );
};

/* ------------------------------------------------------------------ */
/* DAY analytics panel                                                 */
/* ------------------------------------------------------------------ */
const DayPanel = ({ stat, day }) => {
  if (!stat || stat.total === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="No items scheduled for this day"
        description="Add routines or assign classes on this weekday. Daily totals appear here once something is scheduled."
      />
    );
  }
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 mb-5">
        <Stat label="Completed" value={stat.completed} tone="text-ok" />
        <Stat label="Pending" value={stat.remaining} />
        <Stat label="Not yet available" value={stat.locked} />
        <Stat label="Cancelled" value={stat.cancelled} />
      </div>
      <div className="flex items-center gap-3">
        <ProgressBar
          className="flex-1"
          value={stat.percentage ?? 0}
          tone={stat.percentage === 100 ? 'ok' : 'accent'}
        />
        <span className="text-sm font-semibold text-ink-900 w-12 text-right">
          {stat.percentage == null ? '-' : `${stat.percentage}%`}
        </span>
      </div>
      {stat.locked > 0 && (
        <p className="text-2xs text-ink-400 mt-2">
          Items still inside their scheduled session are not counted as pending. They unlock when
          the session ends. Untimed (flexible) routines unlock once every timed routine of the day
          is marked.
        </p>
      )}
      {day?.isFuture && (
        <p className="text-2xs text-ink-400 mt-2">This day is in the future; timed items unlock on the day itself.</p>
      )}
    </div>
  );
};

const Stat = ({ label, value, tone = 'text-ink-900' }) => (
  <div>
    <p className={`font-display text-xl font-semibold ${tone}`}>{value}</p>
    <p className="text-2xs text-ink-500 mt-0.5">{label}</p>
  </div>
);

/* ------------------------------------------------------------------ */
/* WEEK / MONTH analytics panel                                        */
/* ------------------------------------------------------------------ */
const PeriodPanel = ({ title, totals, slots, labelEvery, emptyRange, emptyCompletion }) => {
  if (!totals || totals.total === 0) {
    return <EmptyState icon={TrendingUp} title={emptyRange} description="Nothing was scheduled in this period, so there is nothing to chart." />;
  }
  if (totals.eligible === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title={emptyCompletion}
        description="Items were scheduled, but every one of them was cancelled or is still inside its scheduled session."
      />
    );
  }
  return (
    <div>
      <p className="text-2xs uppercase tracking-wide2 text-ink-400 mb-2">{title}</p>
      <TrendChart slots={slots} labelEvery={labelEvery} emptyMessage={emptyCompletion} />
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-2xs text-ink-500 mt-3">
        <span>
          <strong className="text-ink-900">{totals.completed}</strong> of{' '}
          <strong className="text-ink-900">{totals.eligible}</strong> completable items done
        </span>
        {totals.percentage != null && (
          <span>
            Overall <strong className="text-ink-900">{totals.percentage}%</strong>
          </span>
        )}
        {totals.averagePercentage != null && (
          <span>
            Average of active days <strong className="text-ink-900">{totals.averagePercentage}%</strong>
          </span>
        )}
        <span>
          {totals.daysWithData} of {totals.daysInRange} days had completable work
        </span>
      </div>
    </div>
  );
};

export default MyRoutine;
