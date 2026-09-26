/**
 * Route handlers for the LeetCode integration API (Phase 28).
 * Every handler scopes by `req.user.id` — the frontend never supplies a
 * userId (Phase 29).
 */

import {
  connectLeetCode,
  startLeetCodeSync,
  getLeetCodeState,
  buildLeetCodeAnalytics,
  resolveFilterWindow,
  resolveSyncWindow,
} from '../services/leetcodeSyncService.js';
import { LeetCodeSolvedProblem } from '../models/LeetCode.js';

const handleError = (res, err, fallback) => {
  console.error('[LeetCode API]', err?.message || err);
  return res.status(500).json({ success: false, message: fallback });
};

/** GET /api/integrations/leetcode — connection + sync state for the UI. */
export const getConnection = async (req, res) => {
  try {
    const state = await getLeetCodeState(req.user.id);
    return res.json({ success: true, ...state });
  } catch (err) {
    return handleError(res, err, 'Failed to load LeetCode connection');
  }
};

/**
 * POST /api/integrations/leetcode/connect { username }
 * Verifies the public profile, stores/updates the integration, and starts the
 * initial synchronization. No password, no cookies — the public handle only.
 */
export const connect = async (req, res) => {
  try {
    const result = await connectLeetCode(req.user.id, req.body?.username);
    if (result.httpStatus >= 400) {
      return res.status(result.httpStatus).json({ success: false, message: result.message });
    }
    return res.json({
      success: true,
      ...result.integration,
      sync: result.sync,
      awaitingMonth: Boolean(result.awaitingMonth),
    });
  } catch (err) {
    return handleError(res, err, 'Could not connect the LeetCode account');
  }
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/integrations/leetcode/sync { range, startDate, endDate, tzOffsetMinutes }
 * — filter-first Sync Now. The selected filter IS the sync scope: today /
 * week / month / custom start→end. Nothing outside the requested window is
 * stored. Concurrency is handled inside the engine: a duplicate request
 * returns the running job's id instead of starting a second one.
 */
export const syncNow = async (req, res) => {
  try {
    const body = req.body || {};
    const filter = {
      range: String(body.range || '').trim(),
      startDate: DATE_RE.test(String(body.startDate || '')) ? String(body.startDate) : null,
      endDate: DATE_RE.test(String(body.endDate || '')) ? String(body.endDate) : null,
      month: /^\d{4}-\d{2}$/.test(String(body.month || '')) ? String(body.month) : null,
      tzOffsetMinutes: body.tzOffsetMinutes,
    };
    const runWindow = resolveFilterWindow(filter);
    if (!runWindow) {
      return res.status(400).json({
        success: false,
        message: 'Choose a valid period first — today, this week, this month, or a custom date range.',
      });
    }
    const run = await startLeetCodeSync({ userId: req.user.id, trigger: 'manual', window: runWindow });
    if (run.status === 'not_connected') {
      return res
        .status(404)
        .json({ success: false, message: 'No LeetCode account is connected yet.' });
    }
    if (run.status === 'rate_limited') {
      return res.json({
        success: true,
        status: 'rate_limited',
        syncId: run.syncId || null,
        retryAt: run.retryAt,
        message: 'LeetCode is rate limiting requests — automatic synchronization will retry later.',
      });
    }
    return res.json({ success: true, status: run.status, syncId: run.syncId || null });
  } catch (err) {
    return handleError(res, err, 'Could not start synchronization');
  }
};

/** GET /api/integrations/leetcode/sync/status — polled while a run is active. */
export const getSyncStatus = async (req, res) => {
  try {
    const state = await getLeetCodeState(req.user.id);
    return res.json({ success: true, ...state });
  } catch (err) {
    return handleError(res, err, 'Failed to load synchronization status');
  }
};

/** GET /api/leetcode/problems — this student's unique solved problems.
 *  Optional filters: ?month=YYYY-MM and/or ?week=YYYY-MM-DD; both applied at
 *  the database level on `solvedAt`. Kept for the test suite/API surface —
 *  the Problems dashboard no longer renders a synced-problem list. */
export const listProblems = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    const filter = { user: req.user.id };

    if (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) {
      const [y, m] = req.query.month.split('-').map(Number);
      filter.solvedAt = {
        $gte: new Date(Date.UTC(y, m - 1, 1)),
        $lt: new Date(Date.UTC(y, m, 1)), // first day of next month
      };
    }
    if (req.query.week && /^\d{4}-\d{2}-\d{2}$/.test(req.query.week)) {
      const [y, m, d] = req.query.week.split('-').map(Number);
      const start = new Date(Date.UTC(y, m - 1, d));
      start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); // snap to Monday
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 7);
      filter.solvedAt = { ...(filter.solvedAt || {}), $gte: start, $lt: end };
    }

    const [problems, total] = await Promise.all([
      LeetCodeSolvedProblem.find(filter).sort({ solvedAt: -1 }).skip(skip).limit(limit).lean(),
      LeetCodeSolvedProblem.countDocuments(filter),
    ]);
    return res.json({ success: true, problems, total, count: problems.length });
  } catch (err) {
    return handleError(res, err, 'Failed to load solved problems');
  }
};

/**
 * GET /api/leetcode/dashboard?range=today|week|month|custom&startDate&endDate&difficulty&tzOffsetMinutes
 *
 * The filter-driven Problems dashboard endpoint. The selected range is
 * resolved server-side (in the student's timezone) and applied AT THE QUERY
 * LEVEL over both data sources:
 *   - LeetCodeSolvedProblem (synchronized accepted submissions, `solvedAt`)
 *   - CodingProblem (manual practice logs with exact time, `date` string)
 * Only aggregate analytics are returned — never a problem dump.
 * Today's goal is ALWAYS computed from today's actual data, independent of
 * the selected range (Phase 13 of the filter spec).
 */
export const getDashboard = async (req, res) => {
  try {
    const { LeetCodeSolvedProblem, LeetCodeIntegration } = await import('../models/LeetCode.js');
    const { CodingProblem, PracticeGoal } = await import('../models/TechnicalGrowth.js');

    const filter = {
      range: String(req.query.range || '').trim(),
      startDate: DATE_RE.test(String(req.query.startDate || '')) ? String(req.query.startDate) : null,
      endDate: DATE_RE.test(String(req.query.endDate || '')) ? String(req.query.endDate) : null,
      tzOffsetMinutes: req.query.tzOffsetMinutes,
    };
    const runWindow = resolveFilterWindow(filter);
    if (!runWindow) {
      return res.status(400).json({
        success: false,
        message: 'Choose a valid period — today, this week, this month, or a custom range.',
      });
    }

    const difficulty = ['easy', 'medium', 'hard'].includes(String(req.query.difficulty || ''))
      ? String(req.query.difficulty)
      : null;

    const start = new Date(runWindow.startMs);
    const end = new Date(runWindow.endMs);
    const lcQuery = {
      user: req.user.id,
      solvedAt: { $gte: start, $lt: end },
      ...(difficulty ? { difficulty } : {}),
    };
    // CodingProblem.date is a YYYY-MM-DD string; build the exact local day set
    // from the resolved window and filter on it (server-side).
    const dayKeys = [];
    for (let ms = runWindow.startMs; ms < runWindow.endMs && dayKeys.length < 400; ms += 86400000) {
      dayKeys.push(new Date(ms).toISOString().slice(0, 10));
    }
    const manualQuery = {
      user: req.user.id,
      date: { $gte: dayKeys[0], $lte: dayKeys[dayKeys.length - 1] },
      ...(difficulty ? { difficulty } : {}),
    };

    const [lcRows, manualRows] = await Promise.all([
      LeetCodeSolvedProblem.find(lcQuery).select({ difficulty: 1, solvedAt: 1, language: 1 }).lean(),
      CodingProblem.find(manualQuery).select({ difficulty: 1, date: 1, timeSpentMinutes: 1 }).lean(),
    ]);

    // Manual rows may include days outside the window when the range is not
    // day-aligned — narrow to the exact day set (still server-side).
    const daySet = new Set(dayKeys);
    const manualInWindow = manualRows.filter((r) => daySet.has(r.date));

    // ---- daily activity buckets over the window ----
    const daily = dayKeys.map((date) => ({ date, label: date.slice(8), problems: 0, minutes: 0 }));
    const dailyIndex = new Map(daily.map((d) => [d.date, d]));
    const difficultyCounts = { easy: 0, medium: 0, hard: 0 };
    const languageCounts = {};
    let practiceMinutes = 0;

    for (const row of lcRows) {
      const key = new Date(row.solvedAt).toISOString().slice(0, 10);
      const bucket = dailyIndex.get(key);
      if (bucket) bucket.problems += 1;
      if (row.difficulty in difficultyCounts) difficultyCounts[row.difficulty] += 1;
      if (row.language) languageCounts[row.language] = (languageCounts[row.language] || 0) + 1;
    }
    for (const row of manualInWindow) {
      const bucket = dailyIndex.get(row.date);
      if (bucket) {
        bucket.problems += 1;
        bucket.minutes += row.timeSpentMinutes || 0;
      }
      if (row.difficulty in difficultyCounts) difficultyCounts[row.difficulty] += 1;
      practiceMinutes += row.timeSpentMinutes || 0;
    }

    // ---- today's goal: ALWAYS today's actual data, regardless of filter ----
    const tzMinutes = Number(req.query.tzOffsetMinutes);
    const tz = Number.isFinite(tzMinutes) ? tzMinutes : 0;
    const nowLocalDay = new Date(Date.now() - tz * 60000).toISOString().slice(0, 10);
    // Today's local-midnight window expressed in UTC instants.
    const todayStartMs = Date.parse(`${nowLocalDay}T00:00:00.000Z`) + tz * 60000;
    const [todayLc, todayManual, profile] = await Promise.all([
      LeetCodeSolvedProblem.countDocuments({
        user: req.user.id,
        solvedAt: { $gte: new Date(todayStartMs), $lt: new Date(todayStartMs + 86400000) },
      }),
      CodingProblem.find({ user: req.user.id, date: nowLocalDay }).select({ timeSpentMinutes: 1 }).lean(),
      PracticeGoal.findOne({ user: req.user.id }).select({ dailyProblems: 1, dailyMinutes: 1 }).lean(),
    ]);
    const todayProblems = todayLc + todayManual.length;
    const todayMinutes = todayManual.reduce((acc, r) => acc + (r.timeSpentMinutes || 0), 0);
    const goal = profile || { dailyProblems: 0, dailyMinutes: 0 };

    // Streak from ALL stored solves (a streak is a cross-range property).
    const allRows = await LeetCodeSolvedProblem.find({ user: req.user.id })
      .select({ solvedAt: 1 })
      .lean();
    const streakKeys = [...new Set(allRows.map((r) => new Date(r.solvedAt).toISOString().slice(0, 10)))].sort();
    const { streaksFromDayKeys } = await import('../services/leetcodeSyncService.js');
    // streaksFromDayKeys is not exported; compute inline (same algorithm).
    let current = 0;
    {
      const set = new Set(streakKeys);
      const today = nowLocalDay;
      const yesterday = new Date(Date.parse(`${today}T00:00:00.000Z`) - 86400000).toISOString().slice(0, 10);
      let cursor = set.has(today) ? today : set.has(yesterday) ? yesterday : null;
      while (cursor && set.has(cursor)) {
        current += 1;
        cursor = new Date(Date.parse(`${cursor}T00:00:00.000Z`) - 86400000).toISOString().slice(0, 10);
      }
    }

    return res.json({
      success: true,
      filter: { range: filter.range || 'custom', label: runWindow.label, difficulty: difficulty || 'all' },
      window: { startDate: dayKeys[0], endDate: dayKeys[dayKeys.length - 1] },
      summary: {
        problemsSolved: lcRows.length + manualInWindow.length,
        practiceHours: Math.round((practiceMinutes / 60) * 10) / 10,
        currentStreak: current,
        problemsThisWeek: await LeetCodeSolvedProblem.countDocuments({
          user: req.user.id,
          solvedAt: { $gte: new Date(Date.now() - 7 * 86400000) },
        }) + (await CodingProblem.countDocuments({ user: req.user.id, date: { $gte: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10) } })),
      },
      difficulty: difficultyCounts,
      languages: Object.entries(languageCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      dailyActivity: daily,
      todayGoal: {
        date: nowLocalDay,
        problemsDone: todayProblems,
        minutesDone: todayMinutes,
        goalProblems: goal.dailyProblems || 0,
        goalMinutes: goal.dailyMinutes || 0,
      },
      connected: Boolean(await (await import('../models/LeetCode.js')).LeetCodeIntegration.findOne({ user: req.user.id }).select({ _id: 1 }).lean()),
    });
  } catch (err) {
    return handleError(res, err, 'Failed to load the filtered dashboard');
  }
};

/** GET /api/leetcode/analytics?month=YYYY-MM — derived from stored records + upstream stats.
 *  `month` scopes the topic/language/activity breakdown to that month (UTC);
 *  totals and streaks always reflect the full stored history. */
export const getAnalytics = async (req, res) => {
  try {
    const analytics = await buildLeetCodeAnalytics(req.user.id, {
      month: /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : null,
    });
    return res.json({ success: true, ...analytics });
  } catch (err) {
    return handleError(res, err, 'Failed to load analytics');
  }
};
