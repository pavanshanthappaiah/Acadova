/**
 * LeetCode near-real-time synchronization engine.
 *
 * "Near-real-time" is deliberate wording (Phase 0/terminology): LeetCode
 * offers no verified push/webhook for solves, so this system combines a
 * server-side scheduled sync with manual Sync Now, bounded retries, and an
 * idempotent upsert pipeline. It is NOT true real-time.
 *
 * Architecture (Phase 16):
 *   clients/leetcodeClient.js   → upstream retrieval (all HTTP lives there)
 *   services/leetcodeSyncService.js (this file) → lifecycle, locks, retries,
 *                                                 normalization, upsert, analytics
 *   models/LeetCode.js          → integration state + solved-problem identity
 *
 * Concurrency (Phase 14): one atomic findOneAndUpdate claims a lock keyed by
 * integration id with an expiry. Every subsequent state write is scoped to the
 * claimed syncId, so a lock reclaimed from a crashed worker cannot be clobbered
 * by that worker's late writes.
 *
 * Retries (Phase 12): only `transient` errors are retried, in-run with
 * exponential backoff (LEETCODE_SYNC_RETRY_BASE_MS → 30s/60s/120s by default).
 * profile_not_found, malformed and rejected responses fail immediately.
 *
 * Rate limits (Phase 13): recorded as `rate_limited` with a cooldown
 * (honouring Retry-After when upstream sends one). No bypass, no parallel
 * hammering — runs execute sequentially and calls carry a minimum gap.
 */

import crypto from 'crypto';
import {
  LeetCodeIntegration,
  LeetCodeSolvedProblem,
} from '../models/LeetCode.js';
import { LeetCodeError, createLeetCodeClient } from '../clients/leetcodeClient.js';
import { pushImmediateNotification } from './notificationEngine.js';

/** Identifies this worker in the lock so reclaimed locks are detectable. */
const HOLDER = `node:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;

/** Field-level client override so tests can inject a scripted data source. */
let clientOverride = null;
export const setLeetCodeClient = (client) => {
  clientOverride = client;
};

const envInt = (name, fallback, min = 0) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min ? value : fallback;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** All sync configuration in one place — nothing is hardcoded elsewhere. */
export const leetcodeConfig = () => ({
  /** Near-real-time cadence: the background poll runs every 5–10 seconds
   *  (default 8s), configurable via LEETCODE_SYNC_INTERVAL_SECONDS. */
  intervalSeconds: envInt('LEETCODE_SYNC_INTERVAL_SECONDS', 8, 3),
  minIntervalSeconds: envInt('LEETCODE_SYNC_MIN_INTERVAL_SECONDS', 5, 1),
  maxIntervalSeconds: envInt('LEETCODE_SYNC_MAX_INTERVAL_SECONDS', 10, 1),
  maxRetries: envInt('LEETCODE_SYNC_MAX_RETRIES', 3),
  retryBaseMs: envInt('LEETCODE_SYNC_RETRY_BASE_MS', 2000),
  windowSize: envInt('LEETCODE_SYNC_WINDOW', 50, 1),
  staleLockMs: envInt('LEETCODE_SYNC_STALE_LOCK_MS', 60000, 1000),
  rateLimitCooldownMs: envInt('LEETCODE_SYNC_RATE_LIMIT_COOLDOWN_MS', 900000, 1000),
  maxEnrichPerRun: envInt('LEETCODE_SYNC_MAX_ENRICH', 25),
  tickBatch: envInt('LEETCODE_SYNC_TICK_BATCH', 5, 1),
});

const getClient = () => clientOverride || createLeetCodeClient();

/** Validates a YYYY-MM month parameter; returns null when absent/invalid. */
const validMonth = (value) => (/^\d{4}-\d{2}$/.test(String(value || '')) ? String(value) : null);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

/**
 * Resolves a sync WINDOW from the student's selected filter. The filter is the
 * single source of truth: the engine stores ONLY solves inside this window.
 * Accepted forms:
 *   { month: 'YYYY-MM' }                     → that calendar month
 *   { startDate: 'YYYY-MM-DD', endDate }     → [start 00:00, end 24:00) UTC
 *   null                                     → unscooped (test/export only)
 * endDate is INCLUSIVE (a date string), so it is advanced by one day.
 */
export const resolveSyncWindow = ({ month = null, startDate = null, endDate = null } = {}) => {
  if (validMonth(month)) {
    const [y, m] = month.split('-').map(Number);
    return { startMs: Date.UTC(y, m - 1, 1), endMs: Date.UTC(y, m, 1), label: month };
  }
  if (DATE_RE.test(String(startDate || '')) && DATE_RE.test(String(endDate || ''))) {
    const startMs = Date.parse(`${startDate}T00:00:00.000Z`);
    const endMs = Date.parse(`${endDate}T00:00:00.000Z`) + DAY_MS;
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && startMs < endMs) {
      return { startMs, endMs, label: `${startDate}→${endDate}` };
    }
  }
  return null;
};

/**
 * Turns a named UI filter (today | week | month | custom) into a concrete
 * window, in the STUDENT'S timezone (offset minutes from the client) so date
 * boundaries land on the student's local midnight — not the server's.
 */
export const resolveFilterWindow = (filter = {}, { nowMs = Date.now() } = {}) => {
  const tzOffsetMinutes = Number.isFinite(Number(filter.tzOffsetMinutes))
    ? Number(filter.tzOffsetMinutes)
    : 0;
  const localDay = (ms) => new Date(ms - tzOffsetMinutes * 60000).toISOString().slice(0, 10);
  const windowFromLocalDays = (startDay, endDayInclusive) => ({
    startMs: Date.parse(`${startDay}T00:00:00.000Z`) + tzOffsetMinutes * 60000,
    endMs: Date.parse(`${endDayInclusive}T00:00:00.000Z`) + tzOffsetMinutes * 60000 + DAY_MS,
  });

  switch (filter.range) {
    case 'today': {
      const day = localDay(nowMs);
      return { ...windowFromLocalDays(day, day), label: day };
    }
    case 'week': {
      const nowLocal = new Date(nowMs - tzOffsetMinutes * 60000);
      const dow = (nowLocal.getUTCDay() + 6) % 7; // Monday-first
      const mondayMs = Date.parse(`${nowLocal.toISOString().slice(0, 10)}T00:00:00.000Z`) - dow * DAY_MS;
      const monday = new Date(mondayMs).toISOString().slice(0, 10);
      const sunday = new Date(mondayMs + 6 * DAY_MS).toISOString().slice(0, 10);
      return { ...windowFromLocalDays(monday, sunday), label: `${monday}→${sunday}` };
    }
    case 'month': {
      const month = localDay(nowMs).slice(0, 7);
      const [y, m] = month.split('-').map(Number);
      return { startMs: Date.UTC(y, m - 1, 1) + tzOffsetMinutes * 60000, endMs: Date.UTC(y, m, 1) + tzOffsetMinutes * 60000, label: month };
    }
    case 'custom':
      return resolveSyncWindow({ startDate: filter.startDate, endDate: filter.endDate });
    default:
      return null;
  }
};

/* ------------------------------------------------------------------ */
/* Normalization (Phase 7)                                             */
/* ------------------------------------------------------------------ */

/**
 * ONLY an accepted submission counts as solved — never WA/TLE/MLE/CE.
 * LeetCode's public feed reports NUMERIC status codes (10 = Accepted, 11 =
 * Wrong Answer, 20 = Timeout …) while other sources use the literal
 * "Accepted"; both forms are recognised.
 */
const isAccepted = (status) => {
  if (status !== '' && status !== null && status !== undefined) {
    const code = Number(status);
    if (Number.isFinite(code)) return code === 10;
  }
  return String(status || '').trim().toLowerCase() === 'accepted';
};

const toSolvedAt = (timestampMs) => {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return null;
  const date = new Date(timestampMs);
  return Number.isNaN(date.getTime()) ? null : date;
};

/* ------------------------------------------------------------------ */
/* Result payloads (Phase 11 + 28)                                     */
/* ------------------------------------------------------------------ */

export const leetcodeStatusPayload = (doc) => {
  const result = doc?.lastRunResult || {};
  return {
    connected: Boolean(doc),
    username: doc?.username || null,
    // `status` mirrors syncStatus for the API contract; `connected` carries the
    // account-level state so the two never collide in the UI.
    status: doc?.syncStatus || 'idle',
    syncId: doc?.syncId || null,
    syncStartedAt: doc?.syncStartedAt || null,
    lastSyncedAt: doc?.lastSyncedAt || null,
    lastSuccessfulSyncAt: doc?.lastSuccessfulSyncAt || null,
    lastSyncError: doc?.lastSyncError || null,
    newProblems: result.newProblems || 0,
    updatedProblems: result.updatedProblems || 0,
    duplicates: result.duplicates || 0,
    totalSolved: result.totalSolved || doc?.upstreamStats?.totalSolved || 0,
    startedAt: result.startedAt || null,
    completedAt: result.completedAt || null,
    trigger: result.trigger || null,
    syncMonth: result.month || doc?.cursor?.month || null,
    rateLimitedUntil: doc?.rateLimitedUntil || null,
    nextRetryAt: doc?.nextRetryAt || null,
    intervalSeconds: leetcodeConfig().intervalSeconds,
    minIntervalSeconds: leetcodeConfig().minIntervalSeconds,
    maxIntervalSeconds: leetcodeConfig().maxIntervalSeconds,
  };
};

export const getLeetCodeState = async (userId) => {
  const doc = await LeetCodeIntegration.findOne({ user: userId });
  return leetcodeStatusPayload(doc);
};

/* ------------------------------------------------------------------ */
/* Locking (Phase 14) + terminal state writers (Phase 10/11/12/13)     */
/* ------------------------------------------------------------------ */

const claimSync = async (integration, { windowLabel = null } = {}) => {
  const now = new Date();
  const cfg = leetcodeConfig();
  const staleBefore = new Date(now.getTime() - cfg.staleLockMs);
  const syncId = crypto.randomUUID();
  // Single atomic winner: free lock OR an expired one (crashed worker).
  return LeetCodeIntegration.findOneAndUpdate(
    {
      _id: integration._id,
      $or: [{ syncLockAt: null }, { syncLockAt: { $lte: staleBefore } }],
    },
    {
      $set: {
        syncStatus: 'queued',
        syncId,
        syncStartedAt: now,
        syncLockAt: now,
        syncLockHolder: HOLDER,
        lastSyncError: null,
        permanentFailure: false,
        'cursor.month': windowLabel,
      },
    },
    { new: true }
  );
};

/**
 * A failed attempt never touches lastSuccessfulSyncAt (Phase 11) and always
 * releases the lock (Phase 14). `permanent` failures switch automatic sync off
 * until the student explicitly retries.
 */
const finalizeFailure = async (guard, cfg, { message, permanent, accountError }) => {
  const now = new Date();
  const current = await LeetCodeIntegration.findOne(guard);
  if (!current) return null; // lock was reclaimed — do not clobber the new holder
  const failures = (current.consecutiveFailures || 0) + 1;
  const capped = Math.min(failures - 1, 5);
  const cooldownMs = Math.min(cfg.intervalSeconds * 1000 * 2 ** capped, 6 * 60 * 60 * 1000);
  await LeetCodeIntegration.updateOne(guard, {
    $set: {
      // The run's state is always `failed`; `accountError` additionally marks
      // the CONNECTION itself invalid (wrong username) so the scheduler stops.
      syncStatus: 'failed',
      lastSyncedAt: now,
      lastSyncError: String(message || 'Sync failed').slice(0, 500),
      consecutiveFailures: failures,
      nextRetryAt: permanent ? null : new Date(now.getTime() + cooldownMs),
      permanentFailure: Boolean(permanent),
      ...(accountError ? { status: 'error' } : {}),
      syncLockAt: null,
      syncLockHolder: null,
    },
  });
  return { status: 'failed', message };
};

const finalizeProfileMissing = (guard, cfg, message) =>
  // The username itself is wrong/renamed — stop automatic attempts entirely;
  // the student reconnects with the corrected handle.
  finalizeFailure(guard, cfg, {
    message,
    permanent: true,
    accountError: true,
  });

const finalizeRateLimited = async (guard, cfg, err) => {
  const now = new Date();
  const current = await LeetCodeIntegration.findOne(guard);
  if (!current) return null;
  const retryAt = new Date(now.getTime() + (err?.retryAfterMs || cfg.rateLimitCooldownMs));
  await LeetCodeIntegration.updateOne(guard, {
    $set: {
      syncStatus: 'rate_limited',
      lastSyncedAt: now, // attempt finished — success timestamp untouched
      lastSyncError: String(err?.message || 'LeetCode rate limit reached').slice(0, 500),
      rateLimitedUntil: retryAt,
      nextRetryAt: retryAt,
      syncLockAt: null,
      syncLockHolder: null,
    },
  });
  return { status: 'rate_limited', retryAt };
};

/* ------------------------------------------------------------------ */
/* Sync execution                                                      */
/* ------------------------------------------------------------------ */

/**
 * Runs one claimed synchronization to completion. Never throws: every exit
 * path leaves a terminal, accurate syncStatus and a released lock, and no path
 * sets lastSuccessfulSyncAt unless retrieval AND processing both succeeded.
 *
 * Range scoping: when a window is provided, ONLY accepted
 * submissions whose timestamp falls inside that window are stored. The
 * upstream profile is still verified, and the aggregate snapshot is still
 * refreshed, but no rows are created outside the requested window.
 */
const executeRun = async (integrationId, syncId, trigger, { client, cfg, window: runWindow = null }) => {
  const guard = { _id: integrationId, syncId }; // all writes scoped to our claim
  try {
    await LeetCodeIntegration.updateOne(guard, { $set: { syncStatus: 'syncing' } });
    const integration = await LeetCodeIntegration.findOne(guard);
    if (!integration) return null; // reclaimed elsewhere
    const username = integration.username;
    const startedAt = new Date();

    /* ---- retrieval with bounded retries (Phase 12) ---- */
    let fetched = null;
    let lastError = null;
    for (let attempt = 0; attempt <= cfg.maxRetries; attempt += 1) {
      if (attempt > 0) await sleep(cfg.retryBaseMs * 2 ** (attempt - 1)); // 30s, 60s, 120s…
      try {
        const profile = await client.fetchProfile(username);
        const submissions = await client.fetchRecentSubmissions(username, cfg.windowSize);
        fetched = { profile, submissions };
        break;
      } catch (err) {
        lastError = err;
        const code = err?.code;
        if (code === 'profile_not_found') {
          return finalizeProfileMissing(guard, cfg, err.message);
        }
        if (code === 'rate_limited') {
          return finalizeRateLimited(guard, cfg, err);
        }
        // Retry ONLY transient failures, and never past maxRetries.
        if (code !== 'transient' || attempt === cfg.maxRetries) break;
      }
    }
    if (!fetched) {
      const permanent = lastError?.code !== 'transient';
      return finalizeFailure(guard, cfg, {
        message: lastError?.message || 'Could not reach LeetCode',
        permanent,
      });
    }

    const { profile, submissions } = fetched;

    /* ---- filter-first scope: only store solves inside the requested window ---- */
    const scopeStart = runWindow?.startMs ?? null;
    const scopeEnd = runWindow?.endMs ?? null;

    /* ---- normalize + detect + idempotent upsert (Phase 7/8/9) ---- */
    let newProblems = 0;
    let duplicates = 0;
    const newSlugs = [];

    const acceptedRows = submissions.filter((row) => isAccepted(row.status));
    // One record per unique problem: keep the EARLIEST accepted submission.
    const bySlug = new Map();
    for (const row of acceptedRows) {
      // Filter scope: submissions outside the requested window are ignored.
      if (scopeStart !== null) {
        const ms = row.timestampMs;
        if (!Number.isFinite(ms) || ms < scopeStart || ms >= scopeEnd) continue;
      }
      const prev = bySlug.get(row.slug);
      if (!prev || (row.timestampMs || Infinity) < (prev.timestampMs || Infinity)) {
        bySlug.set(row.slug, row);
      }
    }

    const slugs = [...bySlug.keys()];
    const known = slugs.length
      ? await LeetCodeSolvedProblem.find({ user: integration.user, slug: { $in: slugs } })
          .select({ slug: 1 })
          .lean()
      : [];
    const knownSet = new Set(known.map((doc) => doc.slug));

    for (const row of bySlug.values()) {
      if (knownSet.has(row.slug)) {
        // Identity match: this problem is already stored — SUBMISSION ≠ SOLVED.
        duplicates += 1;
        continue;
      }
      const solvedAt = toSolvedAt(row.timestampMs) || new Date();
      try {
        // Upsert keyed on user+slug: concurrent duplicates resolve at the DB.
        const res = await LeetCodeSolvedProblem.updateOne(
          { user: integration.user, slug: row.slug },
          {
            $setOnInsert: {
              user: integration.user,
              slug: row.slug,
              title: row.title || row.slug,
              url: `https://leetcode.com/problems/${row.slug}/`,
              difficulty: 'unknown', // enriched from upstream below, never guessed
              topics: [],
              language: row.language || '',
              solvedAt, // earliest accepted submission, stored in UTC
              source: 'leetcode_sync',
            },
          },
          { upsert: true }
        );
        if (res.upsertedCount) {
          newProblems += 1;
          newSlugs.push(row.slug);
        } else {
          duplicates += 1; // lost an idempotency race — still exactly one row
        }
      } catch (err) {
        if (err?.code === 11000) duplicates += 1; // duplicate-key safety net
        else throw err;
      }
    }

    /* ---- enrich ONLY new rows (difficulty/topics), bounded and polite ---- */
    let updatedProblems = 0;
    const toEnrich = newSlugs.slice(0, cfg.maxEnrichPerRun);
    for (const slug of toEnrich) {
      try {
        const details = await client.fetchProblemDetails(slug);
        if (!details) continue;
        const res = await LeetCodeSolvedProblem.updateOne(
          { user: integration.user, slug, difficulty: 'unknown' },
          { $set: { difficulty: details.difficulty, topics: details.topics } }
        );
        if (res.modifiedCount) updatedProblems += 1;
      } catch (err) {
        if (err?.code === 'rate_limited') break; // respect upstream; stored rows stay 'unknown'
        if (err?.code === 'profile_not_found') break;
        // Any other enrichment failure: keep 'unknown', the row is still solved.
      }
    }

    /* ---- incremental cursor (Phase 6): newest activity timestamp seen ----
     * The cursor tracks the newest submission OBSERVED (pre-scope), so a
     * month-targeted run still advances the upstream watermark without
     * letting unscoped rows into the store. The targeted month is recorded
     * so the UI can show what the last sync actually covered. */
    const activityTs = submissions
      .map((row) => row.timestampMs)
      .filter((ms) => Number.isFinite(ms) && ms > 0);
    const cursorDate = activityTs.length ? new Date(Math.max(...activityTs)) : integration.cursor?.lastActivityTs || null;

    const completedAt = new Date();
    const result = {
      newProblems,
      updatedProblems,
      duplicates,
      totalSolved: profile.totalSolved,
      trigger,
      month: scopeStart !== null ? runWindow.label : null,
      startedAt,
      completedAt,
    };

    // ---- success: only now is the sync marked successful (Phase 10/11) ----
    await LeetCodeIntegration.updateOne(guard, {
      $set: {
        syncStatus: 'completed',
        status: 'connected',
        lastSyncedAt: completedAt,
        lastSuccessfulSyncAt: completedAt,
        lastSyncError: null,
        lastRunResult: result,
        'cursor.lastActivityTs': cursorDate,
        'cursor.month': scopeStart !== null ? runWindow.label : null,
        upstreamStats: {
          totalSolved: profile.totalSolved,
          easy: profile.easy,
          medium: profile.medium,
          hard: profile.hard,
          languages: profile.languages,
        },
        consecutiveFailures: 0,
        nextRetryAt: null,
        rateLimitedUntil: null,
        permanentFailure: false,
        syncLockAt: null,
        syncLockHolder: null,
      },
    });

    /* ---- notification (Phase 27): only when new problems were detected,
           honouring the student's stored notification preferences ---- */
    if (newProblems > 0) {
      await pushImmediateNotification({
        userId: integration.user,
        category: 'leetcode',
        title: `LeetCode sync completed — ${newProblems} new problem${newProblems === 1 ? '' : 's'} detected.`,
        body: `Acadova found ${newProblems} newly solved problem${newProblems === 1 ? '' : 's'} on your LeetCode profile.`,
        link: '/problems',
      }).catch(() => {
        /* notification delivery must never fail a sync */
      });
    }

    return {
      status: 'completed',
      syncId,
      newProblems,
      updatedProblems,
      duplicates,
      totalSolved: profile.totalSolved,
      startedAt,
      completedAt,
    };
  } catch (err) {
    // Unexpected (e.g. database unavailable): still leave an accurate state.
    console.error('[LeetCode] sync run failed:', err?.message || err);
    return finalizeFailure({ _id: integrationId, syncId }, cfg, {
      message: err?.message || 'Unexpected sync error',
      permanent: false,
    }).catch(() => null);
  }
};

/* ------------------------------------------------------------------ */
/* Public entry points                                                 */
/* ------------------------------------------------------------------ */

/**
 * Manual / initial / scheduled start. Returns immediately with the queue
 * state (Phase 5): a second concurrent start gets `already_running` plus the
 * existing syncId — never a duplicate job.
 */
export const startLeetCodeSync = async ({ userId, trigger = 'manual', window: runWindow = null, client, cfg } = {}) => {
  const config = cfg || leetcodeConfig();
  const integration = await LeetCodeIntegration.findOne({ user: userId });
  if (!integration) return { status: 'not_connected' };

  // Respect an active upstream rate-limit window even for manual requests.
  if (integration.rateLimitedUntil && integration.rateLimitedUntil > new Date()) {
    return { status: 'rate_limited', syncId: integration.syncId, retryAt: integration.rateLimitedUntil };
  }

  const claimed = await claimSync(integration, { windowLabel: runWindow?.label || null });
  if (!claimed) {
    const current = await LeetCodeIntegration.findOne({ user: userId });
    return { status: 'already_running', syncId: current?.syncId || null };
  }

  const run = executeRun(claimed._id, claimed.syncId, trigger, {
    client: client || getClient(),
    cfg: config,
    window: runWindow,
  });
  run.catch(() => {
    /* executeRun already guards every path; belt and braces */
  });
  return { status: 'queued', syncId: claimed.syncId, promise: run };
};

/**
 * Server-restart / hung-worker recovery (Phase 24). `force` (boot time) resets
 * every interrupted run — background promises do not survive a process restart
 * in this single-process architecture — while the periodic sweep only touches
 * locks older than the stale threshold.
 */
export const recoverStaleLeetCodeSyncs = async ({ force = false } = {}) => {
  const cfg = leetcodeConfig();
  const filter = force
    ? { syncStatus: { $in: ['queued', 'syncing'] } }
    : {
        syncStatus: { $in: ['queued', 'syncing'] },
        syncLockAt: { $lte: new Date(Date.now() - cfg.staleLockMs) },
      };
  const res = await LeetCodeIntegration.updateMany(filter, {
    $set: {
      syncStatus: 'failed',
      lastSyncError: 'Sync interrupted (server restart or timeout)',
      syncLockAt: null,
      syncLockHolder: null,
      nextRetryAt: null, // eligible again immediately — recover missed activity (Phase 25)
    },
  });
  return res.modifiedCount || 0;
};

/**
 * Near-real-time scheduler tick. Recovers orphaned locks, then auto-syncs
 * every connected account on the configured 5–10 second cadence — always
 * targeting the CURRENT month. Other months remain strictly student-initiated
 * (month-targeted Sync Now). Runs execute sequentially so upstream is never
 * hammered in parallel (Phase 13); eligibility = connected, not permanently
 * failed, not actively syncing, retry/rate-limit window clear, and outside the
 * minimum gap between runs.
 */
export const leetcodeSyncTick = async ({ client, userIds } = {}) => {
  const cfg = leetcodeConfig();
  const recovered = await recoverStaleLeetCodeSyncs();

  const now = new Date();
  const minGapMs = cfg.minIntervalSeconds * 1000;
  const due = await LeetCodeIntegration.find({
    // Optional scope (used by the test suite) — production calls process every
    // due account, always strictly scoped per user inside startLeetCodeSync.
    ...(Array.isArray(userIds) && userIds.length ? { user: { $in: userIds } } : {}),
    status: 'connected',
    permanentFailure: false,
    syncStatus: { $nin: ['queued', 'syncing'] },
    $and: [
      { $or: [{ lastSuccessfulSyncAt: null }, { lastSuccessfulSyncAt: { $lte: new Date(now.getTime() - minGapMs) } }] },
      { $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: now } }] },
      { $or: [{ rateLimitedUntil: null }, { rateLimitedUntil: { $lte: now } }] },
    ],
  })
    .sort({ lastSuccessfulSyncAt: 1 })
    .limit(cfg.tickBatch);

  let ran = 0;
  // Auto-sync stays deterministic and scoped: it refreshes ONLY the current
  // month window (dedup makes repeats harmless) so already-connected accounts
  // keep their current-period data fresh. History/range pulls stay explicit.
  const currentWindow = resolveSyncWindow({
    month: new Date().toISOString().slice(0, 7),
  });
  for (const integration of due) {
    const run = await startLeetCodeSync({
      userId: integration.user,
      trigger: 'scheduled',
      window: currentWindow,
      client,
      cfg,
    });
    if (run.promise) {
      await run.promise; // sequential: bounded external requests
      ran += 1;
    }
  }
  return { due: due.length, ran, recovered };
};

/** Connect (or reconnect) a username, then kick off the initial sync (Phase 3). */
export const connectLeetCode = async (userId, rawUsername, { client } = {}) => {
  const username = String(rawUsername ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/.test(username)) {
    return {
      httpStatus: 400,
      message: 'Enter a valid LeetCode username (letters, numbers, - or _).',
    };
  }

  const cfg = leetcodeConfig();
  const source = client || getClient();
  let profile;
  try {
    profile = await source.fetchProfile(username);
  } catch (err) {
    if (err?.code === 'profile_not_found') {
      return {
        httpStatus: 404,
        message: `LeetCode user "${username}" was not found. Check the spelling and try again.`,
      };
    }
    if (err?.code === 'rate_limited') {
      return {
        httpStatus: 429,
        message: 'LeetCode is rate limiting requests right now. Wait a few minutes and try again.',
      };
    }
    return { httpStatus: 502, message: `Could not reach LeetCode: ${err?.message || 'network error'}` };
  }

  let integration = await LeetCodeIntegration.findOne({ user: userId });
  const lockFresh =
    integration?.syncLockAt && Date.now() - integration.syncLockAt.getTime() < cfg.staleLockMs;
  if (integration) {
    integration.username = username;
    integration.status = 'connected';
    integration.consecutiveFailures = 0;
    integration.permanentFailure = false;
    integration.nextRetryAt = null;
    integration.rateLimitedUntil = null;
    integration.lastSyncError = null;
    if (!lockFresh) {
      // Safe to clear: no live worker owns this lock.
      integration.syncLockAt = null;
      integration.syncLockHolder = null;
      if (['queued', 'syncing'].includes(integration.syncStatus)) integration.syncStatus = 'idle';
    }
    // Phase 3 step 1 already verified the profile — keep the real stats.
    integration.upstreamStats = {
      totalSolved: profile.totalSolved,
      easy: profile.easy,
      medium: profile.medium,
      hard: profile.hard,
      languages: profile.languages,
    };
    await integration.save();
  } else {
    integration = await LeetCodeIntegration.create({
      user: userId,
      username,
      upstreamStats: {
        totalSolved: profile.totalSolved,
        easy: profile.easy,
        medium: profile.medium,
        hard: profile.hard,
        languages: profile.languages,
      },
    });
  }

  /* No automatic import on connect: the student's selected filter decides
   * what to pull. Connect verifies the profile, snapshots the aggregate
   * counts, and reports awaitingFilter so the UI runs the filter-driven sync. */
  const state = await getLeetCodeState(userId);
  return {
    httpStatus: 200,
    integration: state,
    sync: { status: 'awaiting_filter', syncId: null },
    awaitingFilter: true,
  };
};

/* ------------------------------------------------------------------ */
/* Analytics (Phase 20): derived from stored records + real upstream    */
/* snapshot — nothing fabricated.                                       */
/* ------------------------------------------------------------------ */

const dayKey = (date) => new Date(date).toISOString().slice(0, 10);

const streaksFromDayKeys = (keys, nowDate) => {
  const unique = [...new Set(keys)].sort();
  if (!unique.length) return { current: 0, longest: 0 };
  // Current streak: walk back from today (UTC, stored convention); allow a
  // streak that started yesterday to still count as active today.
  const today = dayKey(nowDate);
  const yesterday = dayKey(new Date(nowDate.getTime() - 24 * 60 * 60 * 1000));
  const set = new Set(unique);
  let current = 0;
  let cursor = set.has(today) ? nowDate : new Date(nowDate.getTime() - 24 * 60 * 60 * 1000);
  if (set.has(dayKey(cursor))) {
    while (set.has(dayKey(cursor))) {
      current += 1;
      cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
    }
  } else if (set.has(yesterday)) {
    // grace: last solve was yesterday, today not yet solved
    cursor = new Date(nowDate.getTime() - 24 * 60 * 60 * 1000);
    while (set.has(dayKey(cursor))) {
      current += 1;
      cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
    }
  }
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const key of unique) {
    if (prev && (new Date(key) - new Date(prev)) / 86400000 === 1) run += 1;
    else run = 1;
    longest = Math.max(longest, run);
    prev = key;
  }
  return { current, longest };
};

export const buildLeetCodeAnalytics = async (userId, { month = null } = {}) => {
  const integration = await LeetCodeIntegration.findOne({ user: userId });
  const allProblems = await LeetCodeSolvedProblem.find({ user: userId })
    .select({ solvedAt: 1, difficulty: 1, topics: 1, language: 1 })
    .lean();

  // Optional month scope (UTC): only the breakdowns are scoped, never totals.
  let monthStart = null;
  let monthEnd = null;
  if (/^\d{4}-\d{2}$/.test(month || '')) {
    const [y, m] = month.split('-').map(Number);
    monthStart = new Date(Date.UTC(y, m - 1, 1));
    monthEnd = new Date(Date.UTC(y, m, 1));
  }
  const problems = monthStart
    ? allProblems.filter((p) => {
        const t = new Date(p.solvedAt).getTime();
        return t >= monthStart.getTime() && t < monthEnd.getTime();
      })
    : allProblems;

  const now = Date.now();
  const weekAgo = now - 7 * 86400000;
  const monthAgo = now - 30 * 86400000;
  const thirtyDaysAgo = monthAgo;

  // Daily buckets: the selected calendar month when scoped, else a rolling 30-day window.
  const daily = [];
  if (monthStart) {
    for (let d = new Date(monthStart); d < monthEnd; d.setUTCDate(d.getUTCDate() + 1)) {
      daily.push({ date: dayKey(d), count: 0 });
    }
  } else {
    for (let i = 29; i >= 0; i -= 1) {
      const date = new Date(now - i * 86400000);
      daily.push({ date: dayKey(date), count: 0 });
    }
  }
  const dailyIndex = new Map(daily.map((entry) => [entry.date, entry]));
  let weekly = 0;
  let monthly = 0;
  // Calendar-window counts for the activity tiles (UTC day/month of now).
  const todayKey = dayKey(new Date(now));
  const thisMonthKey = new Date(now).toISOString().slice(0, 7);
  let todayCount = 0;
  let thisMonthCount = 0;
  const storedDifficulty = { easy: 0, medium: 0, hard: 0, unknown: 0 };
  const topicCounts = {};
  const languageCounts = {};
  const dayKeys = [];

  for (const doc of problems) {
    const solvedMs = new Date(doc.solvedAt).getTime();
    if (Number.isFinite(solvedMs)) {
      dayKeys.push(dayKey(doc.solvedAt));
      const bucket = dailyIndex.get(dayKey(doc.solvedAt));
      if (bucket) bucket.count += 1;
      if (solvedMs >= weekAgo) weekly += 1;
      if (solvedMs >= monthAgo) monthly += 1;
    }
    storedDifficulty[doc.difficulty || 'unknown'] =
      (storedDifficulty[doc.difficulty || 'unknown'] || 0) + 1;
    for (const topic of doc.topics || []) topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    if (doc.language) languageCounts[doc.language] = (languageCounts[doc.language] || 0) + 1;
  }

  // Activity tiles are calendar-window counts over ALL stored rows (never
  // scoped): solved today, solved this calendar month, and all-time total.
  for (const doc of allProblems) {
    const key = dayKey(doc.solvedAt);
    if (key === todayKey) todayCount += 1;
    if (key.startsWith(thisMonthKey)) thisMonthCount += 1;
  }

  const streaks = streaksFromDayKeys(dayKeys, new Date(now));
  const upstream = integration?.upstreamStats;
  const upstreamDifficulty = {
    easy: upstream?.easy || 0,
    medium: upstream?.medium || 0,
    hard: upstream?.hard || 0,
  };

  /* All-time difficulty from LeetCode's own aggregate (whole profile, not
   * just the synced window); falls back to stored rows when unavailable. */
  const allTimeDifficulty =
    upstream && (upstream.easy || upstream.medium || upstream.hard)
      ? {
          easy: upstream.easy || 0,
          medium: upstream.medium || 0,
          hard: upstream.hard || 0,
          total: (upstream.easy || 0) + (upstream.medium || 0) + (upstream.hard || 0),
          source: 'leetcode_profile',
        }
      : {
          easy: 0,
          medium: 0,
          hard: 0,
          total: 0,
          source: 'stored_rows',
        };
  if (allTimeDifficulty.source === 'stored_rows') {
    for (const doc of allProblems) {
      const d = doc.difficulty;
      if (d === 'easy' || d === 'medium' || d === 'hard') {
        allTimeDifficulty[d] += 1;
        allTimeDifficulty.total += 1;
      }
    }
  }

  /* This-month difficulty: derived ONLY from stored rows inside the selected
   * (or current) month — real synced records, never upstream aggregates. */
  const effectiveMonth = validMonth(month) || new Date().toISOString().slice(0, 7);
  const [mY, mM] = effectiveMonth.split('-').map(Number);
  const effStart = Date.UTC(mY, mM - 1, 1);
  const effEnd = Date.UTC(mY, mM, 1);
  const monthDifficulty = { easy: 0, medium: 0, hard: 0, total: 0, month: effectiveMonth };
  for (const doc of allProblems) {
    const t = new Date(doc.solvedAt).getTime();
    if (!Number.isFinite(t) || t < effStart || t >= effEnd) continue;
    const d = doc.difficulty;
    if (d === 'easy' || d === 'medium' || d === 'hard') {
      monthDifficulty[d] += 1;
      monthDifficulty.total += 1;
    }
  }

  return {
    connected: Boolean(integration),
    username: integration?.username || null,
    month: monthStart ? month : null, // null = whole-history scope
    // Real LeetCode aggregate (profile submit stats), fallback to stored rows.
    totalSolved: upstream?.totalSolved || problems.length,
    difficulty: upstreamDifficulty,
    difficultyStored: storedDifficulty,
    allTimeDifficulty,
    monthDifficulty,
    storedCount: allProblems.length, // always the full unique count
    scopedCount: problems.length,
    topicCounts: Object.entries(topicCounts)
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count),
    languageCounts: (upstream?.languages || []).length
      ? upstream.languages
      : Object.entries(languageCounts).map(([name, count]) => ({ name, count })),
    activity: { daily, weekly, monthly, today: todayCount, thisMonth: thisMonthCount },
    streaks,
    sync: leetcodeStatusPayload(integration),
  };
};

export { LeetCodeError };
