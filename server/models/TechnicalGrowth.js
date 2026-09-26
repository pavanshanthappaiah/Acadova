import mongoose from 'mongoose';

// DSA Coding Problem Schema
const codingProblemSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Problem title is required'],
      trim: true,
    },
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      required: true,
      index: true,
    },
    topic: {
      type: String,
      enum: [
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
      ],
      required: true,
      index: true,
    },
    platform: {
      type: String,
      enum: ['LeetCode', 'Codeforces', 'GeeksforGeeks', 'HackerRank', 'CodeChef', 'Other'],
      default: 'LeetCode',
    },
    language: {
      type: String,
      default: 'C++',
    },
    timeSpentMinutes: {
      type: Number,
      default: 30,
    },
    date: {
      type: String, // YYYY-MM-DD
      required: true,
      index: true,
    },
    notes: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

// Engineering Skill Graph Node Schema
const skillSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: ['Programming', 'Computer Science', 'Development', 'AI/ML'],
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    currentLevel: {
      type: Number,
      min: 1,
      max: 5,
      default: 2,
    },
    targetLevel: {
      type: Number,
      min: 1,
      max: 5,
      default: 5,
    },
    practiceHours: {
      type: Number,
      default: 0,
    },
    problemsSolved: {
      type: Number,
      default: 0,
    },
    projectsCount: {
      type: Number,
      default: 0,
    },
    lastPracticed: {
      type: String,
      default: () => new Date().toISOString().split('T')[0],
    },
  },
  { timestamps: true }
);

// Engineering Project Schema
const projectSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    goal: {
      type: String,
      default: '',
    },
    technologies: {
      frontend: [{ type: String, trim: true }],
      backend: [{ type: String, trim: true }],
      database: [{ type: String, trim: true }],
      tools: [{ type: String, trim: true }],
    },
    techStack: [
      {
        type: String,
        trim: true,
      },
    ], // Kept for backwards compatibility for older projects during rendering
    githubUrl: {
      type: String,
      default: '',
    },
    liveDemoUrl: {
      type: String,
      default: '',
    },
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    totalHoursSpent: {
      type: Number,
      default: 0,
    },
    deadline: {
      type: String,
      default: '',
    },
    milestones: [
      {
        name: { type: String, required: true },
        completed: { type: Boolean, default: false },
        weight: { type: Number, default: 20 },
      },
    ],
    status: {
      type: String,
      enum: ['in_progress', 'completed', 'on_hold'],
      default: 'in_progress',
    },
  },
  { timestamps: true }
);

export const CodingProblem = mongoose.model('CodingProblem', codingProblemSchema);
export const Skill = mongoose.model('Skill', skillSchema);
export const Project = mongoose.model('Project', projectSchema);

// Daily practice targets (user-tunable; 0 = no target set).
const practiceGoalSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    dailyProblems: { type: Number, default: 0, min: 0, max: 100 },
    dailyMinutes: { type: Number, default: 0, min: 0, max: 1440 },
  },
  { timestamps: true }
);

export const PracticeGoal = mongoose.model('PracticeGoal', practiceGoalSchema);
