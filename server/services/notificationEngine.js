import {
  NotificationPreference,
  ScheduledReminder,
  AppNotification,
  REMINDER_LEAD_OPTIONS,
  NOTIFICATION_CATEGORIES,
} from '../models/Notification.js';
import {
  Semester,
  TimetableSlot,
  Assignment,
  Exam,
  Assessment,
  SemesterException,
} from '../models/Academic.js';
import { Project } from '../models/TechnicalGrowth.js';
import { CustomRoutine } from '../models/Routine.js';
import { localDateStr, addDays, dayNameOf } from '../utils/time.js';

/* ------------------------------------------------------------------ */
/* Delivery gateways                                                   */
/*                                                                     */
/* Web-push/email adapters are pluggable: each module exports send().  */
/* A missing adapter degrades gracefully (in-app only).                */
/* ------------------------------------------------------------------ */

const webPushGateway = {
  async send(preference, reminder) {
    if (!preference.channels?.webPush) return 'skipped';
    const mod = await import('./pushService.js').catch(() => null);
    if (!mod || typeof mod.sendWebPush !== 'function') {
      console.warn('[Notifications] pushService unavailable — web push skipped');
      return 'skipped';
    }
    const ok = await mod.sendWebPush(preference.user, {
      title: reminder.title,
      body: reminder.body,
      link: reminder.link,
    });
    return ok ? 'sent' : 'skipped';
  },
};

const emailGateway = {
  async send(preference, reminder) {
    if (!preference.channels?.email) return 'skipped';
    const mod = await import('./emailService.js').catch(() => null);
    if (!mod || typeof mod.sendEmail !== 'function') {
      console.warn('[Notifications] emailService unavailable — email skipped');
      return 'skipped';
    }
    await mod.sendEmail(preference.user, {
      subject: reminder.title,
      text: reminder.body,
    });
    return 'sent';
  },
};

const inAppGateway = {
  async send(preference, reminder) {
    // Idempotent by the partial unique index on sourceReminderId — an engine
    // retry can never duplicate a history entry.
    await AppNotification.findOneAndUpdate(
      { sourceReminderId: reminder._id },
      {
        $setOnInsert: {
          user: preference.user,
          category: reminder.category,
          title: reminder.title,
          body: reminder.body,
          link: reminder.link || '/',
          sourceReminderId: reminder._id,
          read: false,
        },
      },
      { upsert: true }
    );
    return 'sent';
  },
};

const GATEWAYS = { webPush: webPushGateway, email: emailGateway, inApp: inAppGateway };

/* ------------------------------------------------------------------ */
/* Preference resolution                                               */
/* ------------------------------------------------------------------ */

/** Conservative defaults, created on first read — nothing enabled except in-app. */
export const getOrCreatePreferences = async (userId) => {
  const existing = await NotificationPreference.findOne({ user: userId });
  if (existing) {
    // Backfill categories introduced after this document was written (e.g.
    // the LeetCode category) so Settings rows and channel gating always see
    // every category. The pre-validate hook appends only what's missing.
    const known = new Set(existing.categories.map((c) => c.category));
    if (NOTIFICATION_CATEGORIES.some((category) => !known.has(category))) {
      await existing.save();
    }
    return existing;
  }
  return NotificationPreference.create({ user: userId });
};

const channelsFor = (preference, category) => {
  const cat = preference.categories?.find((c) => c.category === category);
  const g = preference.channels || {};
  return {
    webPush: !!g.webPush && (cat ? !!cat.channels?.webPush : false),
    email: !!g.email && (cat ? !!cat.channels?.email : false),
    inApp: !!g.inApp && (cat ? !!cat.channels?.inApp : false),
  };
};

const leadMinutesFor = (preference, category) => {
  const cat = preference.categories?.find((c) => c.category === category);
  return (cat?.leadMinutes || []).filter((m) => REMINDER_LEAD_OPTIONS.some((o) => o.minutes === m));
};

/** A reminder fires only when the master, the category and at least one channel allow it. */
const remindersOn = (preference, category) =>
  !!preference.enabled &&
  !!preference.categories?.find((c) => c.category === category)?.enabled &&
  leadMinutesFor(preference, category).length > 0 &&
  Object.values(channelsFor(preference, category)).some(Boolean);

/* ------------------------------------------------------------------ */
/* Reminder sources — real user data only                              */
/* ------------------------------------------------------------------ */

const daysInFuture = (dateStr) => {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  const target = new Date(y, m - 1, d, 23, 59, 59, 999);
  return Math.ceil((target - new Date()) / 86_400_000);
};

const toHhmm = (value) => {
  const m = String(value).match(/(\d{1,2}):(\d{2})/);
  if (!m) return '00:00';
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
};

const slotEvents = async (userId, horizonDays, entryType) => {
  const semester = await Semester.findOne({ user: userId, isActive: true }).lean();
  if (!semester) return [];
  const slots = await TimetableSlot.find({
    user: userId,
    semester: { $in: [semester._id, null] },
    entryType,
    isConsecutiveContinuation: false,
  })
    .populate('subject', 'name')
    .lean();
  if (!slots.length) return [];

  const events = [];
  for (let off = 0; off < horizonDays; off += 1) {
    const dateStr = addDays(localDateStr(), off);
    const dayName = dayNameOf(dateStr);
    const daySlots = slots.filter((s) => s.day === dayName);
    for (const slot of daySlots) {
      if (!slot.subject) continue;
      const exception = await SemesterException.findOne({ user: userId, date: dateStr }).lean();
      if (exception && ['holiday', 'no_class', 'cancelled'].includes(exception.type)) continue;
      events.push({
        category: entryType === 'lab' ? 'lab' : 'class',
        entityId: slot._id,
        sub: dateStr,
        eventAt: new Date(`${dateStr}T${toHhmm(slot.start_time)}:00`),
        title: `${entryType === 'lab' ? 'Lab' : 'Class'}: ${slot.subject.name}`,
        body: `${slot.subject.name} (${slot.subject.code || 'your subject'}) at ${slot.start_time}.`,
        link: '/academics',
      });
    }
  }
  return events;
};

const SOURCES = {
  project: async (userId) => {
    const rows = await Project.find({ user: userId }).lean();
    return rows
      .filter((p) => p.deadline && daysInFuture(p.deadline) >= 0)
      .map((p) => ({
        category: 'project',
        entityId: p._id,
        sub: 'deadline',
        eventAt: new Date(`${p.deadline}T23:59:00`),
        title: `Project deadline: ${p.name || p.title}`,
        body: `"${p.name || p.title}" is due on ${p.deadline}.`,
        link: '/projects',
      }));
  },

  assignment: async (userId) => {
    // The student-facing ABL records live on each subject's Assessment document:
    // `submissionDate` is the due date and drives every reminder. Marks are never
    // read here, so an ABL reminds whether or not it has been graded.
    const assessments = await Assessment.find({ user: userId })
      .populate('subject', 'name')
      .lean();
    const events = [];
    for (const a of assessments) {
      for (const abl of a.abls || []) {
        if (!abl.submissionDate || abl.status === 'submitted') continue;
        if (daysInFuture(abl.submissionDate) < 0) continue;
        events.push({
          category: 'assignment',
          entityId: a._id,
          sub: `abl:${abl.number}`,
          eventAt: new Date(`${abl.submissionDate}T23:59:00`),
          title: `ABL ${abl.number} due: ${a.subject?.name || 'Assignment'}`.trim(),
          body: `ABL ${abl.number} for ${
            a.subject?.name || 'your subject'
          } is due on ${abl.submissionDate}.`,
          link: '/academics',
        });
      }
    }

    // Legacy Assignment records (deadline field) keep reminding too.
    const rows = await Assignment.find({ user: userId, status: { $nin: ['submitted', 'graded'] } })
      .populate('subject', 'name')
      .lean();
    return events.concat(
      rows
        .filter((a) => a.deadline && daysInFuture(a.deadline) >= 0)
        .map((a) => ({
          category: 'assignment',
          entityId: a._id,
          sub: '',
          eventAt: new Date(`${a.deadline}T23:59:00`),
          title: `${a.subject?.name || 'Assignment'} due: ${a.title}`,
          body: `"${a.title}" is due on ${a.deadline}.`,
          link: '/academics',
        }))
    );
  },

  quiz: async (userId) => {
    const rows = await Assessment.find({ user: userId })
      .populate('subject', 'name')
      .lean();
    const events = [];
    for (const a of rows) {
      for (const q of a.quizzes || []) {
        if (!q.quizDate || q.attendance === 'not_attended' || daysInFuture(q.quizDate) < 0) continue;
        events.push({
          category: 'quiz',
          entityId: a._id,
          sub: `quiz:${q.number}`,
          eventAt: new Date(`${q.quizDate}T09:00:00`),
          title: `Quiz ${q.number}: ${a.subject?.name || ''}`.trim(),
          body: `Quiz ${q.number} for ${a.subject?.name || 'your subject'} is scheduled for ${q.quizDate}.`,
          link: '/academics',
        });
      }
    }
    return events;
  },

  internal: async (userId) => {
    // Real internal assessment dates come from the Assessment records the
    // student maintains (Internal 1 & 2 per subject). The legacy Exam model is
    // still honoured so older records keep reminding.
    const rows = await Assessment.find({ user: userId })
      .populate('subject', 'name')
      .lean();
    const events = [];
    for (const a of rows) {
      const dates = a.internals?.internalDates || {};
      for (const key of ['internal_1', 'internal_2']) {
        const dateStr = dates[key];
        if (!dateStr || daysInFuture(dateStr) < 0) continue;
        events.push({
          category: 'internal',
          entityId: a._id,
          sub: key,
          eventAt: new Date(`${dateStr}T09:00:00`),
          title: `Internal ${key === 'internal_1' ? 1 : 2}: ${a.subject?.name || ''}`.trim(),
          body: `Internal ${key === 'internal_1' ? 1 : 2} for ${
            a.subject?.name || 'your subject'
          } is scheduled for ${dateStr}.`,
          link: '/academics',
        });
      }
    }
    const legacy = await Exam.find({ user: userId, type: { $in: ['internal_1', 'internal_2'] } })
      .populate('subject', 'name')
      .lean();
    return events.concat(
      legacy
        .filter((e) => e.date && daysInFuture(e.date) >= 0)
        .map((e) => ({
          category: 'internal',
          entityId: e._id,
          sub: '',
          eventAt: new Date(`${e.date}T09:00:00`),
          title: `${e.title || 'Internal exam'}`,
          body: `Internal exam for ${e.subject?.name || 'your subject'} on ${e.date}.`,
          link: '/academics',
        }))
    );
  },

  labInternal: async (userId) => {
    // The lab internal date lives on the subject's Assessment record (the same
    // single source of truth as internals/ABLs/quizzes). Marks are never
    // consulted — a scheduled lab internal reminds whether or not it is graded.
    const assessments = await Assessment.find({ user: userId })
      .populate('subject', 'name')
      .lean();
    const events = assessments
      .filter((a) => a.labInternal?.date && daysInFuture(a.labInternal.date) >= 0)
      .map((a) => ({
        category: 'labInternal',
        entityId: a._id,
        sub: 'labInternal',
        eventAt: new Date(`${a.labInternal.date}T09:00:00`),
        title: `Lab internal: ${a.subject?.name || ''}`.trim(),
        body: `Lab internal for ${
          a.subject?.name || 'your subject'
        } is scheduled for ${a.labInternal.date}.`,
        link: '/academics',
      }));

    // Legacy lab_exam records keep reminding — they carry their own date.
    const rows = await Exam.find({ user: userId, type: 'lab_exam' })
      .populate('subject', 'name')
      .lean();
    return events.concat(
      rows
        .filter((e) => e.date && daysInFuture(e.date) >= 0)
        .map((e) => ({
          category: 'labInternal',
          entityId: e._id,
          sub: '',
          eventAt: new Date(`${e.date}T09:00:00`),
          title: `${e.title || 'Lab internal'}`,
          body: `Lab internal for ${e.subject?.name || 'your subject'} on ${e.date}.`,
          link: '/academics',
        }))
    );
  },

  routine: async (userId, prefs, horizonDays) => {
    const rows = await CustomRoutine.find({ user: userId }).lean();
    const events = [];
    for (let off = 0; off < horizonDays; off += 1) {
      const dateStr = addDays(localDateStr(), off);
      const dayName = dayNameOf(dateStr);
      for (const r of rows) {
        if (r.isRecurring) {
          if (!(r.recurrenceDays || []).some((d) => d === 'Every Day' || d === dayName)) continue;
        } else if (r.date !== dateStr) {
          continue;
        }
        if (!r.startTime) continue; // untimed routines have no moment to remind about
        events.push({
          category: 'routine',
          entityId: r._id,
          sub: dateStr, // one reminder set per (routine, date)
          eventAt: new Date(`${dateStr}T${toHhmm(r.startTime)}:00`),
          title: `Routine starting: ${r.title}`,
          body: `"${r.title}" starts at ${r.startTime}${r.endTime ? ` (until ${r.endTime})` : ''}.`,
          link: '/routine',
        });
      }
    }
    return events;
  },

  class: async (userId, prefs, horizonDays) => slotEvents(userId, horizonDays, 'theory'),
  lab: async (userId, prefs, horizonDays) => slotEvents(userId, horizonDays, 'lab'),

  attendance: async (userId, prefs, horizonDays) => {
    // Gentle in-app nudge: classes happening tomorrow that will need an
    // attendance record. Purely derived from the real timetable.
    const events = await slotEvents(userId, horizonDays, 'theory');
    const tomorrow = addDays(localDateStr(), 1);
    return events
      .filter((e) => e.sub === tomorrow)
      .map((e) => ({
        category: 'attendance',
        entityId: e.entityId,
        sub: `attendance:${e.sub}`,
        eventAt: new Date(`${tomorrow}T21:00:00`),
        title: 'Upcoming class attendance',
        body: `${e.title.replace(/^Class: /, '')} happens tomorrow — record your attendance after it ends.`,
        link: '/academics',
      }));
  },

  academicDate: async (userId) => {
    const semester = await Semester.findOne({ user: userId, isActive: true }).lean();
    if (!semester) return [];
    const events = [];
    if (semester.startDate && daysInFuture(semester.startDate) >= 0) {
      events.push({
        category: 'academicDate',
        entityId: semester._id,
        sub: 'start',
        eventAt: new Date(`${semester.startDate}T09:00:00`),
        title: `Semester begins: ${semester.name || ''}`.trim(),
        body: `Your semester starts on ${semester.startDate}.`,
        link: '/academics',
      });
    }
    if (semester.endDate && daysInFuture(semester.endDate) >= 0) {
      events.push({
        category: 'academicDate',
        entityId: semester._id,
        sub: 'end',
        eventAt: new Date(`${semester.endDate}T09:00:00`),
        title: `Semester ends: ${semester.name || ''}`.trim(),
        body: `Your semester ends on ${semester.endDate}.`,
        link: '/academics',
      });
    }
    return events;
  },
};

/* ------------------------------------------------------------------ */
/* Sync — rebuild a user's pending reminders from current prefs         */
/* ------------------------------------------------------------------ */

/**
 * Rebuild every pending reminder for one user from their CURRENT preferences
 * and their real entities. Idempotent by userIdentityKey: a pending row whose
 * key still exists is left alone, anything else is cancelled. Delivered rows
 * (history) are never touched.
 */
const runSync = async (userId) => {
  const prefs = await getOrCreatePreferences(userId);
  const horizonDays = 21;

  const desired = [];
  if (prefs.enabled) {
    for (const [category, source] of Object.entries(SOURCES)) {
      if (!remindersOn(prefs, category)) continue;
      let events = [];
      try {
        events = await source(userId, prefs, horizonDays);
      } catch (err) {
        console.warn(`[Notifications] source ${category} failed for user ${userId}:`, err.message);
        continue;
      }
      for (const event of events) {
        for (const lead of leadMinutesFor(prefs, category)) {
          const fireAt = new Date(event.eventAt.getTime() - lead * 60_000);
          if (fireAt <= new Date()) continue; // in the past — not a reminder
          const label = REMINDER_LEAD_OPTIONS.find((o) => o.minutes === lead)?.label || `${lead} min`;
          desired.push({
            userId,
            category,
            entityId: event.entityId,
            sub: event.sub || '',
            leadMinutes: lead,
            leadLabel: label,
            fireAt,
            eventAt: event.eventAt,
            title: event.title,
            body: event.body,
            link: event.link || '/',
            key: `${userId}:${category}:${event.entityId}:${event.sub || ''}:${lead}:${fireAt.toISOString()}`,
          });
        }
      }
    }
  }

  const pending = await ScheduledReminder.find({ user: userId, status: 'scheduled' }).lean();
  const desiredKeys = new Set(desired.map((d) => d.key));

  // Cancel pending rows that are no longer desired (prefs changed, entity
  // edited/deleted, or its fire time moved). History is untouched.
  const staleIds = pending.filter((p) => !desiredKeys.has(p.userIdentityKey)).map((p) => p._id);
  if (staleIds.length) {
    await ScheduledReminder.updateMany(
      { _id: { $in: staleIds } },
      { $set: { status: 'cancelled' } }
    );
  }

  // Upsert the desired set — the unique partial index makes this idempotent.
  for (const d of desired) {
    await ScheduledReminder.updateOne(
      { userIdentityKey: d.key, status: 'scheduled' },
      {
        $setOnInsert: {
          user: d.userId,
          userIdentityKey: d.key,
          category: d.category,
          entityId: d.entityId,
          entitySub: d.sub,
          leadMinutes: d.leadMinutes,
          leadLabel: d.leadLabel,
          fireAt: d.fireAt,
          eventAt: d.eventAt,
          title: d.title,
          body: d.body,
          link: d.link,
          status: 'scheduled',
        },
      },
      { upsert: true }
    );
  }

  return { desired: desired.length, cancelled: staleIds.length };
};

/**
 * Per-user sync queue.
 *
 * Entity hooks fire a sync in the background while a preference save fires
 * another one. Two runs in flight for the same student read preferences at
 * their own start, so the slower run could upsert the reminder set it computed
 * from the OLDER preferences — resurrecting reminders the newer run had just
 * cancelled. Serialising per user makes the last sync the final word, which is
 * exactly what "changing preferences recalculates future reminders" means.
 */
const syncQueues = new Map();

const queueSync = (userId, task) => {
  const key = String(userId);
  const previous = syncQueues.get(key) || Promise.resolve();
  const run = previous.then(task, task); // run after the previous attempt, success or failure
  syncQueues.set(key, run);
  const clear = () => {
    if (syncQueues.get(key) === run) syncQueues.delete(key);
  };
  run.then(clear, clear);
  return run;
};

export const syncUserReminders = (userId) => queueSync(userId, () => runSync(userId));

export const syncAllUsers = async () => {
  const users = await NotificationPreference.distinct('user');
  let desired = 0;
  let cancelled = 0;
  for (const userId of users) {
    const res = await syncUserReminders(userId).catch(() => null);
    if (res) {
      desired += res.desired;
      cancelled += res.cancelled;
    }
  }
  return { users: users.length, desired, cancelled };
};

/* ------------------------------------------------------------------ */
/* Dispatcher — runs every minute from server.js                       */
/* ------------------------------------------------------------------ */

export const dispatchDueReminders = async () => {
  const due = await ScheduledReminder.find({
    status: 'scheduled',
    fireAt: { $lte: new Date() },
  })
    .limit(50)
    .populate('user')
    .lean();

  for (const reminder of due) {
    const prefs = await getOrCreatePreferences(reminder.user._id);
    const channels = channelsFor(prefs, reminder.category);
    const results = {};

    for (const [name, gateway] of Object.entries(GATEWAYS)) {
      if (!channels[name]) {
        results[name] = 'skipped';
        continue;
      }
      try {
        results[name] = await gateway.send(prefs, reminder);
      } catch (err) {
        console.warn(`[Notifications] ${name} delivery failed:`, err.message);
        results[name] = 'failed';
      }
    }

    const anySent = Object.values(results).some((r) => r === 'sent');
    await ScheduledReminder.updateOne(
      { _id: reminder._id },
      {
        $set: {
          status: 'delivered',
          deliveredChannels: Object.entries(results)
            .filter(([, r]) => r === 'sent')
            .map(([n]) => n),
          deliveredAt: anySent ? new Date() : null,
        },
      }
    );
  }
  return due.length;
};

/* ------------------------------------------------------------------ */
/* Immediate in-app events (e.g. attendance marked absent)              */
/* ------------------------------------------------------------------ */

/**
 * Create an in-app notification right now, respecting the master + channel gates.
 * Accepts either `(userId, { category, title, body, link })` or a single
 * `{ userId, category, title, body, link }` object — both call forms exist in
 * the codebase, and mixing them silently produced nothing.
 */
export const pushImmediateNotification = async (userIdOrOptions, maybeOptions) => {
  const isObjectCall = userIdOrOptions && typeof userIdOrOptions === 'object';
  const options = (isObjectCall ? userIdOrOptions : maybeOptions) || {};
  const userId = isObjectCall ? userIdOrOptions.userId : userIdOrOptions;
  const { category, title, body, link, force } = options;
  if (!userId) throw new Error('pushImmediateNotification requires a userId');

  if (!force) {
    const prefs = await getOrCreatePreferences(userId);
    if (!prefs.enabled) return null;
    if (!channelsFor(prefs, category).inApp) return null;
  }
  return AppNotification.create({ user: userId, category, title, body, link: link || '/' });
};

/** Backwards-compatible alias used by earlier integrations. */
export const createImmediateInAppNotification = pushImmediateNotification;
