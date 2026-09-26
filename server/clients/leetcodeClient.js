/**
 * LeetCode data-source abstraction (Phase 16).
 *
 * Every upstream HTTP/GraphQL request lives behind this client so the sync
 * engine never talks to LeetCode directly. Swapping the retrieval mechanism
 * later means replacing this module only.
 *
 * Public data only: no passwords, no session cookies, no CAPTCHA or access
 * bypass, no IP rotation. Requests are bounded by a timeout, a response-size
 * limit, and a minimum gap between calls so we stay well inside what LeetCode
 * tolerates.
 */

const GRAPHQL_URL = 'https://leetcode.com/graphql/';

/** Browser-like headers — LeetCode rejects header-less API clients. */
const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Referer: 'https://leetcode.com/',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

/**
 * Typed upstream error.
 *   profile_not_found — permanent: wrong/renamed username, never retried
 *   rate_limited      — respect retry timing, never hammered
 *   transient         — network/timeout/5xx: the ONLY code the sync engine retries
 *   permanent         — malformed/rejected response: not retried automatically
 */
export class LeetCodeError extends Error {
  constructor(message, { code = 'permanent', retryAfterMs = null, httpStatus = null } = {}) {
    super(message);
    this.name = 'LeetCodeError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.httpStatus = httpStatus;
  }
}

const envInt = (name, fallback, min = 0) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min ? value : fallback;
};

const PROFILE_QUERY = `
  query syncProfile($username: String!) {
    matchedUser(username: $username) {
      username
      submitStatsGlobal {
        acSubmissionNum {
          difficulty
          count
        }
      }
      languageProblemCount {
        languageName
        problemsSolved
      }
    }
  }
`;

const RECENT_SUBMISSIONS_QUERY = `
  query recentSubmissions($username: String!, $limit: Int!) {
    recentSubmissionList(username: $username, limit: $limit) {
      title
      titleSlug
      status
      timestamp
      lang
    }
  }
`;

const QUESTION_DETAILS_QUERY = `
  query questionDetails($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      titleSlug
      difficulty
      topicTags {
        name
      }
    }
  }
`;

/** Classify a GraphQL error message without ever retrying the wrong thing. */
const classifyGraphQLError = (message) => {
  const text = String(message || '');
  if (/does not exist|not found|no user/i.test(text)) return 'profile_not_found';
  if (/rate.?limit|too many|throttl/i.test(text)) return 'rate_limited';
  if (/internal|temporar|unavailable|timeout|try again|server error/i.test(text)) return 'transient';
  return 'permanent';
};

const parseRetryAfterMs = (res) => {
  const header = res.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const when = Date.parse(header);
  return Number.isNaN(when) ? null : Math.max(0, when - Date.now());
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class LeetCodeClient {
  constructor({
    timeoutMs = envInt('LEETCODE_SYNC_TIMEOUT_MS', 15000, 100),
    maxBytes = envInt('LEETCODE_SYNC_MAX_RESPONSE_BYTES', 2_000_000, 1000),
    minGapMs = envInt('LEETCODE_SYNC_MIN_GAP_MS', 500),
  } = {}) {
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
    this.minGapMs = minGapMs;
    this.lastRequestAt = 0;
  }

  /** Keep a polite gap between upstream calls (rate-limit respect, Phase 13). */
  async #gap() {
    const wait = this.lastRequestAt + this.minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  async #graphql(query, variables) {
    await this.#gap();

    let res;
    try {
      res = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      // Timeout / DNS / reset — the only class the engine retries (Phase 12).
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new LeetCodeError(
        timedOut ? 'LeetCode request timed out' : `Could not reach LeetCode: ${err?.message || err}`,
        { code: 'transient' }
      );
    }

    if (res.status === 429) {
      throw new LeetCodeError('LeetCode rate limit reached', {
        code: 'rate_limited',
        retryAfterMs: parseRetryAfterMs(res),
        httpStatus: 429,
      });
    }
    // Observed in practice: LeetCode's anti-abuse layer answers 403 HTML to
    // too-frequent API calls. Treat exactly like a rate limit — back off, never
    // bypass (Phase 13).
    if (res.status === 403) {
      throw new LeetCodeError('LeetCode is throttling requests from this network', {
        code: 'rate_limited',
        retryAfterMs: parseRetryAfterMs(res),
        httpStatus: 403,
      });
    }
    if (res.status >= 500 || res.status === 408) {
      throw new LeetCodeError(`LeetCode is unavailable (HTTP ${res.status})`, {
        code: 'transient',
        httpStatus: res.status,
      });
    }
    if (!res.ok) {
      // LeetCode ships a JSON `errors` array even with 4xx responses — surface
      // that message so the student sees the real reason (bounded read).
      const body = (await res.text().catch(() => '')).slice(0, this.maxBytes);
      let detail = '';
      try {
        const parsed = JSON.parse(body);
        detail = (parsed.errors || []).map((e) => e?.message).filter(Boolean).join('; ');
      } catch {
        /* not JSON — keep the generic message */
      }
      throw new LeetCodeError(
        detail
          ? `${detail} (HTTP ${res.status})`
          : `LeetCode rejected the request (HTTP ${res.status})`,
        { code: 'permanent', httpStatus: res.status }
      );
    }

    // Response-size limit (Phase 29).
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > this.maxBytes) {
      throw new LeetCodeError('LeetCode response exceeded the size limit', { code: 'permanent' });
    }
    const text = await res.text();
    if (text.length > this.maxBytes) {
      throw new LeetCodeError('LeetCode response exceeded the size limit', { code: 'permanent' });
    }

    // Structured responses only — silent fallbacks to scraped HTML are not
    // permitted (Phase 17): a non-JSON body is a malformed response.
    if (!text.trimStart().startsWith('{')) {
      throw new LeetCodeError('Malformed (non-JSON) response from LeetCode', {
        code: 'permanent',
      });
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LeetCodeError('Malformed JSON response from LeetCode', { code: 'permanent' });
    }

    if (Array.isArray(json.errors) && json.errors.length > 0) {
      const message = json.errors.map((e) => e?.message).filter(Boolean).join('; ') || 'GraphQL error';
      throw new LeetCodeError(message, { code: classifyGraphQLError(message) });
    }
    if (!json.data) {
      throw new LeetCodeError('Empty response from LeetCode', { code: 'permanent' });
    }
    return json.data;
  }

  /** Verify a profile exists and return its aggregate stats (Phase 3 step 1). */
  async fetchProfile(username) {
    const data = await this.#graphql(PROFILE_QUERY, { username });
    const matched = data?.matchedUser;
    if (!matched) {
      throw new LeetCodeError('LeetCode user not found', { code: 'profile_not_found' });
    }
    const ac = matched.submitStatsGlobal?.acSubmissionNum || [];
    const pick = (difficulty) => Number(ac.find((s) => s?.difficulty === difficulty)?.count || 0);
    return {
      username: matched.username,
      totalSolved: pick('All'),
      easy: pick('Easy'),
      medium: pick('Medium'),
      hard: pick('Hard'),
      languages: (matched.languageProblemCount || [])
        .filter(Boolean)
        .map((l) => ({ name: String(l.languageName || ''), count: Number(l.problemsSolved) || 0 }))
        .filter((l) => l.name),
    };
  }

  /**
   * Bounded recent-activity window (Phase 6): the public feed exposes no
   * cursor, so we fetch the newest N rows and let the engine dedupe by stable
   * identity instead of trusting timestamps alone.
   */
  async fetchRecentSubmissions(username, limit) {
    const data = await this.#graphql(RECENT_SUBMISSIONS_QUERY, { username, limit });
    const rows = Array.isArray(data?.recentSubmissionList) ? data.recentSubmissionList : [];
    return rows
      .filter((row) => row && row.titleSlug)
      .map((row) => {
        const raw = Number(row.timestamp);
        // LeetCode sends SECOND epochs here (verified live); ms are normalised too.
        const timestampMs = Number.isFinite(raw) && raw > 0 ? (raw < 1e12 ? raw * 1000 : raw) : null;
        return {
          title: String(row.title || '').trim(),
          slug: String(row.titleSlug).trim().toLowerCase(),
          // Real feed reports NUMERIC status codes (10 = Accepted). Keep the raw
          // value; the engine recognises both code 10 and the literal "Accepted".
          status: typeof row.status === 'number' ? row.status : String(row.status || '').trim(),
          timestampMs,
          language: String(row.lang || ''),
        };
      });
  }

  /** Difficulty + topics for one problem — only fetched for newly stored rows. */
  async fetchProblemDetails(slug) {
    const data = await this.#graphql(QUESTION_DETAILS_QUERY, { titleSlug: slug });
    const question = data?.question;
    if (!question) return null;
    const difficulty = String(question.difficulty || '').toLowerCase();
    return {
      slug: String(question.titleSlug || slug),
      difficulty: ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'unknown',
      topics: (question.topicTags || [])
        .filter(Boolean)
        .map((tag) => String(tag.name || '').trim())
        .filter(Boolean),
    };
  }
}

export const createLeetCodeClient = (options) => new LeetCodeClient(options);
