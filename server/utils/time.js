/**
 * Shared date/time helpers for schedule locking.
 *
 * Everything here works in the server's *local* calendar, not UTC: a student's
 * "today" and "now" must match their wall clock, and `toISOString()` would hand
 * back the UTC day, which is the wrong day for part of the world.
 */

const pad = (n) => String(n).padStart(2, '0');

export const localDateStr = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const localMinutesOfDay = (d = new Date()) => d.getHours() * 60 + d.getMinutes();

/**
 * Everything above works in the server's *local* calendar. In production the
 * server may not share the student's wall clock at all (Render runs UTC, the
 * student runs IST) — so every request also carries the browser's
 * `new Date().getTimezoneOffset()` as `tzOffsetMinutes` (IST = -330). The
 * helpers below turn that into the student's own "today" and "now".
 * When no offset is supplied (tests, curl) they fall back to server-local.
 */

/** `tzOffsetMinutes` from a request, or null when absent/invalid. */
export const tzOrNull = (tzOffsetMinutes) => {
  const n = Number(tzOffsetMinutes);
  return Number.isFinite(n) ? n : null;
};

/** Calendar date `YYYY-MM-DD` of instant `d` in the student's timezone. */
export const dateStrInTz = (d = new Date(), tzOffsetMinutes = null) => {
  const tz = tzOrNull(tzOffsetMinutes);
  if (tz == null) return localDateStr(d);
  return new Date(d.getTime() - tz * 60000).toISOString().slice(0, 10);
};

/** Minutes since midnight of instant `d` on the student's wall clock. */
export const minutesOfDayInTz = (d = new Date(), tzOffsetMinutes = null) => {
  const tz = tzOrNull(tzOffsetMinutes);
  if (tz == null) return localMinutesOfDay(d);
  const shifted = new Date(d.getTime() - tz * 60000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
};

/** The two values every lock/gate decision needs, in the student's clock. */
export const studentNow = (tzOffsetMinutes = null, d = new Date()) => ({
  today: dateStrInTz(d, tzOffsetMinutes),
  nowMinutes: minutesOfDayInTz(d, tzOffsetMinutes),
});

/**
 * Parse a schedule time into minutes since midnight.
 * Accepts "HH:MM", "H:MM", and the 12-hour variants the data model allows
 * ("07:15 AM", "9:30 pm"). Returns null when the value is unusable, which
 * callers treat as "untimed" rather than as midnight.
 */
export const toMinutes = (value) => {
  if (!value || typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3] ? match[3].toUpperCase() : null;
  if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = hours % 12 + (meridiem === 'PM' ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }
  return hours * 60 + minutes;
};

export const minutesToHHMM = (minutes) =>
  `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

export const to12h = (value) => {
  const minutes = toMinutes(value);
  if (minutes == null) return value || '';
  const hours24 = Math.floor(minutes / 60);
  const meridiem = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${pad(minutes % 60)} ${meridiem}`;
};

/**
 * Decide whether an item scheduled on `date` may already be completed.
 *
 * `threshold` is the scheduled end (falling back to the scheduled start for
 * open-ended items). `null` means the item is untimed and never locks.
 * Past dates are always open; future dates are always locked.
 */
export const evaluateLock = ({ date, threshold, today, nowMinutes }) => {
  if (threshold == null) return { locked: false, lockAt: null };
  const lockAt = minutesToHHMM(threshold);
  if (date > today) return { locked: true, lockAt };
  if (date < today) return { locked: false, lockAt };
  return { locked: nowMinutes < threshold, lockAt };
};

/**
 * A routine is "flexible" when it has no start time — the student wants to do
 * it whenever, not at a fixed slot. Its checkbox is gated differently from a
 * timed one: it only opens once every timed routine for that day has been
 * marked (in practice, end of day).
 */
export const isFlexibleRoutine = (routine) => toMinutes(routine?.startTime) == null;

export const lockMessage = (lockAt, noun = 'Completion') =>
  `${noun} is available after ${to12h(lockAt)}.`;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const dayNameOf = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return DAY_NAMES[new Date(y, m - 1, d).getDay()];
};

export const addDays = (dateStr, days) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDateStr(new Date(y, m - 1, d + days));
};

/** Monday-first week containing `dateStr`. */
export const startOfWeek = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const offset = (new Date(y, m - 1, d).getDay() + 6) % 7; // Monday = 0
  return addDays(dateStr, -offset);
};

export const datesInWeek = (dateStr) => {
  const start = startOfWeek(dateStr);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
};

export const monthKeyOf = (dateStr) => dateStr.slice(0, 7);

export const datesInMonth = (dateStr) => {
  const [y, m] = dateStr.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`);
};

/**
 * Turn a day's items into the single progress summary used by every view
 * (today's sheet, the week chart and the month chart).
 *
 * Cancelled work is not incomplete work, and items that are still locked
 * because their session has not finished are not "pending" either — the
 * denominator only contains work the student could actually have done.
 */
export const summariseProgress = (items) => {
  const total = items.length;
  const completed = items.filter((i) => i.status === 'completed').length;
  const cancelled = items.filter((i) => i.status === 'cancelled').length;
  const locked = items.filter((i) => i.locked && i.status !== 'cancelled').length;
  const eligible = Math.max(0, total - cancelled - locked);
  const remaining = Math.max(0, eligible - completed);
  return {
    total,
    completed,
    cancelled,
    locked,
    eligible,
    remaining,
    percentage: eligible > 0 ? Math.round((completed / eligible) * 100) : null,
  };
};
