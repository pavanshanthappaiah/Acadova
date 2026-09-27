import React, { useState } from 'react';
import { GraduationCap, Plus, Pencil, Trash2, FlaskConical, BookOpen } from '../../components/common/Icons';
import API from '../../services/api';
import {
  Button, Card, Field, Input, Select, Pill, Modal, ConfirmDialog, EmptyState, SectionHeader, Switch,
} from '../../components/common/ui';

// Subjects come from the overview endpoint, which derives both new-style
// (theoryTotal/…) and legacy (totalClasses/…) counters — normalise once here.
const normSubject = (s) => ({
  ...s,
  theoryAttended: s.theoryAttended ?? s.attendedClasses ?? 0,
  theoryTotal: s.theoryTotal ?? s.totalClasses ?? 0,
  labAttended: s.labAttended ?? s.labAttendedClasses ?? 0,
  labTotal: s.labTotal ?? s.labTotalClasses ?? 0,
});

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const fmtDate = (s) => {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

/* ================================================================== */
/* Semester management                                                 */
/* ================================================================== */
export const SemesterSection = ({ semesters, activeSemester, onChanged }) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    semesterName: '',
    semesterNumber: 1,
    academicYear: '',
    startDate: '',
    endDate: '',
    workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  });

  const openCreate = () => {
    setEditing(null);
    setForm({
      semesterName: '',
      semesterNumber: 1,
      academicYear: '',
      startDate: '',
      endDate: '',
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    });
    setError('');
    setModalOpen(true);
  };

  const openEdit = (sem) => {
    setEditing(sem);
    setForm({
      semesterName: sem.semesterName || '',
      semesterNumber: sem.semesterNumber || 1,
      academicYear: sem.academicYear || '',
      startDate: sem.startDate || '',
      endDate: sem.endDate || '',
      workingDays: sem.workingDays?.length ? sem.workingDays : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    });
    setError('');
    setModalOpen(true);
  };

  const toggleDay = (day) => {
    setForm((f) => {
      const has = f.workingDays.includes(day);
      const next = has ? f.workingDays.filter((d) => d !== day) : [...ALL_DAYS.filter((d) => f.workingDays.includes(d) || d === day)];
      return { ...f, workingDays: next };
    });
  };

  const save = async (e) => {
    e.preventDefault();
    setError('');
    if (form.endDate < form.startDate) {
      setError('End date must be on or after the start date.');
      return;
    }
    if (!form.workingDays.length) {
      setError('Select at least one working day.');
      return;
    }
    try {
      if (editing) {
        await API.put(`/academics/semesters/${editing._id}`, form);
      } else {
        await API.post('/academics/semesters', form);
      }
      setModalOpen(false);
      onChanged();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save the semester.');
    }
  };

  const activate = async (sem) => {
    try {
      await API.post(`/academics/semesters/${sem._id}/activate`);
      onChanged();
    } catch {
      /* handled by parent refetch */
    }
  };

  const remove = async () => {
    try {
      await API.delete(`/academics/semesters/${confirmDelete._id}`);
      setConfirmDelete(null);
      onChanged();
    } catch (err) {
      setConfirmDelete(null);
      alert(err.response?.data?.message || 'Could not delete the semester.');
    }
  };

  return (
    <Card>
      <div className="p-5 sm:p-6 border-b border-line">
        <SectionHeader
          title="Semesters"
          hint="One semester is active at a time. It scopes every subject, timetable slot and attendance record you create."
          aside={
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4" /> New semester
            </Button>
          }
        />

        {semesters.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="No semesters yet"
            description="Create your current semester to begin. You'll set its name, academic year, dates, and working days."
            action={
              <Button onClick={openCreate}>
                <Plus className="w-4 h-4" /> Create semester
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line -mx-5 sm:-mx-6 border-t border-line" style={{ marginTop: 0 }}>
            {semesters.map((sem) => {
              const isActive = sem.isActive || activeSemester?._id === sem._id;
              return (
                <li key={sem._id} className="flex flex-col md:flex-row md:items-center gap-3 md:gap-6 px-5 sm:px-6 py-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-ink-900">{sem.semesterName}</h3>
                      {isActive && (
                        <Pill tone="accent">
                          <span className="w-1.5 h-1.5 rounded-full bg-accent" aria-hidden="true" />
                          Active
                        </Pill>
                      )}
                    </div>
                    <p className="text-xs text-ink-500 mt-0.5">
                      Semester {sem.semesterNumber} · {sem.academicYear} · {fmtDate(sem.startDate)} to {fmtDate(sem.endDate)}
                    </p>
                    <p className="text-2xs text-ink-400 mt-0.5">
                      {sem.workingDays?.length ? sem.workingDays.join(', ') : 'No working days configured'}
                      {sem.isTimetableActivated ? ' · Timetable activated' : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <label className="flex items-center gap-2 text-2xs text-ink-500">
                      <Switch checked={isActive} disabled={isActive} onChange={() => activate(sem)} ariaLabel={`Activate ${sem.semesterName}`} />
                      {isActive ? 'Active' : 'Set active'}
                    </label>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(sem)} aria-label={`Edit ${sem.semesterName}`}>
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-ink-400 hover:text-danger hover:bg-danger-soft"
                      onClick={() => setConfirmDelete(sem)}
                      aria-label={`Delete ${sem.semesterName}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit semester' : 'New semester'}
        subtitle="Only you create your semesters. Nothing is pre-filled."
      >
        <form onSubmit={save} className="space-y-4">
          {error && (
            <div role="alert" className="p-3 rounded-md bg-danger-soft border border-danger/25 text-danger text-xs">
              {error}
            </div>
          )}

          <Field label="Semester name">
            <Input
              required
              value={form.semesterName}
              onChange={(e) => setForm({ ...form, semesterName: e.target.value })}
              placeholder="e.g. Semester 5 Monsoon"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Semester number">
              <Input
                type="number"
                min="1"
                max="12"
                required
                value={form.semesterNumber}
                onChange={(e) => setForm({ ...form, semesterNumber: e.target.value })}
              />
            </Field>
            <Field label="Academic year">
              <Input
                required
                value={form.academicYear}
                onChange={(e) => setForm({ ...form, academicYear: e.target.value })}
                placeholder="2026-27"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date">
              <Input type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </Field>
            <Field label="End date">
              <Input type="date" required value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </Field>
          </div>

          <Field label="Working days" hint="Only these days will appear in your weekly timetable.">
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {ALL_DAYS.map((day) => {
                const on = form.workingDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleDay(day)}
                    className={`h-8 px-3 rounded-md text-xs font-medium border transition-colors ${
                      on
                        ? 'bg-accent-soft text-accent-strong border-accent-fade'
                        : 'bg-surface text-ink-400 border-line-strong hover:text-ink-600'
                    }`}
                  >
                    {day.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </Field>

          <div className="flex justify-end gap-2 pt-2 border-t border-line">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit">{editing ? 'Save changes' : 'Create semester'}</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={remove}
        danger
        confirmLabel="Delete semester"
        title={`Delete “${confirmDelete?.semesterName}”?`}
        body="This permanently removes the semester and everything scoped to it: subjects, lab sections, timetable entries, exceptions, and attendance history. This cannot be undone."
      />
    </Card>
  );
};

/* ================================================================== */
/* Subject registration + 4-credit lab section                         */
/* ================================================================== */
const emptySubject = () => ({
  name: '',
  code: '',
  faculty: '',
  credits: 4,
  type: 'Theory',
  theorySessionsPerWeek: 3,
  theoryDuration: 1,
  hasLab: false,
  targetAttendance: '',
  labSection: { hasLab: false, labName: '', duration: 2, sessionsPerWeek: 1 },
});

export const SubjectsSection = ({ subjects: rawSubjects, onChanged, semesterReady }) => {
  const subjects = rawSubjects.map(normSubject);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptySubject());

  const openCreate = () => {
    setEditing(null);
    setForm(emptySubject());
    setError('');
    setModalOpen(true);
  };

  const openEdit = (s) => {
    setEditing(s);
    setForm({
      name: s.name || '',
      code: s.code || '',
      faculty: s.faculty || '',
      credits: s.credits || 4,
      type: s.type || 'Theory',
      theorySessionsPerWeek: s.theorySessionsPerWeek || 3,
      theoryDuration: s.theoryDuration || 1,
      hasLab: !!s.labSection?.hasLab,
      targetAttendance: s.targetAttendance || '',
      labSection: {
        hasLab: !!s.labSection?.hasLab,
        labName: s.labSection?.labName || '',
        duration: s.labSection?.duration || 2,
        sessionsPerWeek: s.labSection?.sessionsPerWeek || 1,
      },
    });
    setError('');
    setModalOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setError('');
    const labOn = form.credits === 4 && form.hasLab;
    const payload = {
      ...form,
      labSection: {
        hasLab: labOn,
        labName: labOn ? form.labSection.labName || `${form.name} Lab` : '',
        duration: labOn ? Number(form.labSection.duration) || 2 : 2,
        sessionsPerWeek: labOn ? Number(form.labSection.sessionsPerWeek) || 1 : 1,
      },
    };
    try {
      if (editing) {
        await API.put(`/academics/subjects/${editing._id}`, payload);
      } else {
        await API.post('/academics/subjects', payload);
      }
      setModalOpen(false);
      onChanged();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save the subject.');
    }
  };

  const remove = async () => {
    try {
      await API.delete(`/academics/subjects/${confirmDelete._id}`);
      setConfirmDelete(null);
      onChanged();
    } catch (err) {
      setConfirmDelete(null);
      alert(err.response?.data?.message || 'Could not delete the subject.');
    }
  };

  const hasNoData = subjects.length === 0;

  return (
    <Card>
      <div className="p-5 sm:p-6">
        <SectionHeader
          title="Subjects"
          hint="Register your courses before building the timetable. 4-credit subjects can add a lab section that shares the subject's code."
          aside={
            <Button onClick={openCreate} disabled={!semesterReady} title={semesterReady ? undefined : 'Create a semester first'}>
              <Plus className="w-4 h-4" /> Register subject
            </Button>
          }
        />

        {hasNoData ? (
          <EmptyState
            icon={BookOpen}
            title={semesterReady ? 'No subjects registered yet' : 'Create a semester first'}
            description={
              semesterReady
                ? 'Register the courses you are taking this semester. Name, code, credits, and weekly sessions. Your timetable is built from these.'
                : 'Subjects belong to a semester. Create one above, then register your courses here.'
            }
            action={
              semesterReady ? (
                <Button onClick={openCreate}>
                  <Plus className="w-4 h-4" /> Register first subject
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto -mx-5 sm:-mx-6">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                {/* Headers are centred inside their own column, so each one
                    sits directly above the values it labels. */}
                <tr className="border-y border-line bg-paper-deep text-2xs uppercase tracking-wide2 text-ink-400">
                  <th className="font-medium px-5 sm:px-6 py-2.5 text-center">Code</th>
                  <th className="font-medium px-3 py-2.5 text-center">Subject</th>
                  <th className="font-medium px-3 py-2.5 text-center">Credits</th>
                  <th className="font-medium px-3 py-2.5 text-center">Weekly</th>
                  <th className="font-medium px-3 py-2.5 text-center">Lab</th>
                  <th className="font-medium px-3 py-2.5 text-center">Faculty</th>
                  <th className="font-medium px-3 py-2.5 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {subjects.map((s) => (
                  <tr key={s._id} className="hover:bg-paper-deep/50">
                    <td className="px-5 sm:px-6 py-3 font-mono text-xs font-medium text-accent-strong whitespace-nowrap text-center">{s.code}</td>
                    <td className="px-3 py-3 text-ink-900 font-medium">{s.name}</td>
                    <td className="px-3 py-3 text-ink-600 text-center tabular-nums">{s.credits}</td>
                    <td className="px-3 py-3 text-ink-600 whitespace-nowrap text-center tabular-nums">
                      {s.theorySessionsPerWeek || 3} × {s.theoryDuration || 1}h
                    </td>
                    <td className="px-3 py-3 text-center">
                      {s.labSection?.hasLab ? (
                        <Pill tone="accent">
                          <FlaskConical className="w-3 h-3" />
                          {s.labSection.duration || 2}h × {s.labSection.sessionsPerWeek || 1}/wk
                        </Pill>
                      ) : (
                        <span className="text-xs text-ink-400">-</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-ink-600">{s.faculty || <span className="text-ink-300">-</span>}</td>
                    <td className="px-3 py-3">
                      <div className="flex justify-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(s)} aria-label={`Edit ${s.name}`}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-ink-400 hover:text-danger hover:bg-danger-soft"
                          onClick={() => setConfirmDelete(s)}
                          aria-label={`Delete ${s.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit subject' : 'Register subject'}
        subtitle="Lab code always inherits the subject code automatically."
        wide
      >
        <form onSubmit={save} className="space-y-4">
          {error && (
            <div role="alert" className="p-3 rounded-md bg-danger-soft border border-danger/25 text-danger text-xs">
              {error}
            </div>
          )}

          <div className="grid sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <Field label="Subject name">
                <Input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Operating Systems"
                />
              </Field>
            </div>
            <Field label="Subject code">
              <Input
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="e.g. CS504"
                className="font-mono"
              />
            </Field>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Credits">
              <Select
                value={form.credits}
                onChange={(e) => {
                  const c = Number(e.target.value);
                  setForm({ ...form, credits: c, hasLab: c === 4 ? form.hasLab : false });
                }}
              >
                {[1, 2, 3, 4, 5, 6].map((c) => (
                  <option key={c} value={c}>{c} credits</option>
                ))}
              </Select>
            </Field>
            <Field label="Subject type">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option>Theory</option>
                <option>Practical</option>
                <option>Elective</option>
                <option>Other</option>
              </Select>
            </Field>
            <Field label="Faculty (optional)">
              <Input value={form.faculty} onChange={(e) => setForm({ ...form, faculty: e.target.value })} placeholder="Optional" />
            </Field>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Theory sessions per week">
              <Input
                type="number"
                min="1"
                max="10"
                value={form.theorySessionsPerWeek}
                onChange={(e) => setForm({ ...form, theorySessionsPerWeek: e.target.value })}
              />
            </Field>
            <Field label="Theory duration (hours)">
              <Input
                type="number"
                min="1"
                max="4"
                value={form.theoryDuration}
                onChange={(e) => setForm({ ...form, theoryDuration: e.target.value })}
              />
            </Field>
          </div>

          <Field
            label="Attendance target for this subject (optional)"
            hint="Leave blank to use your default from Settings. Must-attend and safe-bunk maths use this number."
          >
            <Input
              type="number"
              min="50"
              max="100"
              value={form.targetAttendance}
              onChange={(e) => setForm({ ...form, targetAttendance: e.target.value })}
              placeholder="Default from Settings"
            />
          </Field>

          {/* 4-credit lab flow */}
          {Number(form.credits) === 4 && (
            <div className="rounded-lg border border-line-strong bg-paper-deep/60 p-4">
              <p className="text-sm font-medium text-ink-900">Does this subject have a lab?</p>
              <p className="text-xs text-ink-500 mt-0.5 mb-3">
                The lab stays part of this subject and uses the same code ({form.code || 'subject code'}).
              </p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  aria-pressed={form.hasLab}
                  onClick={() => setForm({ ...form, hasLab: true, labSection: { ...form.labSection, hasLab: true } })}
                  className={`h-8 px-4 rounded-md text-xs font-medium border transition-colors ${
                    form.hasLab ? 'bg-accent text-white border-accent' : 'bg-surface text-ink-600 border-line-strong hover:text-ink-900'
                  }`}
                >
                  Yes
                </button>
                <button
                  type="button"
                  aria-pressed={!form.hasLab}
                  onClick={() => setForm({ ...form, hasLab: false, labSection: { ...form.labSection, hasLab: false } })}
                  className={`h-8 px-4 rounded-md text-xs font-medium border transition-colors ${
                    !form.hasLab ? 'bg-accent text-white border-accent' : 'bg-surface text-ink-600 border-line-strong hover:text-ink-900'
                  }`}
                >
                  No
                </button>
              </div>

              {form.hasLab && (
                <div className="mt-4 pt-4 border-t border-line space-y-3">
                  <div className="grid sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <Field label="Lab name">
                        <Input
                          value={form.labSection.labName}
                          onChange={(e) => setForm({ ...form, labSection: { ...form.labSection, labName: e.target.value } })}
                          placeholder={`${form.name || 'Subject'} Lab`}
                        />
                      </Field>
                    </div>
                    <Field label="Lab code" hint="Inherited from the subject.">
                      <Input value={form.code || ''} disabled className="font-mono" />
                    </Field>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Field label="Lab duration (hours)">
                      <Select
                        value={form.labSection.duration}
                        onChange={(e) => setForm({ ...form, labSection: { ...form.labSection, duration: Number(e.target.value) } })}
                      >
                        {[1, 2, 3].map((h) => (
                          <option key={h} value={h}>{h} hour{h > 1 ? 's' : ''}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Lab sessions per week">
                      <Select
                        value={form.labSection.sessionsPerWeek}
                        onChange={(e) => setForm({ ...form, labSection: { ...form.labSection, sessionsPerWeek: Number(e.target.value) } })}
                      >
                        {[1, 2].map((n) => (
                          <option key={n} value={n}>{n} per week</option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-line">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit">{editing ? 'Save changes' : 'Register subject'}</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={remove}
        danger
        confirmLabel="Delete subject"
        title={`Delete “${confirmDelete?.name}”?`}
        body="This removes the subject and its lab section, plus any timetable slots and attendance records that reference it."
      />
    </Card>
  );
};
