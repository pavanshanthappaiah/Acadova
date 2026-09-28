import { CodingProblem, Skill, Project, PracticeGoal } from '../models/TechnicalGrowth.js';
import { syncUserReminders } from '../services/notificationEngine.js';
import { analyzeRepo, parseGithubUrl } from '../services/repoAnalyzer.js';
import { dateStrInTz } from '../utils/time.js';

// @desc    List a project's dated hours entries (newest first)
// @route   GET /api/technical/projects/:id/hours
export const getProjectHourLogs = async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, user: req.user.id })
      .select('title totalHoursSpent inheritedHours hourLogs')
      .lean();
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    const logs = (project.hourLogs || [])
      .slice()
      .sort(
        (a, b) =>
          String(b.date).localeCompare(String(a.date)) || new Date(b.loggedAt) - new Date(a.loggedAt)
      )
      .map((l) => ({ id: l._id, hours: l.hours, date: l.date, note: l.note || '', loggedAt: l.loggedAt }));

    return res.status(200).json({
      success: true,
      projectId: project._id,
      title: project.title,
      totalHoursSpent: project.totalHoursSpent || 0,
      inheritedHours: project.inheritedHours || 0,
      logs,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const ALL_TOPICS = [
  'Arrays',
  'Strings',
  'Two Pointers',
  'Sliding Window',
  'Linked Lists',
  'Trees',
  'Graphs',
  'DP',
  'Greedy',
  'Backtracking',
  'Binary Search',
  'Stack & Queue',
];

// Helper to compute consecutive coding streak
const computeStreak = (dates) => {
  if (!dates || dates.length === 0) return 0;
  const uniqueDates = Array.from(new Set(dates)).sort().reverse();

  const todayStr = new Date().toISOString().split('T')[0];
  const yesterdayObj = new Date();
  yesterdayObj.setDate(yesterdayObj.getDate() - 1);
  const yesterdayStr = yesterdayObj.toISOString().split('T')[0];

  // Must have practiced either today or yesterday to have an active streak
  if (uniqueDates[0] !== todayStr && uniqueDates[0] !== yesterdayStr) {
    return 0;
  }

  let streak = 1;
  for (let i = 0; i < uniqueDates.length - 1; i++) {
    const current = new Date(uniqueDates[i]);
    const prev = new Date(uniqueDates[i + 1]);
    const diffDays = Math.round((current - prev) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) {
      streak += 1;
    } else {
      break;
    }
  }

  return streak;
};

// @desc    Get complete Technical Growth overview (DSA, Skill Graph, Projects)
// @route   GET /api/technical/overview
export const getTechnicalOverview = async (req, res) => {
  try {
    const problems = await CodingProblem.find({ user: req.user.id }).sort({ date: -1, createdAt: -1 });
    const skills = await Skill.find({ user: req.user.id }).sort({ category: 1, name: 1 });
    const projects = await Project.find({ user: req.user.id }).sort({ createdAt: -1 });

    // 1. Difficulty distribution
    const difficultyCounts = {
      easy: problems.filter((p) => p.difficulty === 'easy').length,
      medium: problems.filter((p) => p.difficulty === 'medium').length,
      hard: problems.filter((p) => p.difficulty === 'hard').length,
    };

    // 2. 12-Topic Matrix
    const topicMatrix = ALL_TOPICS.map((topic) => {
      const topicProblems = problems.filter((p) => p.topic === topic);
      return {
        topic,
        count: topicProblems.length,
        easy: topicProblems.filter((p) => p.difficulty === 'easy').length,
        medium: topicProblems.filter((p) => p.difficulty === 'medium').length,
        hard: topicProblems.filter((p) => p.difficulty === 'hard').length,
      };
    });

    // 3. Weekly breakdown (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

    const weeklyProblems = problems.filter((p) => p.date >= sevenDaysAgoStr);
    const weeklyCounts = {
      easy: weeklyProblems.filter((p) => p.difficulty === 'easy').length,
      medium: weeklyProblems.filter((p) => p.difficulty === 'medium').length,
      hard: weeklyProblems.filter((p) => p.difficulty === 'hard').length,
      total: weeklyProblems.length,
    };

    // 4. Streak
    const streak = computeStreak(problems.map((p) => p.date));

    // 4b. Daily activity for the last 30 days (manual logs carry the true time spent)
    const dailyActivity = [];
    const dailyMap = new Map();
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const entry = { date: key, problems: 0, minutes: 0 };
      dailyActivity.push(entry);
      dailyMap.set(key, entry);
    }
    for (const p of problems) {
      const bucket = dailyMap.get(p.date);
      if (bucket) {
        bucket.problems += 1;
        bucket.minutes += p.timeSpentMinutes || 0;
      }
    }

    // 5. Skills by category
    const categorizedSkills = {
      'Computer Science': skills.filter((s) => s.category === 'Computer Science'),
      Programming: skills.filter((s) => s.category === 'Programming'),
      Development: skills.filter((s) => s.category === 'Development'),
      'AI/ML': skills.filter((s) => s.category === 'AI/ML'),
    };

    return res.status(200).json({
      success: true,
      totalProblemsSolved: problems.length,
      difficultyCounts,
      weeklyCounts,
      streak,
      dailyActivity,
      topicMatrix,
      recentProblems: problems.slice(0, 10),
      skills: categorizedSkills,
      allSkills: skills,
      projects,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Error fetching technical growth overview',
    });
  }
};

// @desc    Log a solved coding problem
// @route   POST /api/technical/problems
export const logCodingProblem = async (req, res) => {
  try {
    const { title, difficulty, topic, platform, language, timeSpentMinutes, date, notes } = req.body;

    if (!title || !difficulty || !topic) {
      return res.status(400).json({
        success: false,
        message: 'Title, difficulty, and topic are required',
      });
    }

    const problem = await CodingProblem.create({
      user: req.user.id,
      title,
      difficulty,
      topic,
      platform: platform || 'LeetCode',
      language: language || 'C++',
      timeSpentMinutes: Number(timeSpentMinutes) || 30,
      date: date || new Date().toISOString().split('T')[0],
      notes: notes || '',
    });

    // Automatically update Skill "DSA" problem count & hours
    await Skill.updateOne(
      { user: req.user.id, name: 'DSA' },
      {
        $inc: {
          problemsSolved: 1,
          practiceHours: Math.round(((Number(timeSpentMinutes) || 30) / 60) * 10) / 10,
        },
        $set: { lastPracticed: problem.date },
      }
    );

    return res.status(201).json({
      success: true,
      message: 'Problem logged successfully',
      problem,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Error logging coding problem',
    });
  }
};

// @desc    Delete coding problem
// @route   DELETE /api/technical/problems/:id
export const deleteCodingProblem = async (req, res) => {
  try {
    const problem = await CodingProblem.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id,
    });
    if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });
    return res.status(200).json({ success: true, message: 'Problem deleted' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Skills APIs
export const createOrUpdateSkill = async (req, res) => {
  try {
    const { category, name, currentLevel, targetLevel, practiceHours } = req.body;
    let skill = await Skill.findOne({ user: req.user.id, name });

    if (skill) {
      if (currentLevel !== undefined) skill.currentLevel = currentLevel;
      if (targetLevel !== undefined) skill.targetLevel = targetLevel;
      if (practiceHours !== undefined) skill.practiceHours = practiceHours;
      await skill.save();
    } else {
      skill = await Skill.create({
        user: req.user.id,
        category,
        name,
        currentLevel: currentLevel || 2,
        targetLevel: targetLevel || 5,
        practiceHours: practiceHours || 0,
      });
    }

    return res.status(200).json({ success: true, skill });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update one of the authenticated student's skills
// @route   PUT /api/technical/skills/:id
export const updateSkill = async (req, res) => {
  try {
    const skill = await Skill.findOne({ _id: req.params.id, user: req.user.id });
    if (!skill) return res.status(404).json({ success: false, message: 'Skill not found' });

    const { category, name, currentLevel, targetLevel, practiceHours } = req.body;
    if (name !== undefined) skill.name = String(name).trim();
    if (category !== undefined) skill.category = category;
    if (currentLevel !== undefined) skill.currentLevel = Number(currentLevel);
    if (targetLevel !== undefined) skill.targetLevel = Number(targetLevel);
    if (practiceHours !== undefined) skill.practiceHours = Number(practiceHours);

    await skill.save();
    return res.status(200).json({ success: true, skill });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete one of the authenticated student's skills
// @route   DELETE /api/technical/skills/:id
export const deleteSkill = async (req, res) => {
  try {
    const skill = await Skill.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    if (!skill) return res.status(404).json({ success: false, message: 'Skill not found' });
    return res.status(200).json({ success: true, message: 'Skill removed' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Analyze a public GitHub repository and return inferred tech stack + objectives
// @route   POST /api/technical/projects/analyze-repo
export const analyzeRepoController = async (req, res) => {
  const { githubUrl } = req.body;
  if (!githubUrl) {
    return res.status(400).json({ success: false, message: 'githubUrl is required' });
  }
  if (!parseGithubUrl(githubUrl)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid GitHub URL. Expected format: https://github.com/owner/repo',
    });
  }
  try {
    const result = await analyzeRepo(githubUrl);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    // GitHub returns 404 for non-existent or private repos
    if (err.response?.status === 404) {
      return res.status(404).json({
        success: false,
        message: 'Repository not found or is private. Only public repositories can be analyzed without a token.',
      });
    }
    if (err.response?.status === 403) {
      return res.status(429).json({
        success: false,
        message: 'GitHub API rate limit reached. Please wait a minute and try again.',
      });
    }
    return res.status(500).json({ success: false, message: err.message || 'Could not analyze repository.' });
  }
};

// Projects APIs
export const createProject = async (req, res) => {
  try {
    const { title, goal, technologies, githubUrl, liveDemoUrl, deadline, milestones } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, message: 'Project title is required' });
    }

    // Progress points are the student's own plan — never pre-filled. A new
    // project starts with an empty list and the detail panel shows an
    // "Add progress point" empty state until they add their own.
    const ownMilestones = Array.isArray(milestones)
      ? milestones
          .filter((m) => m && typeof m.name === 'string' && m.name.trim())
          .map((m) => ({ name: m.name.trim(), completed: Boolean(m.completed), weight: Number(m.weight) || 20 }))
      : [];

    const project = await Project.create({
      user: req.user.id,
      title,
      goal: goal || '',
      technologies: technologies || { frontend: [], backend: [], database: [], tools: [] },
      githubUrl: githubUrl || '',
      liveDemoUrl: liveDemoUrl || '',
      deadline: deadline || '',

      milestones: ownMilestones,
      progress: 0,
      totalHoursSpent: 0,
    });

    syncUserReminders(req.user.id).catch(() => {}); // project deadline set → schedule reminders
    return res.status(201).json({ success: true, project });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleProjectMilestone = async (req, res) => {
  try {
    const { milestoneIndex } = req.body;
    const project = await Project.findOne({ _id: req.params.id, user: req.user.id });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    if (project.milestones[milestoneIndex]) {
      project.milestones[milestoneIndex].completed = !project.milestones[milestoneIndex].completed;

      // Recompute progress
      const totalWeight = project.milestones.reduce((acc, m) => acc + (m.weight || 25), 0);
      const completedWeight = project.milestones
        .filter((m) => m.completed)
        .reduce((acc, m) => acc + (m.weight || 25), 0);

      project.progress = totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0;
      if (project.progress === 100) project.status = 'completed';
      else project.status = 'in_progress';

      await project.save();
    }

    return res.status(200).json({ success: true, project });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const addProjectMilestone = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Milestone name is required' });

    const project = await Project.findOne({ _id: req.params.id, user: req.user.id });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    project.milestones.push({ name, completed: false, weight: 20 });

    // Recompute progress
    const totalWeight = project.milestones.reduce((acc, m) => acc + (m.weight || 25), 0);
    const completedWeight = project.milestones
      .filter((m) => m.completed)
      .reduce((acc, m) => acc + (m.weight || 25), 0);

    project.progress = totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0;
    if (project.progress === 100) project.status = 'completed';
    else project.status = 'in_progress';

    await project.save();
    return res.status(200).json({ success: true, project });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteProjectMilestone = async (req, res) => {
  try {
    const index = Number(req.params.index);
    const project = await Project.findOne({ _id: req.params.id, user: req.user.id });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    if (!Number.isInteger(index) || index < 0 || index >= project.milestones.length) {
      return res.status(400).json({ success: false, message: 'Invalid progress point' });
    }

    project.milestones.splice(index, 1);

    // Same recompute as toggle and add: weight share of completed points.
    const totalWeight = project.milestones.reduce((acc, m) => acc + (m.weight || 25), 0);
    const completedWeight = project.milestones
      .filter((m) => m.completed)
      .reduce((acc, m) => acc + (m.weight || 25), 0);
    project.progress = totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0;
    if (project.milestones.length === 0) project.progress = 0;
    if (project.progress === 100) project.status = 'completed';
    else if (project.status === 'completed') project.status = 'in_progress';

    await project.save();
    return res.status(200).json({ success: true, project });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const logProjectHours = async (req, res) => {
  try {
    const { hours, note } = req.body;
    // Validate before touching stored totals: garbage input must never mutate
    // real records (the old fallback silently logged 1 hour for any junk, and
    // negative or non-numeric values passed straight through).
    const value = Number(hours);
    if (!Number.isFinite(value) || value <= 0 || value > 1000) {
      return res.status(400).json({ success: false, message: 'Hours must be a number greater than zero.' });
    }
    const project = await Project.findOne({ _id: req.params.id, user: req.user.id });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    // Legacy projects logged hours before dated entries existed: freeze their
    // running total as the inherited base so it survives future recalcs.
    if (project.hourLogs.length === 0 && !project.inheritedHours && project.totalHoursSpent > 0) {
      project.inheritedHours = project.totalHoursSpent;
    }

    // Dated on the student's wall clock (the browser sends its offset with
    // every request); on a UTC server `toLocaleDateString` would put the
    // entry on the previous day for any log made before 5:30 AM IST.
    const todayStr = dateStrInTz(new Date(), req.body.tzOffsetMinutes);
    project.hourLogs.push({ hours: value, date: todayStr, note: String(note || '').trim().slice(0, 200) });
    recalcProjectHours(project);
    await project.save();

    return res.status(200).json({ success: true, project });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Rebuild totalHoursSpent from the dated log entries — the one source of
 * truth for a project's hours. Legacy totals (logged before entries
 * existed) are preserved as an `inheritedHours` base so old data keeps
 * reading correctly after an edit.
 */
const recalcProjectHours = (project) => {
  const logged = project.hourLogs.reduce((acc, l) => acc + (Number(l.hours) || 0), 0);
  const base = Number.isFinite(project.inheritedHours) ? project.inheritedHours : 0;
  project.totalHoursSpent = Math.round((base + logged) * 100) / 100;
};

// @desc    Edit one logged-hours entry on a project
// @route   PUT /api/technical/projects/:id/hours/:logId
export const updateProjectHourLog = async (req, res) => {
  try {
    const { hours, date, note } = req.body;
    const value = Number(hours);
    if (!Number.isFinite(value) || value <= 0 || value > 24) {
      return res.status(400).json({ success: false, message: 'Hours must be a number greater than zero (max 24 per entry).' });
    }
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ success: false, message: 'Date must be in YYYY-MM-DD format.' });
    }

    const project = await Project.findOne({ _id: req.params.id, user: req.user.id });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    const entry = project.hourLogs.id(req.params.logId);
    if (!entry) return res.status(404).json({ success: false, message: 'Hours entry not found' });

    entry.hours = value;
    if (date !== undefined) entry.date = date;
    if (note !== undefined) entry.note = String(note).trim().slice(0, 200);

    recalcProjectHours(project);
    await project.save();

    return res.status(200).json({ success: true, project });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete one logged-hours entry on a project
// @route   DELETE /api/technical/projects/:id/hours/:logId
export const deleteProjectHourLog = async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, user: req.user.id });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    const entry = project.hourLogs.id(req.params.logId);
    if (!entry) return res.status(404).json({ success: false, message: 'Hours entry not found' });

    entry.deleteOne();
    recalcProjectHours(project);
    await project.save();

    return res.status(200).json({ success: true, project });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteProject = async (req, res) => {
  try {
    const project = await Project.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    return res.status(200).json({ success: true, message: 'Project deleted' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get today's practice progress against the user's daily targets
// @route   GET /api/technical/goal
export const getPracticeGoal = async (req, res) => {
  try {
    const goal = await PracticeGoal.findOne({ user: req.user.id }).lean();
    const todayStr = new Date().toISOString().split('T')[0];

    const todays = await CodingProblem.find({ user: req.user.id, date: todayStr })
      .select({ timeSpentMinutes: 1, title: 1 })
      .lean();
    const problemsDone = todays.length;
    const minutesDone = todays.reduce((acc, p) => acc + (p.timeSpentMinutes || 0), 0);

    return res.status(200).json({
      success: true,
      goal: {
        dailyProblems: goal?.dailyProblems || 0,
        dailyMinutes: goal?.dailyMinutes || 0,
      },
      today: {
        problemsDone,
        minutesDone,
        problemsTitle: todays.map((p) => p.title),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Save the user's daily practice targets
// @route   PUT /api/technical/goal
export const updatePracticeGoal = async (req, res) => {
  try {
    const { dailyProblems, dailyMinutes } = req.body;
    const problems = Math.max(0, Math.min(100, Number(dailyProblems) || 0));
    const minutes = Math.max(0, Math.min(1440, Number(dailyMinutes) || 0));

    const goal = await PracticeGoal.findOneAndUpdate(
      { user: req.user.id },
      { $set: { dailyProblems: problems, dailyMinutes: minutes } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return res.status(200).json({
      success: true,
      goal: { dailyProblems: goal.dailyProblems, dailyMinutes: goal.dailyMinutes },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
