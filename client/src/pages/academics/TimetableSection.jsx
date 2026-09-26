import React, { useState } from 'react';
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, AlertTriangle, CheckCircle2 } from '../../components/common/Icons';
import API from '../../services/api';
import {
  Button, Card, Field, Input, Select, Pill, Modal, EmptyState, SectionHeader,
} from '../../components/common/ui';

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const to12h = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h)) return t;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
};

export const TimetableSection = ({ activeSemester, subjects, gridData, gridLoading, onChanged }) => {
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [slotsDraft, setSlotsDraft] = useState([]);
  const [scheduleError, setScheduleError] = useState('');

  const [cellOpen, setCellOpen] = useState(false);
  const [cell, setCell] = useState(null); // { day, slotIndex }
  const [cellForm, setCellForm] = useState({ entryType: 'theory', subjectId: '', room: '' });
  const [cellError, setCellError] = useState('');

  const [exceptionsOpen, setExceptionsOpen] = useState(false);
  const [exceptions, setExceptions] = useState([]);
  const [exceptionForm, setExceptionForm] = useState({ date: '', type: 'holiday', title: '', notes: '' });
  const [exceptionError, setExceptionError] = useState('');

  const workingDays = gridData?.workingDays?.length
    ? gridData.workingDays
    : activeSemester?.workingDays || [];
  const timeSlots = gridData?.timeSlots || activeSemester?.timeSlots || [];
  const grid = gridData?.grid || {};
  const validation = gridData?.validation || { isValid: false, summary: [], canActivate: false };

  /* ---------------- Time schedule editor ---------------- */
  const openSchedule = () => {
    setSlotsDraft((activeSemester?.timeSlots || []).map((s) => ({ ...s })));
    setScheduleError('');
    setScheduleOpen(true);
  };

  const saveSchedule = async () => {
    setScheduleError('');
    if (!slotsDraft.length) {
      setScheduleError('Add at least one time slot.');
      return;
    }
    const normalized = slotsDraft.map((s, i) => ({
      slotIndex: i,
      startTime: s.startTime,
      endTime: s.endTime,
      label: s.label || '',
      type: s.type || 'regular',
    }));
    for (const s of normalized) {
      if (!s.startTime || !s.endTime) {
        setScheduleError('Every slot needs a start and end time.');
        return;
      }
      if (s.endTime <= s.startTime) {
        setScheduleError('Each slot must end after it starts.');
        return;
      }
    }
    try {
      await API.put(`/academics/semesters/${activeSemester._id}`, { timeSlots: normalized });
      setScheduleOpen(false);
      onChanged();
    } catch (err) {
      setScheduleError(err.response?.data?.message || 'Could not save the schedule.');
    }
  };

  const moveSlot = (idx, dir) => {
    setSlotsDraft((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  /* ---------------- Cell assignment ---------------- */
  const openCell = (day, slotIndex) => {
    const existing = grid?.[day]?.[slotIndex];
    setCell({ day, slotIndex });
    setCellForm({
      entryType: existing?.entryType || 'theory',
      subjectId: existing?.subject?._id || '',
      room: existing?.room || '',
    });
    setCellError('');
    setCellOpen(true);
  };

  const saveCell = async (e) => {
    e.preventDefault();
    setCellError('');
    try {
      await API.post('/academics/timetable/cell', {
        day: cell.day,
        slotIndex: cell.slotIndex,
        entryType: cellForm.entryType,
        subjectId: ['theory', 'lab'].includes(cellForm.entryType) ? cellForm.subjectId : null,
        room: cellForm.room,
      });
      setCellOpen(false);
      onChanged();
    } catch (err) {
      setCellError(err.response?.data?.message || 'Could not assign this cell.');
    }
  };

  const activateTimetable = async () => {
    try {
      await API.post('/academics/timetable/activate');
      onChanged();
    } catch (err) {
      alert(err.response?.data?.message || 'Could not activate the timetable.');
    }
  };

  /* ---------------- Exceptions (holidays) ---------------- */
  const openExceptions = async () => {
    setExceptionsOpen(true);
    try {
      const res = await API.get('/academics/exceptions');
      setExceptions(res.data?.exceptions || []);
    } catch {
      setExceptions([]);
    }
  };

  const addException = async (e) => {
    e.preventDefault();
    setExceptionError('');
    try {
      await API.post('/academics/exceptions', exceptionForm);
      setExceptionForm({ date: '', type: 'holiday', title: '', notes: '' });
      const res = await API.get('/academics/exceptions');
      setExceptions(res.data?.exceptions || []);
      onChanged();
    } catch (err) {
      setExceptionError(err.response?.data?.message || 'Could not add the exception.');
    }
  };

  const removeException = async (id) => {
    try {
      await API.delete(`/academics/exceptions/${id}`);
      setExceptions((prev) => prev.filter((x) => x._id !== id));
      onChanged();
    } catch {
      /* keep list */
    }
  };

  const labSubjects = subjects.filter((s) => s.labSection?.hasLab);
  const anySlotConfigured = timeSlots.length > 0;

  return (
    <Card>
      <div className="p-5 sm:p-6">
        <SectionHeader
          title="Weekly timetable"
          hint="Your weekly sheet is generated from your configured working days, time slots and registered subjects. So those must be set up first."
          aside={
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={openExceptions}>Holidays &amp; exceptions</Button>
              <Button variant="secondary" onClick={openSchedule} disabled={!activeSemester}>
                <Pencil className="w-3.5 h-3.5" /> Time slots
              </Button>
            </div>
          }
        />

        {/* Validation summary — always real, from the server */}
        {timeSlots.length > 0 && subjects.length > 0 && (
          <div
            className={`mb-4 rounded-lg border p-3.5 ${
              validation.isValid ? 'border-ok/25 bg-ok-soft' : 'border-warn/25 bg-warn-soft'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              {validation.isValid ? (
                <CheckCircle2 className="w-4 h-4 text-ok" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-warn" />
              )}
              <span className={`text-xs font-semibold ${validation.isValid ? 'text-ok' : 'text-warn'}`}>
                {validation.isValid ? 'All weekly requirements met' : 'Requirements not met yet'}
              </span>
            </div>
            {validation.summary?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {validation.summary.map((r) => {
                  const done = r.isTheoryComplete && (!r.hasLab || r.isLabComplete);
                  return (
                    <Pill key={r.subjectId} tone={done ? 'ok' : 'warn'}>
                      {r.code} · theory {r.theoryAssigned}/{r.theoryRequired}
                      {r.hasLab ? ` · lab ${r.labAssigned}/${r.labRequired}` : ''}
                    </Pill>
                  );
                })}
              </div>
            )}
            <div className="mt-3">
              <Button size="sm" onClick={activateTimetable} disabled={!validation.canActivate || activeSemester?.isTimetableActivated}>
                {activeSemester?.isTimetableActivated
                  ? 'Timetable activated'
                  : validation.canActivate
                  ? 'Activate timetable'
                  : 'Resolve items above to activate'}
              </Button>
            </div>
          </div>
        )}

        {/* Grid / empty states */}
        {!activeSemester ? (
          <EmptyState title="No active semester" description="Create a semester above to begin building your timetable." />
        ) : !anySlotConfigured ? (
          <EmptyState
            title="No time slots yet"
            description="Configure your working days and time slots, then assign your registered subjects to the grid."
            action={
              <Button onClick={openSchedule}>
                <Plus className="w-4 h-4" /> Configure time slots
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line-strong">
            {gridLoading ? (
              <div className="p-12 text-center text-sm text-ink-400">Loading timetable…</div>
            ) : (
              <table className="w-full border-collapse text-sm" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th className="sticky left-0 z-20 bg-paper-deep border-b border-r border-line-strong px-3 py-2.5 text-center text-2xs font-medium uppercase tracking-wide2 text-ink-400 min-w-[110px]">
                      Day / Time
                    </th>
                    {timeSlots.map((ts) => {
                      const isPause = ts.type === 'break' || ts.type === 'lunch';
                      return (
                        <th
                          key={ts.slotIndex}
                          className={`border-b border-r border-line-strong px-2 py-2 text-center min-w-[104px] ${
                            isPause ? 'bg-paper-deep' : 'bg-paper-deep'
                          }`}
                        >
                          <div className={`text-2xs font-medium whitespace-nowrap ${isPause ? 'text-warn' : 'text-ink-700'}`}>
                            {to12h(ts.startTime)} to {to12h(ts.endTime)}
                          </div>
                          {ts.label && <div className="text-2xs text-ink-400 mt-0.5">{ts.label}</div>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {workingDays.map((day) => (
                    <tr key={day}>
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-surface border-b border-r border-line-strong px-3 py-2.5 text-left text-xs font-semibold text-ink-900"
                      >
                        {day}
                      </th>
                      {timeSlots.map((ts) => {
                        const cellData = grid?.[day]?.[ts.slotIndex];
                        if (cellData?.isConsecutiveContinuation) return null;

                        const colSpan = cellData?.colSpan || 1;
                        const slotIsPause = ts.type === 'break' || ts.type === 'lunch';
                        const isLab = cellData?.entryType === 'lab';
                        const isTheory = cellData?.entryType === 'theory';
                        const isPauseCell = slotIsPause || cellData?.entryType === 'break' || cellData?.entryType === 'lunch';

                        return (
                          <td
                            key={`${day}-${ts.slotIndex}`}
                            colSpan={colSpan}
                            className={`border-b border-r border-line-strong p-1.5 align-middle ${
                              isPauseCell
                                ? 'bg-paper-deep text-center'
                                : isLab
                                ? 'bg-accent-wash text-center'
                                : isTheory
                                ? 'bg-surface text-center'
                                : 'bg-surface'
                            }`}
                          >
                            {isPauseCell ? (
                              <span className="text-2xs font-medium uppercase tracking-wide2 text-ink-400">
                                {ts.label || ts.type}
                              </span>
                            ) : cellData?.subject ? (
                              <button
                                type="button"
                                onClick={() => openCell(day, ts.slotIndex)}
                                className="w-full text-center rounded-md px-1.5 py-1 hover:shadow-focus-accent transition-shadow"
                              >
                                <span className="block text-xs font-semibold text-ink-900 truncate">
                                  {cellData.subject.name}
                                </span>
                                <span className="block text-2xs font-mono text-accent-strong">
                                  {cellData.subject.code}
                                  {isLab ? ' · LAB' : ''}
                                </span>
                                {cellData.room && (
                                  <span className="block text-2xs text-ink-400 truncate">{cellData.room}</span>
                                )}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openCell(day, ts.slotIndex)}
                                aria-label={`Assign a class on ${day}, ${to12h(ts.startTime)}`}
                                className="w-full h-9 rounded-md border border-dashed border-line-strong text-ink-300 hover:text-accent hover:border-accent-fade hover:bg-accent-wash transition-colors text-lg leading-none"
                              >
                                +
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {anySlotConfigured && subjects.length === 0 && (
          <p className="mt-3 text-xs text-ink-500">Add subjects first. Then assign them to the grid.</p>
        )}

        {labSubjects.length > 0 && (
          <p className="mt-3 text-2xs text-ink-400">
            Lab sections (part of their parent subject, same code):{' '}
            {labSubjects.map((s) => s.code).join(', ')}
          </p>
        )}
      </div>

      {/* Time slot editor */}
      <Modal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title="Configure time slots"
        subtitle="No defaults. You define every period, break, and lunch for your college day."
        wide
      >
        <div className="space-y-3">
          {scheduleError && (
            <div role="alert" className="p-3 rounded-md bg-danger-soft border border-danger/25 text-danger text-xs">
              {scheduleError}
            </div>
          )}

          {slotsDraft.length === 0 && (
            <p className="text-sm text-ink-500 py-2">
              Start by adding your first time slot. For example your first period, a break, or lunch.
            </p>
          )}

          {slotsDraft.map((slot, idx) => (
            <div key={idx} className="flex flex-col lg:flex-row lg:items-end gap-2.5 p-3 rounded-lg border border-line bg-paper-deep/50">
              <div className="grid flex-1 grid-cols-2 lg:grid-cols-4 gap-2.5">
                <Field label="Start">
                  <Input
                    type="time"
                    value={slot.startTime || ''}
                    onChange={(e) => {
                      const next = [...slotsDraft];
                      next[idx] = { ...next[idx], startTime: e.target.value };
                      setSlotsDraft(next);
                    }}
                  />
                </Field>
                <Field label="End">
                  <Input
                    type="time"
                    value={slot.endTime || ''}
                    onChange={(e) => {
                      const next = [...slotsDraft];
                      next[idx] = { ...next[idx], endTime: e.target.value };
                      setSlotsDraft(next);
                    }}
                  />
                </Field>
                <Field label="Type">
                  <Select
                    value={slot.type || 'regular'}
                    onChange={(e) => {
                      const next = [...slotsDraft];
                      next[idx] = { ...next[idx], type: e.target.value };
                      setSlotsDraft(next);
                    }}
                  >
                    <option value="regular">Academic</option>
                    <option value="break">Break</option>
                    <option value="lunch">Lunch</option>
                    <option value="other">Other</option>
                  </Select>
                </Field>
                <Field label="Label (optional)">
                  <Input
                    value={slot.label || ''}
                    onChange={(e) => {
                      const next = [...slotsDraft];
                      next[idx] = { ...next[idx], label: e.target.value };
                      setSlotsDraft(next);
                    }}
                    placeholder="e.g. Period 1"
                  />
                </Field>
              </div>
              <div className="flex lg:flex-col gap-1 justify-end">
                <Button variant="ghost" size="sm" disabled={idx === 0} onClick={() => moveSlot(idx, -1)} aria-label="Move up">
                  <ChevronUp className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" disabled={idx === slotsDraft.length - 1} onClick={() => moveSlot(idx, 1)} aria-label="Move down">
                  <ChevronDown className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-ink-400 hover:text-danger hover:bg-danger-soft"
                  onClick={() => setSlotsDraft((prev) => prev.filter((_, i) => i !== idx))}
                  aria-label="Remove slot"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}

          <Button
            variant="secondary"
            className="w-full border-dashed"
            onClick={() => setSlotsDraft([...slotsDraft, { slotIndex: slotsDraft.length, startTime: '', endTime: '', type: 'regular', label: '' }])}
          >
            <Plus className="w-4 h-4" /> Add time slot
          </Button>

          <div className="flex justify-end gap-2 pt-3 border-t border-line">
            <Button variant="secondary" onClick={() => setScheduleOpen(false)}>Cancel</Button>
            <Button onClick={saveSchedule}>Save schedule</Button>
          </div>
        </div>
      </Modal>

      {/* Cell assignment */}
      <Modal
        open={cellOpen}
        onClose={() => setCellOpen(false)}
        title={cell ? `${cell.day} · ${to12h(timeSlots.find((t) => t.slotIndex === cell.slotIndex)?.startTime)}` : 'Assign cell'}
        subtitle="Choose what happens in this slot."
      >
        <form onSubmit={saveCell} className="space-y-4">
          {cellError && (
            <div role="alert" className="p-3 rounded-md bg-danger-soft border border-danger/25 text-danger text-xs">
              {cellError}
            </div>
          )}

          <Field label="Slot type">
            <Select value={cellForm.entryType} onChange={(e) => setCellForm({ ...cellForm, entryType: e.target.value })}>
              <option value="theory">Theory class</option>
              {labSubjects.length > 0 && <option value="lab">Lab session</option>}
              <option value="break">Break</option>
              <option value="lunch">Lunch</option>
              <option value="free">Free period (clear)</option>
            </Select>
          </Field>

          {(cellForm.entryType === 'theory' || cellForm.entryType === 'lab') && (
            <>
              <Field label="Subject">
                <Select
                  required
                  value={cellForm.subjectId}
                  onChange={(e) => setCellForm({ ...cellForm, subjectId: e.target.value })}
                >
                  <option value="">Select a subject…</option>
                  {subjects
                    .filter((s) => (cellForm.entryType === 'lab' ? s.labSection?.hasLab : true))
                    .map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.code}: {s.name}
                        {cellForm.entryType === 'lab' ? ' (lab section)' : ''}
                      </option>
                    ))}
                </Select>
                {cellForm.entryType === 'lab' && (
                  <p className="mt-1.5 text-2xs text-ink-500">
                    A lab spans consecutive slots to match its duration.
                  </p>
                )}
              </Field>
              <Field label="Room (optional)">
                <Input
                  value={cellForm.room}
                  onChange={(e) => setCellForm({ ...cellForm, room: e.target.value })}
                  placeholder="e.g. Hall 304"
                />
              </Field>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-line">
            <Button variant="secondary" onClick={() => setCellOpen(false)}>Cancel</Button>
            <Button type="submit">Assign</Button>
          </div>
        </form>
      </Modal>

      {/* Exceptions manager */}
      <Modal
        open={exceptionsOpen}
        onClose={() => setExceptionsOpen(false)}
        title="Holidays & exceptions"
        subtitle="Only the ones you add are used. Holiday and cancelled dates never penalize attendance."
        wide
      >
        <form onSubmit={addException} className="grid sm:grid-cols-2 gap-3">
          <Field label="Date">
            <Input
              type="date"
              required
              value={exceptionForm.date}
              onChange={(e) => setExceptionForm({ ...exceptionForm, date: e.target.value })}
            />
          </Field>
          <Field label="Type">
            <Select value={exceptionForm.type} onChange={(e) => setExceptionForm({ ...exceptionForm, type: e.target.value })}>
              <option value="holiday">Holiday</option>
              <option value="no_class">No class</option>
              <option value="event">College event</option>
              <option value="exam">Exam day</option>
              <option value="cancelled">Cancelled class</option>
              <option value="custom">Custom</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Title">
              <Input
                required
                value={exceptionForm.title}
                onChange={(e) => setExceptionForm({ ...exceptionForm, title: e.target.value })}
                placeholder="e.g. Independence Day"
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm">
              <Plus className="w-3.5 h-3.5" /> Add exception
            </Button>
          </div>
        </form>

        <div className="mt-5 border-t border-line pt-4">
          {exceptions.length === 0 ? (
            <p className="text-sm text-ink-500">No exceptions yet. Add holidays or cancelled days above.</p>
          ) : (
            <ul className="divide-y divide-line">
              {exceptions.map((x) => (
                <li key={x._id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-sm text-ink-900">
                      <span className="font-medium">{x.title}</span>{' '}
                      <span className="text-2xs text-ink-400">({x.type.replace('_', ' ')})</span>
                    </p>
                    <p className="text-2xs text-ink-400 font-mono">{x.date}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-ink-400 hover:text-danger hover:bg-danger-soft"
                    onClick={() => removeException(x._id)}
                    aria-label={`Remove ${x.title}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </Card>
  );
};

export default TimetableSection;
