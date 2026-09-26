import React, { useCallback, useEffect, useMemo, useState } from 'react';
import API from '../../services/api';
import {
  Card, SectionHeader, EmptyState, Pill, Button, Modal, Field, Input, SegmentedControl,
} from '../../components/common/ui';
import { BookOpen, Check } from '../../components/common/Icons';

// Fixed assessment structure — these are constants of the academic system,
// not configuration: 2 internals (/50), 2 ABLs (/20 with due date),
// 2 quizzes (/20 with date + attendance).
const INTERNAL_MAX = 50;
const ABL_MAX = 20;
const QUIZ_MAX = 20;
const LAB_INTERNAL_MAX = 20; // one lab internal, for lab-bearing subjects
const EMPTY_INTERNALS = {
  internal_1: null,
  internal_2: null,
  internalDates: { internal_1: null, internal_2: null },
};
const EMPTY_ABL = (n) => ({ number: n, submissionDate: '', marks: null, status: 'pending', notes: '' });
const EMPTY_QUIZ = (n) => ({ number: n, quizDate: '', attendance: 'not_recorded', marks: null });
const EMPTY_LAB_INTERNAL = { date: null, marks: null, notes: '' };

const orDash = (v) => (v === null || v === undefined || v === '' ? '-' : v);
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Overdue derives from the due date, never from a manually chosen status.
const ablDerivedStatus = (abl) => {
  if (!abl?.submissionDate) return { label: 'No date', tone: 'neutral' };
  if (abl.status === 'submitted') return { label: 'Submitted', tone: 'ok' };
  const today = todayStr();
  if (abl.submissionDate === today) return { label: 'Due today', tone: 'warn' };
  if (abl.submissionDate < today) return { label: 'Overdue', tone: 'danger' };
  return { label: 'Upcoming', tone: 'neutral' };
};

// Internal status derives from the actual assessment date + recorded marks —
// never from a creation timestamp. A past internal without marks is honestly
// "Marks not recorded", not zero.
const internalStatus = (dateStr, marks) => {
  if (marks !== null && marks !== undefined) return { label: 'Recorded', tone: 'ok' };
  if (!dateStr) return { label: 'No date', tone: 'neutral' };
  const today = todayStr();
  if (dateStr === today) return { label: 'Today', tone: 'warn' };
  if (dateStr < today) return { label: 'Marks not recorded', tone: 'danger' };
  return { label: 'Upcoming', tone: 'neutral' };
};

const fmtDate = (dateStr) => {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};

const scoreTone = (marks, max) => {
  if (marks === null || marks === undefined) return 'text-ink-300';
  const pct = (marks / max) * 100;
  if (pct >= 60) return 'text-ok';
  if (pct >= 40) return 'text-ink-900';
  return 'text-danger';
};

/* ------------------------------------------------------------------ */
/* Per-assessment editor                                                */
/*                                                                      */
/* Every assessment owns its own date and its own marks, and every row   */
/* saves on its own. Only the fields the student actually changed are    */
/* sent, so saving Internal 1 never validates, overwrites or clears      */
/* Internal 2 — or any other assessment.                                 */
/* ------------------------------------------------------------------ */

const SELECT_CLS =
  'w-full bg-surface text-sm text-ink-900 border border-line-strong rounded-md px-3 py-2 focus:outline-none focus:border-accent';

const dateHint = (kind) =>
  kind === 'internal'
    ? 'The scheduled internal date. Drives reminders.'
    : kind === 'lab'
    ? 'The scheduled lab internal date. Drives reminders, not the marks.'
    : kind === 'abl'
    ? 'The due date. Drives reminders.'
    : 'The quiz date. Drives reminders.';

const AssessmentRow = ({ subjectId, kind, number, title, note, max, initial, onSaved }) => {
  const [date, setDate] = useState(initial.date || '');
  const [marks, setMarks] = useState(
    initial.marks === null || initial.marks === undefined ? '' : String(initial.marks)
  );
  const [status, setStatus] = useState(initial.status);
  const [dirty, setDirty] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const touch = (field, setter) => (value) => {
    setter(value);
    setDirty((d) => ({ ...d, [field]: true }));
    setSaved(false);
    setError('');
  };

  const anythingDirty = Object.keys(dirty).length > 0;

  // Only touched fields are sent. An omitted field keeps its stored value, so
  // this can never wipe an unrelated date or mark — and clearing a field is an
  // explicit action (an empty input sends null).
  const payload = () => {
    const body = {};
    if (kind === 'internal') {
      const internals = {};
      if (dirty.marks) internals[`internal_${number}`] = marks === '' ? null : Number(marks);
      if (dirty.date) internals.internalDates = { [`internal_${number}`]: date || null };
      body.internals = internals;
    } else if (kind === 'lab') {
      const lab = {};
      if (dirty.date) lab.date = date || null;
      if (dirty.marks) lab.marks = marks === '' ? null : Number(marks);
      body.labInternal = lab;
    } else if (kind === 'abl') {
      const abl = { number };
      if (dirty.date) abl.submissionDate = date || null;
      if (dirty.marks) abl.marks = marks === '' ? null : Number(marks);
      if (dirty.status) abl.status = status;
      body.abls = [abl];
    } else {
      const quiz = { number };
      if (dirty.date) quiz.quizDate = date || null;
      if (dirty.marks) quiz.marks = marks === '' ? null : Number(marks);
      if (dirty.status) quiz.attendance = status;
      body.quizzes = [quiz];
    }
    return body;
  };

  const save = async () => {
    if (!anythingDirty || saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await API.put(`/academics/assessments/subject/${subjectId}`, payload());
      if (res.data?.success) {
        setDirty({});
        setSaved(true);
        onSaved && onSaved();
      } else {
        setError(res.data?.message || 'Could not save.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs font-medium text-ink-700">
          {title}
          {note && <span className="text-2xs text-ink-400 font-normal ml-1.5">{note}</span>}
        </p>
        <div className="flex items-center gap-2">
          {saved && !anythingDirty && (
            <span role="status" className="text-2xs text-ok inline-flex items-center gap-1">
              <Check className="w-3 h-3" /> Saved
            </span>
          )}
          <Button size="xs" onClick={save} disabled={!anythingDirty || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <div
        className={`grid grid-cols-1 ${
          kind === 'abl' || kind === 'quiz' ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
        } gap-3`}
      >
        <Field label="Date" hint={dateHint(kind)}>
          <Input type="date" value={date} onChange={(e) => touch('date', setDate)(e.target.value)} />
        </Field>
        <Field label={`Marks · out of ${max}`} hint="Optional. Leave empty until it is graded.">
          <Input
            type="number"
            min={0}
            max={max}
            value={marks}
            onChange={(e) => touch('marks', setMarks)(e.target.value)}
            placeholder="-"
          />
        </Field>
        {kind === 'abl' && (
          <Field label="Status">
            <select value={status} onChange={(e) => touch('status', setStatus)(e.target.value)} className={SELECT_CLS}>
              <option value="pending">Pending</option>
              <option value="submitted">Submitted</option>
            </select>
          </Field>
        )}
        {kind === 'quiz' && (
          <Field label="Did you attend?">
            <select value={status} onChange={(e) => touch('status', setStatus)(e.target.value)} className={SELECT_CLS}>
              <option value="not_recorded">Not recorded</option>
              <option value="attended">Yes, attended</option>
              <option value="not_attended">No, missed</option>
            </select>
          </Field>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-2xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
};

const AssessmentEditor = ({ open, onClose, subject, stored, onSaved }) => {
  const internals = stored?.internals || EMPTY_INTERNALS;
  const ablFor = (n) => stored?.abls?.find((x) => x.number === n) || EMPTY_ABL(n);
  const quizFor = (n) => stored?.quizzes?.find((x) => x.number === n) || EMPTY_QUIZ(n);
  const lab = stored?.labInternal || EMPTY_LAB_INTERNAL;

  const groupLabel = 'text-2xs uppercase tracking-wide2 text-ink-400 font-medium mb-2';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${subject.name}: Assessments`}
      subtitle={subject.code}
      wide
    >
      <p className="text-2xs text-ink-500 mb-4">
        Every date and every mark is independent. Enter only what you know, and save each assessment on its own. No
        other assessment is required or changed by a save.
      </p>

      <p className={groupLabel}>Internals · out of {INTERNAL_MAX}</p>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-5">
        {[1, 2].map((n) => (
          <AssessmentRow
            key={`internal-${n}`}
            subjectId={subject._id}
            kind="internal"
            number={n}
            title={`Internal ${n}`}
            max={INTERNAL_MAX}
            initial={{ date: internals.internalDates?.[`internal_${n}`] || '', marks: internals[`internal_${n}`] }}
            onSaved={onSaved}
          />
        ))}
      </div>

      {subject.labSection?.hasLab && (
        <>
          <p className={groupLabel}>Lab internal · out of {LAB_INTERNAL_MAX} · this subject has a lab</p>
          <div className="mb-5">
            <AssessmentRow
              subjectId={subject._id}
              kind="lab"
              title="Lab internal"
              max={LAB_INTERNAL_MAX}
              initial={{ date: lab.date || '', marks: lab.marks }}
              onSaved={onSaved}
            />
          </div>
        </>
      )}

      <p className={groupLabel}>ABL · out of {ABL_MAX}</p>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-5">
        {[1, 2].map((n) => {
          const a = ablFor(n);
          return (
            <AssessmentRow
              key={`abl-${n}`}
              subjectId={subject._id}
              kind="abl"
              number={n}
              title={`ABL ${n}`}
              max={ABL_MAX}
              initial={{ date: a.submissionDate || '', marks: a.marks, status: a.status || 'pending' }}
              onSaved={onSaved}
            />
          );
        })}
      </div>

      <p className={groupLabel}>Quizzes · out of {QUIZ_MAX}</p>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {[1, 2].map((n) => {
          const q = quizFor(n);
          return (
            <AssessmentRow
              key={`quiz-${n}`}
              subjectId={subject._id}
              kind="quiz"
              number={n}
              title={`Quiz ${n}`}
              max={QUIZ_MAX}
              initial={{ date: q.quizDate || '', marks: q.marks, status: q.attendance || 'not_recorded' }}
              onSaved={onSaved}
            />
          );
        })}
      </div>

      <div className="flex justify-end mt-6">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
};

/* ------------------------------------------------------------------ */
/* Subject detail — one unified academic view                           */
/* ------------------------------------------------------------------ */
const SubjectDetail = ({ subject, assessments, onEdit }) => {
  const a = assessments[subject._id];
  const internals = a?.internals || EMPTY_INTERNALS;
  const abls = [1, 2].map((n) => a?.abls?.find((x) => x.number === n) || EMPTY_ABL(n));
  const quizzes = [1, 2].map((n) => a?.quizzes?.find((x) => x.number === n) || EMPTY_QUIZ(n));

  // Only average marks that actually exist — never treat "not recorded" as 0.
  const recorded = [];
  if (internals.internal_1 !== null) recorded.push(internals.internal_1 / INTERNAL_MAX);
  if (internals.internal_2 !== null) recorded.push(internals.internal_2 / INTERNAL_MAX);
  abls.forEach((x) => x.marks !== null && recorded.push(x.marks / ABL_MAX));
  quizzes.forEach((x) => x.marks !== null && x.marks !== undefined && recorded.push(x.marks / QUIZ_MAX));
  const overall = recorded.length ? Math.round((recorded.reduce((s, v) => s + v, 0) / recorded.length) * 100) : null;

  return (
    <div className="rounded-lg border border-line bg-paper-deep/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h4 className="text-sm font-display font-semibold text-ink-900 tracking-tightest">{subject.name}</h4>
          <p className="text-2xs text-ink-500 mt-0.5 font-mono">{subject.code}</p>
        </div>
        <div className="flex items-center gap-2">
          {overall !== null ? (
            <Pill tone="accent">Overall {overall}%</Pill>
          ) : (
            <Pill>No marks yet</Pill>
          )}
          <Button size="xs" variant="secondary" onClick={() => onEdit(subject)}>
            Edit assessments
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-4 text-sm">
        <div>
          <p className="text-2xs uppercase tracking-wide2 text-ink-400 font-medium mb-1.5">Internals / 50</p>
          <div className="space-y-1">
            {['internal_1', 'internal_2'].map((key, i) => {
              const marks = internals[key];
              const dateStr = internals.internalDates?.[key] || null;
              const st = internalStatus(dateStr, marks);
              return (
                <div key={key} className="flex items-center justify-between gap-3">
                  <span className="text-ink-500">
                    Internal {i + 1}
                    {dateStr && (
                      <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-accent-soft text-accent-strong text-xs font-bold tracking-tight">
                        {fmtDate(dateStr)}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={`font-medium tabular-nums ${scoreTone(marks, INTERNAL_MAX)}`}>
                      {marks !== null && marks !== undefined ? `${marks} / ${INTERNAL_MAX}` : '-'}
                    </span>
                    <Pill tone={st.tone}>{st.label}</Pill>
                  </span>
                </div>
              );
            })}
            {subject.labSection?.hasLab &&
              (() => {
                const lab = a?.labInternal || EMPTY_LAB_INTERNAL;
            const labMarks = lab.marks ?? null;
            const st = internalStatus(lab.date || null, labMarks);
            return (
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink-500">
                  Lab internal
                  {lab.date && (
                    <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-accent-soft text-accent-strong text-xs font-bold tracking-tight">
                      {fmtDate(lab.date)}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  <span className={`font-medium tabular-nums ${scoreTone(labMarks, LAB_INTERNAL_MAX)}`}>
                    {labMarks !== null ? `${labMarks} / ${LAB_INTERNAL_MAX}` : '-'}
                  </span>
                  <Pill tone={st.tone}>{st.label}</Pill>
                </span>
              </div>
            );
              })()}
          </div>
        </div>

        <div>
          <p className="text-2xs uppercase tracking-wide2 text-ink-400 font-medium mb-1.5">ABL / 20</p>
          <div className="space-y-1">
            {abls.map((abl) => {
              const st = ablDerivedStatus(abl);
              return (
                <div key={abl.number} className="flex items-center justify-between gap-3">
                  <span className="text-ink-500">ABL {abl.number}</span>
                  <span className="flex items-center gap-2">
                    <span className={`font-medium tabular-nums ${scoreTone(abl.marks, ABL_MAX)}`}>
                      {abl.marks !== null ? `${abl.marks} / ${ABL_MAX}` : '-'}
                    </span>
                    <Pill tone={st.tone}>{st.label}</Pill>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-2xs uppercase tracking-wide2 text-ink-400 font-medium mb-1.5">Quizzes / 20</p>
          <div className="space-y-1">
            {quizzes.map((quiz) => (
              <div key={quiz.number} className="flex items-center justify-between gap-3">
                <span className="text-ink-500">Quiz {quiz.number}</span>
                <span className="flex items-center gap-2">
                  <span className={`font-medium tabular-nums ${scoreTone(quiz.attendance === 'attended' ? quiz.marks : null, QUIZ_MAX)}`}>
                    {quiz.attendance === 'attended' && quiz.marks !== null ? `${quiz.marks} / ${QUIZ_MAX}` : '-'}
                  </span>
                  <Pill tone={quiz.attendance === 'attended' ? 'ok' : quiz.attendance === 'not_attended' ? 'danger' : 'neutral'}>
                    {quiz.attendance === 'attended' ? 'Attended' : quiz.attendance === 'not_attended' ? 'Missed' : 'Not recorded'}
                  </Pill>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-line flex flex-wrap gap-x-4 gap-y-2 text-2xs text-ink-500">
        {abls.some((x) => x.submissionDate) && abls.filter((x) => x.submissionDate).map((x) => (
          <span key={x.number} className="flex items-center gap-1">
            <span className="text-ink-400">ABL {x.number} due:</span>
            <span className="inline-block px-1.5 py-0.5 rounded bg-accent-soft text-accent-strong font-bold text-xs tracking-tight">
              {fmtDate(x.submissionDate)}
            </span>
          </span>
        ))}
        {quizzes.some((x) => x.quizDate) && quizzes.filter((x) => x.quizDate).map((x) => (
          <span key={x.number} className="flex items-center gap-1">
            <span className="text-ink-400">Quiz {x.number}:</span>
            <span className="inline-block px-1.5 py-0.5 rounded bg-accent-soft text-accent-strong font-bold text-xs tracking-tight">
              {fmtDate(x.quizDate)}
            </span>
          </span>
        ))}
        {subject.labSection?.hasLab && <span>Lab attendance: {subject.labPercentage ?? '-'}% ({subject.labAttended ?? 0}/{subject.labTotal ?? 0})</span>}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Section                                                              */
/* ------------------------------------------------------------------ */
export const AssessmentsSection = () => {
  const [view, setView] = useState('internals'); // internals | abl | quizzes
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // subject being edited
  const [detail, setDetail] = useState(null);   // subject with open detail view

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await API.get('/academics/assessments');
      if (res.data?.success) setData(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load assessments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const subjects = data?.subjects || [];
  const bySubject = useMemo(() => {
    const map = {};
    (data?.assessments || []).forEach((a) => {
      map[a.subject?._id || a.subject] = a;
    });
    return map;
  }, [data]);

  // The editor receives exactly what the API returned for this subject; it
  // seeds each assessment row from it and sends back only edited fields.
  const openEdit = (subject) => {
    setEditing({ subject, stored: bySubject[subject._id] || null });
  };

  const renderTable = () => {
    if (loading) {
      return <div className="py-10 text-center text-sm text-ink-400">Loading assessments…</div>;
    }
    if (error) {
      return (
        <div role="alert" className="p-3 rounded-md bg-danger-soft border border-danger/25 text-danger text-xs">
          {error}
        </div>
      );
    }
    if (subjects.length === 0) {
      return (
        <EmptyState
          icon={BookOpen}
          title="No subjects to assess"
          description="Register your semester subjects first. Each one gets Internals, ABLs and Quizzes with the fixed academic structure."
        />
      );
    }

    // One column per assessment. The lab internal only applies to lab-bearing
    // subjects, so the column is always present (aligned) and says "No lab"
    // for subjects that have none.
    const columnsByView = {
      internals: ['Internal 1 / 50', 'Internal 2 / 50', 'Lab internal / 20'],
      abl: ['ABL 1 / 20', 'ABL 2 / 20'],
      quizzes: ['Quiz 1 / 20', 'Quiz 2 / 20'],
    };
    const columns = columnsByView[view];
    // SUBJECT | CODE | one fixed track per assessment | ACTIONS.
    const gridTemplateColumns = `minmax(0,1fr) 7rem ${columns.map(() => '9rem').join(' ')} 7.5rem`;

    return (
      <div className="space-y-3">
        {/* Column headings — desktop only; centred inside their own column so
            each label sits directly above the values it describes. */}
        <div
          aria-hidden="true"
          className="hidden xl:grid items-center gap-x-4 px-4 pb-2 border-b border-line"
          style={{ gridTemplateColumns }}
        >
          <span className="text-center text-2xs font-medium uppercase tracking-wide2 text-ink-400">Subject</span>
          <span className="text-center text-2xs font-medium uppercase tracking-wide2 text-ink-400">Code</span>
          {columns.map((c) => (
            <span key={c} className="text-center text-2xs font-medium uppercase tracking-wide2 text-ink-400">
              {c}
            </span>
          ))}
          <span className="text-center text-2xs font-medium uppercase tracking-wide2 text-ink-400">Actions</span>
        </div>

        {subjects.map((subject) => {
          const a = bySubject[subject._id];
          const internals = a?.internals || EMPTY_INTERNALS;
          const abls = [1, 2].map((n) => a?.abls?.find((x) => x.number === n) || EMPTY_ABL(n));
          const quizzes = [1, 2].map((n) => a?.quizzes?.find((x) => x.number === n) || EMPTY_QUIZ(n));
          const hasLab = !!subject.labSection?.hasLab;
          const lab = a?.labInternal || EMPTY_LAB_INTERNAL;
          const labMarks = lab.marks ?? null;
          const labDate = lab.date || null;

          const cells =
            view === 'internals'
              ? [
                  ...['internal_1', 'internal_2'].map((k) => {
                    const marks = internals[k];
                    const dateStr = internals.internalDates?.[k] || null;
                    return {
                      marks,
                      max: INTERNAL_MAX,
                      date: dateStr,
                      extra: internalStatus(dateStr, marks),
                    };
                  }),
                  {
                    marks: labMarks,
                    max: LAB_INTERNAL_MAX,
                    date: labDate,
                    extra: hasLab
                      ? internalStatus(labDate, labMarks)
                      : { label: 'No lab', tone: 'neutral' },
                  },
                ]
              : view === 'abl'
                ? abls.map((x) => ({
                    marks: x.marks,
                    max: ABL_MAX,
                    date: x.submissionDate || null,
                    extra: ablDerivedStatus(x),
                  }))
                : quizzes.map((x) => ({
                    marks: x.marks ?? null, // stored independently of attendance
                    max: QUIZ_MAX,
                    date: x.quizDate || null,
                    extra:
                      x.attendance === 'attended'
                        ? { label: 'Attended', tone: 'ok' }
                        : x.attendance === 'not_attended'
                        ? { label: 'Missed', tone: 'danger' }
                        : { label: 'Not recorded', tone: 'neutral' },
                  }));

          const cellValue = (c) =>
            c.marks !== null && c.marks !== undefined ? `${c.marks} / ${c.max}` : '-';

          return (
            <div key={subject._id} className="rounded-lg border border-line px-4 py-3">
              {/* DESKTOP — the aligned column layout */}
              <div className="hidden xl:grid items-center gap-x-4 gap-y-1" style={{ gridTemplateColumns }}>
                {/* SUBJECT — its own column */}
                <div className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink-900">{subject.name}</span>
                </div>
                {/* CODE — its own column, never appended to the name */}
                <span className="truncate font-mono text-2xs text-accent-strong text-center">{subject.code || '-'}</span>
                {cells.map((c, i) => (
                  <div key={i} className="flex flex-col items-center gap-0.5">
                    <span className={`text-sm font-medium tabular-nums ${scoreTone(c.marks, c.max)}`}>
                      {cellValue(c)}
                    </span>
                    {c.date ? (
                      <span className="inline-block px-1.5 py-0.5 rounded bg-accent-soft text-accent-strong text-xs font-bold whitespace-nowrap tracking-tight">
                        {c.date}
                      </span>
                    ) : (
                      <span className="text-2xs text-ink-300 whitespace-nowrap">No date</span>
                    )}
                    {c.extra && <Pill tone={c.extra.tone}>{c.extra.label}</Pill>}
                  </div>
                ))}
                <div className="justify-self-center flex items-center gap-2 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => setDetail(detail === subject._id ? null : subject._id)}
                    className="text-2xs font-medium text-accent-strong hover:underline"
                    aria-expanded={detail === subject._id}
                  >
                    {detail === subject._id ? 'Hide detail' : 'View detail'}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(subject)}
                    className="text-2xs font-medium text-accent-strong hover:underline"
                  >
                    Edit
                  </button>
                </div>
              </div>

              {/* COMPACT — same data, stacked; used below the wide table */}
              <div className="xl:hidden">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink-900">{subject.name}</span>
                    <span className="font-mono text-2xs text-accent-strong">{subject.code || '-'}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDetail(detail === subject._id ? null : subject._id)}
                    className="text-2xs font-medium text-accent-strong hover:underline shrink-0"
                    aria-expanded={detail === subject._id}
                  >
                    {detail === subject._id ? 'Hide detail' : 'View detail'}
                  </button>
                </div>
                <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {cells.map((c, i) => (
                    <li key={i} className="min-w-0">
                      <p className="text-2xs text-ink-400 truncate">{columns[i]}</p>
                      <p className="text-xs text-ink-700 flex items-center gap-1.5 flex-wrap">
                        <span className={`font-medium tabular-nums ${scoreTone(c.marks, c.max)}`}>
                          {cellValue(c)}
                        </span>
                        {c.date ? (
                          <span className="inline-block px-1.5 py-0.5 rounded bg-accent-soft text-accent-strong text-xs font-bold tracking-tight">
                            {c.date}
                          </span>
                        ) : (
                          <span className="text-2xs text-ink-300">No date</span>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
              {detail === subject._id && (
                <div className="mt-3">
                  <SubjectDetail subject={subject} assessments={bySubject} onEdit={openEdit} />
                </div>
              )}
            </div>
          );
        })}

        <p className="text-2xs text-ink-400 pt-1">
          Each date and each mark is independent. Enter one without the other. Unrecorded marks show as a dash, and are never counted as zero.
        </p>
      </div>
    );
  };

  return (
    <Card>
      <div className="p-5 sm:p-6">
        <SectionHeader
          title="Assessments"
          description="Track internal marks, ABLs, quizzes, and lab assessments for this semester."
          hint="The fixed structure for every subject: Internal 1 & 2 (50 marks each), ABL 1 & 2 (20, with due dates) and Quiz 1 & 2 (20, with attendance). Lab internals live with the subject's lab."
          aside={
            <SegmentedControl
              ariaLabel="Assessment view"
              value={view}
              onChange={setView}
              options={[
                { value: 'internals', label: 'Internals' },
                { value: 'abl', label: 'ABL' },
                { value: 'quizzes', label: 'Quizzes' },
              ]}
            />
          }
        />
        {renderTable()}
      </div>

      {editing && (
        <AssessmentEditor
          open={!!editing}
          onClose={() => setEditing(null)}
          subject={editing.subject}
          stored={editing.stored}
          onSaved={load}
        />
      )}
    </Card>
  );
};

export default AssessmentsSection;
