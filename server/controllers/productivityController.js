import { DailyReview, WeeklyReview } from '../models/Productivity.js';
import { Activity } from '../models/Activity.js';
import { Assignment, Exam, Subject } from '../models/Academic.js';
import { CodingProblem, Project } from '../models/TechnicalGrowth.js';
import { computeSubjectAttendance } from './academicController.js';

// Helper to format date YYYY-MM-DD
const formatDate = (date) => date.toISOString().split('T')[0];

// @desc    Get 7-Day Deadline Radar
// @route   GET /api/productivity/radar
export const getDeadlineRadar = async (req, res) => {
  try {
    const today = new Date();
    const todayStr = formatDate(today);

    const sevenDaysLater = new Date();
    sevenDaysLater.setDate(today.getDate() + 7);
    const sevenDaysStr = formatDate(sevenDaysLater);

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
    const tomorrowStr = formatDate(tomorrow);

    const threeDays = new Date();
    threeDays.setDate(today.getDate() + 3);
    const threeDaysStr = formatDate(threeDays);

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
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const startDateStr = formatDate(fourteenDaysAgo);

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
    const todayStr = formatDate(new Date());

    // Coding Streak
    const problems = await CodingProblem.find({ user: req.user.id }).select('date');
    const problemDates = Array.from(new Set(problems.map((p) => p.date))).sort().reverse();
    const codingStreak = problemDates.includes(todayStr) || problemDates.length > 0 ? problemDates.length : 0;

    // Study Streak (days with completed academic activities >= 60 mins)
    const academicActs = await Activity.find({
      user: req.user.id,
      category: 'academic',
      status: 'completed',
    });
    const studyDates = Array.from(new Set(academicActs.map((a) => a.date)));

    // Project Streak
    const projectActs = await Activity.find({
      user: req.user.id,
      category: 'project',
      status: 'completed',
    });
    const projectDates = Array.from(new Set(projectActs.map((a) => a.date)));

    return res.status(200).json({
      success: true,
      streaks: [
        {
          name: 'DSA Coding Streak',
          category: 'Coding',
          streak: codingStreak,
          criterion: 'At least 1 LeetCode/DSA problem solved',
          activeToday: problemDates.includes(todayStr),
        },
        {
          name: 'Academic Deep Work',
          category: 'Academic',
          streak: studyDates.length,
          criterion: '≥60 mins of classes or revision completed',
          activeToday: studyDates.includes(todayStr),
        },
        {
          name: 'Engineering Project Sprint',
          category: 'Projects',
          streak: projectDates.length,
          criterion: 'Committed code or logged project milestone',
          activeToday: projectDates.includes(todayStr),
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
    const todayStr = formatDate(new Date());
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = formatDate(tomorrow);

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

    // 3. Coding streak at risk if not done today
    const solvedToday = await CodingProblem.findOne({ user: req.user.id, date: todayStr });
    if (!solvedToday) {
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

    const todayStr = date || formatDate(new Date());

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
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const startDateStr = formatDate(sevenDaysAgo);
    const todayStr = formatDate(new Date());

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
