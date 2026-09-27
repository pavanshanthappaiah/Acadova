import { CustomRoutine, RoutineCompletion, RoutineCategory } from '../models/Routine.js';
import { syncUserReminders } from '../services/notificationEngine.js';
import { Semester, TimetableSlot, SemesterException, ClassSession } from '../models/Academic.js';
import {
  localDateStr,
  localMinutesOfDay,
  toMinutes,
  evaluateLock,
  lockMessage,
  isFlexibleRoutine,
  dayNameOf,
  datesInWeek,
  datesInMonth,
  summariseProgress,
  monthKeyOf,
  startOfWeek,
  addDays,
} from '../utils/time.js';

// Helper: derive Day of Week from YYYY-MM-DD
const getDayName = dayNameOf;

const effectiveEnd = (endTime, startTime) => toMinutes(endTime) ?? toMinutes(startTime);

/**
 * Ids of the student's timed routines that apply to `date` — the set the
 * flexible gate waits on before untimed routines become markable.
 */
const timedRoutineIdsForDate = async (userId, date) =>
  CustomRoutine.find({
    user: userId,
    startTime: { $ne: '' },
    $or: [
      { isRecurring: false, date },
      {
        isRecurring: true,
        $or: [
          { recurrenceDays: dayNameOf(date) },
          { recurrenceDays: 'Every Day' },
          { recurrenceDays: 'daily' },
        ],
      },
    ],
  }).distinct('_id');

/**
 * Flexible (untimed) routines become markable only once every timed routine
 * for the same date has been marked — "end of day", without hard-coding an
 * hour. Days with no timed routines leave the gate open. Past days stay open
 * for corrections; future days are already covered by evaluateLock.
 *
 * Returns null when the gate is open, or a human-readable reason when closed.
 */
const flexibleGate = async (userId, date, today) => {
  if (date !== today) return null;

  const ids = await timedRoutineIdsForDate(userId, date);
  if (ids.length === 0) return null; // nothing timed today → flexible stays open

  const doneTimed = await RoutineCompletion.countDocuments({
    user: userId,
    routine: { $in: ids },
    date,
    completed: true,
  });

  return doneTimed < ids.length
    ? `Flexible routines unlock once all timed routines for today are marked (${doneTimed} of ${ids.length} done).`
    : null;
};

/**
 * One read of everything a schedule day needs, reusable across a single date, a
 * week or a month. Keeps the combined timeline, the lock rules, the checkboxes
 * and every chart reading from the same records.
 */
const loadScheduleContext = async (userId, dates) => {
  const [activeSemester, routines, completions, exceptions, slots, sessions] = await Promise.all([
    Semester.findOne({ user: userId, isActive: true }),
    CustomRoutine.find({ user: userId }),
    RoutineCompletion.find({ user: userId, date: { $in: dates } }),
    SemesterException.find({ user: userId, date: { $in: dates } }),
    TimetableSlot.find({
      user: userId,
      entryType: { $in: ['theory', 'lab'] },
      isConsecutiveContinuation: false,
    }).populate('subject', 'name code color faculty'),
    ClassSession.find({ user: userId, date: { $in: dates } }),
  ]);

  return { activeSemester, routines, completions, exceptions, slots, sessions };
};

const belongsToSemester = (record, semester) =>
  !record.semester || record.semester.toString() === semester._id.toString();

/**
 * A 2-hour lab stores only its first slot's times, so the session really ends
 * when the last reserved slot ends.
 */
const slotEndTime = (slot, semester) => {
  const span = slot.colSpan || 1;
  if (span > 1 && Array.isArray(semester?.timeSlots)) {
    const last = semester.timeSlots.find((ts) => ts.slotIndex === slot.slotIndex + span - 1);
    if (last?.endTime) return last.endTime;
  }
  return slot.end_time;
};

/**
 * Build the combined day: real academic classes (from the activated timetable,
 * minus exceptions) plus the student's own routines, each carrying its live
 * lock state and completion status.
 */
const buildDayItems = (ctx, date, { today, nowMinutes, flexibleGateMessage = null }) => {
  const dayOfWeek = getDayName(date);
  const { activeSemester: semester } = ctx;
  const items = [];
  let isWithinSemester = false;
  let exception = null;
  let isHoliday = false;

  if (semester) {
    isWithinSemester = date >= semester.startDate && date <= semester.endDate;
    exception = ctx.exceptions.find((e) => e.date === date && belongsToSemester(e, semester)) || null;
    isHoliday = !!exception && ['holiday', 'no_class', 'cancelled'].includes(exception.type);

    if (!isHoliday) {
      const slots = ctx.slots.filter(
        (slot) => slot.day === dayOfWeek && slot.subject && belongsToSemester(slot, semester)
      );
      const seen = new Set();

      for (const slot of slots) {
        if (seen.has(slot._id.toString())) continue;
        seen.add(slot._id.toString());

        const session = ctx.sessions.find((s) => s.date === date && s.notes === `timetable:${slot._id}`);
        const attended = !!session && (session.status === 'attended' || session.status === 'present');
        const missed = !!session && (session.status === 'missed' || session.status === 'absent');
        const markedCancelled = !!session && session.status === 'cancelled';
        const endTime = slotEndTime(slot, semester);
        const lock = evaluateLock({
          date,
          threshold: effectiveEnd(endTime, slot.start_time),
          today,
          nowMinutes,
        });

        const status = markedCancelled
          ? 'cancelled'
          : attended
            ? 'completed'
            : missed
              ? 'missed'
              : lock.locked
                ? 'scheduled'
                : 'available';

        items.push({
          id: slot._id,
          source: 'academic',
          entryType: slot.entryType,
          sessionType: slot.entryType,
          title:
            slot.entryType === 'lab'
              ? `${slot.subject.name} (Lab)`
              : slot.subject.name,
          code: slot.subject.code,
          faculty: slot.subject.faculty,
          color: slot.subject.color,
          room: slot.room,
          startTime: slot.start_time,
          endTime,
          date,
          lockAt: lock.lockAt,
          locked: lock.locked && status !== 'cancelled' && status !== 'completed',
          completed: attended,
          attendanceStatus: session ? session.status : 'unmarked',
          status,
        });
      }
    }
  }

  for (const routine of ctx.routines) {
    const applies = routine.isRecurring
      ? (routine.recurrenceDays || []).some(
          (d) => d === dayOfWeek || d === 'Every Day' || d === 'daily'
        )
      : routine.date === date;
    if (!applies) continue;

    const completion = ctx.completions.find(
      (c) => c.date === date && c.routine.toString() === routine._id.toString()
    );
    const done = !!completion?.completed;
    const lock = evaluateLock({
      date,
      threshold: effectiveEnd(routine.endTime, routine.startTime),
      today,
      nowMinutes,
    });
    // The flexible gate is decided per whole day, so it is computed by the
    // caller (timedRoutineIdsForDate + flexibleGate) and passed in. Non-today
    // days are exempt: past days stay open for corrections and future days
    // are already fully locked by evaluateLock.
    const flexible = isFlexibleRoutine(routine);
    const flexibleLocked = flexible && !done && date === today && !!flexibleGateMessage;

    items.push({
      _id: routine._id,
      id: routine._id,
      source: 'routine',
      title: routine.title,
      category: routine.category,
      priority: routine.priority,
      notes: routine.notes,
      isRecurring: routine.isRecurring,
      recurrenceDays: routine.recurrenceDays,
      startTime: routine.startTime,
      endTime: routine.endTime,
      date,
      flexible,
      lockAt: flexibleLocked ? null : lock.lockAt,
      locked: done ? false : flexibleLocked || lock.locked,
      lockMessage: done
        ? null
        : flexibleLocked
          ? flexibleGateMessage
          : lock.locked
            ? lockMessage(lock.lockAt)
            : null,
      completed: done,
      completedAt: completion?.completedAt || null,
      status: done ? 'completed' : flexibleLocked || lock.locked ? 'scheduled' : 'available',
    });
  }

  items.sort(
    (a, b) =>
      String(a.startTime || '').localeCompare(String(b.startTime || '')) ||
      String(a.title || '').localeCompare(String(b.title || ''))
  );

  return { date, dayOfWeek, isWithinSemester, isHoliday, exception, items };
};

// @desc    Get custom routines for a specific date (merged with completion state)
// @route   GET /api/routines?date=YYYY-MM-DD
export const getRoutinesForDate = async (req, res) => {
  try {
    const todayStr = req.query.date || localDateStr();
    const dayOfWeek = getDayName(todayStr);
    const today = localDateStr();
    const nowMinutes = localMinutesOfDay();

    // `?scope=all` reports every routine the student owns, regardless of
    // whether it falls on the requested date. Onboarding/setup UI uses it to
    // know whether routines exist at all — it never invents any.
    if (req.query.scope === 'all') {
      const ownedRoutines = await CustomRoutine.find({ user: req.user.id }).sort({
        startTime: 1,
        createdAt: 1,
      });

      const ownedIds = ownedRoutines.map((r) => r._id);
      const ownedCompletions = await RoutineCompletion.find({
        user: req.user.id,
        routine: { $in: ownedIds },
        date: todayStr,
      });
      const ownedCompletionMap = new Map();
      ownedCompletions.forEach((c) => ownedCompletionMap.set(c.routine.toString(), c.completed));

      return res.status(200).json({
        success: true,
        date: todayStr,
        totalRoutines: ownedRoutines.length,
        routines: ownedRoutines.map((r) => ({
          ...r.toObject(),
          completed: ownedCompletionMap.get(r._id.toString()) || false,
        })),
      });
    }

    // 1. One-off routines scheduled explicitly on this date
    const oneOffRoutines = await CustomRoutine.find({
      user: req.user.id,
      isRecurring: false,
      date: todayStr,
    });

    // 2. Recurring routines applicable to this day of week
    const recurringRoutines = await CustomRoutine.find({
      user: req.user.id,
      isRecurring: true,
      $or: [
        { recurrenceDays: dayOfWeek },
        { recurrenceDays: 'Every Day' },
        { recurrenceDays: 'daily' },
      ],
    });

    // Merge routines without duplicates
    const allRoutines = [...oneOffRoutines, ...recurringRoutines];

    // 3. Fetch completion records for this date
    const routineIds = allRoutines.map((r) => r._id);
    const completions = await RoutineCompletion.find({
      user: req.user.id,
      routine: { $in: routineIds },
      date: todayStr,
    });

    const completionMap = new Map();
    completions.forEach((c) => {
      completionMap.set(c.routine.toString(), c);
    });

    // Each routine carries its live lock state so the checkbox can be disabled
    // before the scheduled session has finished. Flexible (untimed) routines
    // additionally wait for every timed routine of the day to be marked.
    const flexibleMessage = await flexibleGate(req.user.id, todayStr, today);

    const routinesWithStatus = allRoutines.map((r) => {
      const completion = completionMap.get(r._id.toString());
      const done = !!completion?.completed;
      const lock = evaluateLock({
        date: todayStr,
        threshold: effectiveEnd(r.endTime, r.startTime),
        today,
        nowMinutes,
      });
      const flexible = isFlexibleRoutine(r);
      const flexibleLocked = flexible && !done && !!flexibleMessage;
      return {
        ...r.toObject(),
        completed: done,
        completedAt: completion?.completedAt || null,
        flexible,
        lockAt: lock.lockAt,
        locked: done ? false : flexibleLocked || lock.locked,
        lockMessage: done
          ? null
          : flexibleLocked
            ? flexibleMessage
            : lock.locked
              ? lockMessage(lock.lockAt)
              : null,
        status: done ? 'completed' : flexibleLocked || lock.locked ? 'scheduled' : 'available',
      };
    });

    // Sort by startTime if available
    routinesWithStatus.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

    const totalCount = routinesWithStatus.length;
    const completedCount = routinesWithStatus.filter((r) => r.completed).length;
    const percentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    return res.status(200).json({
      success: true,
      date: todayStr,
      dayOfWeek,
      today,
      now: `${String(Math.floor(nowMinutes / 60)).padStart(2, '0')}:${String(nowMinutes % 60).padStart(2, '0')}`,
      routines: routinesWithStatus,
      totalCount,
      completedCount,
      percentage,
      progress: summariseProgress(routinesWithStatus),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create a custom routine
// @route   POST /api/routines
export const createRoutine = async (req, res) => {
  try {
    const {
      title,
      category,
      priority,
      startTime,
      endTime,
      notes,
      isRecurring,
      recurrenceDays,
      date,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Routine title is required' });
    }

    const newRoutine = await CustomRoutine.create({
      user: req.user.id,
      title: title.trim(),
      category: (category || 'Personal').trim(),
      priority: priority || 'medium',
      startTime: startTime || '',
      endTime: endTime || '',
      notes: notes ? notes.trim() : '',
      isRecurring: !!isRecurring,
      recurrenceDays: Array.isArray(recurrenceDays) ? recurrenceDays : [],
      date: date || localDateStr(),
    });

    syncUserReminders(req.user.id).catch(() => {}); // new routine → schedule its reminders
    return res.status(201).json({
      success: true,
      routine: newRoutine,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update a custom routine
// @route   PUT /api/routines/:id
export const updateRoutine = async (req, res) => {
  try {
    const routine = await CustomRoutine.findOne({ _id: req.params.id, user: req.user.id });
    if (!routine) {
      return res.status(404).json({ success: false, message: 'Routine not found' });
    }

    const allowed = [
      'title',
      'category',
      'priority',
      'startTime',
      'endTime',
      'notes',
      'isRecurring',
      'recurrenceDays',
      'date',
    ];

    allowed.forEach((field) => {
      if (req.body[field] !== undefined) {
        routine[field] = req.body[field];
      }
    });

    await routine.save();
    syncUserReminders(req.user.id).catch(() => {}); // routine timing changed → recalc

    return res.status(200).json({
      success: true,
      routine,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete a custom routine
// @route   DELETE /api/routines/:id
export const deleteRoutine = async (req, res) => {
  try {
    const routine = await CustomRoutine.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id,
    });
    if (!routine) {
      return res.status(404).json({ success: false, message: 'Routine not found' });
    }

    // Delete associated completions
    await RoutineCompletion.deleteMany({ routine: req.params.id, user: req.user.id });
    syncUserReminders(req.user.id).catch(() => {}); // routine gone → cancel its reminders

    return res.status(200).json({
      success: true,
      message: 'Routine removed successfully',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Toggle completion checkbox for a routine on a specific date
// @route   POST /api/routines/:id/toggle
export const toggleRoutineCompletion = async (req, res) => {
  try {
    const { date, completed } = req.body;
    const targetDate = date || localDateStr();
    const today = localDateStr();

    const routine = await CustomRoutine.findOne({ _id: req.params.id, user: req.user.id });
    if (!routine) {
      return res.status(404).json({ success: false, message: 'Routine not found' });
    }

    // A scheduled session cannot be credited before it has finished. This is
    // enforced here, not only in the UI, so a direct API call cannot bypass it.
    // Un-ticking is always allowed.
    if (completed !== false) {
      const lock = evaluateLock({
        date: targetDate,
        threshold: effectiveEnd(routine.endTime, routine.startTime),
        today,
        nowMinutes: localMinutesOfDay(),
      });

      if (lock.locked) {
        return res.status(400).json({
          success: false,
          code: 'TOO_EARLY',
          locked: true,
          lockAt: lock.lockAt,
          message:
            targetDate > today
              ? `Completion is available on ${targetDate}.`
              : lockMessage(lock.lockAt),
        });
      }
    }

    // Flexible (untimed) routines unlock only after every timed routine for
    // this date has been marked. Enforced here, not only in the UI, so a
    // direct API call cannot bypass the rule.
    if (completed !== false && isFlexibleRoutine(routine)) {
      const gateMessage = await flexibleGate(req.user.id, targetDate, today);
      if (gateMessage) {
        return res.status(400).json({
          success: false,
          code: 'FLEXIBLE_LOCKED',
          flexible: true,
          message: gateMessage,
        });
      }
    }

    const completion = await RoutineCompletion.findOneAndUpdate(
      {
        user: req.user.id,
        routine: routine._id,
        date: targetDate,
      },
      {
        completed: completed !== undefined ? completed : true,
        // The scheduled times above are never overwritten — the timestamp is
        // recorded separately so historical progress stays accurate.
        completedAt: completed === false ? null : new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({
      success: true,
      routineId: routine._id,
      date: targetDate,
      completed: completion.completed,
      completedAt: completion.completedAt,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Combined Daily View: merges academic timetable classes & personal routines
// @route   GET /api/routines/combined-daily?date=YYYY-MM-DD
export const getCombinedDailyTimeline = async (req, res) => {
  try {
    const targetDate = req.query.date || localDateStr();
    const today = localDateStr();
    const nowMinutes = localMinutesOfDay();

    const ctx = await loadScheduleContext(req.user.id, [targetDate]);
    // One gate decision per request — buildDayItems stamps every flexible
    // routine in the day with the same reason when it is closed.
    const flexibleGateMessage = await flexibleGate(req.user.id, targetDate, today);
    const day = buildDayItems(ctx, targetDate, { today, nowMinutes, flexibleGateMessage });

    const academicCount = day.items.filter((i) => i.source === 'academic').length;
    const routineCount = day.items.filter((i) => i.source === 'routine').length;

    return res.status(200).json({
      success: true,
      date: targetDate,
      dayOfWeek: day.dayOfWeek,
      today,
      now: `${String(Math.floor(nowMinutes / 60)).padStart(2, '0')}:${String(nowMinutes % 60).padStart(2, '0')}`,
      isWithinSemester: day.isWithinSemester,
      isHoliday: day.isHoliday,
      exception: day.exception,
      timeline: day.items,
      academicCount,
      routineCount,
      progress: summariseProgress(day.items),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Daily / weekly / monthly completion analytics for the selected date
// @route   GET /api/routines/analytics?date=YYYY-MM-DD
export const getRoutineAnalytics = async (req, res) => {
  try {
    const anchor = req.query.date || localDateStr();
    const today = localDateStr();
    const nowMinutes = localMinutesOfDay();

    const weekDates = datesInWeek(anchor);
    const monthDates = datesInMonth(anchor);
    const allDates = Array.from(new Set([anchor, ...weekDates, ...monthDates]));

    const ctx = await loadScheduleContext(req.user.id, allDates);
    const dayContext = { today, nowMinutes };
    const anchorGateMessage = await flexibleGate(req.user.id, anchor, today);

    const summaryFor = (date) => {
      const built = buildDayItems(ctx, date, {
        ...dayContext,
        flexibleGateMessage: date === anchor ? anchorGateMessage : null,
      });
      return {
        date,
        dayOfWeek: built.dayOfWeek,
        isToday: date === today,
        isFuture: date > today,
        isHoliday: built.isHoliday,
        exception: built.exception ? { title: built.exception.title, type: built.exception.type } : null,
        progress: summariseProgress(built.items),
      };
    };

    // Every day in the ranges is summarised from the same records, so the
    // charts can never disagree with the sheet above them.
    const weekDays = weekDates.map(summaryFor);
    const monthDays = monthDates.map(summaryFor);

    const aggregate = (days) => {
      const totals = days.reduce(
        (acc, d) => ({
          total: acc.total + d.progress.total,
          completed: acc.completed + d.progress.completed,
          cancelled: acc.cancelled + d.progress.cancelled,
          locked: acc.locked + d.progress.locked,
          eligible: acc.eligible + d.progress.eligible,
          remaining: acc.remaining + d.progress.remaining,
        }),
        { total: 0, completed: 0, cancelled: 0, locked: 0, eligible: 0, remaining: 0 }
      );
      const scored = days.filter((d) => d.progress.percentage !== null);
      return {
        ...totals,
        percentage: totals.eligible > 0 ? Math.round((totals.completed / totals.eligible) * 100) : null,
        // Average over days that actually had completable work — days with no
        // scheduled items are "no data", not 0%.
        averagePercentage: scored.length
          ? Math.round(scored.reduce((a, d) => a + d.progress.percentage, 0) / scored.length)
          : null,
        daysWithData: scored.length,
        daysInRange: days.length,
      };
    };

    const dayBuilt = buildDayItems(ctx, anchor, { ...dayContext, flexibleGateMessage: anchorGateMessage });

    return res.status(200).json({
      success: true,
      date: anchor,
      today,
      now: `${String(Math.floor(nowMinutes / 60)).padStart(2, '0')}:${String(nowMinutes % 60).padStart(2, '0')}`,
      day: {
        date: anchor,
        dayOfWeek: dayBuilt.dayOfWeek,
        isToday: anchor === today,
        isWithinSemester: dayBuilt.isWithinSemester,
        isHoliday: dayBuilt.isHoliday,
        exception: dayBuilt.exception,
        items: dayBuilt.items,
        progress: summariseProgress(dayBuilt.items),
      },
      week: {
        start: startOfWeek(anchor),
        end: addDays(startOfWeek(anchor), 6),
        anchor,
        days: weekDays,
        totals: aggregate(weekDays),
      },
      month: {
        month: monthKeyOf(anchor),
        days: monthDays,
        totals: aggregate(monthDays),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* ------------------------------------------------------------------ */
/* Custom routine categories — scoped to the authenticated student      */
/* ------------------------------------------------------------------ */

// @desc    List the student's own routine categories (real records only)
// @route   GET /api/routines/categories
export const getRoutineCategories = async (req, res) => {
  try {
    const categories = await RoutineCategory.find({ user: req.user.id }).sort({ name: 1 });
    // A category actually in use on a routine is offered even if its record
    // was never created through the dedicated endpoint (legacy free text).
    const inUse = await CustomRoutine.distinct('category', { user: req.user.id });
    const known = new Set(categories.map((c) => c.name.toLowerCase()));
    const merged = [
      ...categories.map((c) => ({ _id: c._id, name: c.name })),
      ...inUse
        .filter((name) => name && !known.has(String(name).toLowerCase()))
        .map((name) => ({ _id: null, name: String(name) })),
    ];
    return res.status(200).json({ success: true, categories: merged });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create a custom category
// @route   POST /api/routines/categories
export const createRoutineCategory = async (req, res) => {
  try {
    const name = (req.body?.name || '').trim().slice(0, 40);
    if (!name) {
      return res.status(400).json({ success: false, message: 'Category name is required.' });
    }
    const existing = await RoutineCategory.findOne({
      user: req.user.id,
      name: new RegExp(`^${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`, 'i'),
    });
    if (existing) {
      return res.status(200).json({ success: true, category: existing, created: false });
    }
    const category = await RoutineCategory.create({ user: req.user.id, name });
    return res.status(201).json({ success: true, category, created: true });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(200).json({ success: true, category: null, created: false });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Rename a custom category on this student's routines too
// @route   PUT /api/routines/categories/:id
export const updateRoutineCategory = async (req, res) => {
  try {
    const name = (req.body?.name || '').trim().slice(0, 40);
    if (!name) {
      return res.status(400).json({ success: false, message: 'Category name is required.' });
    }
    const category = await RoutineCategory.findOne({ _id: req.params.id, user: req.user.id });
    if (!category) return res.status(404).json({ success: false, message: 'Category not found.' });

    const oldName = category.name;
    category.name = name;
    await category.save();

    // Keep routines consistent — only this student's documents are touched.
    if (oldName !== name) {
      await CustomRoutine.updateMany({ user: req.user.id, category: oldName }, { $set: { category: name } });
    }
    return res.status(200).json({ success: true, category });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: 'You already have a category with that name.' });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete a custom category — routines that use it keep working
// @route   DELETE /api/routines/categories/:id
export const deleteRoutineCategory = async (req, res) => {
  try {
    const category = await RoutineCategory.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    if (!category) return res.status(404).json({ success: false, message: 'Category not found.' });
    // Safe delete: the string on existing routines is left intact so history
    // still reads correctly; the category simply leaves the picker.
    return res.status(200).json({ success: true, message: 'Category removed.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
