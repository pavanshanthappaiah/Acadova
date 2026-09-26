import Activity from '../models/Activity.js';

// Helper: convert "HH:MM" to minutes from midnight
const timeToMinutes = (timeStr) => {
  if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
};

// Helper: format Date to "HH:MM"
const formatHHMM = (date) => {
  const d = date || new Date();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

// Helper: format Date to "YYYY-MM-DD"
const formatYYYYMMDD = (date) => {
  const d = date || new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// @desc    Get all activities for a user on a given date (default today)
// @route   GET /api/activities
export const getActivities = async (req, res) => {
  try {
    const date = req.query.date || formatYYYYMMDD();
    const activities = await Activity.find({
      user: req.user.id,
      date,
    }).sort({ planned_start: 1 });

    return res.status(200).json({
      success: true,
      count: activities.length,
      date,
      activities,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Error fetching activities',
    });
  }
};

// @desc    Create a new activity
// @route   POST /api/activities
export const createActivity = async (req, res) => {
  try {
    const {
      title,
      category,
      date,
      planned_start,
      planned_end,
      planned_duration,
      academicImportance,
      subjectRef,
      notes,
    } = req.body;

    if (!title || !planned_start || !planned_end) {
      return res.status(400).json({
        success: false,
        message: 'Title, planned_start, and planned_end are required',
      });
    }

    const calculatedDuration =
      planned_duration ||
      Math.max(1, timeToMinutes(planned_end) - timeToMinutes(planned_start));

    const activity = await Activity.create({
      user: req.user.id,
      title,
      category: category || 'academic',
      date: date || formatYYYYMMDD(),
      planned_start,
      planned_end,
      planned_duration: calculatedDuration,
      academicImportance: academicImportance || 'medium',
      subjectRef: subjectRef || null,
      notes: notes || '',
    });

    return res.status(201).json({
      success: true,
      message: 'Activity scheduled successfully',
      activity,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Error creating activity',
    });
  }
};

// @desc    Update an activity
// @route   PUT /api/activities/:id
export const updateActivity = async (req, res) => {
  try {
    const activity = await Activity.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!activity) {
      return res.status(404).json({ success: false, message: 'Activity not found' });
    }

    const updates = req.body;
    if (updates.planned_start && updates.planned_end && !updates.planned_duration) {
      updates.planned_duration = Math.max(
        1,
        timeToMinutes(updates.planned_end) - timeToMinutes(updates.planned_start)
      );
    }

    Object.assign(activity, updates);
    const updated = await activity.save();

    return res.status(200).json({
      success: true,
      message: 'Activity updated successfully',
      activity: updated,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Error updating activity',
    });
  }
};

// @desc    Quick status update and timer logger (start / complete / pause)
// @route   PATCH /api/activities/:id/status
export const updateActivityStatus = async (req, res) => {
  try {
    const { status, actual_start, actual_end, actual_duration } = req.body;

    const activity = await Activity.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!activity) {
      return res.status(404).json({ success: false, message: 'Activity not found' });
    }

    const nowHHMM = formatHHMM();

    if (status === 'in_progress') {
      activity.status = 'in_progress';
      if (!activity.actual_start) {
        activity.actual_start = actual_start || nowHHMM;
      }
    } else if (status === 'completed') {
      activity.status = 'completed';
      activity.actual_end = actual_end || nowHHMM;
      if (!activity.actual_start) {
        activity.actual_start = activity.planned_start;
      }

      if (actual_duration !== undefined) {
        activity.actual_duration = Number(actual_duration);
      } else {
        const startMins = timeToMinutes(activity.actual_start);
        const endMins = timeToMinutes(activity.actual_end);
        let duration = endMins - startMins;
        if (duration <= 0) duration = activity.planned_duration;
        activity.actual_duration = duration;
      }
    } else if (status) {
      activity.status = status;
      if (actual_duration !== undefined) {
        activity.actual_duration = Number(actual_duration);
      }
    }

    const saved = await activity.save();

    return res.status(200).json({
      success: true,
      message: `Activity status updated to ${activity.status}`,
      activity: saved,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Error updating activity status',
    });
  }
};

// @desc    Delete activity
// @route   DELETE /api/activities/:id
export const deleteActivity = async (req, res) => {
  try {
    const activity = await Activity.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!activity) {
      return res.status(404).json({ success: false, message: 'Activity not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Activity deleted successfully',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Error deleting activity',
    });
  }
};

// @desc    Get planned vs actual daily metrics & intelligence
// @route   GET /api/activities/summary
export const getDailySummary = async (req, res) => {
  try {
    const date = req.query.date || formatYYYYMMDD();
    const activities = await Activity.find({
      user: req.user.id,
      date,
    }).sort({ planned_start: 1 });

    const totalPlannedMinutes = activities.reduce((acc, a) => acc + (a.planned_duration || 0), 0);
    const completedActivities = activities.filter((a) => a.status === 'completed');
    const totalCompletedMinutes = completedActivities.reduce(
      (acc, a) => acc + (a.actual_duration || a.planned_duration || 0),
      0
    );

    const pendingActivities = activities.filter(
      (a) => a.status === 'scheduled' || a.status === 'in_progress'
    );
    const totalRemainingMinutes = pendingActivities.reduce(
      (acc, a) => acc + (a.planned_duration || 0),
      0
    );

    // Category breakdown
    const categoryStats = {
      academic: { planned: 0, actual: 0, count: 0 },
      coding: { planned: 0, actual: 0, count: 0 },
      project: { planned: 0, actual: 0, count: 0 },
      health: { planned: 0, actual: 0, count: 0 },
      personal: { planned: 0, actual: 0, count: 0 },
    };

    let totalOverrun = 0;
    let totalUnderrun = 0;
    const timeLeaks = [];

    activities.forEach((act) => {
      const cat = act.category || 'personal';
      if (categoryStats[cat]) {
        categoryStats[cat].planned += act.planned_duration || 0;
        categoryStats[cat].count += 1;
        if (act.status === 'completed') {
          categoryStats[cat].actual += act.actual_duration || 0;
        }
      }

      if (act.status === 'completed' && act.actual_duration) {
        const diff = act.actual_duration - act.planned_duration;
        if (diff > 15) {
          totalOverrun += diff;
          timeLeaks.push({
            title: act.title,
            category: act.category,
            planned: act.planned_duration,
            actual: act.actual_duration,
            leakMinutes: diff,
            type: 'overrun',
          });
        } else if (diff < -20) {
          totalUnderrun += Math.abs(diff);
          timeLeaks.push({
            title: act.title,
            category: act.category,
            planned: act.planned_duration,
            actual: act.actual_duration,
            leakMinutes: Math.abs(diff),
            type: 'undercompletion',
          });
        }
      }
    });

    // Schedule Accuracy: ratio of completed planned time matching
    let scheduleAccuracy = 100;
    if (completedActivities.length > 0) {
      const accuracySum = completedActivities.reduce((acc, a) => {
        const planned = a.planned_duration || 1;
        const actual = a.actual_duration || planned;
        const variance = Math.abs(actual - planned) / planned;
        return acc + Math.max(0, 1 - variance);
      }, 0);
      scheduleAccuracy = Math.round((accuracySum / completedActivities.length) * 100);
    } else if (activities.length > 0) {
      scheduleAccuracy = 0;
    }

    // Time Efficiency: (Total Actual / Total Planned for completed items) * 100
    const plannedForCompleted = completedActivities.reduce((acc, a) => acc + (a.planned_duration || 0), 0);
    const timeEfficiency =
      plannedForCompleted > 0
        ? Math.round((totalCompletedMinutes / plannedForCompleted) * 100)
        : 0;

    const completionRate =
      activities.length > 0
        ? Math.round((completedActivities.length / activities.length) * 100)
        : 0;

    // Identify current "NOW" activity and "UP NEXT"
    const currentMins = timeToMinutes(formatHHMM());
    const nowActivity =
      activities.find((a) => a.status === 'in_progress') ||
      activities.find(
        (a) =>
          a.status === 'scheduled' &&
          timeToMinutes(a.planned_start) <= currentMins &&
          timeToMinutes(a.planned_end) >= currentMins
      ) ||
      null;

    const upNextActivity =
      activities.find(
        (a) =>
          a.status === 'scheduled' &&
          timeToMinutes(a.planned_start) > currentMins
      ) || null;

    return res.status(200).json({
      success: true,
      date,
      total_planned_minutes: totalPlannedMinutes,
      total_completed_minutes: totalCompletedMinutes,
      total_remaining_minutes: totalRemainingMinutes,
      completion_rate: completionRate,
      schedule_accuracy: scheduleAccuracy,
      time_efficiency: timeEfficiency,
      total_overrun_minutes: totalOverrun,
      total_underrun_minutes: totalUnderrun,
      category_breakdown: categoryStats,
      time_leaks: timeLeaks,
      now_activity: nowActivity,
      up_next_activity: upNextActivity,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Error generating daily summary',
    });
  }
};
