import React, { useState } from 'react';
import { Check, X, Ban, Lock, CalendarOff, History, CalendarDays, Pencil, ChevronDown } from '../../components/common/Icons';
import API from '../../services/api';
import {
  Card, Select, Pill, EmptyState, SectionHeader, ProgressBar, DateNavigator,
} from '../../components/common/ui';

// The server stores legacy totals on different field names than the derived
// metrics; normalise both so summaries never read undefined.
const norm = (s) => ({
  ...s,
  theoryTotal: s.theoryTotal ?? s.totalClasses ?? 0,
  theoryAttended: s.theoryAttended ?? s.attendedClasses ?? 0,
  labTotal: s.labTotal ?? s.labTotalClasses ?? 0,
  labAttended: s.labAttended ?? s.labAttendedClasses ?? 0,
  theoryPercentage: s.theoryPercentage ?? null,
  labPercentage: s.labPercentage ?? null,
  percentage: s.percentage ?? 0,
});

const localToday = () => new Date().toISOString().split('T')[0];

// Attendance state machine per class row:
//   NOT MARKED   → [Present] [Absent] [Not conducted]
//   RECORDED     → ✓ Present   Edit      (only the chosen state + Edit)
//   EDIT MODE    → [Present] [Absent] [Not conducted]  (entered via Edit)
// The recorded state collapses the other choices so the row reads as already
// saved. Edit only re-opens the choices; saving goes through the same mark
// API, which updates the one existing record — never a duplicate.
const classState = (cls) => {
  const current = cls.markedStatus;
  return {
    isPresent: current === 'attended' || current === 'present',
    isAbsent: current === 'missed' || current === 'absent',
    isCancelled: current === 'cancelled',
    isRecorded: ['attended', 'present', 'missed', 'absent', 'cancelled'].includes(current),
    // The server locks Present/Absent until the session's real end time (a
    // 2-hour lab ends with its last reserved slot). Cancelled stays available.
    lockedEarly: !!cls.locked && !['attended', 'present', 'missed', 'absent', 'cancelled'].includes(current),
  };
};

/** STATUS column — the recorded state, or why it cannot be recorded yet. */
const AttendanceStatus = ({ cls, isFuture }) => {
  if (isFuture) {
    return (
      <Pill>
        <Lock className="w-3 h-3" /> Upcoming
      </Pill>
    );
  }
  const { isPresent, isAbsent, isCancelled, isRecorded, lockedEarly } = classState(cls);
  if (isRecorded) {
    const label = isPresent ? 'Present' : isAbsent ? 'Absent' : 'Not conducted';
    const toneCls = isPresent ? 'text-ok' : isAbsent ? 'text-danger' : 'text-ink-500';
    return (
      <span className={`inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap ${toneCls}`}>
        {isPresent && <Check className="w-3.5 h-3.5" />}
        {isAbsent && <X className="w-3.5 h-3.5" />}
        {isCancelled && <Ban className="w-3.5 h-3.5" />}
        {label}
      </span>
    );
  }
  if (lockedEarly && cls.lockAt) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-ink-500 whitespace-nowrap">
        <Lock className="w-3 h-3" /> Available after {cls.lockAt}
      </span>
    );
  }
  return <Pill>Not marked</Pill>;
};

/** ACTIONS column — the marking controls, or Edit once recorded. */
const AttendanceActions = ({ cls, isFuture, onMark, editing, setEditing }) => {
  if (isFuture) {
    return <span className="text-2xs text-ink-400">-</span>;
  }

  const { isPresent, isAbsent, isCancelled, isRecorded, lockedEarly } = classState(cls);

  if (isRecorded && !editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Edit attendance"
        aria-label={`Edit attendance for ${cls.subject?.name || 'this class'}`}
        className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-2xs font-medium text-ink-500 hover:text-accent-strong hover:bg-accent-soft transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 whitespace-nowrap"
      >
        <Pencil className="w-3 h-3" /> Edit
      </button>
    );
  }

  // EDIT MODE or NOT MARKED — the full choice set is visible.
  return (
    <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          disabled={lockedEarly}
          aria-disabled={lockedEarly}
          onClick={() => onMark(cls._id, 'present')}
          aria-pressed={isPresent}
          className={`h-8 px-3 rounded-md text-xs font-medium border transition-colors ${
            isPresent ? 'bg-ok text-white border-ok' : 'bg-surface text-ink-600 border-line-strong hover:border-ok hover:text-ok'
          } ${lockedEarly ? 'opacity-45 cursor-not-allowed hover:border-line-strong hover:text-ink-600' : ''}`}
        >
          <Check className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Present
        </button>
        <button
          type="button"
          disabled={lockedEarly}
          aria-disabled={lockedEarly}
          onClick={() => onMark(cls._id, 'absent')}
          aria-pressed={isAbsent}
          className={`h-8 px-3 rounded-md text-xs font-medium border transition-colors ${
            isAbsent ? 'bg-danger text-white border-danger' : 'bg-surface text-ink-600 border-line-strong hover:border-danger hover:text-danger'
          } ${lockedEarly ? 'opacity-45 cursor-not-allowed hover:border-line-strong hover:text-ink-600' : ''}`}
        >
          <X className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Absent
        </button>
        <button
          type="button"
          onClick={() => onMark(cls._id, 'cancelled')}
          aria-pressed={isCancelled}
          title="Class did not happen, so there is no attendance impact"
          className={`h-8 px-2.5 rounded-md text-xs font-medium border transition-colors ${
            isCancelled ? 'bg-ink-600 text-white border-ink-600' : 'bg-surface text-ink-400 border-line-strong hover:text-ink-700'
          }`}
        >
          <Ban className="w-3.5 h-3.5" />
        </button>
        {isRecorded && (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="h-8 px-2 rounded-md text-2xs font-medium text-ink-400 hover:text-ink-700 transition-colors"
          >
            Cancel
          </button>
        )}
    </div>
  );
};

const today = localToday();

export const AttendanceSection = ({ overview }) => {
  const [tab, setTab] = useState('today'); // 'today' | 'history' | 'summary'
  const [date, setDate] = useState(today);
  const [openDetails, setOpenDetails] = useState(null); // class row with details open
  const [editingId, setEditingId] = useState(null); // class row re-opened for editing
  const [dayData, setDayData] = useState(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [dayError, setDayError] = useState('');

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [filter, setFilter] = useState({ subjectId: '', sessionType: '' });

  const subjects = overview?.subjects || [];

  const fetchDay = React.useCallback(async (d) => {
    setDayLoading(true);
    setDayError('');
    try {
      const res = await API.get(`/academics/today?date=${d}`);
      if (res.data?.success) setDayData(res.data);
    } catch (err) {
      setDayError(err.response?.data?.message || 'Could not load classes for this date.');
    } finally {
      setDayLoading(false);
    }
  }, []);

  const fetchHistory = React.useCallback(async (f) => {
    setHistoryLoading(true);
    try {
      const params = [];
      if (f.subjectId) params.push(`subjectId=${f.subjectId}`);
      if (f.sessionType) params.push(`sessionType=${f.sessionType}`);
      const res = await API.get(`/academics/attendance/history${params.length ? `?${params.join('&')}` : ''}`);
      if (res.data?.success) setHistory(res.data.history || []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
      setHistoryLoaded(true);
    }
  }, []);

  React.useEffect(() => {
    if (tab === 'today') fetchDay(date);
    if (tab === 'history') fetchHistory(filter);
  }, [tab, date, filter, fetchDay, fetchHistory]);

  const mark = async (slotId, status) => {
    try {
      await API.post(`/academics/timetable/${slotId}/mark`, { status, date });
      setDayError('');
      setEditingId(null); // saved. The row collapses back to its recorded state
      fetchDay(date);
    } catch (err) {
      // The server rejects early marking with a clear message — surface it
      // inline instead of an alert() dialog.
      setDayError(err.response?.data?.message || 'Could not mark attendance.');
    }
  };

  const isFuture = date > today;
  const displayDate = (() => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  })();

  return (
    <Card>
      <div className="p-5 sm:p-6">
        <SectionHeader
          title="Attendance"
          description="Record each scheduled class and keep track of your attendance."
          hint="Classes come from your activated timetable. Percentages are computed only from what you actually mark. Theory and lab are tracked separately."
          aside={
            <div className="inline-flex items-center gap-0.5 p-0.5 rounded-md bg-paper-deep border border-line" role="tablist" aria-label="Attendance views">
              {[
                { id: 'today', label: 'Mark' },
                { id: 'summary', label: 'Summary' },
                { id: 'history', label: 'History' },
              ].map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`px-3 h-7 text-xs font-medium rounded-[5px] transition-colors ${
                    tab === t.id ? 'bg-surface text-ink-900 shadow-card border border-line' : 'text-ink-500 hover:text-ink-900'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          }
        />

        {/* ------------------------------- MARK ------------------------------- */}
        {tab === 'today' && (
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <p className="text-sm text-ink-600">
                {isFuture ? 'Attendance unlocks on the day of the class.' : 'Mark each class as it happens.'}
              </p>
              <DateNavigator
                value={date}
                onChange={(d) => {
                  setDate(d);
                  setDayData(null);
                }}
                display={displayDate}
                isToday={date === today}
              />
            </div>

            {dayError && (
              <div role="alert" className="p-3 rounded-md bg-danger-soft border border-danger/25 text-danger text-xs mb-3">
                {dayError}
              </div>
            )}

            {dayLoading && !dayData ? (
              <div className="py-10 text-center text-sm text-ink-400">Loading classes…</div>
            ) : dayData?.isHoliday ? (
              <div className="rounded-lg border border-line bg-paper-deep p-5 flex items-start gap-3">
                <CalendarOff className="w-5 h-5 text-warn shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-ink-900">{dayData.exception?.title || 'No classes today'}</p>
                  <p className="text-xs text-ink-500 mt-0.5">
                    This date is marked as {dayData.exception?.type?.replace('_', ' ')} in your exceptions. It does not affect attendance.
                  </p>
                </div>
              </div>
            ) : !dayData || dayData.classes.length === 0 ? (
              <EmptyState
                icon={CalendarDays}
                title={dayData?.day ? `No classes on ${dayData.day}` : 'No classes scheduled'}
                description={
                  dayData?.isWithinSemester === false
                    ? 'This date falls outside the semester dates you configured.'
                    : 'Your timetable may not include this weekday, or nothing is assigned for it yet.'
                }
              />
            ) : (
              <div className="rounded-lg border border-line overflow-hidden">
                {/* Column headings — desktop only; rows below align to them. */}
                <div
                  aria-hidden="true"
                  className="hidden xl:grid grid-cols-[minmax(0,1fr)_7.5rem_11rem_minmax(0,17rem)] gap-x-4 px-4 py-2 bg-paper-deep/50 border-b border-line"
                >
                  <span className="text-2xs font-medium uppercase tracking-wide2 text-ink-400 text-center">Subject</span>
                  <span className="text-2xs font-medium uppercase tracking-wide2 text-ink-400 text-center">Time</span>
                  <span className="text-2xs font-medium uppercase tracking-wide2 text-ink-400 text-center">Status</span>
                  <span className="text-2xs font-medium uppercase tracking-wide2 text-ink-400 text-center">Actions</span>
                </div>
                <ul className="divide-y divide-line">
                {dayData.classes.map((cls) => {
                  const detailsOpen = openDetails === cls._id;
                  return (
                    <li key={cls._id} className="px-4 py-3.5">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 xl:grid-cols-[minmax(0,1fr)_7.5rem_11rem_minmax(0,17rem)] xl:gap-x-4">
                        {/* SUBJECT — name only; code / type / faculty / room wait in Details. */}
                        <div className="min-w-0">
                          <span className="block truncate text-sm font-medium text-ink-900">{cls.subject?.name}</span>
                          <p className="xl:hidden mt-0.5 font-mono text-2xs text-ink-500 tabular-nums">
                            {cls.start_time} to {cls.end_time}
                          </p>
                        </div>
                        {/* TIME — its own fixed column on desktop */}
                        <span className="hidden xl:block font-mono text-xs text-ink-600 tabular-nums whitespace-nowrap text-center">
                          {cls.start_time} to {cls.end_time}
                        </span>
                        {/* STATUS — its own fixed column */}
                        <div className="justify-self-end xl:justify-self-center min-w-0">
                          <AttendanceStatus cls={cls} isFuture={isFuture} />
                        </div>
                        {/* ACTIONS — its own column, sized for the widest control
                            set and start-aligned so the first control sits at the
                            same x in every row. */}
                        <div className="col-span-2 justify-self-end xl:col-span-1 xl:justify-self-center flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setOpenDetails(detailsOpen ? null : cls._id)}
                            aria-expanded={detailsOpen}
                            aria-controls={`class-details-${cls._id}`}
                            title={detailsOpen ? 'Hide details' : 'Show details'}
                            className={`inline-flex items-center gap-1 h-7 px-2 rounded-md text-2xs font-medium transition-colors whitespace-nowrap ${
                              detailsOpen ? 'text-ink-900 bg-paper-deep' : 'text-ink-400 hover:text-ink-900 hover:bg-paper-deep'
                            }`}
                          >
                            Details
                            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} />
                          </button>
                          <AttendanceActions
                            cls={cls}
                            isFuture={isFuture}
                            onMark={mark}
                            editing={editingId === cls._id}
                            setEditing={(v) => setEditingId(v ? cls._id : null)}
                          />
                        </div>
                      </div>
                      {detailsOpen && (
                        <div
                          id={`class-details-${cls._id}`}
                          className="mt-2.5 rounded-md border border-line bg-paper-deep/50 px-3.5 py-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2.5"
                        >
                          <div>
                            <p className="text-2xs uppercase tracking-wide2 text-ink-400">Session type</p>
                            <p className="text-xs text-ink-700 mt-0.5">{cls.entryType === 'lab' ? 'Lab' : 'Theory'}</p>
                          </div>
                          <div>
                            <p className="text-2xs uppercase tracking-wide2 text-ink-400">Subject code</p>
                            <p className="text-xs text-ink-700 mt-0.5 font-mono">{cls.subject?.code || '-'}</p>
                          </div>
                          <div>
                            <p className="text-2xs uppercase tracking-wide2 text-ink-400">Faculty</p>
                            <p className="text-xs text-ink-700 mt-0.5">{cls.subject?.faculty || '-'}</p>
                          </div>
                          <div>
                            <p className="text-2xs uppercase tracking-wide2 text-ink-400">Room</p>
                            <p className="text-xs text-ink-700 mt-0.5">{cls.room || '-'}</p>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ------------------------------ SUMMARY ----------------------------- */}
        {tab === 'summary' && (
          <div>
            {subjects.length === 0 ? (
              <EmptyState
                title="Nothing to summarize yet"
                description="Register subjects and mark attendance. Summaries appear here, computed from your records only."
              />
            ) : (
              <div className="space-y-3">
                {subjects.map((raw) => {
                  const s = norm(raw);
                  const hasAnyData =
                    (s.theoryTotal || 0) + (s.labTotal || 0) > 0 ||
                    (s.totalClasses || 0) + (s.labTotalClasses || 0) > 0;
                  const theoryPct = s.theoryPercentage ?? s.theoryPercentage;
                  const labPct = s.labPercentage;
                  const overallPct = s.percentage;

                  return (
                    <div key={s._id} className="rounded-lg border border-line p-4">
                      {/* Subject name + code + percentage form one aligned row;
                          the percentage is baseline-aligned with the title. */}
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="text-sm font-medium text-ink-900 truncate">{s.name}</span>
                          <span className="font-mono text-2xs text-accent-strong">{s.code}</span>
                        </div>
                        <span className="text-sm font-semibold text-ink-900 leading-5">
                          {hasAnyData ? `${overallPct}%` : <span className="text-ink-300 text-xs font-normal">No data yet</span>}
                        </span>
                      </div>

                      {hasAnyData ? (
                        <div className="mt-3 space-y-2">
                          <ProgressBar value={overallPct} tone={overallPct >= (s.targetAttendance || 75) ? 'ok' : 'danger'} />
                          <div className="flex flex-wrap gap-x-5 gap-y-1 text-2xs text-ink-500">
                            <span className="inline-flex items-baseline gap-1">
                              Theory <span className="tabular-nums font-medium text-ink-700">{s.theoryAttended ?? 0}/{s.theoryTotal ?? 0}</span>
                              {theoryPct != null ? <span className="tabular-nums"> ({theoryPct}%)</span> : null}
                            </span>
                            {s.labSection?.hasLab && (
                              <span className="inline-flex items-baseline gap-1">
                                Lab <span className="tabular-nums font-medium text-ink-700">{s.labAttended}/{s.labTotal}</span>
                                {labPct != null ? <span className="tabular-nums"> ({labPct}%)</span> : null}
                              </span>
                            )}
                            <span className="inline-flex items-baseline gap-1">
                              Target <span className="tabular-nums font-medium text-ink-700">{s.targetAttendance || 75}%</span>
                            </span>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-ink-400">
                          Mark attendance for scheduled classes to see percentages for this subject.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ------------------------------ HISTORY ----------------------------- */}
        {tab === 'history' && (
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <p className="text-sm text-ink-600">Every record you have marked, newest first.</p>
              <div className="flex gap-2">
                <Select
                  value={filter.subjectId}
                  onChange={(e) => setFilter({ ...filter, subjectId: e.target.value })}
                  className="!w-auto !py-1.5 text-xs"
                  aria-label="Filter by subject"
                >
                  <option value="">All subjects</option>
                  {subjects.map((s) => (
                    <option key={s._id} value={s._id}>{s.code}: {s.name}</option>
                  ))}
                </Select>
                <Select
                  value={filter.sessionType}
                  onChange={(e) => setFilter({ ...filter, sessionType: e.target.value })}
                  className="!w-auto !py-1.5 text-xs"
                  aria-label="Filter by session type"
                >
                  <option value="">Theory &amp; lab</option>
                  <option value="theory">Theory</option>
                  <option value="lab">Lab</option>
                </Select>
              </div>
            </div>

            {historyLoading && !historyLoaded ? (
              <div className="py-10 text-center text-sm text-ink-400">Loading history…</div>
            ) : history.length === 0 ? (
              <EmptyState
                icon={History}
                title="No attendance records yet"
                description="Once you mark classes in the Mark tab, they appear here as a permanent log."
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    {/* Every header is centred in its own column, above its values. */}
                    <tr className="border-b border-line bg-paper-deep text-2xs uppercase tracking-wide2 text-ink-400">
                      <th className="font-medium px-4 py-2.5 text-center">Date</th>
                      <th className="font-medium px-3 py-2.5 text-center">Subject</th>
                      <th className="font-medium px-3 py-2.5 text-center">Component</th>
                      <th className="font-medium px-3 py-2.5 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {history.map((r) => {
                      const present = r.status === 'attended' || r.status === 'present';
                      const absent = r.status === 'missed' || r.status === 'absent';
                      return (
                        <tr key={r._id} className="hover:bg-paper-deep/50">
                          <td className="px-4 py-2.5 font-mono text-xs text-ink-600 whitespace-nowrap text-center tabular-nums">{r.date}</td>
                          <td className="px-3 py-2.5 text-ink-900">{r.subject?.name}</td>
                          <td className="px-3 py-2.5 text-center">
                            <Pill tone={r.sessionType === 'lab' ? 'accent' : 'neutral'}>
                              {r.sessionType === 'lab' ? 'Lab' : 'Theory'}
                            </Pill>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <Pill tone={present ? 'ok' : absent ? 'danger' : 'neutral'}>
                              {present ? 'Present' : absent ? 'Absent' : 'Cancelled'}
                            </Pill>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};

export default AttendanceSection;
