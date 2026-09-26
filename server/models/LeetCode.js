import mongoose from 'mongoose';

/* ------------------------------------------------------------------ */
/* LeetCodeIntegration — one connected account per student             */
/*                                                                     */
/* Lifecycle (Phase 2):                                                */
/*   CONNECTED → INITIAL_SYNC → SYNCED → SCHEDULED_SYNC →              */
/*   NEW_ACTIVITY → UPSERT → SYNCED                                    */
/* Failure: SYNCING → FAILED → RETRY → SYNCED / FAILED                 */
/*                                                                     */
/* `syncStatus` exposes the current state: idle, queued, syncing,      */
/* completed, failed, rate_limited. Lock fields make concurrent        */
/* starts mutually exclusive and self-healing if a worker dies.        */
/* ------------------------------------------------------------------ */

export const LEETCODE_SYNC_STATES = [
  'idle',
  'queued',
  'syncing',
  'completed',
  'failed',
  'rate_limited',
];

const leetcodeIntegrationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, // one connected LeetCode account per student
      index: true,
    },
    // Public LeetCode handle only — never a password or session cookie.
    username: { type: String, required: true, trim: true },
    // 'connected' | 'error' — 'error' means the upstream profile could not be
    // validated (e.g. renamed/deleted); automatic sync stops until reconnect.
    status: { type: String, enum: ['connected', 'error'], default: 'connected', index: true },
    syncStatus: { type: String, enum: LEETCODE_SYNC_STATES, default: 'idle', index: true },
    syncId: { type: String, default: null },
    syncStartedAt: { type: Date, default: null },
    // Any finished attempt (success or failure) — scheduler cadence uses the
    // successful timestamp below, never this one.
    lastSyncedAt: { type: Date, default: null },
    lastSuccessfulSyncAt: { type: Date, default: null },
    lastSyncError: { type: String, default: null },
    lastRunResult: {
      newProblems: { type: Number, default: 0 },
      updatedProblems: { type: Number, default: 0 },
      duplicates: { type: Number, default: 0 },
      totalSolved: { type: Number, default: 0 },
      trigger: { type: String, default: 'scheduled' },
      // The month window this run targeted (YYYY-MM), null = unscooped.
      month: { type: String, default: null },
      startedAt: { type: Date, default: null },
      completedAt: { type: Date, default: null },
    },
    // Incremental sync starting point. LeetCode's public feed has no numeric
    // cursor, so we keep the newest activity timestamp and still dedupe every
    // row by stable identity — timestamps alone never decide what is stored.
    cursor: {
      lastActivityTs: { type: Date, default: null },
      // The month window this integration last synced/targeted (YYYY-MM).
      // Manual syncs always target an explicit month; the scheduler targets
      // the current month.
      month: { type: String, default: null, match: /^\d{4}-\d{2}$/ },
    },
    consecutiveFailures: { type: Number, default: 0 },
    // Earliest time an AUTOMATIC attempt may run again (backoff / rate limit).
    nextRetryAt: { type: Date, default: null },
    rateLimitedUntil: { type: Date, default: null },
    // Non-retryable upstream failure (malformed response, rejected request):
    // automatic sync stays off until the student manually syncs or reconnects.
    permanentFailure: { type: Boolean, default: false },
    // Snapshot of LeetCode's own aggregate counts (real upstream data).
    upstreamStats: {
      totalSolved: { type: Number, default: 0 },
      easy: { type: Number, default: 0 },
      medium: { type: Number, default: 0 },
      hard: { type: Number, default: 0 },
      languages: [{ _id: false, name: String, count: Number }],
    },
    // Sync lock — claimed atomically, expires so a crashed worker cannot
    // block the account forever.
    syncLockAt: { type: Date, default: null },
    syncLockHolder: { type: String, default: null },
  },
  { timestamps: true }
);

/* ------------------------------------------------------------------ */
/* LeetCodeSolvedProblem — ONE record per unique solved problem        */
/*                                                                     */
/* Submissions are not problems: two Sum solved twice is ONE row.      */
/* The compound unique index is the idempotency guarantee — running    */
/* the same sync twice can never duplicate a solved problem.           */
/* ------------------------------------------------------------------ */

const leetcodeSolvedProblemSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Canonical identity from the upstream data source (LeetCode titleSlug).
    slug: { type: String, required: true, trim: true, lowercase: true },
    title: { type: String, required: true, trim: true },
    url: { type: String, default: '' },
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard', 'unknown'],
      default: 'unknown', // only set from upstream problem details, never guessed
      index: true,
    },
    topics: [{ type: String }],
    language: { type: String, default: '' },
    // Earliest accepted submission seen for this problem (UTC).
    solvedAt: { type: Date, required: true, index: true },
    source: { type: String, default: 'leetcode_sync' },
  },
  { timestamps: true }
);

// Conceptual key `userId + problemSlug` — enforced by the database, not only
// by application checks (idempotency survives concurrent syncs).
leetcodeSolvedProblemSchema.index({ user: 1, slug: 1 }, { unique: true });

export const LeetCodeIntegration = mongoose.model(
  'LeetCodeIntegration',
  leetcodeIntegrationSchema
);
export const LeetCodeSolvedProblem = mongoose.model(
  'LeetCodeSolvedProblem',
  leetcodeSolvedProblemSchema
);
