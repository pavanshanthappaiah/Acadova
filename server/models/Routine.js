import mongoose from 'mongoose';

// Custom Routine schema - generic & fully customizable
const customRoutineSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Routine name is required'],
      trim: true,
    },
    category: {
      type: String,
      default: 'Personal',
      trim: true,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    startTime: {
      type: String, // e.g. "06:30" or "06:30 AM"
      default: '',
    },
    endTime: {
      type: String, // e.g. "07:15" or "07:15 AM"
      default: '',
    },
    notes: {
      type: String,
      default: '',
      trim: true,
    },
    isRecurring: {
      type: Boolean,
      default: false,
    },
    recurrenceDays: {
      type: [String], // ['Monday', 'Tuesday', ...] or ['Every Day']
      default: [],
    },
    date: {
      type: String, // YYYY-MM-DD (used for single-instance routines)
      default: '',
      index: true,
    },
  },
  { timestamps: true }
);

// Routine Completion schema - independent per date
const routineCompletionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    routine: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CustomRoutine',
      required: true,
      index: true,
    },
    date: {
      type: String, // YYYY-MM-DD
      required: true,
      index: true,
    },
    completed: {
      type: Boolean,
      default: false,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Unique compound index: one status per routine per date
routineCompletionSchema.index({ user: 1, routine: 1, date: 1 }, { unique: true });

// Routine Category schema — user-defined categories. The `category` field on
// CustomRoutine stays a plain string, so no migration is needed; these records
// give each student their own reusable list. Scoped per user by construction.
const routineCategorySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Category name is required'],
      trim: true,
      maxlength: 40,
    },
  },
  { timestamps: true }
);

// One category per name per student.
routineCategorySchema.index({ user: 1, name: 1 }, { unique: true });

export const RoutineCategory = mongoose.model('RoutineCategory', routineCategorySchema);

export const CustomRoutine = mongoose.model('CustomRoutine', customRoutineSchema);
export const RoutineCompletion = mongoose.model('RoutineCompletion', routineCompletionSchema);

export default { CustomRoutine, RoutineCompletion, RoutineCategory };
