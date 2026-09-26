import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ClipboardCheck,
  CalendarDays, ListChecks, CheckCircle2, Circle, AlertTriangle, ArrowRight, Clock,
} from '../components/common/Icons';
import API from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Card, Pill, ProgressBar, buttonStyles, localDateStr, PageHeader, StateNote, PageFrame } from '../components/common/ui';

// Local calendar date (never UTC — a UTC date is the wrong day for part of the world).
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const Dashboard = () => {
  const { user } = useAuth();
  const today = todayStr();

  const [attention, setAttention] = useState(null);
  const [academic, setAcademic] = useState(null);
  const [routinesToday, setRoutinesToday] = useState(null); // { totalCount, completedCount, percentage }
  const [routineTotal, setRoutineTotal] = useState(null); // every routine the student owns
  const [radar, setRadar] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [att, acad, today_routines, all_routines, rad] = await Promise.allSettled([
        API.get('/productivity/attention'),
        API.get('/academics/overview'),
        API.get(`/routines?date=${today}`),
        API.get('/routines?scope=all'),
        API.get('/productivity/radar'),
      ]);

      setAttention(att.status === 'fulfilled' ? att.value.data : null);
      setAcademic(acad.status === 'fulfilled' ? acad.value.data : null);
      setRadar(rad.status === 'fulfilled' ? rad.value.data : null);

      const routinesOk = today_routines.status === 'fulfilled';
      const allRoutinesOk = all_routines.status === 'fulfilled';
      setRoutinesToday(routinesOk ? today_routines.value.data : null);
      setRoutineTotal(allRoutinesOk ? all_routines.value.data?.totalRoutines ?? 0 : null);

      // Only a total failure is an error; individual sections degrade on their own.
      const anyOk = [att, acad, today_routines, all_routines, rad].some((r) => r.status === 'fulfilled');
      setError(anyOk ? '' : 'Could not reach the server. Your data is safe. Retry when you are back online.');
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    load();
  }, [load]);

  const semesters = academic?.semesters || [];
  const hasActiveSemester = semesters.some((s) => s.isActive) || !!academic?.activeSemester;
  const subjectCount = academic?.subjects?.length || 0;
  const hasTimetable = !!academic?.activeSemester?.isTimetableActivated;
  const hasRoutines = (routineTotal || 0) > 0;

  const checklist = [
    {
      key: 'semester',
      done: hasActiveSemester,
      label: 'Create your semester',
      to: '/academics',
      hint: hasActiveSemester
        ? academic?.activeSemester?.name || 'Active semester'
        : 'Name, academic year, dates, and working days.',
    },
    {
      key: 'subjects',
      done: subjectCount > 0,
      label: 'Register your subjects',
      to: '/academics',
      hint: subjectCount > 0
        ? `${subjectCount} registered`
        : 'Include labs for 4-credit courses if they exist.',
    },
    {
      key: 'timetable',
      done: hasTimetable,
      label: 'Build and activate your timetable',
      to: '/academics',
      hint: hasTimetable
        ? 'Activated. Your classes are on the calendar.'
        : 'Configure time slots, then assign subjects to each day.',
    },
    {
      key: 'routines',
      done: hasRoutines,
      label: 'Add your first routines',
      to: '/routine',
      hint: hasRoutines
        ? `${routineTotal} routine${routineTotal === 1 ? '' : 's'} created`
        : 'Anything you want to track daily, weekly, or once.',
    },
  ];
  const doneCount = checklist.filter((c) => c.done).length;
  const setupComplete = doneCount === checklist.length;
  const nextStep = checklist.find((c) => !c.done) || checklist[0];
  const setupPct = Math.round((doneCount / checklist.length) * 100);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.name ? user.name.split(' ')[0] : null;

  const routinePct = routinesToday?.percentage || 0;
  const routineScheduledToday = (routinesToday?.totalCount || 0) > 0;

  const fmtDate = (d) => {
    const [y, m, dd] = d.split('-').map(Number);
    return new Date(y, m - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // ABL / quiz reminders, derived from the real assessment records only.
  // The server returns abls/quizzes keyed to subjects; here we flatten them
  // into dated events for today and the coming days.
  const academicReminders = useMemo(() => {
    const today = localDateStr();
    const fmt = (d) => {
      const [y, m, dd] = d.split('-').map(Number);
      return new Date(y, m - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };
    const items = [];
    (academic?.subjects || []).forEach((s) => {
      // Upcoming internal assessments — only from the actual recorded dates,
      // and only while marks are still unrecorded (a scored internal has happened).
      const internalDates = s.internals?.internalDates || {};
      ['internal_1', 'internal_2'].forEach((key, i) => {
        const dateStr = internalDates[key];
        const marks = s.internals?.[key];
        if (!dateStr || marks !== null && marks !== undefined) return;
        if (dateStr >= today) {
          items.push({ kind: 'Internal', label: `Internal ${i + 1}`, subject: s.name, date: dateStr, overdue: false });
        }
      });
      (s.abls || []).forEach((abl) => {
        if (!abl.submissionDate) return;
        if (abl.status === 'submitted') return;
        if (abl.submissionDate >= today) {
          items.push({ kind: 'ABL', label: `ABL ${abl.number}`, subject: s.name, date: abl.submissionDate, overdue: abl.submissionDate < today });
        } else {
          items.push({ kind: 'ABL', label: `ABL ${abl.number}`, subject: s.name, date: abl.submissionDate, overdue: true });
        }
      });
      (s.quizzes || []).forEach((q) => {
        if (!q.quizDate) return;
        if (q.attendance === 'attended' || q.attendance === 'not_attended') return; // already happened & recorded
        if (q.quizDate >= today) {
          items.push({ kind: 'Quiz', label: `Quiz ${q.number}`, subject: s.name, date: q.quizDate, overdue: false });
        }
      });
    });
    return items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
  }, [academic]);

  return (
    <PageFrame>
      <PageHeader
        meta="Daily"
        title={`${greeting}${firstName ? `, ${firstName}` : ''}`}
        description={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
      />

      {error && (
        <StateNote
          tone="error"
          title={error}
          action={
            <button
              type="button"
              onClick={load}
              className="text-xs font-medium underline underline-offset-2 hover:no-underline"
            >
              Try again
            </button>
          }
        />
      )}

      {/* ---------------- Set up Acadova (real progress only) ---------------- */}
      {!loading && !setupComplete && (
        <Card className="p-5 sm:p-6 animate-slide-up">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 max-w-xl">
              <p className="text-2xs font-medium uppercase tracking-wide2 text-accent-fade">Acadova</p>
              <h2 className="mt-1.5 font-display text-xl font-semibold tracking-tightest text-ink-900">
                Set up your academic workspace
              </h2>
              <p className="mt-1.5 text-sm text-ink-500 leading-relaxed">
                Configure your semester, subjects and timetable to get your daily academic schedule.
              </p>
            </div>
            <div className="shrink-0 sm:text-right">
              <div className="flex items-center gap-3 sm:justify-end">
                <ProgressBar value={setupPct} tone="accent" className="w-24" />
                <span className="font-mono text-2xs text-ink-500 whitespace-nowrap">
                  {doneCount} of {checklist.length}
                </span>
              </div>
              <p className="mt-1.5 text-2xs text-ink-400">Nothing is pre-filled. It is all yours.</p>
            </div>
          </div>

          <ul className="mt-5 border-t border-line divide-y divide-line">
            {checklist.map((item) => (
              <li key={item.key}>
                <Link
                  to={item.to}
                  className="group flex items-center gap-3 -mx-2 px-2 py-3 rounded-md hover:bg-paper-deep transition-colors"
                >
                  <span className="w-[18px] h-[18px] shrink-0 flex items-center justify-center">
                    {item.done ? (
                      <CheckCircle2 className="w-[18px] h-[18px] text-ok" />
                    ) : (
                      <Circle className="w-[18px] h-[18px] text-ink-300" />
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-sm ${item.done ? 'text-ink-500' : 'font-medium text-ink-900'}`}>
                      {item.label}
                    </span>
                    <span className="block text-2xs text-ink-400 mt-0.5">{item.hint}</span>
                  </span>
                  <span className="shrink-0 text-2xs font-medium text-ink-300 group-hover:text-accent transition-colors">
                    {item.done ? 'Review' : 'Start'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-4 pt-4 border-t border-line flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-2xs text-ink-400">
              {hasRoutines
                ? 'Last step: your routine is where the day gets tracked.'
                : 'Each step stays here until it is done.'}
            </p>
            <Link to={nextStep.to} className={buttonStyles('primary', 'md')}>
              Continue setup <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </Card>
      )}

      {/* ---------------- Needs attention (real signals only) ---------------- */}
      {!loading && attention?.attentionItems?.length > 0 && (
        <Card className="border-danger/25">
          <div className="p-5 sm:p-6 border-b border-line flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-danger" />
            <h2 className="font-display text-lg font-semibold tracking-tightest text-ink-900">
              Needs attention
            </h2>
            <Pill tone="danger">{attention.attentionItems.length}</Pill>
          </div>
          <ul className="divide-y divide-line">
            {attention.attentionItems.map((item, idx) => (
              <li key={idx} className="px-5 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900 truncate">{item.title}</p>
                  <p className="text-2xs text-ink-500">{item.reason}</p>
                </div>
                {/* Warning tone belongs to the item's urgency, not to its
                    estimated effort, which is plain metadata. */}
                <Pill>{item.estimatedEffort}</Pill>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ---------------- Today at a glance ---------------- */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="p-5 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold text-ink-900">Today's classes</h3>
          </div>
          <div className="flex-1">
            {loading ? (
              <div className="space-y-2" aria-hidden="true">
                <div className="h-3.5 w-4/5 rounded bg-paper-deep animate-pulse" />
                <div className="h-3.5 w-2/3 rounded bg-paper-deep animate-pulse" />
              </div>
            ) : academic?.todaysClasses?.length ? (
              <ul className="space-y-2 text-sm">
                {academic.todaysClasses.slice(0, 4).map((c, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className="text-ink-900 truncate">{c.subject?.name || c.title}</span>
                    <span className="font-mono text-2xs text-ink-400 shrink-0">{c.start_time}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-400 leading-relaxed">
                No classes found for today. Activate your timetable to see your college day here.
              </p>
            )}
          </div>
          <Link to="/academics" className="mt-4 pt-3 border-t border-line text-xs font-medium text-accent-strong inline-flex items-center gap-1">
            Academics <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </Card>

        <Card className="p-5 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <ClipboardCheck className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold text-ink-900">ABLs &amp; quizzes</h3>
          </div>
          <div className="flex-1">
            {loading ? (
              <div className="space-y-2" aria-hidden="true">
                <div className="h-3.5 w-3/4 rounded bg-paper-deep animate-pulse" />
                <div className="h-3.5 w-1/2 rounded bg-paper-deep animate-pulse" />
              </div>
            ) : academicReminders.length ? (
              <ul className="space-y-2 text-sm">
                {academicReminders.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      <span className="text-2xs font-medium text-ink-500 mr-1.5">{r.kind}</span>
                      <span className="text-ink-900">{r.label}: {r.subject}</span>
                    </span>
                    <span className={`font-mono text-2xs shrink-0 ${r.overdue ? 'text-danger' : 'text-ink-400'}`}>{fmtDate(r.date)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-400 leading-relaxed">
                No ABL submissions or quizzes coming up. Dates you record in Assessments appear here.
              </p>
            )}
          </div>
          <Link to="/academics" className="mt-4 pt-3 border-t border-line text-xs font-medium text-accent-strong inline-flex items-center gap-1">
            Assessments <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </Card>

        <Card className="p-5 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <ListChecks className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold text-ink-900">Routine progress</h3>
          </div>
          <div className="flex-1">
            {loading ? (
              <div className="space-y-3" aria-hidden="true">
                <div className="h-8 w-20 rounded bg-paper-deep animate-pulse" />
                <div className="h-1.5 w-full rounded bg-paper-deep animate-pulse" />
              </div>
            ) : routineScheduledToday ? (
              <>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="font-display text-3xl font-semibold text-ink-900">{routinePct}%</span>
                  <span className="text-2xs text-ink-500">completed today</span>
                </div>
                <ProgressBar value={routinePct} tone={routinePct === 100 ? 'ok' : 'accent'} />
                <p className="mt-2 text-2xs text-ink-400">
                  {routinesToday.completedCount || 0} of {routinesToday.totalCount} routines done
                </p>
              </>
            ) : hasRoutines ? (
              <p className="text-sm text-ink-400 leading-relaxed">
                None of your {routineTotal} routine{routineTotal === 1 ? '' : 's'} fall on{' '}
                {new Date().toLocaleDateString('en-US', { weekday: 'long' })}. Add one for today, or open your
                schedule to review recurrence.
              </p>
            ) : (
              <p className="text-sm text-ink-400 leading-relaxed">
                No routines yet. Create your own activities with an optional time, category and repeat.
              </p>
            )}
          </div>
          <Link to="/routine" className="mt-4 pt-3 border-t border-line text-xs font-medium text-accent-strong inline-flex items-center gap-1">
            Daily routine <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </Card>

        <Card className="p-5 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold text-ink-900">Next 7 days</h3>
          </div>
          <div className="flex-1">
            {loading ? (
              <div className="space-y-2" aria-hidden="true">
                <div className="h-3.5 w-3/4 rounded bg-paper-deep animate-pulse" />
                <div className="h-3.5 w-1/2 rounded bg-paper-deep animate-pulse" />
              </div>
            ) : radar?.deadlines?.length ? (
              <ul className="space-y-2 text-sm">
                {radar.deadlines.slice(0, 4).map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <span className="text-ink-900 truncate">{d.title}</span>
                    <span className="font-mono text-2xs text-ink-400 shrink-0">{d.date}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-400 leading-relaxed">
                No deadlines in the next seven days. Assignments and exams you add will show up here.
              </p>
            )}
          </div>
          <Link to="/productivity" className="mt-4 pt-3 border-t border-line text-xs font-medium text-accent-strong inline-flex items-center gap-1">
            Deadline radar <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </Card>
      </div>
    </PageFrame>
  );
};

export default Dashboard;
