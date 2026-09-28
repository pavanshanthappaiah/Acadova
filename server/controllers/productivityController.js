import { DailyReview, WeeklyReview } from '../models/Productivity.js';
import { Activity } from '../models/Activity.js';
import { Assignment, Exam, Subject, ClassSession } from '../models/Academic.js';
import { CodingProblem, Project } from '../models/TechnicalGrowth.js';
import { LeetCodeSolvedProblem } from '../models/LeetCode.js';
import { computeSubjectAttendance } from './academicController.js';
import { tzOrNull } from '../utils/time.js';

// Helper to format a date as YYYY-MM-DD in the student's LOCAL calendar.
// Every request carries the browser's getTimezoneOffset() (see the axios
// interceptor in client/src/services/api.js); with no offset (tests, curl)
// we fall back to server-local. toISOString() alone would hand back the UTC
// day, which is the wrong day for part of the world (in India, from midnight
// to 05:30 local it would read yesterday).
const formatDate = (date, tzOffsetMinutes = null) => {
  const d = date || new Date();
  const tz = tzOrNull(tzOffsetMinutes);
  if (tz != null) {
    return new Date(d.getTime() - tz * 60000).toISOString().slice(0, 10);
  }
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// The student's timezone offset, sent by the browser with every request.
const reqTz = (req) => req.query?.tzOffsetMinutes ?? req.body?.tzOffsetMinutes ?? null;

/**
 * Consecutive-day run ending today (or yesterday, when today is not logged
 * yet — a streak stays alive until the day actually ends, the same way
 * GitHub and LeetCode display it).
 */
const currentStreakOf = (daySet, todayStr) => {
  const DAY_MS = 86400000;
  const toTime = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const fromTime = (t) => new Date(t).toISOString().slice(0, 10);
  let cursor = daySet.has(todayStr) ? toTime(todayStr) : toTime(todayStr) - DAY_MS;
  let streak = 0;
  while (daySet.has(fromTime(cursor))) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
};

/**
 * A UTC-instant window covering the student's LOCAL calendar day
 * `YYYY-MM-DD`, for querying stored UTC timestamps (e.g. solvedAt).
 */
const dayWindow = (localDayStr) => {
  const [y, m, d] = localDayStr.split('-').map(Number);
  return { $gte: new Date(y, m - 1, d), $lt: new Date(y, m - 1, d + 1) };
};

// @desc    Get 7-Day Deadline Radar
// @route   GET /api/productivity/radar
export const getDeadlineRadar = async (req, res) => {
  try {
    const tz = reqTz(req);
    const today = new Date();
    const todayStr = formatDate(today, tz);

    const sevenDaysLater = new Date();
    sevenDaysLater.setDate(today.getDate() + 7);
    const sevenDaysStr = formatDate(sevenDaysLater, tz);

    // Fetch assignments, exams, and projects
    const [assignments, exams, projects] = await Promise.all([
      Assignment.find({
        user: req.user.id,
        status: { $ne: 'submitted' },
        deadline: { $gte: todayStr, $lte: sevenDaysStr },
      }).populate('subject', 'name code color'),
      Exam.find({
        user: req.user.id,
        date: { $gte: todayStr, $lte: sevenDaysStr },
      }).populate('subject', 'name code color'),
      Project.find({
        user: req.user.id,
        status: { $ne: 'completed' },
        deadline: { $gte: todayStr, $lte: sevenDaysStr },
      }),
    ]);

    const items = [];

    assignments.forEach((a) => {
      items.push({
        id: a._id,
        title: a.title,
        type: 'Assignment',
        category: 'Academic',
        date: a.deadline,
        subtitle: `${a.subject?.code || 'Coursework'} • ${a.maxMarks} marks`,
        priority: a.priority,
      });
    });

    exams.forEach((e) => {
      items.push({
        id: e._id,
        title: e.title,
        type: 'Exam',
        category: 'Academic',
        date: e.date,
        subtitle: `${e.subject?.name || 'Subject'} • ${e.type.replace('_', ' ')}`,
        priority: 'high',
      });
    });

    projects.forEach((p) => {
      items.push({
        id: p._id,
        title: p.title,
        type: 'Project Sprint',
        category: 'Project',
        date: p.deadline,
        subtitle: `Progress: ${p.progress}%`,
        priority: 'medium',
      });
    });

    // Sort by date ascending
    items.sort((a, b) => (a.date > b.date ? 1 : -1));

    // Group into Urgency buckets: Today/Tomorrow (<24h), 2-3 Days, 4-7 Days
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowStr = formatDate(tomorrow, tz);

    const threeDays = new Date();
    threeDays.setDate(today.getDate() + 3);
    const threeDaysStr = formatDate(threeDays, tz);

    const urgencyBuckets = {
      imminent: items.filter((i) => i.date <= tomorrowStr), // Today & Tomorrow
      approaching: items.filter((i) => i.date > tomorrowStr && i.date <= threeDaysStr),
      upcoming: items.filter((i) => i.date > threeDaysStr),
    };

    return res.status(200).json({
      success: true,
      totalDeadlines: items.length,
      deadlines: items,
      urgencyBuckets,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get Time Leak Diagnostics
// @route   GET /api/productivity/time-leaks
export const getTimeLeaks = async (req, res) => {
  try {
    const tz = reqTz(req);
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const startDateStr = formatDate(fourteenDaysAgo, tz);

    const activities = await Activity.find({
      user: req.user.id,
      date: { $gte: startDateStr },
      status: 'completed',
    });

    const categoryLeaks = {
      academic: { overruns: 0, undercompletion: 0, count: 0 },
      coding: { overruns: 0, undercompletion: 0, count: 0 },
      project: { overruns: 0, undercompletion: 0, count: 0 },
      health: { overruns: 0, undercompletion: 0, count: 0 },
      personal: { overruns: 0, undercompletion: 0, count: 0 },
    };

    const leaksList = [];

    activities.forEach((act) => {
      const planned = act.planned_duration || 0;
      const actual = act.actual_duration || 0;
      const diff = actual - planned;
      const cat = act.category || 'personal';

      if (diff > 15) {
        // Overrun (ballooned break or task taking longer)
        categoryLeaks[cat].overruns += diff;
        categoryLeaks[cat].count += 1;
        leaksList.push({
          title: act.title,
          category: act.category,
          date: act.date,
          planned,
          actual,
          leakMinutes: diff,
          type: 'overrun',
          reason: 'Activity exceeded planned window',
        });
      } else if (diff < -20) {
        // Undercompletion (deep work abandoned or cut short)
        categoryLeaks[cat].undercompletion += Math.abs(diff);
        categoryLeaks[cat].count += 1;
        leaksList.push({
          title: act.title,
          category: act.category,
          date: act.date,
          planned,
          actual,
          leakMinutes: Math.abs(diff),
          type: 'undercompletion',
          reason: 'Planned session ended prematurely',
        });
      }
    });

    const totalLostMinutes = Object.values(categoryLeaks).reduce(
      (acc, c) => acc + c.overruns + c.undercompletion,
      0
    );

    return res.status(200).json({
      success: true,
      totalLostMinutes,
      categoryLeaks,
      recentLeaks: leaksList.slice(0, 8),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get Meaningful Consistency Streaks
// @route   GET /api/productivity/consistency
export const getConsistencyStreaks = async (req, res) => {
  try {
    const tz = reqTz(req);
    const todayStr = formatDate(new Date(), tz);

    // --- DSA coding streak ---
    // Two sources feed one streak: LeetCode syncs (solvedAt is a UTC Date)
    // and manual practice logs (date is a YYYY-MM-DD string). Both are
    // reduced to local calendar days, then walked back consecutively.
    const [lcRows, manualRows] = await Promise.all([
      LeetCodeSolvedProblem.find({ user: req.user.id }).select('solvedAt').lean(),
      CodingProblem.find({ user: req.user.id }).select('date').lean(),
    ]);
    const codingDays = new Set();
    lcRows.forEach((r) => r.solvedAt && codingDays.add(formatDate(new Date(r.solvedAt), tz)));
    manualRows.forEach((r) => r.date && codingDays.add(r.date));
    const codingStreak = currentStreakOf(codingDays, todayStr);

    // --- Study streak ---
    // A day counts when a class was attended (ClassSession — where attendance
    // actually lives) OR a completed academic activity was logged.
    const [sessions, academicActs] = await Promise.all([
      ClassSession.find({ user: req.user.id, status: { $in: ['attended', 'present'] } })
        .select('date')
        .lean(),
      Activity.find({ user: req.user.id, category: 'academic', status: 'completed' })
        .select('date')
        .lean(),
    ]);
    const studyDays = new Set();
    sessions.forEach((s) => s.date && studyDays.add(s.date));
    academicActs.forEach((a) => a.date && studyDays.add(a.date));
    const studyStreak = currentStreakOf(studyDays, todayStr);

    // --- Project streak ---
    // Days with completed project-category activity blocks. Hours logged on
    // a project's page add to its total but carry no date, so they cannot
    // contribute to a per-day streak.
    const projectActs = await Activity.find({
      user: req.user.id,
      category: 'project',
      status: 'completed',
    })
      .select('date')
      .lean();
    const projectDays = new Set(projectActs.map((a) => a.date).filter(Boolean));
    const projectStreak = currentStreakOf(projectDays, todayStr);

    return res.status(200).json({
      success: true,
      streaks: [
        {
          name: 'DSA Coding Streak',
          category: 'Coding',
          streak: codingStreak,
          criterion: 'At least 1 problem solved each day (LeetCode sync or manual log)',
          activeToday: codingDays.has(todayStr),
        },
        {
          name: 'Academic Deep Work',
          category: 'Academic',
          streak: studyStreak,
          criterion: 'A class attended or a study block completed each day',
          activeToday: studyDays.has(todayStr),
        },
        {
          name: 'Engineering Project Sprint',
          category: 'Projects',
          streak: projectStreak,
          criterion: 'A project activity block completed each day',
          activeToday: projectDays.has(todayStr),
        },
      ],
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get Attention / Priority Engine (Transparent Heuristics)
// @route   GET /api/productivity/attention
export const getAttentionRequired = async (req, res) => {
  try {
    const tz = reqTz(req);
    const todayStr = formatDate(new Date(), tz);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = formatDate(tomorrow, tz);

    const attentionItems = [];

    // 1. Assignments due tomorrow
    const urgentAssignments = await Assignment.find({
      user: req.user.id,
      status: { $ne: 'submitted' },
      deadline: { $lte: tomorrowStr },
    }).populate('subject', 'name code');

    urgentAssignments.forEach((a) => {
      attentionItems.push({
        id: a._id,
        title: `${a.subject?.code || 'Coursework'}: ${a.title}`,
        reason: a.deadline === todayStr ? 'Due Today' : 'Due Tomorrow',
        urgency: 'critical',
        type: 'Academic Assignment',
        estimatedEffort: '1.5 – 2 hours',
      });
    });

    // 2. Attendance deficit subjects
    const subjects = await Subject.find({ user: req.user.id });
    subjects.forEach((s) => {
      const metric = computeSubjectAttendance(s);
      if (!metric.isSafe) {
        attentionItems.push({
          id: s._id,
          title: `${s.code} Attendance Below ${s.targetAttendance}%`,
          reason: `Currently ${metric.percentage}% (${s.attendedClasses}/${s.totalClasses} classes)`,
          urgency: 'high',
          type: 'Attendance Alert',
          estimatedEffort: `Must attend next ${metric.classesNeeded} classes`,
        });
      }
    });

    // 3. Coding streak at risk if not done today. The same two sources the
    // streak itself reads — a synced LeetCode solve counts exactly like a
    // manual log, so an active streak is never reported as at risk.
    const [solvedToday, syncedToday] = await Promise.all([
      CodingProblem.findOne({ user: req.user.id, date: todayStr }).select('_id').lean(),
      LeetCodeSolvedProblem.findOne({ user: req.user.id, solvedAt: dayWindow(todayStr) })
        .select('_id')
        .lean(),
    ]);
    if (!solvedToday && !syncedToday) {
      attentionItems.push({
        id: 'coding-streak',
        title: 'Daily DSA Problem Practice',
        reason: 'Consistency streak at risk for today',
        urgency: 'medium',
        type: 'Coding Consistency',
        estimatedEffort: '45 mins',
      });
    }

    return res.status(200).json({
      success: true,
      count: attentionItems.length,
      attentionItems,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Submit End-of-Day Checkout
// @route   POST /api/productivity/checkout
export const submitDailyCheckout = async (req, res) => {
  try {
    const { date, completedItems, missedItems, energyLevel, tomorrowPriority, reflectionNotes } =
      req.body;

    const todayStr = date || formatDate(new Date(), reqTz(req));

    const review = await DailyReview.findOneAndUpdate(
      { user: req.user.id, date: todayStr },
      {
        user: req.user.id,
        date: todayStr,
        completedItems: completedItems || [],
        missedItems: missedItems || [],
        energyLevel: energyLevel || 'medium',
        tomorrowPriority: tomorrowPriority || '',
        reflectionNotes: reflectionNotes || '',
      },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      success: true,
      message: 'End-of-day checkout logged successfully',
      review,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get Automated Weekly Review
// @route   GET /api/productivity/weekly-review
export const getWeeklyReview = async (req, res) => {
  try {
    const tz = reqTz(req);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const startDateStr = formatDate(sevenDaysAgo, tz);
    const todayStr = formatDate(new Date(), tz);

    const activities = await Activity.find({
      user: req.user.id,
      date: { $gte: startDateStr, $lte: todayStr },
      status: 'completed',
    });

    const studyMinutes = activities
      .filter((a) => a.category === 'academic')
      .reduce((acc, a) => acc + (a.actual_duration || a.planned_duration || 0), 0);

    const codingMinutes = activities
      .filter((a) => a.category === 'coding')
      .reduce((acc, a) => acc + (a.actual_duration || a.planned_duration || 0), 0);

    const projectMinutes = activities
      .filter((a) => a.category === 'project')
      .reduce((acc, a) => acc + (a.actual_duration || a.planned_duration || 0), 0);

    const healthMinutes = activities
      .filter((a) => a.category === 'health')
      .reduce((acc, a) => acc + (a.actual_duration || a.planned_duration || 0), 0);

    const completedCount = activities.length;

    const hours = (minutes) => Math.round((minutes / 60) * 10) / 10;
    const accumulated = (activity) => activity.actual_duration || activity.planned_duration || 0;

    // Busiest day: the real date with the most logged minutes, or nothing at all.
    const minutesByDate = new Map();
    for (const activity of activities) {
      minutesByDate.set(activity.date, (minutesByDate.get(activity.date) || 0) + accumulated(activity));
    }
    let bestDay = null;
    let bestDayMinutes = 0;
    for (const [date, minutes] of minutesByDate) {
      if (minutes > bestDayMinutes) {
        bestDayMinutes = minutes;
        bestDay = date;
      }
    }
    // Another day reaching the same total means "busiest" is not a single day.
    const bestDayTied = [...minutesByDate.values()].filter((m) => m === bestDayMinutes).length > 1;

    // Peak focus window: derived from when completed work actually started, not
    // asserted. Only reported when there is completed time to measure.
    const startMinutes = [];
    for (const activity of activities) {
      const start = String(activity.actual_start || activity.planned_start || '');
      const match = /^(\d{1,2}):(\d{2})/.exec(start);
      if (!match) continue;
      const hour = Number(match[1]);
      if (!Number.isFinite(hour) || hour < 0 || hour > 23) continue;
      startMinutes.push({ hour, minutes: accumulated(activity) });
    }
    let peakWindow = null;
    if (startMinutes.length > 0) {
      // The single start hour that accounts for the most logged minutes, so the
      // window names the hour work actually began in rather than an arbitrary
      // band that merely happens to overlap it.
      const minutesByHour = new Map();
      for (const entry of startMinutes) {
        minutesByHour.set(entry.hour, (minutesByHour.get(entry.hour) || 0) + entry.minutes);
      }
      let peakHour = null;
      let peakTotal = 0;
      for (const [hour, total] of [...minutesByHour].sort((a, b) => a[0] - b[0])) {
        if (total > peakTotal) {
          peakTotal = total;
          peakHour = hour;
        }
      }
      if (peakHour !== null && peakTotal > 0) {
        const label = (h) => {
          const normalised = ((h % 24) + 24) % 24;
          const suffix = normalised < 12 ? 'AM' : 'PM';
          const twelve = normalised % 12 === 0 ? 12 : normalised % 12;
          return `${twelve}:00 ${suffix}`;
        };
        peakWindow = `${label(peakHour)} to ${label(peakHour + 1)}`;
      }
    }

    // Observations are built only from real, non-zero figures. A category with
    // no logged time produces no sentence, so an empty week reads as empty
    // instead of being described as progress.
    const hoursLabel = (minutes) => `${hours(minutes)} ${hours(minutes) === 1 ? 'hour' : 'hours'}`;
    const observations = [];
    if (studyMinutes > 0) observations.push(`${hoursLabel(studyMinutes)} of academic work and lab preparation.`);
    if (codingMinutes > 0) observations.push(`${hoursLabel(codingMinutes)} of DSA and LeetCode practice.`);
    if (projectMinutes > 0) observations.push(`${hoursLabel(projectMinutes)} of hands-on project development.`);
    if (healthMinutes > 0) observations.push(`${hoursLabel(healthMinutes)} on health and recovery.`);
    if (completedCount > 0) observations.push(`${completedCount} completed ${completedCount === 1 ? 'block' : 'blocks'} logged this week.`);
    if (peakWindow) observations.push(`Focus started most often in the ${peakWindow} band.`);

    return res.status(200).json({
      success: true,
      weekRange: `${startDateStr} to ${todayStr}`,
      studyHours: hours(studyMinutes),
      codingHours: hours(codingMinutes),
      projectHours: hours(projectMinutes),
      healthHours: hours(healthMinutes),
      completedTasks: completedCount,
      bestDay,
      bestDayTied,
      peakWindow,
      totalHours: hours(studyMinutes + codingMinutes + projectMinutes + healthMinutes),
      hasActivity: completedCount > 0,
      observations,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
