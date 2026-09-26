import webpush from 'web-push';
import { PushSubscription } from '../models/Notification.js';

let configured = false;

const vapidConfigured =
  Boolean(process.env.VAPID_PUBLIC_KEY) &&
  Boolean(process.env.VAPID_PRIVATE_KEY) &&
  Boolean(process.env.VAPID_SUBJECT);

if (vapidConfigured) {
  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    configured = true;

    console.log('[Push] VAPID configuration loaded successfully.');
  } catch (err) {
    console.error(
      '[Push] VAPID configuration failed:',
      err.message
    );
  }
} else {
  console.warn(
    '[Push] VAPID configuration incomplete. Web Push is disabled.'
  );
}

export const vapidPublicKey = () => {
  return process.env.VAPID_PUBLIC_KEY || null;
};

export const pushConfigured = () => {
  return configured;
};

export const sendWebPush = async (userId, payload) => {
  if (!configured) {
    console.warn(
      '[Push] Web Push not sent because VAPID is not configured.'
    );
    return false;
  }

  const subscriptions = await PushSubscription.find({
    user: userId,
  }).lean();

  if (!subscriptions.length) {
    console.warn(
      `[Push] No active push subscriptions found for user ${userId}.`
    );
    return false;
  }

  const body = JSON.stringify(payload);

  let delivered = false;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
        },
        body
      );

      delivered = true;
    } catch (err) {
      if (
        err?.statusCode === 404 ||
        err?.statusCode === 410
      ) {
        try {
          await PushSubscription.deleteOne({
            _id: subscription._id,
          });

          console.log(
            `[Push] Removed expired subscription ${subscription._id}.`
          );
        } catch (deleteError) {
          console.error(
            '[Push] Failed to remove expired subscription:',
            deleteError.message
          );
        }
      } else {
        console.error(
          '[Push] Notification delivery failed:',
          err.message
        );
      }
    }
  }

  return delivered;
};