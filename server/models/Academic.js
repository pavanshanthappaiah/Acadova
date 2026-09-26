import mongoose from 'mongoose';

// Academic Semester Schema
const semesterSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    semesterNumber: {
      type: Number,
      required: true,
    },
    academicYear: {
      type: String, // e.g. "2026–27"
      required: true,
      trim: true,
    },
    semesterName: {
      type: String, // e.g. "6th Sem Computer Science"
      required: true,
      trim: true,
    },
    startDate: {
      type: String, // YYYY-MM-DD
      required: true,
    },
    endDate: {
      type: String, // YYYY-MM-DD
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    workingDays: {
      type: [String],
      default: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    },
    timeSlots: [
      {
        slotIndex: { type: Number, required: true },
        startTime: { type: String, required: true }, // "08:00"
        endTime: { type: String, required: true },   // "09:00"
        label: { type: String, default: '' },        // e.g. "Period 1", "Tea Break", "Lunch"
        type: {
          type: String,
          enum: ['regular', 'break', 'lunch'],
          default: 'regular',
        },
      },
    ],
    isTimetableActivated: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Subject Schema
const subjectSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    semester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Semester',
      default: null,
      index: true,
    },
    semesterNumber: {
      type: Number,
      default: 6,
    },
    code: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    faculty: {
      type: String,
      default: '',
      trim: true,
    },
    credits: {
      type: Number,
      default: 4,
    },
    type: {
      type: String,
      enum: ['Theory', 'Practical', 'Elective', 'Other'],
      default: 'Theory',
    },
    color: {
      type: String,
      default: '#6366f1',
    },
    targetAttendance: {
      type: Number,
      default: 75,
    },
    // Weekly session requirements
    theorySessionsPerWeek: {
      type: Number,
      default: 3,
    },
    theoryDuration: {
      type: Number, // in hours
      default: 1,
    },
    // Lab Section child component (specifically prompted for 4-credit courses or explicit practicals)
    labSection: {
      hasLab: {
        type: Boolean,
        default: false,
      },
      labName: {
        type: String,
        default: '',
        trim: true,
      },
      // Note: Lab code strictly inherits parent subject code
      duration: {
        type: Number, // in hours, e.g. 2
        default: 2,
      },
      sessionsPerWeek: {
        type: Number,
        default: 1,
      },
    },
    // Theory Attendance counters
    totalClasses: {
      type: Number,
      default: 0,
    },
    attendedClasses: {
      type: Number,
      default: 0,
    },
    // Lab Attendance counters (tracked separately under same subject)
    labTotalClasses: {
      type: Number,
      default: 0,
    },
    labAttendedClasses: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Virtual for labCode: strictly inherits parent subject code
subjectSchema.virtual('labSection.code').get(function () {
  return this.code;
});

// Class Session Log (Attendance record)
const classSessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    semester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Semester',
      default: null,
      index: true,
    },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: true,
      index: true,
    },
    sessionType: {
      type: String,
      enum: ['theory', 'lab'],
      default: 'theory',
    },
    date: {
      type: String, // YYYY-MM-DD
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['attended', 'missed', 'cancelled', 'present', 'absent', 'not_conducted'],
      required: true,
    },
    timetableEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TimetableSlot',
      default: null,
    },
    notes: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

// Assignment Schema
const assignmentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    deadline: {
      type: String, // YYYY-MM-DD
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'submitted', 'graded'],
      default: 'pending',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    maxMarks: {
      type: Number,
      default: 10,
    },
    scoredMarks: {
      type: Number,
      default: null,
    },
  },
  { timestamps: true }
);

// Exam Schema
const examSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['internal_1', 'internal_2', 'lab_exam', 'final'],
      default: 'internal_1',
    },
    date: {
      type: String, // YYYY-MM-DD
      required: true,
    },
    syllabus: [
      {
        topic: String,
        completed: { type: Boolean, default: false },
      },
    ],
    weightage: {
      type: Number,
      default: 20,
    },
    marks: {
      type: Number,
      default: null,
    },
  },
  { timestamps: true }
);

// Assessment Schema — fixed per-subject academic structure.
// Every subject carries exactly: Internal 1 + Internal 2 (max 50 each),
// ABL 1 + ABL 2 (max 20 each, with a required submission date), and
// Quiz 1 + Quiz 2 (max 20 each, with a required date and explicit
// attendance). One document per subject per semester; upserts keep it a
// single source of truth. Labs stay under the existing subject.labSection.
const assessmentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    semester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Semester',
      required: true,
      index: true,
    },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: true,
      index: true,
    },
    internals: {
      internal_1: { type: Number, default: null, min: 0, max: 50 }, // obtained / 50
      internal_2: { type: Number, default: null, min: 0, max: 50 }, // obtained / 50
      // Actual scheduled assessment dates (YYYY-MM-DD) — never derived from
      // createdAt. A date can exist without marks (exam not yet scored) and
      // marks can exist without a date (legacy records).
      internalDates: {
        internal_1: { type: String, default: null },
        internal_2: { type: String, default: null },
      },
    },
    abls: [
      {
        number: { type: Number, enum: [1, 2], required: true }, // exactly ABL 1 & ABL 2
        submissionDate: { type: String, default: null }, // YYYY-MM-DD — required on save
        marks: { type: Number, default: null, min: 0, max: 20 }, // obtained / 20, null = not recorded
        status: {
          type: String,
          enum: ['pending', 'submitted'],
          default: 'pending',
        },
        notes: { type: String, default: '', trim: true },
      },
    ],
    quizzes: [
      {
        number: { type: Number, enum: [1, 2], required: true }, // exactly Quiz 1 & Quiz 2
        quizDate: { type: String, default: null }, // YYYY-MM-DD — required on save
        attendance: {
          type: String,
          enum: ['not_recorded', 'attended', 'not_attended'],
          default: 'not_recorded',
        },
        marks: { type: Number, default: null, min: 0, max: 20 }, // only meaningful when attended
      },
    ],
    // One lab internal for lab-bearing subjects. The DATE is the reminder
    // source; marks are an academic record and stay optional, so a lab internal
    // can be scheduled before it is graded and never auto-become zero.
    labInternal: {
      date: { type: String, default: null }, // YYYY-MM-DD
      marks: { type: Number, default: null, min: 0, max: 20 },
      notes: { type: String, default: '', trim: true },
    },
  },
  { timestamps: true }
);

// One assessment document per subject per semester.
assessmentSchema.index({ semester: 1, subject: 1 }, { unique: true });

// Timetable Slot Schema — College-Style Timetable Grid Entry
const timetableSlotSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    semester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Semester',
      default: null,
      index: true,
    },
    day: {
      type: String,
      enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      required: true,
    },
    slotIndex: {
      type: Number, // Reference to semester.timeSlots[slotIndex]
      default: 0,
    },
    start_time: {
      type: String, // "08:00"
      required: true,
    },
    end_time: {
      type: String, // "09:00"
      required: true,
    },
    entryType: {
      type: String,
      enum: ['theory', 'lab', 'break', 'lunch', 'free'],
      default: 'theory',
    },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      default: null,
    },
    room: {
      type: String,
      default: '',
      trim: true,
    },
    colSpan: {
      type: Number, // e.g. 2 for multi-slot lab
      default: 1,
    },
    isConsecutiveContinuation: {
      type: Boolean, // True if this cell is covered by a previous merged slot
      default: false,
    },
    effective_from: {
      type: String, // YYYY-MM-DD — semester start date
      default: '',
    },
  },
  { timestamps: true }
);

// Semester Exception Schema (Holidays, College Events, Cancelled Classes)
const semesterExceptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    semester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Semester',
      required: true,
      index: true,
    },
    date: {
      type: String, // YYYY-MM-DD
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['holiday', 'no_class', 'event', 'exam', 'cancelled', 'custom'],
      default: 'holiday',
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    notes: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

export const Semester = mongoose.model('Semester', semesterSchema);
export const Subject = mongoose.model('Subject', subjectSchema);
export const ClassSession = mongoose.model('ClassSession', classSessionSchema);
export const Assignment = mongoose.model('Assignment', assignmentSchema);
export const Exam = mongoose.model('Exam', examSchema);
export const Assessment = mongoose.model('Assessment', assessmentSchema);
export const TimetableSlot = mongoose.model('TimetableSlot', timetableSlotSchema);
export const SemesterException = mongoose.model('SemesterException', semesterExceptionSchema);

export default {
  Semester,
  Subject,
  ClassSession,
  Assignment,
  Exam,
  Assessment,
  TimetableSlot,
  SemesterException,
};
