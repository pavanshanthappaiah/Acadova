import mongoose from 'mongoose';

const activitySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Activity title is required'],
      trim: true,
    },
    category: {
      type: String,
      enum: ['academic', 'coding', 'project', 'health', 'personal'],
      default: 'academic',
      index: true,
    },
    date: {
      type: String, // YYYY-MM-DD format for fast, timezone-safe grouping
      required: true,
      index: true,
    },
    planned_start: {
      type: String, // "HH:MM" 24hr format, e.g. "09:00"
      required: true,
    },
    planned_end: {
      type: String, // "HH:MM" 24hr format, e.g. "10:30"
      required: true,
    },
    planned_duration: {
      type: Number, // In minutes
      required: true,
      min: 1,
    },
    actual_start: {
      type: String, // "HH:MM" or ISO string
      default: null,
    },
    actual_end: {
      type: String, // "HH:MM" or ISO string
      default: null,
    },
    actual_duration: {
      type: Number, // In minutes
      default: 0,
    },
    status: {
      type: String,
      enum: ['scheduled', 'in_progress', 'completed', 'interrupted', 'cancelled'],
      default: 'scheduled',
      index: true,
    },
    academicImportance: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
    },
    subjectRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for querying a user's schedule on a specific date
activitySchema.index({ user: 1, date: 1, planned_start: 1 });

export const Activity = mongoose.model('Activity', activitySchema);
export default Activity;
