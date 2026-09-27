import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Code2, Plus, ExternalLink, Loader2, CheckCircle2, RefreshCw, Target, Filter,
} from '../components/common/Icons';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import API from '../services/api';
import {
  Button, Card, Field, Input, Select, SegmentedControl, Modal,
  PageFrame, PageHeader, SectionHeader, Badge, Skeleton, StateNote,
} from '../components/common/ui';
import { Reveal, ProgressRing, AnimatedValue, useChartMotion } from '../components/common/motion';

/* ------------------------------ date helpers ------------------------------ */

const pad = (n) => String(n).padStart(2, '0');
const fmtDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const localToday = () => fmtDay(new Date());

// Monday of the current week (local).
const localWeekStart = () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return fmtDay(d);
};

const localWeekEnd = () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 6);
  return fmtDay(d);
};

const localMonthStart = () => localToday().slice(0, 7);

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const prettyDay = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
};

/** The ONE source of truth for what the dashboard shows. */
const defaultFilter = () => ({
  range: 'today', // 'today' | 'week' | 'month' | 'custom'
  startDate: localToday(),
  endDate: localToday(),
  difficulty: 'all',
});

/** Query params derived ONLY from the selected filter — nothing else. */
const filterParams = (f) => {
  const tzOffsetMinutes = new Date().getTimezoneOffset();
  if (f.range === 'today') {
    return { range: 'custom', startDate: localToday(), endDate: localToday(), tzOffsetMinutes, difficulty: f.difficulty };
  }
  if (f.range === 'week') {
    return { range: 'custom', startDate: localWeekStart(), endDate: localWeekEnd(), tzOffsetMinutes, difficulty: f.difficulty };
  }
  if (f.range === 'month') {
    const [y, m] = localMonthStart().split('-').map(Number);
    return {
      range: 'custom',
      startDate: `${localMonthStart()}-01`,
      endDate: fmtDay(new Date(y, m, 0)),
      tzOffsetMinutes,
      difficulty: f.difficulty,
    };
  }
  return { range: 'custom', startDate: f.startDate, endDate: f.endDate, tzOffsetMinutes, difficulty: f.difficulty };
};

/** Human label for the active period, used in copy and on the sync button. */
const filterLabel = (f) => {
  if (f.range === 'today') return 'Today';
  if (f.range === 'week') return 'This week';
  if (f.range === 'month') return `${MONTH_NAMES[Number(localMonthStart().slice(5)) - 1]} ${localMonthStart().slice(0, 4)}`;
  if (f.startDate === f.endDate) return prettyDay(f.startDate);
  return `${prettyDay(f.startDate)} to ${prettyDay(f.endDate)}`;
};

// Sentence-case period phrase for use mid-sentence, without any dashes.
const periodPhrase = (f) => {
  if (f.range === 'today') return 'today';
  if (f.range === 'week') return 'this week';
  if (f.range === 'month') return 'this month';
  return `from ${prettyDay(f.startDate)} to ${prettyDay(f.endDate)}`;
};

/** Compact relative time for the last successful sync. */
const relativeTime = (iso) => {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
};

// Errors are shown where the action happened, never via alert().
const ErrorNote = ({ children }) => <StateNote tone="error">{children}</StateNote>;

/* ------------------------------ sync state ------------------------------ */

const SYNC_STATE = {
  idle: { label: 'Not synced yet', tone: 'neutral' },
  queued: { label: 'Queued', tone: 'accent' },
  syncing: { label: 'Syncing', tone: 'accent' },
  completed: { label: 'Synced', tone: 'ok' },
  failed: { label: 'Sync failed', tone: 'danger' },
  rate_limited: { label: 'Rate limited', tone: 'warn' },
};
const LC_ACTIVE = ['queued', 'syncing'];

// The badge always states the state in words, so colour is never the only cue.
const SyncStateBadge = ({ status }) => {
  const s = SYNC_STATE[status] || SYNC_STATE.idle;
  return (
    <Badge tone={s.tone} dot>
      {s.label}
      {LC_ACTIVE.includes(status) && <span className="sr-only">, in progress</span>}
    </Badge>
  );
};

/* ========================================================================== */
/* Filter-driven Problems dashboard                                            */
/* ========================================================================== */

const PERIOD_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'custom', label: 'Custom' },
];

const TOPICS = [
  'Arrays', 'Strings', 'Two Pointers', 'Sliding Window', 'Linked Lists', 'Trees',
  'Graphs', 'DP', 'Greedy', 'Backtracking', 'Binary Search', 'Stack & Queue',
];
const PLATFORMS = ['LeetCode', 'Codeforces', 'GeeksforGeeks', 'HackerRank', 'CodeChef', 'Other'];

export const ProblemsPage = () => {
  // The selected filter is the SINGLE source of truth for everything shown.
  const [filter, setFilter] = useState(defaultFilter);
  const [dashboard, setDashboard] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState('');

  // LeetCode connection (connect once; syncing is always filter-scoped).
  const [lc, setLc] = useState(null);
  const [lcLoading, setLcLoading] = useState(false);
  const [lcBusy, setLcBusy] = useState(false);
  const [lcPolling, setLcPolling] = useState(false);
  const [lcUsername, setLcUsername] = useState('');
  const [lcNotice, setLcNotice] = useState('');
  const [lcError, setLcError] = useState('');
  const [lcNewCount, setLcNewCount] = useState(null);

  // Manual practice log (the exact time-tracking source).
  const [problemOpen, setProblemOpen] = useState(false);
  const [problemBusy, setProblemBusy] = useState(false);
  const [problemError, setProblemError] = useState('');
  const [problemForm, setProblemForm] = useState({
    title: '', difficulty: 'medium', topic: 'Arrays', platform: 'LeetCode',
    timeSpentMinutes: 30, date: localToday(), notes: '',
  });

  /* ------------------------- filtered dashboard load ------------------------- */

  const loadDashboard = useCallback(async (f) => {
    setDashboardLoading(true);
    setDashboardError('');
    try {
      const res = await API.get('/leetcode/dashboard', { params: filterParams(f) });
      if (res.data?.success) setDashboard(res.data);
      else setDashboardError('The server returned an unexpected response.');
    } catch (err) {
      setDashboardError(err.response?.data?.message || 'Unable to load activity. Please try again.');
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  // Every filter change re-queries the server. The previous period's numbers
  // are never left on screen wearing the new filter's label.
  useEffect(() => {
    loadDashboard(filter);
  }, [filter, loadDashboard]);

  // Connection state (never triggers a sync by itself).
  const loadConnection = useCallback(async () => {
    setLcLoading(true);
    try {
      const res = await API.get('/integrations/leetcode');
      if (res.data?.success) {
        setLc(res.data);
        if (LC_ACTIVE.includes(res.data.status)) setLcPolling(true);
      }
    } catch {
      /* the connection card is optional; manual practice logs still render */
    } finally {
      setLcLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConnection();
  }, [loadConnection]);

  /* ------------------------------- goal (today) ------------------------------ */

  const [goalForm, setGoalForm] = useState({ dailyProblems: 0, dailyMinutes: 0 });
  const [goalLoaded, setGoalLoaded] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalError, setGoalError] = useState('');
  const [goalBusy, setGoalBusy] = useState(false);

  const fetchGoal = useCallback(async () => {
    try {
      const res = await API.get('/technical/goal');
      if (res.data?.success) {
        setGoalForm({
          dailyProblems: res.data.goal?.dailyProblems || 0,
          dailyMinutes: res.data.goal?.dailyMinutes || 0,
        });
      }
    } catch {
      /* the goal card is optional — stay silent when it cannot load */
    } finally {
      setGoalLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchGoal();
  }, [fetchGoal]);

  const saveGoal = async (e) => {
    e.preventDefault();
    setGoalError('');
    setGoalBusy(true);
    try {
      const res = await API.put('/technical/goal', goalForm);
      if (res.data?.success) {
        setGoalOpen(false);
        await Promise.all([fetchGoal(), loadDashboard(filter)]);
      }
    } catch (err) {
      setGoalError(err.response?.data?.message || 'Could not save the goal. Please try again.');
    } finally {
      setGoalBusy(false);
    }
  };

  /* ---------------------- sync follows the SELECTED FILTER ------------------- */

  const syncNow = async () => {
    setLcError('');
    setLcNotice('');
    setLcNewCount(null);
    setLcBusy(true);
    try {
      // The selected filter decides WHAT gets synchronized — nothing random.
      const res = await API.post('/integrations/leetcode/sync', filterParams(filter));
      const data = res.data || {};
      if (data.status === 'already_running') {
        setLcNotice(`A sync is already running. It will refresh ${periodPhrase(filter)} when it finishes.`);
        setLcPolling(true);
        return;
      }
      if (data.status === 'rate_limited') {
        setLcNotice('LeetCode is rate limiting requests right now. Try again shortly.');
        return;
      }
      setLc((prev) => (prev ? { ...prev, status: data.status || 'queued', syncId: data.syncId } : prev));
      setLcNotice(`Syncing ${periodPhrase(filter)}.`);
      setLcPolling(true);
    } catch (err) {
      setLcError(err.response?.data?.message || 'Unable to sync LeetCode activity. Please try again.');
    } finally {
      setLcBusy(false);
    }
  };

  // Status polling: stops at a terminal state, then refreshes ONLY the
  // filtered dashboard (never a full page reload).
  useEffect(() => {
    if (!lcPolling) return undefined;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const res = await API.get('/integrations/leetcode/sync/status');
        const state = res.data;
        if (cancelled || !state?.success) return;
        setLc((prev) => (prev ? { ...prev, ...state } : state));
        if (!LC_ACTIVE.includes(state.status)) {
          setLcPolling(false);
          if (state.status === 'completed') {
            setLcError('');
            setLcNewCount(Number(state.newProblems) || 0);
            setLcNotice(
              Number(state.newProblems) > 0
                ? `Sync completed. ${state.newProblems} new problem${Number(state.newProblems) === 1 ? '' : 's'} found ${periodPhrase(filter)}.`
                : `Sync completed. No new problems ${periodPhrase(filter)}.`
            );
          } else if (state.status === 'failed') {
            setLcNotice('');
            setLcError(state.lastSyncError || 'Unable to sync LeetCode activity. Please try again.');
          } else if (state.status === 'rate_limited') {
            setLcNotice('LeetCode is rate limiting requests right now. Try again shortly.');
          }
          await loadDashboard(filter);
        }
      } catch {
        /* transient polling hiccup — the next tick retries */
      }
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [lcPolling, filter, loadDashboard]);

  const connectLc = async (e) => {
    e.preventDefault();
    setLcError('');
    setLcNotice('');
    setLcBusy(true);
    try {
      const res = await API.post('/integrations/leetcode/connect', { username: lcUsername.trim() });
      setLc(res.data);
      // Connect verifies only; the first sync follows the selected filter.
      setLcNotice('Account connected. Pulling your selected period now.');
      await syncNow();
    } catch (err) {
      setLcError(err.response?.data?.message || 'Could not connect this LeetCode username.');
    } finally {
      setLcBusy(false);
    }
  };

  /* ------------------------------ practice log ------------------------------ */

  const saveProblem = async (e) => {
    e.preventDefault();
    setProblemError('');
    setProblemBusy(true);
    try {
      await API.post('/technical/problems', problemForm);
      setProblemOpen(false);
      setProblemForm({
        title: '', difficulty: 'medium', topic: 'Arrays', platform: 'LeetCode',
        timeSpentMinutes: 30, date: localToday(), notes: '',
      });
      // The dashboard re-queries so the new log lands in the correct filter.
      await loadDashboard(filter);
    } catch (err) {
      setProblemError(err.response?.data?.message || 'Could not save this problem. Please try again.');
    } finally {
      setProblemBusy(false);
    }
  };

  /* ------------------------------- derived data ------------------------------ */

  const summary = dashboard?.summary;
  const dailyActivity = dashboard?.dailyActivity || [];
  const dailyChartData = useMemo(
    () => dailyActivity.map((d) => ({ ...d, hours: Math.round((d.minutes / 60) * 10) / 10 })),
    [dailyActivity]
  );
  const hasDaily = dailyChartData.some((d) => d.problems > 0 || d.minutes > 0);

  const todayGoal = dashboard?.todayGoal;
  const hasGoalTarget = goalForm.dailyProblems > 0 || goalForm.dailyMinutes > 0;
  const goalProblemsPct =
    goalForm.dailyProblems > 0
      ? Math.min(100, ((todayGoal?.problemsDone || 0) / goalForm.dailyProblems) * 100)
      : null;
  const goalMinutesPct =
    goalForm.dailyMinutes > 0
      ? Math.min(100, ((todayGoal?.minutesDone || 0) / goalForm.dailyMinutes) * 100)
      : null;
  const fmtHM = (min) => {
    const n = Math.max(0, Math.round(Number(min) || 0));
    return n >= 60 ? `${Math.floor(n / 60)}h ${n % 60}m` : `${n}m`;
  };

  const difficulty = dashboard?.difficulty || { easy: 0, medium: 0, hard: 0 };
  const difficultyTotal = difficulty.easy + difficulty.medium + difficulty.hard;
  // What was actually solved in the selected period: synced LeetCode rows
  // first (with links), then manual logs. Capped so a whole semester never
  // renders an endless wall.
  const solvedList = (dashboard?.syncedProblems || []).slice(0, 50);

  const problemsSolved = summary?.problemsSolved ?? 0;
  const practiceHours = summary?.practiceHours;
  const hasActivity = problemsSolved > 0 || hasDaily;

  // Re-mounting the chart on a filter change replays the draw animation from
  // the new baseline rather than morphing between two unrelated periods.
  const chartKey = `${filter.range}:${filter.startDate}:${filter.endDate}:${filter.difficulty}`;
  const chartMotion = useChartMotion();
  const tickInterval = dailyChartData.length > 14 ? Math.ceil(dailyChartData.length / 8) : 0;

  const updateFilter = (patch) => setFilter((prev) => ({ ...prev, ...patch }));

  const onRangeChange = (range) => {
    if (range === 'today') updateFilter({ range, startDate: localToday(), endDate: localToday() });
    else if (range === 'week') updateFilter({ range, startDate: localWeekStart(), endDate: localWeekEnd() });
    else if (range === 'month') {
      const [y, m] = localMonthStart().split('-').map(Number);
      updateFilter({ range, startDate: `${localMonthStart()}-01`, endDate: fmtDay(new Date(y, m, 0)) });
    } else updateFilter({ range });
  };

  const syncing = lcBusy || LC_ACTIVE.includes(lc?.status);

  return (
    <PageFrame>
      {/* ------------------------------ page header ------------------------------ */}
      <PageHeader
        meta="Growth"
        title="LeetCode Practice"
        description="Choose a period and the dashboard shows only that period's activity. Sync Now pulls exactly the selected range, and manually logged practice provides the exact time spent."
        hint="Difficulty narrows every figure below, including the daily chart and the difficulty breakdown."
        actions={
          <>
            {lc?.connected && (
              <a
                href={`https://leetcode.com/${lc.username || ''}`}
                target="_blank"
                rel="noreferrer"
                className="pressable inline-flex h-9 items-center gap-1.5 rounded border border-line-strong bg-surface px-3 text-xs font-medium text-ink-700 hover:border-ink-300 hover:bg-paper-deep hover:text-ink-900"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View on LeetCode
              </a>
            )}
            <Button
              onClick={() => {
                setProblemError('');
                setProblemOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Log Practice
            </Button>
          </>
        }
      />

      {/* -------------------------------- filters -------------------------------- */}
      <Reveal>
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-line bg-surface-muted px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3">
              <div className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                <span className="text-2xs font-semibold uppercase tracking-wide2 text-ink-400">
                  Period
                </span>
                <SegmentedControl
                  ariaLabel="Activity period"
                  options={PERIOD_OPTIONS}
                  value={filter.range}
                  onChange={onRangeChange}
                  className="flex-wrap"
                />
              </div>

              <label className="flex items-center gap-2">
                <span className="text-2xs font-semibold uppercase tracking-wide2 text-ink-400">
                  Difficulty
                </span>
                <Select
                  value={filter.difficulty}
                  onChange={(e) => updateFilter({ difficulty: e.target.value })}
                  aria-label="Difficulty filter"
                  className="h-8 w-[7.5rem] rounded-md py-0 text-xs"
                >
                  <option value="all">All</option>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </Select>
              </label>

              {filter.range === 'custom' && (
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={filter.startDate}
                    max={filter.endDate || localToday()}
                    onChange={(e) => updateFilter({ startDate: e.target.value })}
                    aria-label="Range start date"
                    className="h-8 w-[9.5rem] rounded-md py-0 text-xs"
                  />
                  <span className="text-2xs text-ink-400">to</span>
                  <Input
                    type="date"
                    value={filter.endDate}
                    min={filter.startDate}
                    max={localToday()}
                    onChange={(e) => updateFilter({ endDate: e.target.value })}
                    aria-label="Range end date"
                    className="h-8 w-[9.5rem] rounded-md py-0 text-xs"
                  />
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-3">
              {/* The active period is always visible, so a filtered dashboard
                  can never be mistaken for a full-history view. */}
              <p className="hidden text-xs text-ink-500 md:block">
                Showing <span className="font-medium text-ink-900">{filterLabel(filter)}</span>
              </p>
              {lc?.connected && (
                <Button variant="secondary" size="sm" onClick={syncNow} disabled={syncing}>
                  {syncing ? (
                    <Loader2 className="icon-spin h-3.5 w-3.5" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  {syncing ? 'Syncing' : 'Sync Now'}
                </Button>
              )}
            </div>
          </div>

          {/* Honest state messaging, kept in one place under the controls. */}
          {(lcError || lcNotice) && (
            <div className="space-y-2 px-4 py-3.5 sm:px-5">
              {lcError && <ErrorNote>{lcError}</ErrorNote>}
              {lcNotice && !lcError && (
                <StateNote
                  tone="success"
                  title={
                    lcNewCount === null
                      ? undefined
                      : lcNewCount > 0
                        ? `${lcNewCount} new problem${lcNewCount === 1 ? '' : 's'} added`
                        : 'No new problems found'
                  }
                >
                  {lcNotice}
                </StateNote>
              )}
            </div>
          )}
        </Card>
      </Reveal>

      {/* ------------------------- LeetCode connection ------------------------- */}
      {lcLoading && !lc ? (
        <Card className="p-5 sm:p-6">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-3 h-3 w-64" />
        </Card>
      ) : lc?.connected ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-line bg-surface-muted px-4 py-3 sm:px-5">
          <span className="inline-flex items-center gap-2 text-xs text-ink-600">
            <Code2 className="h-3.5 w-3.5 text-accent" />
            Connected as
            <span className="font-medium text-ink-900">@{lc.username}</span>
          </span>
          <SyncStateBadge status={lc.status} />
          <span className="text-xs text-ink-500">
            {lc.lastSuccessfulSyncAt ? (
              <>
                Last successful sync{' '}
                <span className="text-ink-700">{relativeTime(lc.lastSuccessfulSyncAt)}</span>
              </>
            ) : (
              'No successful sync yet'
            )}
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-ink-500">
            <Target className="h-3.5 w-3.5 text-ink-400" />
            Syncing <span className="font-medium text-ink-900">{filterLabel(filter)}</span>
          </span>
        </div>
      ) : (
        <Reveal>
          <Card className="p-5 sm:p-6">
            <SectionHeader
              title="Connect LeetCode"
              description="Enter your public LeetCode username. Acadova reads public profile data only, never your password, and synchronizes exactly the period selected above."
            />
            <form onSubmit={connectLc} className="flex flex-wrap items-end gap-3">
              <Field label="LeetCode username" className="w-full sm:w-64">
                <Input
                  value={lcUsername}
                  onChange={(e) => setLcUsername(e.target.value)}
                  placeholder="your-handle"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </Field>
              <Button type="submit" disabled={!lcUsername.trim()} loading={lcBusy}>
                {!lcBusy && <CheckCircle2 className="h-4 w-4" />}
                {lcBusy ? 'Connecting' : 'Connect'}
              </Button>
            </form>
            {lcError && (
              <div className="mt-4">
                <ErrorNote>{lcError}</ErrorNote>
              </div>
            )}
          </Card>
        </Reveal>
      )}

      {/* ------------------------------- summary ------------------------------- */}
      {dashboardError && (
        <StateNote
          tone="error"
          title={dashboardError}
          action={
            <Button variant="secondary" size="sm" onClick={() => loadDashboard(filter)}>
              Try again
            </Button>
          }
        />
      )}

      <Reveal>
        {dashboardLoading && !dashboard ? (
          <Card className="overflow-hidden">
            <div className="grid lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="p-5 sm:p-6">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="mt-4 h-12 w-40" />
                <Skeleton className="mt-4 h-3 w-24" />
              </div>
              <div className="border-t border-line bg-surface-muted p-5 sm:p-6 lg:border-l lg:border-t-0">
                <div className="grid grid-cols-3 gap-4 lg:grid-cols-1 lg:gap-6">
                  {[0, 1, 2].map((i) => (
                    <div key={i}>
                      <Skeleton className="h-2.5 w-20" />
                      <Skeleton className="mt-2.5 h-5 w-14" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        ) : (
          /* One primary figure carries the period; the supporting figures sit
             on a quieter surface beside it. Not four identical cards. */
          <Card className="overflow-hidden">
            <div className="grid lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="p-5 sm:p-6">
                <p className="text-2xs font-medium uppercase tracking-wide2 text-ink-400">
                  Problems solved
                </p>
                <p className="mt-2.5 flex items-baseline gap-2">
                  <AnimatedValue
                    value={problemsSolved}
                    className="font-display text-[3rem] font-semibold leading-none tracking-tightest text-ink-900"
                  />
                  <span className="text-sm font-medium text-ink-500">
                    {problemsSolved === 1 ? 'problem' : 'problems'}
                  </span>
                </p>
                <p className="mt-3 text-sm text-ink-500">
                  {filterLabel(filter)}
                  {filter.difficulty !== 'all' && (
                    <>
                      {', '}
                      <span className="capitalize">{filter.difficulty}</span> difficulty only
                    </>
                  )}
                </p>
              </div>

              <div className="border-t border-line bg-surface-muted p-5 sm:p-6 lg:border-l lg:border-t-0">
                <dl className="grid grid-cols-3 gap-5 lg:grid-cols-1 lg:gap-6">
                  <div>
                    <dt className="text-2xs font-medium uppercase tracking-wide2 text-ink-400">
                      Practice hours
                    </dt>
                    <dd className="mt-1.5 font-display text-xl font-semibold leading-none text-ink-900">
                      {dashboardLoading ? (
                        <Skeleton className="inline-block h-5 w-12 align-middle" />
                      ) : practiceHours != null ? (
                        <AnimatedValue value={practiceHours} format={(v) => (Math.round(v * 10) / 10).toString()} />
                      ) : (
                        'Not available'
                      )}
                    </dd>
                    <p className="mt-1 text-2xs text-ink-400">In this period</p>
                  </div>
                  <div>
                    <dt className="text-2xs font-medium uppercase tracking-wide2 text-ink-400">
                      Current streak
                    </dt>
                    <dd className="mt-1.5 font-display text-xl font-semibold leading-none text-ink-900">
                      {dashboardLoading ? (
                        <Skeleton className="inline-block h-5 w-10 align-middle" />
                      ) : (
                        <>
                          {/* A real space keeps "0 days" readable as text and to a
                              screen reader, rather than only as a margin. */}
                          <AnimatedValue value={summary?.currentStreak ?? 0} />{' '}
                          <span className="text-xs font-medium text-ink-500">
                            {(summary?.currentStreak ?? 0) === 1 ? 'day' : 'days'}
                          </span>
                        </>
                      )}
                    </dd>
                    <p className="mt-1 text-2xs text-ink-400">Always current</p>
                  </div>
                  <div>
                    <dt className="text-2xs font-medium uppercase tracking-wide2 text-ink-400">
                      Problems this week
                    </dt>
                    <dd className="mt-1.5 font-display text-xl font-semibold leading-none text-ink-900">
                      {dashboardLoading ? (
                        <Skeleton className="inline-block h-5 w-10 align-middle" />
                      ) : (
                        <AnimatedValue value={summary?.problemsThisWeek ?? 0} />
                      )}
                    </dd>
                    <p className="mt-1 text-2xs text-ink-400">Always current week</p>
                  </div>
                </dl>
              </div>
            </div>
          </Card>
        )}
      </Reveal>

      {/* ----------------------------- daily activity ----------------------------- */}
      <Reveal>
        <Card id="daily-activity" className="p-5 sm:p-6">
          <SectionHeader
            title="Daily activity"
            description={`Problems solved and practice time for ${periodPhrase(filter)}.`}
            aside={
              hasDaily ? (
                <p className="text-xs text-ink-500">
                  {dailyChartData.length} {dailyChartData.length === 1 ? 'day' : 'days'} in range
                </p>
              ) : null
            }
            className="mb-5"
          />
          {dashboardLoading ? (
            <Skeleton className="h-56 w-full rounded-md" />
          ) : hasDaily ? (
            <div className="h-56" key={chartKey}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={dailyChartData} margin={{ top: 8, right: 4, left: -22, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EDE9E2" vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke="#9B948C"
                    fontSize={10}
                    tickLine={false}
                    axisLine={{ stroke: '#E7E2DA' }}
                    interval={tickInterval}
                    minTickGap={12}
                  />
                  <YAxis
                    yAxisId="p"
                    stroke="#9B948C"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                    width={38}
                  />
                  <YAxis
                    yAxisId="h"
                    orientation="right"
                    stroke="#9B948C"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    width={34}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#FFFFFF',
                      border: '1px solid #E7E2DA',
                      borderRadius: 8,
                      fontSize: 12,
                      boxShadow: '0 1px 2px rgba(28, 25, 23, 0.04)',
                    }}
                    labelStyle={{ color: '#1C1917', fontWeight: 500, marginBottom: 2 }}
                    cursor={{ fill: 'rgba(15, 110, 99, 0.05)' }}
                    labelFormatter={(v, payload) => payload?.[0]?.payload?.date || v}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="plainline" />
                  <Bar
                    yAxisId="p"
                    dataKey="problems"
                    name="Problems solved"
                    fill="#0F6E63"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={18}
                    {...chartMotion}
                  />
                  <Line
                    yAxisId="h"
                    type="monotone"
                    dataKey="hours"
                    name="Hours practiced"
                    stroke="#1C1917"
                    strokeWidth={1.5}
                    dot={false}
                    {...chartMotion}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-line-strong px-5 py-12 text-center">
              <p className="text-sm font-medium text-ink-700">
                No activity {filter.range === 'today' ? 'today' : 'in this period'}
              </p>
              <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-ink-500">
                {lc?.connected
                  ? 'Nothing has been recorded in this period yet. Press Sync Now to pull it, or log a practice session.'
                  : 'Log a practice session to record time spent, or connect LeetCode to pull your solved problems.'}
              </p>
              <div className="mt-5 flex justify-center gap-2">
                {lc?.connected && (
                  <Button variant="secondary" size="sm" onClick={syncNow} disabled={syncing}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    Sync this period
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => {
                    setProblemError('');
                    setProblemOpen(true);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Log practice
                </Button>
              </div>
            </div>
          )}
        </Card>
      </Reveal>

      {/* ------------------------------ today's goal ------------------------------ */}
      <Reveal>
        <Card className="p-5 sm:p-6">
          <SectionHeader
            level={2}
            title="Today's goal"
            description="Always measured against today's actual activity, whatever period is selected above."
            aside={
              goalLoaded && (
                <Button variant="tertiary" size="sm" onClick={() => { setGoalError(''); setGoalOpen(true); }}>
                  {hasGoalTarget ? 'Edit goal' : 'Set a goal'}
                </Button>
              )
            }
            className="mb-5"
          />

          {!goalLoaded ? (
            <div className="flex gap-10">
              <Skeleton className="h-[6.5rem] w-24 rounded-md" />
              <Skeleton className="h-[6.5rem] w-24 rounded-md" />
            </div>
          ) : hasGoalTarget ? (
            <div className="flex flex-wrap items-start gap-x-12 gap-y-8 sm:gap-x-20">
              {goalForm.dailyProblems > 0 && (
                <ProgressRing
                  value={goalProblemsPct}
                  size={104}
                  label="Problem goal"
                  caption={`${todayGoal?.problemsDone ?? 0} of ${goalForm.dailyProblems} solved today`}
                />
              )}
              {goalForm.dailyMinutes > 0 && (
                <ProgressRing
                  value={goalMinutesPct}
                  size={104}
                  label="Time goal"
                  caption={`${fmtHM(todayGoal?.minutesDone ?? 0)} of ${fmtHM(goalForm.dailyMinutes)} today`}
                />
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-xl text-sm leading-relaxed text-ink-500">
                No daily target set. Choose how many problems or minutes you aim for each day and this
                card will track today against it.
              </p>
              <Button variant="secondary" size="sm" onClick={() => { setGoalError(''); setGoalOpen(true); }}>
                <Target className="h-3.5 w-3.5" />
                Set a goal
              </Button>
            </div>
          )}
        </Card>
      </Reveal>

      {/* --------------------- difficulty distribution (filtered) --------------------- */}
      {/* Only rendered when real filtered data supports it, so an empty
          breakdown is never padded into the page. */}
      {difficultyTotal > 0 ? (
        <Reveal>
          <Card className="p-5 sm:p-6">
            <SectionHeader
              title="Difficulty distribution"
              description={`Solved problems ${periodPhrase(filter)}${
                filter.difficulty !== 'all' ? `, ${filter.difficulty} only` : ''
              }.`}
              className="mb-5"
            />
            <div className="space-y-4">
              {[
                { key: 'Easy', value: difficulty.easy, tone: 'accent' },
                { key: 'Medium', value: difficulty.medium, tone: 'neutral' },
                { key: 'Hard', value: difficulty.hard, tone: 'danger' },
              ].map((d) => {
                const pct = difficultyTotal > 0 ? (d.value / difficultyTotal) * 100 : 0;
                return (
                  <div key={d.key} className="flex items-center gap-4">
                    <span className="w-16 shrink-0 text-xs font-medium text-ink-600">{d.key}</span>
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line">
                      <div
                        className={`meter-fill h-full rounded-full ${
                          d.tone === 'accent' ? 'bg-accent' : d.tone === 'danger' ? 'bg-danger' : 'bg-ink-300'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span
                      className="w-20 shrink-0 text-right text-xs text-ink-600"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {d.value} <span className="text-ink-400">({Math.round(pct)}%)</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </Reveal>
      ) : (
        hasActivity && (
          <Reveal>
            <Card className="p-5 sm:p-6">
              <SectionHeader
                title="Difficulty distribution"
                description="Difficulty is not recorded for the problems in this period, so there is nothing to break down yet."
                className="mb-0"
              />
            </Card>
          </Reveal>
        )
      )}

      {/* ------------------------- solved in this period ------------------------- */}
      {/* The identities behind the counts above: every LeetCode problem the
          sync stored for the selected window, newest first. Rendered only
          when there is something to list — never a padded placeholder. */}
      {solvedList.length > 0 && (
        <Reveal>
          <Card className="p-5 sm:p-6">
            <SectionHeader
              title="Solved in this period"
              description={`${solvedList.length === 1 ? 'Problem' : 'Problems'} synced from LeetCode ${periodPhrase(filter)}${
                filter.difficulty !== 'all' ? `, ${filter.difficulty} only` : ''
              }.`}
              className="mb-4"
            />
            <ol className="divide-y divide-line">
              {solvedList.map((p, i) => (
                <li key={p.slug || p.url || i} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="w-5 shrink-0 text-right text-2xs tabular-nums text-ink-400">{i + 1}</span>
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-accent" />
                    {p.url ? (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 truncate text-sm font-medium text-ink-900 hover:text-accent-strong hover:underline"
                      >
                        {p.title}
                      </a>
                    ) : (
                      <span className="min-w-0 truncate text-sm font-medium text-ink-900">{p.title}</span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {p.language && <span className="hidden text-2xs text-ink-400 sm:inline">{p.language}</span>}
                    <Badge tone={p.difficulty === 'easy' ? 'accent' : p.difficulty === 'hard' ? 'danger' : 'neutral'}>
                      {p.difficulty === 'unknown' ? 'Unknown' : p.difficulty.charAt(0).toUpperCase() + p.difficulty.slice(1)}
                    </Badge>
                    <span className="w-14 text-right text-2xs tabular-nums text-ink-400">
                      {new Date(p.solvedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </Reveal>
      )}

      {/* ------------------------------ log practice modal ------------------------------ */}
      <Modal
        open={problemOpen}
        onClose={() => setProblemOpen(false)}
        title="Log a solved problem"
        subtitle="Manual logs are the source of exact practice time."
      >
        <form onSubmit={saveProblem} className="space-y-4">
          {problemError && <ErrorNote>{problemError}</ErrorNote>}
          <Field label="Problem title" required>
            <Input
              required
              value={problemForm.title}
              onChange={(e) => setProblemForm({ ...problemForm, title: e.target.value })}
              placeholder="Problem name"
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Difficulty" required>
              <Select
                value={problemForm.difficulty}
                onChange={(e) => setProblemForm({ ...problemForm, difficulty: e.target.value })}
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </Select>
            </Field>
            <Field label="Topic" required>
              <Select
                value={problemForm.topic}
                onChange={(e) => setProblemForm({ ...problemForm, topic: e.target.value })}
              >
                {TOPICS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Platform">
              <Select
                value={problemForm.platform}
                onChange={(e) => setProblemForm({ ...problemForm, platform: e.target.value })}
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Time spent" hint="Minutes">
              <Input
                type="number"
                min="1"
                max="1440"
                required
                value={problemForm.timeSpentMinutes}
                onChange={(e) => setProblemForm({ ...problemForm, timeSpentMinutes: e.target.value })}
              />
            </Field>
            <Field label="Date" required>
              <Input
                type="date"
                value={problemForm.date}
                max={localToday()}
                onChange={(e) => setProblemForm({ ...problemForm, date: e.target.value })}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="secondary" onClick={() => setProblemOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={problemBusy}>
              {problemBusy ? 'Saving' : 'Save problem'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* --------------------------------- goal modal --------------------------------- */}
      <Modal
        open={goalOpen}
        onClose={() => setGoalOpen(false)}
        title="Daily practice goal"
        subtitle="Today's goal is always measured against today's activity."
      >
        <form onSubmit={saveGoal} className="space-y-4">
          {goalError && <ErrorNote>{goalError}</ErrorNote>}
          <p className="text-xs leading-relaxed text-ink-500">
            Set a target for each day. Enter 0 to leave a target unset; the goal card tracks only what you
            configure.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Problems per day">
              <Input
                type="number"
                min="0"
                max="100"
                value={goalForm.dailyProblems}
                onChange={(e) => setGoalForm({ ...goalForm, dailyProblems: e.target.value })}
              />
            </Field>
            <Field label="Minutes per day">
              <Input
                type="number"
                min="0"
                max="1440"
                value={goalForm.dailyMinutes}
                onChange={(e) => setGoalForm({ ...goalForm, dailyMinutes: e.target.value })}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="secondary" onClick={() => setGoalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={goalBusy}>
              {goalBusy ? 'Saving' : 'Save goal'}
            </Button>
          </div>
        </form>
      </Modal>

    </PageFrame>
  );
};

export default ProblemsPage;
