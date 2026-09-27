# Acadova

> A calm, focused academic and daily routine companion for engineering students: semesters, subjects, labs, a fully custom college timetable, honest attendance, and personal routines.

Every number Acadova shows comes from the signed-in student's own records. There is no demo account, no seeded sample semester, and no fabricated percentage anywhere in the product (see [No fabricated data](#no-fabricated-data)).

Internally the project still uses its original name, **StudentOS**: npm package names, and a few API response strings. The product is Acadova.

---

## What it does

Four questions, in the order a student actually asks them:

1. **Today** - What classes do I have, from my own timetable?
2. **My Day** - What did I plan, and what did I actually finish?
3. **Semester** - Where does my attendance really stand, per subject and per lab?
4. **Projects / Problems / Reviews** - What am I building and practising, and what do the numbers honestly say?

The guided setup flow:

```text
Semester -> Subjects -> Optional lab (4-credit) -> Working days -> Custom time slots
         -> Weekly timetable -> Activate -> Today's classes -> Mark attendance
         -> Attendance history -> Custom routines -> Daily completion -> Reviews
```

Navigation is four fixed groups:

| Group | Pages |
| --- | --- |
| Daily | Today (`/`), My Day (`/routine`) |
| Academics | Semester (`/academics`) |
| Growth | Projects (`/projects`), Problems (`/problems`), Reviews (`/productivity`) |
| Account | Settings (`/settings`) |

Public routes: `/login`, `/register`, `/legal/terms`, `/legal/privacy`. Unknown paths redirect to `/`.

---

## Features

### Today (`/`)

- Aggregated command center: today's classes from the active timetable, what is now / up next, and deadline-radar highlights.
- Timeline entries carry both plan and reality: `planned_start`, `planned_end`, `actual_start`, `actual_end`, plus planned and actual durations.
- Status transitions: `scheduled`, `in_progress`, `completed`, `interrupted`, `cancelled`. Categories: academic, coding, project, health, personal.
- Planned-versus-actual metrics: schedule accuracy, time efficiency, overrun / underrun, and category time distribution.

### My Day (`/routine`)

- Fully custom routines, including the student's own routine categories (create, rename, delete).
- Per-date completion toggles, time-locked so a future day cannot be marked done early.
- Combined daily timeline (classes plus routines) and day / week / month completion analytics.

### Semester (`/academics`)

- Semester setup, then subject registration: course code, name, faculty, credits, room, weekly sessions, duplicate-code prevention, all scoped to the active semester.
- A 4-credit subject may declare a lab as a child component (`labSection`), never as a separate subject.
- College-style timetable sheet: days as rows (from the student's working days), the student's own slots as columns, sticky header row and day column, merged cells for multi-hour labs, distinct break and lunch cells, and dashed assign affordances for free periods. Horizontal scroll on narrow screens.
- Timetable validation and schedule generation, plus date exceptions (holidays).
- Attendance logging per class session with predictive maths: how many classes must be attended to reach the target, and how many can be missed without dropping below it. Target threshold is per user (default 75%).
- Assessments: one document per subject per semester holding Internal 1 and 2 (marks out of 50, plus their scheduled dates), ABL 1 and 2 (out of 20 plus submission date), and Quiz 1 and 2 (out of 20, with date and attendance). A date can exist without marks and marks without a date, and they save independently - creation time is never used as an assessment date.
- Assignments (deadline, priority, status, max and scored marks) and exams (internal, lab exam, final, with syllabus and weightage).

### Projects (`/projects`)

- Summary figures derived from real records, plus search, status, and technology filters (technology options come only from the student's own projects).
- Responsive 3 / 2 / 1 column card grid with equal-height cards; each card has an overflow menu (GitHub, live demo, log hours, delete) anchored to its ellipsis button and closable with Esc or an outside tap.
- Detail workspace: facts strip (progress, tasks, hours, target date), progress bar, and a milestone table. Progress is completed over total points, clamped to 0 to 100, never `NaN`.

### Problems (`/problems`)

A filter-driven activity dashboard, not a database browser. There is no synced-problem list, no recent-practice dump, and no calendar heatmap.

- Filters: Period (Today, This Week, This Month, Custom Range) and Difficulty (All, Easy, Medium, Hard). The selected filter is the single source of truth and re-requests data on change.
- Filter-scoped sync: **Sync Now** synchronizes exactly the selected window, with boundaries resolved in the student's timezone.
- Server-side filtering: the dashboard query applies range and difficulty at the database level across both synchronized accepted submissions and manual logs.
- Today's goal always tracks today's real solves and practice minutes, whatever period is selected, with problem and time goal rings.
- Practice time comes only from the practice timer or manual logs. A gap between submissions is never treated as solving time.

### Reviews (`/productivity`)

- Daily checkout: completed items, deferred items, energy level, and tomorrow's top priority.
- Weekly review built only from recorded activity: total hours, busiest day (flagged when tied), the single dominant start hour as the peak window, and hours by area with percentages. An empty week returns nulls and no observations rather than invented copy.
- Every panel has its own loading, error, and empty state, and a failed panel offers a retry instead of rendering a false empty week.

### Settings and notifications (`/settings`)

- Profile and account settings, and the notification preference matrix.
- Preference model: one master switch, master delivery channels (web push, email, in-app), and one entry per category (project, assignment, quiz, internal, lab internal, routine, class, lab, attendance, academic date) carrying its own enabled flag, channels, and lead time.
- Conservative defaults: master on, in-app only, every category off with no lead time.
- Web push via VAPID; email via SMTP. Turning a category off stops future reminders and never deletes history.
- The reminder dispatcher runs every 60 seconds with a boot-time resync, so reminders always reflect current preferences and entities.

---

## No fabricated data

- The one-click demo account and its seed entry point are not reachable from any UI surface.
- No hardcoded "quick presets" in the day composer and no pre-written routine presets in an empty state.
- A new account has no semester until the student creates one; the backend does not invent a default semester and fixed period slots.
- With zero recorded classes, aggregate attendance is 0 with an empty-state explanation, never a fabricated 100%.

---

## Design system

Acadova has its own visual identity and no third-party UI kit. All tokens live in `client/tailwind.config.js`, with focus rings, scrollbars, and motion tokens in `client/src/index.css`.

- **Canvas:** warm near-white paper (`#F7F5F1`). Pure white is never the page background.
- **Ink:** warm dark neutrals for text, with hairline borders in `#E7E2DA`.
- **Accent:** one restrained deep teal (`#0F6E63`) for primary actions and active states. Support hues (ok, warn, danger) appear only for status.
- **Typography:** a serif display stack (Charter, Georgia) for headings and a system sans stack for UI text. No Inter, Geist, or Space Grotesk.
- **Radius is a hierarchy, not a default:** 5px chips and badges, 7px controls, 8px inline notes, 10px cards and panels, 14px modals. Nothing is a capsule.
- **Depth:** thin borders and minimal shadows rather than heavy elevation.
- **Icons:** an in-house set of 46 glyphs on one 24x24 grid in `client/src/components/common/Icons.jsx`, inheriting `currentColor` with a 1.8 stroke. There is no icon dependency, and icons appear only where they carry meaning, never as decoration.
- **Motion:** limited to state changes, dialogs, and feedback via `client/src/components/common/motion.jsx`, and fully disabled under `prefers-reduced-motion`.
- **Shared primitives** in `client/src/components/common/ui.jsx`: buttons, fields, cards, badges (one chip geometry everywhere), modal and confirm dialog with Escape and scroll lock, skeletons, empty and error states, progress bar, segmented control, checkbox, switch, date navigator, and page headers.
- **Legal:** `/legal/terms` and `/legal/privacy`, linked from the auth screens, the app footer, and Settings. Both are marked **DRAFT FOR REVIEW** where operational details are still pending.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | React 18.3, Vite 6, Tailwind CSS 3.4, React Router 6.28, Recharts 2.15, Axios |
| Backend | Node.js (ES modules), Express 4.21, Mongoose 8.9 |
| Database | MongoDB |
| Auth | JWT (`Authorization: Bearer <token>`) with bcryptjs password hashing (10 rounds) |
| Notifications | web-push (VAPID) and Nodemailer (SMTP) |
| Tooling | dotenv, cors; Node.js >= 18 |

---

## Architecture

```text
+-------------------------------------------------------------------------+
|                        React 18 SPA (Vite)                             |
|  Tailwind CSS  *  In-house icons  *  Recharts  *  React Router DOM      |
+------------------------------------+------------------------------------+
                                     |
                         HTTP REST API (JSON) + Bearer JWT
                                     |
+------------------------------------v------------------------------------+
|                         Node.js + Express Server                        |
|                                                                         |
|  auth  *  activities  *  academics  *  routines  *  technical           |
|  productivity  *  notifications  *  integrations  *  leetcode           |
|                                                                         |
|  background: 60s reminder dispatcher   |   LeetCode auto-sync tick      |
+------------------------------------+------------------------------------+
                                     |
                                Mongoose ODM
                                     |
+------------------------------------v------------------------------------+
|                       MongoDB Database (Port 27017)                     |
|  Users, Activities, Semesters, Subjects, Attendance, Problems, Reviews  |
+-------------------------------------------------------------------------+
```

Server entry point is `server/server.js`: it connects to MongoDB, mounts the route groups, and starts two background timers.

- **Reminder dispatcher:** every 60 seconds, plus a boot-time resync.
- **LeetCode auto-sync:** every `LEETCODE_SYNC_INTERVAL_SECONDS` (default 8s, clamped to the 5 to 10 second window), sequential, targeting the **current month** for connected accounts only. A closed browser cannot stop it. Boot-time recovery releases jobs interrupted by a restart.
- Both timers are `unref()`ed so they never keep the process alive on their own.
- CORS allows `localhost:5173`, `localhost:5174` and `127.0.0.1` equivalents, plus `CLIENT_URL`.

---

## Data model

Models live in `server/models/`.

| Model | File | Purpose |
| --- | --- | --- |
| `User` | `User.js` | Identity, email, password hash, branch, graduation year, target attendance threshold |
| `Semester` | `Academic.js` | Number / name, start and end date, active flag |
| `Subject` | `Academic.js` | Code, name, faculty, credits, weekly sessions, lab child component, target percentage |
| `TimetableSlot` | `Academic.js` | Day, time slot, subject, kind (class, lab, break, lunch, free) |
| `SemesterException` | `Academic.js` | Holidays and date-specific timetable exceptions |
| `ClassSession` | `Academic.js` | Meeting date, subject, status (`attended`, `missed`, `cancelled`), notes |
| `Assessment` | `Academic.js` | One per subject per semester: internal / ABL / quiz marks and dates |
| `Assignment` | `Academic.js` | Deadline, priority, status, max and scored marks |
| `Exam` | `Academic.js` | Type (`internal_1`, `internal_2`, `lab_exam`, `final`), date, syllabus, weightage, marks |
| `Activity` | `Activity.js` | Day timeline entries with planned and actual times, status, category |
| `CustomRoutine` | `Routine.js` | Student-authored routine item, `category` kept as a plain string |
| `RoutineCategory` | `Routine.js` | The student's reusable categories, unique per user and name |
| `RoutineCompletion` | `Routine.js` | Per-date completion of a routine item |
| `CodingProblem` | `TechnicalGrowth.js` | Manually logged practice, with platform, difficulty, topic, minutes, date |
| `PracticeGoal` | `TechnicalGrowth.js` | Per-user daily problem and time goals |
| `Project` | `TechnicalGrowth.js` | Tech stack, repository and demo URLs, status, progress, milestones, logged hours |
| `LeetCodeIntegration` | `LeetCode.js` | One per student: username, sync state machine, cursor, retry and rate-limit fields, expiring lock, upstream snapshot |
| `LeetCodeSolvedProblem` | `LeetCode.js` | Unique index on `user + slug`; difficulty, topics, language, `solvedAt` in UTC |
| `DailyReview` | `Productivity.js` | Completed and missed counts, energy level, reflection, tomorrow's priority |
| `WeeklyReview` | `Productivity.js` | Week bounds, total hours, best day, peak window, observations |
| `NotificationPreference` | `Notification.js` | Master switch, master channels, one entry per category with lead time |
| `ScheduledReminder` | `Notification.js` | One row per user, category, entity, lead time, fire time; status `scheduled` / `cancelled` / `sent` |
| `AppNotification` | `Notification.js` | In-app history: category, title, body, link, read flag |
| `PushSubscription` | `Notification.js` | Web push endpoints and keys per browser |
| `Skill` | `TechnicalGrowth.js` | Retained in the schema but not surfaced anywhere in the UI; there is no Skills section |

Notes that matter for correctness:

- Assessment dates and marks are independent fields. A date without marks, or marks without a date, is valid and never back-filled from `createdAt`.
- `RoutineCategory` is a separate collection; deleting a category never rewrites existing routines.
- LeetCode solved rows are unique per `user + slug`, so re-syncing overlapping windows stores one logical record.
- `ScheduledReminder.userIdentityKey` is unique, which makes reminder creation idempotent.

---

## API surface

All operational endpoints require `Authorization: Bearer <token>` and are scoped to the caller.

| Base | Responsibility |
| --- | --- |
| `/api/auth` | Register, login, `me`, profile settings, and OIDC single sign-on (`/oidc/providers`, `/oidc/start`, `/oidc/callback`, `/oidc/exchange`) |
| `/api/activities` | Day timeline CRUD, status updates, live timer, planned-versus-actual metrics |
| `/api/academics` | Semesters, subjects, timetable grid and cells, exceptions, `today`, attendance, assessments, assignments, exams |
| `/api/routines` | Custom routines CRUD, category CRUD, per-date completion toggle, combined timeline, day / week / month analytics |
| `/api/technical` | Coding problem logs, difficulty and topic aggregates, project CRUD, milestones, hours, practice goals |
| `/api/productivity` | Deadline radar, time leaks, daily checkout, weekly review |
| `/api/notifications` | Preferences, reminder sync, scheduled and in-app lists, web push subscribe / unsubscribe, test send |
| `/api/integrations` | LeetCode connect, sync, sync status |
| `/api/leetcode` | Dashboard and analytics for the connected account |
| `/api/health` | Unauthenticated health check |

`POST /api/seed` remains mounted but is not reachable from any UI surface.

### LeetCode integration

Connecting uses a **public** LeetCode username only: no password, no cookies, no bypasses. LeetCode offers no verified push or webhook, so this is deliberately called near-real-time synchronization, never real-time; freshness comes from the server tick plus **Sync Now**.

```text
CONNECTED -> INITIAL_SYNC -> SYNCED -> SCHEDULED_SYNC (or Sync Now)
          -> NEW_ACTIVITY_DETECTED (by problem identifier, not by count)
          -> UPSERT -> SYNCED      failure path: SYNCING -> FAILED -> RETRY
```

- Only accepted submissions count (LeetCode status code `10`, or the literal `Accepted`). Wrong answer, TLE, MLE, and compile errors never become solved records.
- A per-account expiring lock prevents concurrent runs; a second start returns `already_running` with the existing sync id.
- Failures use bounded exponential backoff and never overwrite `lastSuccessfulSyncAt`.
- Statuses: `idle`, `queued`, `syncing`, `completed`, `failed`, `rate_limited`.
- A completed run that finds new problems creates an in-app notification only when the student's preferences allow it, and never for zero-new runs.

`server/clients/leetcodeClient.js` holds every upstream GraphQL call behind `fetchProfile`, `fetchRecentSubmissions`, and `fetchProblemDetails`, with a 15s timeout, a 2 MB response cap, and a minimum gap between calls. Errors are classified as transient (retried), rate limited (cooldown, honouring `Retry-After`), profile not found, or permanent.

Configuration (all optional, defaults shown, set in `server/.env`):

| Key | Default | Meaning |
| --- | --- | --- |
| `LEETCODE_SYNC_INTERVAL_SECONDS` | `8` | Auto-sync cadence, clamped to the window below |
| `LEETCODE_SYNC_MIN_INTERVAL_SECONDS` | `5` | Minimum gap between auto-sync runs per account |
| `LEETCODE_SYNC_MAX_INTERVAL_SECONDS` | `10` | Upper clamp for the cadence |
| `LEETCODE_SYNC_MAX_RETRIES` | `3` | In-run retries for transient failures |
| `LEETCODE_SYNC_RETRY_BASE_MS` | `30000` | Backoff base (30s, 60s, 120s) |
| `LEETCODE_SYNC_WINDOW` | `50` | Recent-activity rows read per sync |
| `LEETCODE_SYNC_TIMEOUT_MS` | `15000` | Upstream request timeout |
| `LEETCODE_SYNC_MAX_RESPONSE_BYTES` | `2000000` | Response size cap |
| `LEETCODE_SYNC_MIN_GAP_MS` | `500` | Minimum gap between upstream calls |
| `LEETCODE_SYNC_STALE_LOCK_MS` | `600000` | Lock expiry for interrupted-run recovery |
| `LEETCODE_SYNC_RATE_LIMIT_COOLDOWN_MS` | `900000` | Cooldown when upstream throttles |

---

## Getting started

### Prerequisites

- Node.js >= 18 (developed on 24.x)
- A MongoDB instance (local default `mongodb://127.0.0.1:27017`)

### Install

```bash
npm run install:all          # installs server and client
```

### Configure

Create `server/.env`:

```env
PORT=5001
MONGODB_URI=mongodb://127.0.0.1:27017/studentos
JWT_SECRET=replace-with-a-long-random-string
NODE_ENV=development
CLIENT_URL=http://localhost:5173
```

Optional backend keys, needed only for the features that use them:

```env
# Web push (generate a pair with node server/scripts/generate-vapid.js)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com

# Email reminders
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# Single sign-on (OpenID Connect). SSO appears on the sign-in page only
# when OIDC_ISSUER and OIDC_CLIENT_ID are set. Works with any compliant
# provider: Google (https://accounts.google.com), Microsoft Entra ID
# (https://login.microsoftonline.com/<tenant>/v2.0), Keycloak, Auth0...
OIDC_ISSUER=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
# Optional overrides; defaults are derived from CLIENT_URL / SERVER_URL
# OIDC_REDIRECT_URI=https://your-host/api/auth/oidc/callback
# OIDC_SCOPES=openid profile email
```

How SSO works: `/api/auth/oidc/providers` reports availability, `start`
redirects to the provider with PKCE + state + nonce (a signed HttpOnly
cookie binds the flow), and `callback` verifies the `id_token` against the
provider's JWKS before matching an account. Existing accounts with the same
email are linked; new emails get an SSO-only account whose random password
can never be used. The SPA receives a one-time token via URL fragment and
redeems it at `POST /api/auth/oidc/exchange` for the standard JWT.

Create `client/.env`:

```env
VITE_API_URL=http://localhost:5001/api
```

`.env` files are gitignored and must never be committed.

### Run

```bash
npm run server      # Express API on http://localhost:5001 (node --watch)
npm run client      # Vite dev server on http://localhost:5173
```

The Vite dev server proxies `/api` to `http://localhost:5001`, so the client works even without `VITE_API_URL`. Confirm the API is up at `http://localhost:5001/api/health`.

Root scripts: `install:all`, `server`, `client`, `test`, `build`.

---

## Testing

There is no unit-test framework; the suites are scripted HTTP tests that run against a live API, so **start MongoDB and the server first**.

```bash
cd server && npm test        # 10 suites, phases 1 through 12
cd client && npm run build   # the client has no ESLint step; the build is the check
```

`server/tests/run-all-tests.js` runs the suites in order and stops at the first failure:

1. Phase 1: Foundation and authentication
2. Phase 2: Student day and planned versus actual
3. Phase 3: Academic system and attendance engine
4. Phase 4: Technical growth and DSA tracker
5. Phase 5: Productivity radar and intelligence
6. Phase 6: Polish and seed engine
7. Phase 9: Timetable, attendance, and custom routine features
8. Phase 10: Assessment dates versus marks, and reminders
9. Phase 11: Per-assessment independence (date versus marks)
10. Phase 12: LeetCode near-real-time sync

Suites use throwaway accounts and clean up after themselves. They read `TEST_API_URL` if set, otherwise `http://localhost:5001/api` (Phase 9 always uses that default). Note that the cleanup deletes the accounts it created, so a browser session signed in as one of them will be logged out.

---

## Project structure

```text
daily_routine_tracker/
  package.json                  root scripts (install:all, server, client, test, build)
  client/
    src/
      components/common/        ui.jsx, Icons.jsx, motion.jsx, AuthShell, ProtectedRoute
      components/layout/        AppLayout, Header, Sidebar, NotificationBell
      context/AuthContext.jsx
      pages/                    Dashboard, MyRoutine, Academics, ProjectsPage,
                                ProblemsPage, ProductivityRadar, Settings,
                                NotificationSettings, Login, Register, Legal
      pages/academics/          SetupSections, TimetableSection, AttendanceSection,
                                AssessmentsSection
      services/api.js           Axios client with the bearer token
      index.css                 focus rings, motion tokens, reduced-motion rules
    tailwind.config.js          colors, fonts, radius scale, shadows
  server/
    server.js                   entry point, route mounts, background timers
    routes/                     one router per API base
    controllers/                request handling and aggregation
    models/                     Mongoose schemas
    services/                   notificationEngine, pushService, emailService,
                                leetcodeSyncService, repoAnalyzer
    clients/leetcodeClient.js   upstream GraphQL calls
    middleware/                 auth and error handling
    scripts/generate-vapid.js   VAPID key generator
    tests/                      scripted HTTP suites
```

---

## Security notes

- Passwords are salted and hashed with bcryptjs (10 rounds); the hash is never returned by the API.
- Stateless JWT authentication with an expiry, sent as a bearer token.
- Every operational route is behind auth middleware and scoped to the authenticated user.
- CORS is restricted to the configured frontend origins.
- Credentials live only in gitignored `.env` files. `.env`, `node_modules/`, `dist/`, and OS files are excluded by `.gitignore`.

---

## Known limitations

- The public LeetCode feed exposes no submission cursor, so each sync reads a bounded recent-activity window (50 rows by default) and dedupes by identity. A solve older than that window would only appear once upstream activity brings it back into range, which is why month-targeted sync can only import months still covered by the recent window.
- Difficulty enrichment is capped at 25 problems per run. Until a row is enriched its difficulty shows as a dash and is stored as `unknown`, never guessed.
- The connect-time and per-run profile checks are single-shot by design (fail fast with a clear message); only scheduled and manual runs retry transient failures.
- The Problems difficulty split comes from LeetCode's profile aggregate, so it counts all of the student's solved problems, while topic and language counts reflect only the synchronized window.
- The client has no linter of its own; `npm run build` is the only static check.
