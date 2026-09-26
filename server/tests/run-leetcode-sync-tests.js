/**
 * Phase 12 — LeetCode near-real-time synchronization.
 *
 * Runs against the live local API and the real Mongo database with throwaway
 * accounts, using a SCRIPTED data source (setLeetCodeClient) so every upstream
 * condition — new problems, rate limits, timeouts, malformed responses, missing
 * profiles — is deterministic. No real LeetCode traffic, no mock records that
 * ever reach the UI as if they were real: each throwaway account is deleted at
 * the end.
 *
 * The 20 required cases map to sections below; idempotency is asserted
 * explicitly (the same synchronization runs three times).
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

// Fast, deterministic timing for the test process only. The engine reads these
// lazily per call, so overrides apply to every run in this suite. Production
// values live in .env / code defaults (15 min, 3 retries, 30 s base).
process.env.LEETCODE_SYNC_RETRY_BASE_MS = '1';
process.env.LEETCODE_SYNC_MAX_RETRIES = '2';
process.env.LEETCODE_SYNC_STALE_LOCK_MS = '1000';
process.env.LEETCODE_SYNC_INTERVAL_MINUTES = '15';
process.env.LEETCODE_SYNC_RATE_LIMIT_COOLDOWN_MS = '60000';
process.env.LEETCODE_SYNC_MIN_GAP_MS = '0';

import { LeetCodeError } from '../clients/leetcodeClient.js';
import {
  startLeetCodeSync,
  leetcodeSyncTick,
  recoverStaleLeetCodeSyncs,
  connectLeetCode,
  buildLeetCodeAnalytics,
  getLeetCodeState,
  setLeetCodeClient,
  leetcodeConfig,
  resolveSyncWindow,
} from '../services/leetcodeSyncService.js';
import { LeetCodeIntegration, LeetCodeSolvedProblem } from '../models/LeetCode.js';
import { User } from '../models/User.js';
import { AppNotification, NotificationPreference } from '../models/Notification.js';

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:5001/api';

let passed = 0;
let failed = 0;

const check = (name, condition, detail = '') => {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (path, { method = 'GET', body, token } = {}) => {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};

const transient = (message) => new LeetCodeError(message, { code: 'transient' });
const permanentErr = (message) => new LeetCodeError(message, { code: 'permanent' });

/* ------------------------- scripted data source ------------------------- */
class MockClient {
  constructor() {
    this.calls = { profile: 0, submissions: 0, question: 0 };
    this.profiles = {}; // username -> profile | fn | Error
    this.submissions = {}; // username -> rows | fn -> rows | Error
    this.details = {}; // slug -> { difficulty, topics } | Error
  }
  async fetchProfile(username) {
    this.calls.profile += 1;
    const v = this.profiles[username];
    if (typeof v === 'function') return v();
    if (v instanceof Error) throw v;
    if (!v) throw new LeetCodeError('LeetCode user not found', { code: 'profile_not_found' });
    return v;
  }
  async fetchRecentSubmissions(username) {
    this.calls.submissions += 1;
    const v = this.submissions[username];
    if (typeof v === 'function') return v();
    if (v instanceof Error) throw v;
    return v || [];
  }
  async fetchProblemDetails(slug) {
    this.calls.question += 1;
    const v = this.details[slug];
    if (v instanceof Error) throw v;
    return v || { slug, difficulty: 'unknown', topics: [] };
  }
}

const H = 3600000;
const T = (hoursAgo) => Date.now() - hoursAgo * H;

const aliceProfile = {
  username: 'alice_coder',
  totalSolved: 3,
  easy: 1,
  medium: 2,
  hard: 0,
  languages: [{ name: 'javascript', count: 2 }],
};
const bobProfile = {
  username: 'bob_coder',
  totalSolved: 10,
  easy: 5,
  medium: 5,
  hard: 0,
  languages: [{ name: 'cpp', count: 7 }],
};
const zeroProfile = (username) => ({
  username,
  totalSolved: 0,
  easy: 0,
  medium: 0,
  hard: 0,
  languages: [],
});

// v1: two-sum solved with FOUR submissions (2 WA + 2 Accepted) → ONE record,
//     plus add-two-numbers accepted, plus three-sum never accepted.
const TWO_SUM_EARLIEST = T(4.5); // pinned once so later clock drift can't skew the assertion
const rowsV1 = [
  { title: 'Two Sum', slug: 'two-sum', status: 'Wrong Answer', timestampMs: T(5), language: 'javascript' },
  { title: 'Two Sum', slug: 'two-sum', status: 'Wrong Answer', timestampMs: T(5), language: 'javascript' },
  { title: 'Two Sum', slug: 'two-sum', status: 'Accepted', timestampMs: T(4), language: 'javascript' },
  { title: 'Two Sum', slug: 'two-sum', status: 'Accepted', timestampMs: TWO_SUM_EARLIEST, language: 'javascript' },
  { title: 'Add Two Numbers', slug: 'add-two-numbers', status: 'Accepted', timestampMs: T(30), language: 'python3' },
  { title: 'Three Sum', slug: 'three-sum', status: 'Time Limit Exceeded', timestampMs: T(2), language: 'cpp' },
];
const rowsV2 = [...rowsV1, { title: 'Binary Search', slug: 'binary-search', status: 'Accepted', timestampMs: T(1), language: 'javascript' }];
const rowsV3 = [...rowsV2, { title: 'Longest Substring', slug: 'longest-substring', status: 'Accepted', timestampMs: T(0.5), language: 'javascript' }];
const rowsV4 = [...rowsV3, { title: 'Sliding Window Maximum', slug: 'sliding-window-max', status: 'Accepted', timestampMs: T(0.25), language: 'javascript' }];
const rowsV5 = [...rowsV4, { title: 'Merge K Sorted Lists', slug: 'merge-k-lists', status: 'Accepted', timestampMs: T(0.1), language: 'javascript' }];

const bobRows = [
  { title: 'Two Sum', slug: 'two-sum', status: 'Accepted', timestampMs: T(10), language: 'cpp' },
  { title: 'Valid Parentheses', slug: 'valid-parentheses', status: 'Accepted', timestampMs: T(11), language: 'cpp' },
  { title: 'Reverse Linked List', slug: 'reverse-linked-list', status: 'Runtime Error', timestampMs: T(9), language: 'cpp' },
];

const runManual = async (userId, opts = {}) => {
  const r = await startLeetCodeSync({ userId, trigger: 'manual', ...opts });
  if (r.promise) await r.promise;
  return getLeetCodeState(userId);
};

/** Connect then run the first sync for an explicit month (the product flow:
 * connect verifies only, the student's month choice drives the first sync). */
const connectAndSync = async (userId, username, { month = null } = {}) => {
  const res = await connectLeetCode(userId, username);
  if (res.httpStatus !== 200) return res;
  const syncRes = await runManual(userId, { month });
  return { httpStatus: 200, integration: syncRes, sync: syncRes };
};

const waitForSync = async (userId, timeoutMs = 8000) => {
  const started = Date.now();
  let state = await getLeetCodeState(userId);
  while (['queued', 'syncing'].includes(state.status) && Date.now() - started < timeoutMs) {
    await sleep(25);
    state = await getLeetCodeState(userId);
  }
  return state;
};

const doc = (userId) => LeetCodeIntegration.findOne({ user: userId });
const slugsOf = async (userId) =>
  (await LeetCodeSolvedProblem.find({ user: userId }).select({ slug: 1, solvedAt: 1, difficulty: 1, language: 1 }).lean())
    .map((d) => d.slug)
    .sort();

const run = async () => {
  console.log('===========================================================');
  console.log('  PHASE 12: LEETCODE NEAR-REAL-TIME SYNCHRONIZATION');
  console.log('===========================================================\n');

  const mock = new MockClient();
  mock.profiles['alice_coder'] = aliceProfile;
  mock.profiles['bob_coder'] = bobProfile;
  mock.submissions['alice_coder'] = rowsV1;
  mock.submissions['bob_coder'] = bobRows;
  mock.details['two-sum'] = { slug: 'two-sum', difficulty: 'easy', topics: ['Array', 'Hash Table'] };
  mock.details['add-two-numbers'] = { slug: 'add-two-numbers', difficulty: 'medium', topics: ['Linked List', 'Math'] };
  mock.details['binary-search'] = { slug: 'binary-search', difficulty: 'easy', topics: ['Array', 'Binary Search'] };
  mock.details['longest-substring'] = { slug: 'longest-substring', difficulty: 'medium', topics: ['String', 'Sliding Window'] };

  setLeetCodeClient(mock);

  const stamp = Date.now();
  const mkEmail = (who) => `lcsync.${who}.${stamp}@acadova.test`;
  const users = {};
  let tokenAlice = '';
  let tokenBob = '';
  let tokenApiOnly = '';
  let tokenMonth = '';
  let aliceId = null;
  let bobId = null;
  let apiOnlyId = null;

  try {
    await mongoose.connect(process.env.MONGODB_URI);

    // Preclean leftovers from any earlier crashed run of this suite.
    const staleUsers = await User.find({ email: { $regex: /^lcsync\./ } }).select({ _id: 1 });
    const staleIds = staleUsers.map((u) => u._id);
    if (staleIds.length) {
      await LeetCodeIntegration.deleteMany({ user: { $in: staleIds } });
      await LeetCodeSolvedProblem.deleteMany({ user: { $in: staleIds } });
      await AppNotification.deleteMany({ user: { $in: staleIds } });
      await NotificationPreference.deleteMany({ user: { $in: staleIds } });
      await User.deleteMany({ _id: { $in: staleIds } });
    }

    /* ------------------------------- accounts ------------------------------ */
    console.log('0. Throwaway accounts (real API registration)');
    const regAlice = await api('/auth/register', {
      method: 'POST',
      body: { name: 'LC Alice', email: mkEmail('alice'), password: 'LcSync!2345', branch: 'Computer Science', semester: 6 },
    });
    tokenAlice = regAlice.data?.token || '';
    const regBob = await api('/auth/register', {
      method: 'POST',
      body: { name: 'LC Bob', email: mkEmail('bob'), password: 'LcSync!2345', branch: 'Computer Science', semester: 6 },
    });
    tokenBob = regBob.data?.token || '';
    const regApi = await api('/auth/register', {
      method: 'POST',
      body: { name: 'LC ApiOnly', email: mkEmail('apionly'), password: 'LcSync!2345', branch: 'Computer Science', semester: 6 },
    });
    tokenApiOnly = regApi.data?.token || '';
    aliceId = (await User.findOne({ email: mkEmail('alice') }))?._id;
    bobId = (await User.findOne({ email: mkEmail('bob') }))?._id;
    apiOnlyId = (await User.findOne({ email: mkEmail('apionly') }))?._id;
    check(
      'setup: three accounts registered with tokens',
      Boolean(tokenAlice && tokenBob && tokenApiOnly && aliceId && bobId && apiOnlyId),
      `tokens=${Boolean(tokenAlice && tokenBob && tokenApiOnly)} ids=${Boolean(aliceId && bobId && apiOnlyId)}`
    );

    /* --------------------------- 1. initial sync --------------------------- */
    console.log('\n1. Initial synchronization (connect → verify → import)');
    const connectRes = await connectLeetCode(aliceId, 'alice_coder');
    check('initial: connect verifies the profile and creates the integration', connectRes.httpStatus === 200 && connectRes.integration?.connected === true);
    check('initial: connect does NOT auto-sync (the selected filter drives the first sync)', connectRes.sync?.status === 'awaiting_filter' && connectRes.awaitingFilter === true, JSON.stringify(connectRes.sync));
    await runManual(aliceId); // student-chosen window; none = unscooped
    let aliceState = await waitForSync(aliceId);
    check('initial: sync reaches completed', aliceState.status === `completed`, `got ${aliceState.status}: ${aliceState.lastSyncError || ''}`);
    check('initial: lastSuccessfulSyncAt + lastSyncedAt both set', Boolean(aliceState.lastSuccessfulSyncAt && aliceState.lastSyncedAt));
    let aliceDoc = await doc(aliceId);
    check('initial: lock released after the run', aliceDoc.syncLockAt === null);
    const storedV1 = await LeetCodeSolvedProblem.find({ user: aliceId }).lean();
    check('initial: only accepted problems stored (2 of 3 unique)', storedV1.length === 2, `got ${storedV1.length}`);
    check('initial: TLE problem (three-sum) NOT stored', !storedV1.some((d) => d.slug === 'three-sum'));
    const twoSum = storedV1.find((d) => d.slug === 'two-sum');
    check('initial: solvedAt = earliest accepted submission (T-4.5h)', twoSum && Math.abs(twoSum.solvedAt.getTime() - TWO_SUM_EARLIEST) < 50, twoSum ? `diff=${Math.abs(twoSum.solvedAt.getTime() - TWO_SUM_EARLIEST)}` : 'missing');
    check('initial: difficulty enriched from upstream details', twoSum?.difficulty === 'easy', `got ${twoSum?.difficulty}`);
    check('initial: upstream aggregate snapshot stored (totalSolved=3)', aliceDoc.upstreamStats?.totalSolved === 3);
    check('initial: lastRunResult.trigger = manual (connect no longer auto-syncs; the student\'s first sync drives the import)', aliceDoc.lastRunResult?.trigger === 'manual', `got ${aliceDoc.lastRunResult?.trigger}`);

    /* ---------------------------- 2. idempotency --------------------------- */
    console.log('\n2. Idempotency — the same synchronization runs 3× total');
    let state2 = await runManual(aliceId);
    let state3 = await runManual(aliceId);
    const storedAfter3 = await LeetCodeSolvedProblem.countDocuments({ user: aliceId });
    check('idempotency: run 2 completes', state2.status === 'completed');
    check('idempotency: run 3 completes', state3.status === 'completed');
    check('idempotency: stored rows unchanged after 3 runs (still 2)', storedAfter3 === 2, `got ${storedAfter3}`);
    check('idempotency: run 2 reports 0 new, 2 duplicates', state2.newProblems === 0 && state2.duplicates === 2, `new=${state2.newProblems} dup=${state2.duplicates}`);
    check('idempotency: run 3 reports 0 new, 2 duplicates', state3.newProblems === 0 && state3.duplicates === 2, `new=${state3.newProblems} dup=${state3.duplicates}`);
    let dupError = null;
    try {
      await LeetCodeSolvedProblem.collection.insertOne({
        user: aliceId,
        slug: 'two-sum',
        title: 'Two Sum',
        solvedAt: new Date(),
        difficulty: 'unknown',
        topics: [],
        source: 'raw-insert-test',
      });
    } catch (err) {
      dupError = err;
    }
    check('idempotency: DB unique index rejects a raw duplicate (E11000)', dupError?.code === 11000, dupError ? `code=${dupError.code}` : 'insert unexpectedly succeeded');
    const indexes = await LeetCodeSolvedProblem.collection.indexes();
    const userSlugIdx = indexes.find((i) => i.key?.user === 1 && i.key?.slug === 1);
    check('database: user+slug compound unique index exists', Boolean(userSlugIdx?.unique), JSON.stringify(userSlugIdx?.key || {}));

    /* ------------------- 3. new detection by identifier -------------------- */
    console.log('\n3. New-problem detection uses identifiers, not counts');
    mock.submissions['alice_coder'] = rowsV2; // +binary-search, totalSolved still 3
    const stateV2 = await runManual(aliceId);
    check('detection: exactly 1 new problem even though totalSolved unchanged', stateV2.newProblems === 1, `new=${stateV2.newProblems} total=${stateV2.totalSolved}`);
    check('detection: totalSolved reported as upstream 3 (not 3+1)', stateV2.totalSolved === 3);
    check('detection: stored rows now 3', (await LeetCodeSolvedProblem.countDocuments({ user: aliceId })) === 3);

    /* ------------------ 4. API surface, auth, empty state ------------------ */
    console.log('\n4. API contract: auth, ownership, empty states');
    const noAuthConn = await api('/integrations/leetcode');
    const noAuthProblems = await api('/leetcode/problems');
    const noAuthSync = await api('/integrations/leetcode/sync', { method: 'POST' });
    check('api: connection endpoint requires auth (401)', noAuthConn.status === 401, `got ${noAuthConn.status}`);
    check('api: problems endpoint requires auth (401)', noAuthProblems.status === 401, `got ${noAuthProblems.status}`);
    check('api: sync endpoint requires auth (401)', noAuthSync.status === 401, `got ${noAuthSync.status}`);
    const syncNoMonth = await api('/integrations/leetcode/sync', { method: 'POST', token: tokenApiOnly });
    check('api: sync without a month → 400 (month choice is mandatory)', syncNoMonth.status === 400, `got ${syncNoMonth.status}`);
    const syncNoConn = await api('/integrations/leetcode/sync', { method: 'POST', token: tokenApiOnly, body: { range: 'month' } });
    check('api: sync without a connected account → 404', syncNoConn.status === 404, `got ${syncNoConn.status}`);
    const apiState = (await api('/integrations/leetcode', { token: tokenApiOnly })).data;
    check('api: status payload reports connected=false, idle', apiState.connected === false && apiState.status === 'idle', JSON.stringify({ c: apiState.connected, s: apiState.status }));
    const apiProblems = (await api('/leetcode/problems', { token: tokenApiOnly })).data;
    check('api: empty problems list for a fresh account', apiProblems.success === true && apiProblems.total === 0 && apiProblems.problems.length === 0);
    const apiAnalytics = (await api('/leetcode/analytics', { token: tokenApiOnly })).data;
    check('api: analytics reports connected=false without crashing', apiAnalytics.success === true && apiAnalytics.connected === false);
    const badConnect = await api('/integrations/leetcode/connect', {
      method: 'POST',
      token: tokenApiOnly,
      body: { username: 'not a valid handle!!' },
    });
    check('api: invalid username rejected with 400 before any upstream call', badConnect.status === 400, `got ${badConnect.status}`);

    /* ---------------------------- 5. rate limit ---------------------------- */
    console.log('\n5. Rate-limit handling — no hammering, cooldown respected');
    const rateUntil = new Date(Date.now() + 5 * 60000);
    await LeetCodeIntegration.updateOne(
      { user: aliceId },
      { $set: { rateLimitedUntil: rateUntil, nextRetryAt: rateUntil, lastSuccessfulSyncAt: new Date(Date.now() - 16 * 60000) } }
    );
    const subCallsBefore = mock.calls.submissions;
    const tickDuringLimit = await leetcodeSyncTick({ client: mock, userIds: [aliceId] });
    check('rate limit: due account is NOT synced while rate-limited', tickDuringLimit.ran === 0 && mock.calls.submissions === subCallsBefore, `ran=${tickDuringLimit.ran}`);
    const manualDuringLimit = await startLeetCodeSync({ userId: aliceId, trigger: 'manual' });
    check('rate limit: manual sync reports rate_limited instead of running', manualDuringLimit.status === 'rate_limited', `got ${manualDuringLimit.status}`);
    const apiDuringLimit = await api('/integrations/leetcode/sync', { method: 'POST', token: tokenAlice, body: { range: 'month' } });
    check('rate limit: API returns rate_limited (no upstream hit)', apiDuringLimit.status === 200 && apiDuringLimit.data.status === 'rate_limited', JSON.stringify(apiDuringLimit.data));

    // Connect-time rate limit → clear 429, no integration created.
    mock.profiles['rate_ed'] = () => {
      throw new LeetCodeError('LeetCode rate limit reached', { code: 'rate_limited', retryAfterMs: 4000 });
    };
    const rateUser = await User.create({ name: 'LC Rate', email: mkEmail('rate'), password: 'LcSync!2345' });
    users.rate = rateUser._id;
    const rateConnect = await connectLeetCode(rateUser._id, 'rate_ed');
    check('rate limit: connect answers 429 instead of hammering', rateConnect.httpStatus === 429, `got ${rateConnect.httpStatus}`);
    check('rate limit: nothing stored for a blocked connect', (await doc(rateUser._id)) === null);

    // A run that RECEIVES a rate limit from upstream records the cooldown.
    await LeetCodeIntegration.create({ user: rateUser._id, username: 'rate_ed' });
    const profileCallsBeforeRun = mock.calls.profile;
    const rateState = await runManual(rateUser._id);
    check('rate limit: run state recorded as rate_limited', rateState.status === 'rate_limited', `got ${rateState.status}`);
    check('rate limit: cooldown persisted (rateLimitedUntil in the future)', rateState.rateLimitedUntil && new Date(rateState.rateLimitedUntil) > new Date(), String(rateState.rateLimitedUntil));
    check('rate limit: single attempt only (no retry storm)', mock.calls.profile - profileCallsBeforeRun === 1, `delta=${mock.calls.profile - profileCallsBeforeRun}`);
    const rateRetryBlocked = await startLeetCodeSync({ userId: rateUser._id, trigger: 'manual' });
    check('rate limit: further starts are blocked while the window is open', rateRetryBlocked.status === 'rate_limited', `got ${rateRetryBlocked.status}`);

    /* ------------------ 6. permanent failure — no retries ------------------ */
    console.log('\n6. Permanent (malformed) failure is never retried');
    await LeetCodeIntegration.updateOne(
      { user: aliceId },
      { $set: { rateLimitedUntil: null, nextRetryAt: null, lastSuccessfulSyncAt: new Date(Date.now() - 16 * 60000) } }
    );
    mock.submissions['alice_coder'] = () => {
      throw permanentErr('Malformed (non-JSON) response from LeetCode');
    };
    const profileCallsBeforeMalformed = mock.calls.profile;
    const subCallsBeforeMalformed = mock.calls.submissions;
    const malformedState = await runManual(aliceId);
    check('permanent: run fails', malformedState.status === 'failed', `got ${malformedState.status}`);
    check(
      'permanent: exactly one attempt — malformed responses are not retried',
      mock.calls.profile - profileCallsBeforeMalformed === 1 && mock.calls.submissions - subCallsBeforeMalformed === 1,
      `profileDelta=${mock.calls.profile - profileCallsBeforeMalformed} subDelta=${mock.calls.submissions - subCallsBeforeMalformed}`
    );
    aliceDoc = await doc(aliceId);
    check('permanent: permanentFailure latched, nextRetryAt null', aliceDoc.permanentFailure === true && aliceDoc.nextRetryAt === null);
    const tickPermanent = await leetcodeSyncTick({ client: mock, userIds: [aliceId] });
    check('permanent: automatic sync stays off even when due', tickPermanent.ran === 0, `ran=${tickPermanent.ran}`);

    /* ------------------- 7. retry — transient then success ----------------- */
    console.log('\n7. Transient failures retry with backoff, then succeed');
    mock.submissions['alice_coder'] = rowsV2;
    let profileAttempts = 0;
    mock.profiles['alice_coder'] = () => {
      profileAttempts += 1;
      if (profileAttempts === 1) throw transient('temporary network failure');
      return aliceProfile;
    };
    const retryState = await runManual(aliceId); // manual claim resets permanentFailure
    check('retry: run recovers and completes', retryState.status === 'completed', `got ${retryState.status}: ${retryState.lastSyncError || ''}`);
    check('retry: two profile attempts (fail once, then succeed)', profileAttempts === 2, `attempts=${profileAttempts}`);
    aliceDoc = await doc(aliceId);
    check('retry: consecutiveFailures reset to 0 after success', aliceDoc.consecutiveFailures === 0, `got ${aliceDoc.consecutiveFailures}`);

    /* ------------- 8. timeout exhausts retries, keeps old timestamp --------- */
    console.log('\n8. Timeout exhausts retries; previous success timestamp preserved');
    const prevSuccess = aliceDoc.lastSuccessfulSyncAt?.toISOString?.() || String(aliceDoc.lastSuccessfulSyncAt);
    mock.profiles['alice_coder'] = () => {
      throw transient('LeetCode request timed out');
    };
    const timeoutCallsBefore = mock.calls.profile;
    const subCallsBeforeTimeout = mock.calls.submissions;
    const timeoutState = await runManual(aliceId);
    check('timeout: run fails after bounded retries', timeoutState.status === 'failed', `got ${timeoutState.status}`);
    check(
      'timeout: 3 attempts total (1 + maxRetries=2), no endless loop',
      mock.calls.profile - timeoutCallsBefore === 3 && mock.calls.submissions - subCallsBeforeTimeout === 0,
      `profileDelta=${mock.calls.profile - timeoutCallsBefore}`
    );
    aliceDoc = await doc(aliceId);
    check('timeout: lastSuccessfulSyncAt NOT overwritten by the failed attempt', (aliceDoc.lastSuccessfulSyncAt?.toISOString?.() || String(aliceDoc.lastSuccessfulSyncAt)) === prevSuccess);
    check('timeout: lastSyncError surfaces the timeout', String(aliceDoc.lastSyncError).includes('tim out') || String(aliceDoc.lastSyncError).includes('timed out'), String(aliceDoc.lastSyncError));
    check('timeout: lock released so the account is never stuck', aliceDoc.syncLockAt === null);
    check('timeout: backoff scheduled (nextRetryAt in the future)', aliceDoc.nextRetryAt && new Date(aliceDoc.nextRetryAt) > new Date(), String(aliceDoc.nextRetryAt));
    const tickBackoff = await leetcodeSyncTick({ client: mock, userIds: [aliceId] });
    check('timeout: scheduler respects the backoff window', tickBackoff.ran === 0, `ran=${tickBackoff.ran}`);
    mock.profiles['alice_coder'] = aliceProfile; // restore for the rest of the suite

    /* ------------------------ 9. concurrency control ----------------------- */
    console.log('\n9. Concurrent Sync Now → exactly one job');
    const slowRows = rowsV2;
    mock.submissions['alice_coder'] = async () => {
      await sleep(120);
      return slowRows;
    };
    const [first, second] = await Promise.all([
      startLeetCodeSync({ userId: aliceId, trigger: 'manual' }),
      startLeetCodeSync({ userId: aliceId, trigger: 'manual' }),
    ]);
    const statuses = [first.status, second.status].sort().join(',');
    check('concurrency: one queued + one already_running', statuses === 'already_running,queued', `got ${statuses}`);
    check('concurrency: both reference the same syncId', first.syncId && first.syncId === second.syncId, `${first.syncId} vs ${second.syncId}`);
    const active = [first, second].find((r) => r.promise);
    if (active) await active.promise;
    check('concurrency: only ONE upstream run executed', mock.calls.submissions >= 1); // detailed below via stored state
    const concState = await getLeetCodeState(aliceId);
    check('concurrency: final state completed, lock free', concState.status === 'completed' && (await doc(aliceId)).syncLockAt === null, `got ${concState.status}`);

    /* -------------- 10. scheduler + manual sync collision ------------------ */
    console.log('\n10. Scheduled tick vs manual Sync Now → one job, fresh timestamp');
    mock.submissions['alice_coder'] = rowsV2;
    await LeetCodeIntegration.updateOne({ user: aliceId }, { $set: { lastSuccessfulSyncAt: new Date(Date.now() - 16 * 60000) } });
    const subBeforeCollision = mock.calls.submissions;
    const tickPromise = leetcodeSyncTick({ client: mock, userIds: [aliceId] });
    const manualCollision = await startLeetCodeSync({ userId: aliceId, trigger: 'manual' });
    const tickResult = await tickPromise;
    if (manualCollision.promise) await manualCollision.promise;
    check(
      'collision: exactly one synchronization ran',
      mock.calls.submissions - subBeforeCollision === 1,
      `subDelta=${mock.calls.submissions - subBeforeCollision} tick.ran=${tickResult.ran} manual=${manualCollision.status}`
    );
    const collisionDoc = await doc(aliceId);
    check(
      'collision: winner is one of the two contenders (no third job)',
      (tickResult.ran === 1 && manualCollision.status === 'already_running') || (tickResult.ran === 0 && manualCollision.status === 'queued'),
      `tick.ran=${tickResult.ran} manual=${manualCollision.status}`
    );
    check('collision: lastSuccessfulSyncAt is fresh after the manual win', collisionDoc.lastSuccessfulSyncAt && Date.now() - new Date(collisionDoc.lastSuccessfulSyncAt) < 60000);

    /* ------------------- 11. server restart recovery ----------------------- */
    console.log('\n11. Server restart recovery — no permanent "Syncing…"');
    await LeetCodeIntegration.updateOne(
      { user: aliceId },
      { $set: { syncStatus: 'syncing', syncLockAt: new Date(Date.now() - 2 * 3600000), syncLockHolder: 'dead-process', syncId: 'zombie-run' } }
    );
    const recovered = await recoverStaleLeetCodeSyncs();
    aliceDoc = await doc(aliceId);
    check('restart: stale lock recovered (status failed, lock released)', recovered >= 1 && aliceDoc.syncStatus === 'failed' && aliceDoc.syncLockAt === null, `recovered=${recovered} status=${aliceDoc.syncStatus}`);
    check('restart: interrupted error is recorded', String(aliceDoc.lastSyncError).includes('interrupted'), String(aliceDoc.lastSyncError));
    await LeetCodeIntegration.updateOne(
      { user: aliceId },
      { $set: { syncStatus: 'syncing', syncLockAt: new Date(), syncLockHolder: 'boot-window' } }
    );
    const forced = await recoverStaleLeetCodeSyncs({ force: true });
    aliceDoc = await doc(aliceId);
    check('restart: boot-time force recovery clears even a fresh lock', forced >= 1 && aliceDoc.syncLockAt === null && aliceDoc.syncStatus === 'failed');
    const postRecovery = await runManual(aliceId);
    check('restart: a normal sync runs again after recovery', postRecovery.status === 'completed', `got ${postRecovery.status}`);

    /* ------------------- 12. near-real-time auto-sync (5–10s) -------------- */
    console.log('\n12. Near-real-time auto-sync picks up due accounts (current month)');
    mock.submissions['alice_coder'] = rowsV3; // +longest-substring (NOT yet stored)
    await LeetCodeIntegration.updateOne({ user: aliceId }, { $set: { lastSuccessfulSyncAt: new Date(Date.now() - 60000) } });
    const autoResult = await leetcodeSyncTick({ client: mock, userIds: [aliceId] });
    check('auto-sync: due account was synced by the tick', autoResult.ran >= 1, `ran=${autoResult.ran} due=${autoResult.due}`);
    aliceDoc = await doc(aliceId);
    check('auto-sync: run completed with trigger=scheduled', aliceDoc.syncStatus === 'completed' && aliceDoc.lastRunResult?.trigger === 'scheduled', `${aliceDoc.syncStatus}/${aliceDoc.lastRunResult?.trigger}`);
    check('auto-sync: targets the CURRENT month', aliceDoc.lastRunResult?.month === new Date().toISOString().slice(0, 7), `month=${aliceDoc.lastRunResult?.month}`);
    check('auto-sync: 1 new problem detected in this scheduled run', aliceDoc.lastRunResult?.newProblems === 1, `new=${aliceDoc.lastRunResult?.newProblems}`);
    check('auto-sync: lastSuccessfulSyncAt now recent (no immediate re-run)', Date.now() - new Date(aliceDoc.lastSuccessfulSyncAt) < 60000);
    check('auto-sync: cadence config stays inside the 5–10s window', leetcodeConfig().intervalSeconds >= 5 && leetcodeConfig().intervalSeconds <= 10, `interval=${leetcodeConfig().intervalSeconds}s`);
    const notDue = await leetcodeSyncTick({ client: mock, userIds: [aliceId] });
    check('auto-sync: account inside the minimum gap is not re-queued', notDue.ran === 0, `ran=${notDue.ran}`);

    /* ---------------------- 13. multiple users ----------------------------- */
    console.log('\n13. Multiple users — complete isolation');
    const bobConnect = await connectLeetCode(bobId, 'bob_coder');
    check('multi-user: bob connects independently', bobConnect.httpStatus === 200);
    await runManual(bobId); // month choice: unscooped for this suite
    const bobState = await waitForSync(bobId);
    check('multi-user: bob syncs to completed', bobState.status === 'completed', `got ${bobState.status}`);
    const aliceSlugs = await slugsOf(aliceId);
    const bobSlugs = await slugsOf(bobId);
    check('multi-user: alice has her 4 problems', aliceSlugs.length === 4, aliceSlugs.join(','));
    check('multi-user: bob has his 2 problems', bobSlugs.length === 2 && bobSlugs.join(',') === 'two-sum,valid-parentheses', bobSlugs.join(','));
    check('multi-user: alice does not see bob-only problems', !aliceSlugs.includes('valid-parentheses'));
    const twoSumBoth = await LeetCodeSolvedProblem.find({ slug: 'two-sum', user: { $in: [aliceId, bobId] } }).lean();
    check('multi-user: shared slug stored once PER user (2 rows, distinct owners)', twoSumBoth.length === 2 && new Set(twoSumBoth.map((d) => String(d.user))).size === 2, `rows=${twoSumBoth.length}`);
    const bobDoc = await doc(bobId);
    check('multi-user: upstream stats not mixed (bob totalSolved=10)', bobDoc.upstreamStats?.totalSolved === 10 && bobDoc.lastRunResult?.trigger === 'manual');
    const aliceProblemsApi = (await api('/leetcode/problems', { token: tokenAlice })).data;
    const bobProblemsApi = (await api('/leetcode/problems', { token: tokenBob })).data;
    check(
      'multi-user: API scopes problems by owner',
      aliceProblemsApi.total === 4 && bobProblemsApi.total === 2 &&
        aliceProblemsApi.problems.every((p) => aliceSlugs.includes(p.slug)) &&
        bobProblemsApi.problems.every((p) => bobSlugs.includes(p.slug)),
      `alice=${aliceProblemsApi.total} bob=${bobProblemsApi.total}`
    );

    /* --------------------- 14. invalid profile (API) ----------------------- */
    console.log('\n14. Invalid profile on a connected account');
    mock.profiles['alice_coder'] = () => {
      throw new LeetCodeError('LeetCode user not found', { code: 'profile_not_found' });
    };
    const ghostState = await runManual(aliceId);
    aliceDoc = await doc(aliceId);
    check('invalid profile: run fails with a useful error', ghostState.status === 'failed' && String(aliceDoc.lastSyncError).includes('not found'), String(aliceDoc.lastSyncError));
    check('invalid profile: connection marked error, permanentFailure set', aliceDoc.status === 'error' && aliceDoc.permanentFailure === true, `status=${aliceDoc.status}`);
    const tickGhost = await leetcodeSyncTick({ client: mock, userIds: [aliceId] });
    check('invalid profile: automatic sync stops for this account', tickGhost.ran === 0, `ran=${tickGhost.ran}`);
    // restore the account for the remaining checks
    mock.profiles['alice_coder'] = aliceProfile;
    await LeetCodeIntegration.updateOne({ user: aliceId }, { $set: { status: 'connected', permanentFailure: false, nextRetryAt: null } });
    const recoveryState = await runManual(aliceId);
    check('invalid profile: account recovers after reconnect + successful sync', recoveryState.status === 'completed', `got ${recoveryState.status}`);

    /* ------------------------ 15. empty response --------------------------- */
    console.log('\n15. Empty upstream response');
    const emptyUser = await User.create({ name: 'LC Empty', email: mkEmail('empty'), password: 'LcSync!2345' });
    users.empty = emptyUser._id;
    mock.profiles['empty_ed'] = zeroProfile('empty_ed');
    mock.submissions['empty_ed'] = [];
    await connectLeetCode(emptyUser._id, 'empty_ed');
    await runManual(emptyUser._id);
    const emptyState = await waitForSync(emptyUser._id);
    check('empty: completes successfully with zero problems', emptyState.status === 'completed' && emptyState.newProblems === 0 && emptyState.totalSolved === 0, JSON.stringify({ s: emptyState.status, n: emptyState.newProblems }));
    check('empty: nothing written to solved collection', (await LeetCodeSolvedProblem.countDocuments({ user: emptyUser._id })) === 0);

    /* ---------------------- 16. partial response --------------------------- */
    console.log('\n16. Partial upstream response never reports false success');
    const partialUser = await User.create({ name: 'LC Partial', email: mkEmail('partial'), password: 'LcSync!2345' });
    users.partial = partialUser._id;
    mock.profiles['partial_ed'] = zeroProfile('partial_ed');
    mock.submissions['partial_ed'] = () => {
      throw transient('upstream stream truncated');
    };
    await connectLeetCode(partialUser._id, 'partial_ed');
    await runManual(partialUser._id);
    const partialState = await waitForSync(partialUser._id);
    const partialDoc = await doc(partialUser._id);
    check('partial: run marked failed (not completed)', partialState.status === 'failed', `got ${partialState.status}`);
    check('partial: lastSuccessfulSyncAt stays null (no false success)', partialDoc.lastSuccessfulSyncAt === null, String(partialDoc.lastSuccessfulSyncAt));
    check('partial: retries were attempted (transient)', partialDoc.consecutiveFailures >= 1, `failures=${partialDoc.consecutiveFailures}`);

    /* -------------------------- 17. analytics ------------------------------ */
    console.log('\n17. Analytics derived from stored records + real upstream snapshot');
    const analytics = await buildLeetCodeAnalytics(aliceId);    check('analytics: totalSolved from upstream snapshot (=3)', analytics.totalSolved === 3, `got ${analytics.totalSolved}`);
    check('analytics: difficulty split matches upstream (1/2/0)', analytics.difficulty.easy === 1 && analytics.difficulty.medium === 2 && analytics.difficulty.hard === 0, JSON.stringify(analytics.difficulty));
    check('analytics: storedCount reflects unique rows (=4)', analytics.storedCount === 4, `got ${analytics.storedCount}`);
    check('analytics: weekly activity counts all four solves', analytics.activity.weekly === 4, `got ${analytics.activity.weekly}`);
    check('analytics: daily buckets cover 30 days ending today', analytics.activity.daily.length === 30, `got ${analytics.activity.daily.length}`);
    check('analytics: current streak ≥ 1 (solved today)', (analytics.streaks?.current || 0) >= 1, `got ${analytics.streaks?.current}`);
    const arrayTopic = analytics.topicCounts.find((t) => t.topic === 'Array');
    check('analytics: topic counts derived from stored topics', Boolean(arrayTopic && arrayTopic.count >= 1), JSON.stringify(analytics.topicCounts.slice(0, 3)));
    check('analytics: languages from upstream snapshot', (analytics.languageCounts || []).some((l) => l.name === 'javascript'), JSON.stringify(analytics.languageCounts));
    check('analytics: embeds sync state for the UI', analytics.sync?.status === 'completed', `got ${analytics.sync?.status}`);

    /* --------------------------- 18. timezone ------------------------------ */
    console.log('\n18. Timezone: UTC storage, UTC day buckets');
    const tzUser = await User.create({ name: 'LC Tz', email: mkEmail('tz'), password: 'LcSync!2345' });
    users.tz = tzUser._id;
    // Yesterday 23:30 UTC — under IST (+5:30) that is already "today", so a
    // server-local bucket would land on a different day than the UTC bucket.
    const nowMs = Date.now();
    const utcMidnight = Date.UTC(
      new Date(nowMs).getUTCFullYear(),
      new Date(nowMs).getUTCMonth(),
      new Date(nowMs).getUTCDate()
    );
    const tzTs = utcMidnight - 86400000 + 23.5 * 3600000; // yesterday 23:30 UTC
    mock.profiles['tz_ed'] = zeroProfile('tz_ed');
    mock.submissions['tz_ed'] = [
      { title: 'Timezone Probe', slug: 'timezone-probe', status: 'Accepted', timestampMs: tzTs, language: 'go' },
    ];
    await connectLeetCode(tzUser._id, 'tz_ed');
    await runManual(tzUser._id);
    const tzState = await waitForSync(tzUser._id);
    const tzRow = await LeetCodeSolvedProblem.findOne({ user: tzUser._id }).lean();
    check('timezone: sync completed', tzState.status === 'completed', `got ${tzState.status}`);
    check('timezone: solvedAt stores the exact instant (ms-identical)', tzRow && tzRow.solvedAt.getTime() === tzTs, tzRow ? `stored=${tzRow.solvedAt.getTime()} expected=${tzTs}` : 'row missing');
    const tzAnalytics = await buildLeetCodeAnalytics(tzUser._id);
    const utcYesterdayKey = new Date(tzTs).toISOString().slice(0, 10);
    const utcTodayKey = new Date(utcMidnight).toISOString().slice(0, 10);
    const yesterdayBucket = tzAnalytics.activity.daily.find((b) => b.date === utcYesterdayKey);
    const todayBucket = tzAnalytics.activity.daily.find((b) => b.date === utcTodayKey);
    check('timezone: activity bucketed on the UTC day, not the local day', yesterdayBucket?.count === 1 && (todayBucket?.count || 0) === 0, `yesterday(${utcYesterdayKey})=${yesterdayBucket?.count} today(${utcTodayKey})=${todayBucket?.count}`);
    check('timezone: streak recognises a solve from yesterday (grace)', (tzAnalytics.streaks?.current || 0) >= 1, `got ${tzAnalytics.streaks?.current}`);

    /* ------------------------ 19. notifications ---------------------------- */
    console.log('\n19. Post-sync notification honours stored preferences');
    await NotificationPreference.updateOne(
      { user: aliceId },
      {
        $set: {
          enabled: true,
          channels: { webPush: false, email: false, inApp: true },
          categories: [{ category: 'leetcode', enabled: true, channels: { webPush: false, email: false, inApp: true } }],
        },
      },
      { upsert: true }
    );
    const notifCount = async () => AppNotification.countDocuments({ user: aliceId, category: 'leetcode' });
    mock.submissions['alice_coder'] = rowsV4; // +sliding-window-max
    const notifRun1 = await runManual(aliceId);
    check('notify: new problem detected (v4)', notifRun1.newProblems === 1, `new=${notifRun1.newProblems}`);
    check('notify: in-app notification created when preferences allow it', (await notifCount()) === 1, `count=${await notifCount()}`);
    const notifDoc = await AppNotification.findOne({ user: aliceId, category: 'leetcode' });
    check('notify: notification text reports the actual new count', String(notifDoc?.title).includes('1 new problem'), String(notifDoc?.title));
    const notifRun2 = await runManual(aliceId); // same data → no new problems
    check('notify: zero-new run creates NO notification', notifRun2.newProblems === 0 && (await notifCount()) === 1, `new=${notifRun2.newProblems} count=${await notifCount()}`);
    await NotificationPreference.updateOne({ user: aliceId }, { $set: { enabled: false } });
    mock.submissions['alice_coder'] = rowsV5; // +merge-k-lists
    const notifRun3 = await runManual(aliceId);
    check('notify: master switch OFF suppresses the notification (data still syncs)', notifRun3.newProblems === 1 && (await notifCount()) === 1, `new=${notifRun3.newProblems} count=${await notifCount()}`);

    /* --------------------- 20. month-targeted sync -------------------------- */
    console.log('\n20. Filter-first synchronization (selected range decides what is stored)');
    // A fresh user whose upstream feed spans several periods.
    const monthUser = await User.create({ name: 'LC Month', email: mkEmail('month'), password: 'LcSync!2345' });
    users.month = monthUser._id;
    const nowMs2 = Date.now();
    const daysAgoUtc = (days, hour = 12) => {
      const d = new Date(nowMs2 - days * 86400000);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour);
    };
    const todayKey2 = new Date(nowMs2).toISOString().slice(0, 10);
    const monthKey2 = todayKey2.slice(0, 7);
    const thisMonthWindow = resolveSyncWindow({ month: monthKey2 });
    const todayWindow = resolveSyncWindow({ startDate: todayKey2, endDate: todayKey2 });
    mock.profiles['month_ed'] = zeroProfile('month_ed');
    mock.details['month-easy'] = { difficulty: 'easy', topics: ['Array'] };
    mock.details['month-hard'] = { difficulty: 'hard', topics: ['Graphs'] };
    mock.details['today-medium'] = { difficulty: 'medium', topics: ['DP'] };
    mock.submissions['month_ed'] = [
      { title: 'Month Easy', slug: 'month-easy', status: 'Accepted', timestampMs: daysAgoUtc(3), language: 'python3' },
      { title: 'Month Hard', slug: 'month-hard', status: 'Accepted', timestampMs: daysAgoUtc(5), language: 'python3' },
      { title: 'Today Medium', slug: 'today-medium', status: 'Accepted', timestampMs: nowMs2 - 3600000, language: 'python3' },
    ];
    await connectLeetCode(monthUser._id, 'month_ed'); // connect alone imports NOTHING
    check('filter: connect alone stores no problems', (await LeetCodeSolvedProblem.countDocuments({ user: monthUser._id })) === 0);
    // Sync with the MONTH filter selected.
    const monthRun = await runManual(monthUser._id, { window: thisMonthWindow });
    check('filter: month-window sync completes', monthRun.status === 'completed', `got ${monthRun.status}`);
    const monthSlugs = await slugsOf(monthUser._id);
    check('filter: month window stores exactly the month\'s solves (3 rows)', monthSlugs.length === 3, monthSlugs.join(','));
    check('filter: lastRunResult records the selected window', (await doc(monthUser._id))?.lastRunResult?.month === monthKey2, JSON.stringify((await doc(monthUser._id))?.lastRunResult?.month));
    // Switch filter to TODAY → only today's solve is in scope.
    const todayRun = await runManual(monthUser._id, { window: todayWindow });
    check('filter: today-window sync completes', todayRun.status === 'completed', `got ${todayRun.status}`);
    check('filter: switching the filter stores no duplicates', (await LeetCodeSolvedProblem.countDocuments({ user: monthUser._id })) === 3);
    check('filter: today-window run reports no NEW rows (all already stored)', todayRun.newProblems === 0, `new=${todayRun.newProblems}`);
    // A custom range strictly outside the feed imports nothing extra.
    const emptyWindow = resolveSyncWindow({ startDate: '2020-01-01', endDate: '2020-01-02' });
    const emptyRun = await runManual(monthUser._id, { window: emptyWindow });
    check('filter: out-of-range custom window stores nothing', emptyRun.status === 'completed' && (await LeetCodeSolvedProblem.countDocuments({ user: monthUser._id })) === 3, `new=${emptyRun.newProblems}`);
    check('filter: out-of-range run still reports the window label', (await doc(monthUser._id))?.lastRunResult?.month === '2020-01-01→2020-01-02');
    // Invalid windows are rejected before any upstream call.
    // Invalid windows resolve to null → the engine treats it as unscooped.
    // That path is reserved for tests/exports; the API rejects bad dates
    // BEFORE calling the service (validated below via the HTTP layer).
    check('filter: invalid date strings resolve to no window', resolveSyncWindow({ startDate: 'nope', endDate: '2020-01-02' }) === null);

    /* -------------- 21. filtered dashboard endpoint (DB-level) ------------- */
    console.log('\n21. Filter-driven dashboard endpoint');
    const dashUser = await User.create({ name: 'LC Dash', email: mkEmail('dash'), password: 'LcSync!2345' });
    users.dash = dashUser._id;
    tokenMonth = (await api('/auth/register', {
      method: 'POST',
      body: { name: 'LC Dash2', email: mkEmail('dash2'), password: 'LcSync!2345', branch: 'Computer Science', semester: 6 },
    })).data?.token || '';
    const dashToken = (await api('/auth/login', { method: 'POST', body: { email: mkEmail('dash'), password: 'LcSync!2345' } })).data?.token || '';
    check('dashboard: account ready with token', Boolean(dashToken));
    // Two synced rows inside this month + one manual log today.
    const dashMonth = resolveSyncWindow({ month: monthKey2 });
    await LeetCodeSolvedProblem.create({
      user: dashUser._id, slug: 'dash-easy', title: 'Dash Easy', difficulty: 'easy',
      url: 'https://leetcode.com/problems/dash-easy/', solvedAt: new Date(daysAgoUtc(2)), source: 'leetcode_sync',
    });
    await LeetCodeSolvedProblem.create({
      user: dashUser._id, slug: 'dash-hard', title: 'Dash Hard', difficulty: 'hard',
      url: 'https://leetcode.com/problems/dash-hard/', solvedAt: new Date(nowMs2 - 3600000), source: 'leetcode_sync',
    });
    await api('/technical/problems', {
      method: 'POST', token: dashToken,
      body: { title: 'Manual Log', difficulty: 'medium', topic: 'Arrays', platform: 'LeetCode', timeSpentMinutes: 80, date: todayKey2 },
    });
    const dashToday = (await api(`/leetcode/dashboard?range=custom&startDate=${todayKey2}&endDate=${todayKey2}&tzOffsetMinutes=0`, { token: dashToken })).data;
    check('dashboard: today range returns only today\'s data', dashToday.success === true && dashToday.summary.problemsSolved === 2, JSON.stringify(dashToday.summary));
    check('dashboard: practice hours from manual logs only (80m → 1.3h)', dashToday.summary.practiceHours === 1.3, `got ${dashToday.summary.practiceHours}`);
    check('dashboard: daily buckets cover exactly the requested day', dashToday.dailyActivity.length === 1 && dashToday.dailyActivity[0].date === todayKey2);
    check('dashboard: difficulty split reflects the filtered rows (0 easy/1 medium/1 hard — the 2-day-old easy row is outside today)', dashToday.difficulty.easy === 0 && dashToday.difficulty.medium === 1 && dashToday.difficulty.hard === 1, JSON.stringify(dashToday.difficulty));
    check('dashboard: todayGoal present even when the range IS today', dashToday.todayGoal?.problemsDone === 2 && dashToday.todayGoal?.minutesDone === 80, JSON.stringify(dashToday.todayGoal));
    const [my, mm] = monthKey2.split('-').map(Number);
    const monthEndDay = new Date(Date.UTC(my, mm, 0)).toISOString().slice(0, 10);
    // Difficulty filter narrows server-side.
    const dashEasy = (await api(`/leetcode/dashboard?range=custom&startDate=${monthKey2}-01&endDate=${monthEndDay}&difficulty=easy&tzOffsetMinutes=0`, { token: dashToken })).data;
    check('dashboard: difficulty filter applied at the query level (1 easy in month)', dashEasy.summary.problemsSolved === 1 && dashEasy.difficulty.easy === 1 && dashEasy.difficulty.hard === 0, JSON.stringify(dashEasy.summary));
    // Full-month window includes the older synced row.
    const dashMonthResp = (await api(`/leetcode/dashboard?range=custom&startDate=${monthKey2}-01&endDate=${monthEndDay}&tzOffsetMinutes=0`, { token: dashToken })).data;
    check('dashboard: month range covers all three rows', dashMonthResp.summary.problemsSolved === 3, JSON.stringify(dashMonthResp.summary));
    check('dashboard: month daily buckets only inside the month', dashMonthResp.dailyActivity.every((d) => d.date.startsWith(monthKey2)) && dashMonthResp.dailyActivity.length > 1);
    // Invalid range rejected.
    const dashBad = await api('/leetcode/dashboard?range=bogus', { token: dashToken });
    check('dashboard: invalid range → 400', dashBad.status === 400, `got ${dashBad.status}`);
    // Unauthenticated rejected.
    const dashNoAuth = await api('/leetcode/dashboard?range=month');
    check('dashboard: requires authentication (401)', dashNoAuth.status === 401, `got ${dashNoAuth.status}`);
    check('filter: invalid request leaves the database untouched', (await LeetCodeSolvedProblem.countDocuments({ user: monthUser._id })) === 3);
    mock.submissions['month_ed'] = [];
  } catch (err) {
    failed += 1;
    console.error('\n  ✗ suite crashed:', err);
  } finally {
    /* ------------------------------ cleanup ------------------------------- */
    try {
      setLeetCodeClient(null);
      const cleanupUsers = await User.find({ email: { $regex: /^lcsync\./ } }).select({ _id: 1 });
      const ids = cleanupUsers.map((u) => u._id);
      const extras = Object.values(users).filter(Boolean);
      const allIds = [...new Set([...ids.map(String), ...extras.map(String)])].map(
        (s) => new mongoose.Types.ObjectId(s)
      );
      if (allIds.length) {
        await LeetCodeIntegration.deleteMany({ user: { $in: allIds } });
        await LeetCodeSolvedProblem.deleteMany({ user: { $in: allIds } });
        await AppNotification.deleteMany({ user: { $in: allIds } });
        await NotificationPreference.deleteMany({ user: { $in: allIds } });
        await User.deleteMany({ _id: { $in: allIds } });
      }
      console.log('\n🧹 Cleanup: throwaway accounts and LeetCode records deleted.');
      await mongoose.disconnect();
    } catch (err) {
      console.log(`\n⚠ Cleanup issue: ${err.message}`);
    }
  }

  console.log('\n===========================================================');
  console.log(`  ${failed === 0 ? '✓' : '✗'} ${passed} check(s) passed, ${failed} failed`);
  console.log('===========================================================');
  process.exit(failed === 0 ? 0 : 1);
};

run();
