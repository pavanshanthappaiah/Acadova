import express from 'express';
import {
  NotificationPreference,
  ScheduledReminder,
  AppNotification,
  PushSubscription,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  REMINDER_LEAD_OPTIONS,
} from '../models/Notification.js';
import { getOrCreatePreferences, syncUserReminders, syncAllUsers } from '../services/notificationEngine.js';
import { vapidPublicKey } from '../services/pushService.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

const VALID_LEADS = new Set(REMINDER_LEAD_OPTIONS.map((o) => o.minutes));
const VALID_CHANNEL_NAMES = ['webPush', 'email', 'inApp'];

const sanitiseChannels = (input, fallback = {}) => {
  const out = { ...fallback };
  for (const name of VALID_CHANNEL_NAMES) {
    if (typeof input?.[name] === 'boolean') out[name] = input[name];
  }
  return out;
};

const sanitiseCategories = (input) =>
  (Array.isArray(input) ? input : [])
    .filter((c) => c && NOTIFICATION_CATEGORIES.includes(c.category))
    .map((c) => ({
      category: c.category,
      enabled: Boolean(c.enabled),
      channels: sanitiseChannels(c.channels),
      leadMinutes: Array.isArray(c.leadMinutes)
        ? [...new Set(c.leadMinutes)].filter((m) => VALID_LEADS.has(m))
        : [],
    }));

/** GET /api/notifications/preferences — prefs + metadata for the UI */
export const getPreferences = async (req, res) => {
  try {
    const prefs = await getOrCreatePreferences(req.user._id);
    res.json({
      success: true,
      preferences: prefs,
      categories: NOTIFICATION_CATEGORIES.map((c) => ({
        value: c,
        label: NOTIFICATION_CATEGORY_LABELS[c],
      })),
      leadOptions: REMINDER_LEAD_OPTIONS,
      vapidPublicKey: vapidPublicKey(),
      emailConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/** PUT /api/notifications/preferences — validate, save, resync reminders */
export const updatePreferences = async (req, res) => {
  try {
    const prefs = await getOrCreatePreferences(req.user._id);
    const body = req.body || {};

    if (typeof body.enabled === 'boolean') prefs.enabled = body.enabled;
    if (body.channels) prefs.channels = sanitiseChannels(body.channels, prefs.channels);

    if (Array.isArray(body.categories)) {
      const incoming = sanitiseCategories(body.categories);
      const byCategory = new Map(prefs.categories.map((c) => [c.category, c]));
      for (const next of incoming) {
        const existing = byCategory.get(next.category);
        if (existing) {
          existing.enabled = next.enabled;
          existing.channels = next.channels;
          existing.leadMinutes = next.leadMinutes;
        }
      }
    }

    await prefs.save();

    // Immediate effect: recalc future reminders against the new preferences.
    const sync = await syncUserReminders(req.user._id);

    res.json({ success: true, preferences: prefs, sync });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/** GET /api/notifications — in-app history for the bell */
export const listNotifications = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const [items, unread] = await Promise.all([
      AppNotification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(limit).lean(),
      AppNotification.countDocuments({ user: req.user._id, read: false }),
    ]);
    res.json({ success: true, items, unread });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/** POST /api/notifications/read — mark all (or one) as read */
export const markNotificationsRead = async (req, res) => {
  try {
    const filter = { user: req.user._id, read: false };
    if (req.body?.id) filter._id = req.body.id;
    await AppNotification.updateMany(filter, { read: true });
    const unread = await AppNotification.countDocuments({ user: req.user._id, read: false });
    res.json({ success: true, unread });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/** DELETE /api/notifications — clear the in-app history (all, or one by id).
 *  History only: preferences and scheduled reminders are untouched, so the
 *  dispatcher keeps working exactly as before. */
export const clearNotifications = async (req, res) => {
  try {
    const filter = { user: req.user._id };
    if (req.body?.id) filter._id = req.body.id;
    const result = await AppNotification.deleteMany(filter);
    const unread = await AppNotification.countDocuments({ user: req.user._id, read: false });
    res.json({ success: true, deleted: result.deletedCount || 0, unread });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/** GET /api/notifications/reminders — upcoming scheduled reminders (planner visibility) */
export const listScheduledReminders = async (req, res) => {
  try {
    const items = await ScheduledReminder.find({
      user: req.user._id,
      status: 'scheduled',
      fireAt: { $gte: new Date() },
    })
      .sort({ fireAt: 1 })
      .limit(30)
      .lean();
    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/** POST /api/notifications/sync — manual resync (used by tests and the UI debug link) */
export const manualSync = async (req, res) => {
  try {
    const result = await syncUserReminders(req.user._id);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/** POST /api/notifications/push/subscribe — store a browser push subscription */
export const subscribePush = async (req, res) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ success: false, message: 'Invalid subscription payload' });
    }
    await PushSubscription.findOneAndUpdate(
      { user: req.user._id, endpoint },
      {
        user: req.user._id,
        endpoint,
        keys,
        userAgent: String(req.headers['user-agent'] || '').slice(0, 250),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/** POST /api/notifications/push/unsubscribe — remove a browser push subscription */
export const unsubscribePush = async (req, res) => {
  try {
    if (req.body?.endpoint) {
      await PushSubscription.deleteOne({ user: req.user._id, endpoint: req.body.endpoint });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/** POST /api/notifications/test — deliver a sample notification through enabled channels */
export const sendTestNotification = async (req, res) => {
  try {
    const { pushImmediateNotification } = await import('../services/notificationEngine.js');
    const created = await pushImmediateNotification({
      userId: req.user._id,
      category: 'academicDate',
      title: 'Test notification',
      body: 'If you can read this in your notification bell, in-app delivery works.',
      link: '/settings',
      force: true,
    });
    res.json({
      success: true,
      delivered: Boolean(created),
      note: 'In-app test notification delivered to the bell.',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/** Dev-only: resync every user's reminders. */
export const syncEveryone = async (req, res) => {
  try {
    const result = await syncAllUsers();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

router.get('/preferences', getPreferences);
router.put('/preferences', updatePreferences);
router.get('/', listNotifications);
router.post('/read', markNotificationsRead);
router.delete('/', clearNotifications);
router.get('/reminders', listScheduledReminders);
router.post('/sync', manualSync);
router.post('/push/subscribe', subscribePush);
router.post('/push/unsubscribe', unsubscribePush);
router.post('/test', sendTestNotification);
router.post('/sync-all', syncEveryone);

export default router;
