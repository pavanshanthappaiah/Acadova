import mongoose from 'mongoose';

/* ------------------------------------------------------------------ */
/* NotificationPreference                                              */
/*                                                                     */
/* The student — not hardcoded logic — controls every reminder. All    */
/* timing values are user-selected lead times; nothing here assumes a  */
/* default cadence. Categories are independent: enabled flag, channel  */
/* flags, and lead times all live per category.                        */
/* ------------------------------------------------------------------ */

export const NOTIFICATION_CATEGORIES = [
  'project',
  'assignment',
  'quiz',
  'internal',
  'labInternal',
  'routine',
  'class',
  'lab',
  'attendance',
  'academicDate',
  'leetcode',
];

export const NOTIFICATION_CATEGORY_LABELS = {
  project: 'Projects',
  assignment: 'Assignments / ABL',
  quiz: 'Quizzes',
  internal: 'Internal Exams',
  labInternal: 'Lab Internals',
  routine: 'Personal Routines',
  class: 'Classes',
  lab: 'Labs',
  attendance: 'Attendance',
  academicDate: 'Academic Dates',
  leetcode: 'LeetCode',
};

// Every selectable reminder lead time, in display order. Users pick any
// subset (multi) or exactly one (single) per category.
export const REMINDER_LEAD_OPTIONS = [
  { minutes: 10080, label: '7 days before' },
  { minutes: 4320, label: '3 days before' },
  { minutes: 1440, label: '1 day before' },
  { minutes: 720, label: '12 hours before' },
  { minutes: 360, label: '6 hours before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 30, label: '30 minutes before' },
  { minutes: 15, label: '15 minutes before' },
];

const channelsSchema = new mongoose.Schema(
  {
    webPush: { type: Boolean, default: false },
    email: { type: Boolean, default: false },
    inApp: { type: Boolean, default: false },
  },
  { _id: false }
);

const categoryPrefSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: NOTIFICATION_CATEGORIES,
      required: true,
    },
    enabled: { type: Boolean, default: false }, // conservative default: off
    channels: { type: channelsSchema, default: () => ({}) },
    leadMinutes: {
      type: [Number],
      default: [],
      validate: {
        validator: (v) => v.every((m) => REMINDER_LEAD_OPTIONS.some((o) => o.minutes === m)),
        message: 'Unknown reminder lead time',
      },
    },
  },
  { _id: false }
);

const notificationPreferenceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    enabled: { type: Boolean, default: true }, // master switch
    channels: { type: channelsSchema, default: () => ({ inApp: true }) }, // in-app only by default
    categories: { type: [categoryPrefSchema], default: () => [] },
  },
  { timestamps: true }
);

// Normalize: every known category exists exactly once, with sane values.
notificationPreferenceSchema.pre('validate', function ensureCategories(next) {
  const known = new Set(this.categories.map((c) => c.category));
  for (const cat of NOTIFICATION_CATEGORIES) {
    if (!known.has(cat)) this.categories.push({ category: cat });
  }
  this.categories = NOTIFICATION_CATEGORIES.map(
    (cat) => this.categories.find((c) => c.category === cat) || { category: cat }
  );
  next();
});

export const NotificationPreference = mongoose.model(
  'NotificationPreference',
  notificationPreferenceSchema
);

/* ------------------------------------------------------------------ */
/* ScheduledReminder — materialised future reminders                   */
/*                                                                     */
/* The sync engine rebuilds a user's scheduled set from their current  */
/* preferences and entity deadlines. userIdentityKey makes every       */
/* pending reminder idempotent (unique partial index below), so a      */
/* re-sync can never produce duplicates. Delivered history is never    */
/* touched by re-syncs.                                                */
/* ------------------------------------------------------------------ */

const scheduledReminderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userIdentityKey: { type: String, required: true }, // `${user}:${category}:${entityId}:${sub}:${fireAt}`
    category: { type: String, enum: NOTIFICATION_CATEGORIES, required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId },
    entitySub: { type: String, default: '' }, // e.g. 'abl:1', 'quiz:2'
    leadMinutes: { type: Number, required: true },
    leadLabel: { type: String, required: true },
    fireAt: { type: Date, required: true, index: true },
    eventAt: { type: Date, required: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    link: { type: String, default: '/' },
    status: {
      type: String,
      enum: ['scheduled', 'delivered', 'cancelled'],
      default: 'scheduled',
      index: true,
    },
    deliveredChannels: { type: [String], default: [] },
    deliveredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Only one PENDING reminder per identity; history (delivered/cancelled) exempt.
scheduledReminderSchema.index(
  { userIdentityKey: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'scheduled' },
  }
);

export const ScheduledReminder = mongoose.model('ScheduledReminder', scheduledReminderSchema);

/* ------------------------------------------------------------------ */
/* AppNotification — in-app bell history                               */
/* ------------------------------------------------------------------ */

const appNotificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    category: { type: String, enum: NOTIFICATION_CATEGORIES, required: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    link: { type: String, default: '/' },
    read: { type: Boolean, default: false, index: true },
    sourceReminderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ScheduledReminder', default: null },
  },
  { timestamps: true }
);

// One in-app copy per scheduled reminder — an engine retry can't duplicate.
appNotificationSchema.index(
  { sourceReminderId: 1 },
  { unique: true, partialFilterExpression: { sourceReminderId: { $type: 'objectId' } } }
);

export const AppNotification = mongoose.model('AppNotification', appNotificationSchema);

/* ------------------------------------------------------------------ */
/* PushSubscription — browser web-push endpoints                       */
/* ------------------------------------------------------------------ */

const pushSubscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: { type: String, default: '' },
  },
  { timestamps: true }
);

pushSubscriptionSchema.index({ user: 1, endpoint: 1 }, { unique: true });

export const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);
