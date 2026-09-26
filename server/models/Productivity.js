import mongoose from 'mongoose';

// End-of-Day Checkout Schema
const dailyReviewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    date: {
      type: String, // YYYY-MM-DD
      required: true,
      index: true,
    },
    completedItems: [
      {
        type: String,
        trim: true,
      },
    ],
    missedItems: [
      {
        type: String,
        trim: true,
      },
    ],
    energyLevel: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    tomorrowPriority: {
      type: String,
      default: '',
      trim: true,
    },
    reflectionNotes: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { timestamps: true }
);

// Compound index to guarantee one checkout per day per student
dailyReviewSchema.index({ user: 1, date: 1 }, { unique: true });

// Weekly Review Schema
const weeklyReviewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    weekStartDate: {
      type: String, // YYYY-MM-DD
      required: true,
    },
    weekEndDate: {
      type: String, // YYYY-MM-DD
      required: true,
    },
    studyMinutes: {
      type: Number,
      default: 0,
    },
    codingMinutes: {
      type: Number,
      default: 0,
    },
    projectMinutes: {
      type: Number,
      default: 0,
    },
    healthMinutes: {
      type: Number,
      default: 0,
    },
    completedTasks: {
      type: Number,
      default: 0,
    },
    totalTasks: {
      type: Number,
      default: 0,
    },
    bestDay: {
      type: String,
      default: 'Wednesday',
    },
    peakWindow: {
      type: String,
      default: '6:00 PM – 9:00 PM',
    },
    mostDelayedCategory: {
      type: String,
      default: 'Academic',
    },
    factualObservations: [
      {
        type: String,
      },
    ],
  },
  { timestamps: true }
);

export const DailyReview = mongoose.model('DailyReview', dailyReviewSchema);
export const WeeklyReview = mongoose.model('WeeklyReview', weeklyReviewSchema);
