/**
 * Phase 10 — assessment DATES drive reminders, assessment MARKS never do.
 *
 * Runs against the live local API with a throwaway account and cleans up after
 * itself. Every assertion below is about one rule from the product spec:
 *
 *   date / deadline  → reminder scheduling
 *   marks            → academic record only
 *
 * A, B, C, D, E  a date with no marks still schedules a reminder
 * F              no date schedules nothing
 * G              changing marks does not touch the reminder set
 * H              changing a date recalculates it
 * I              changing preferences reconciles future reminders
 * J              repeated syncs are idempotent
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Semester, Subject, Assessment, Assignment, Exam, TimetableSlot, SemesterException, ClassSession } from '../models/Academic.js';
import {
  NotificationPreference,
  ScheduledReminder,
  AppNotification,
  PushSubscription,
} from '../models/Notification.js';

dotenv.config();

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:5001/api';
const LEAD_1_DAY = 1440;

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

/** YYYY-MM-DD, `offset` days from today (local calendar). */
const dstr = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const listReminders = async (token) => {
  const res = await api('/notifications/reminders', { token });
  return res.data.items || [];
};

const byCategory = (items) =>
  items.reduce((acc, r) => {
    acc[r.category] = (acc[r.category] || 0) + 1;
    return acc;
  }, {});

/** The engine syncs in the background after each write — poll briefly. */
const waitForCount = async (token, expected, label, timeoutMs = 6000) => {
  const started = Date.now();
  let items = await listReminders(token);
  while (items.length !== expected && Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 150));
    items = await listReminders(token);
  }
  if (items.length !== expected) {
    throw new Error(`${label}: expected ${expected} scheduled reminders, got ${items.length} (${JSON.stringify(byCategory(items))})`);
  }
  return items;
};

/** Poll until `predicate(items)` holds — the engine reconciles in the background. */
const waitFor = async (token, predicate, label, timeoutMs = 8000) => {
  const started = Date.now();
  let items = await listReminders(token);
  while (!predicate(items) && Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 150));
    items = await listReminders(token);
  }
  if (!predicate(items)) {
    throw new Error(
      `${label}: condition never held — ${items.length} reminder(s) ${JSON.stringify(
        items.map((r) => `${r.category}:${r.entitySub}:${new Date(r.fireAt).toISOString()}`)
      )}`
    );
  }
  return items;
};

/** Stable fingerprint of the scheduled set: category + entity + fire time. */
const fingerprint = (items) =>
  items
    .map((r) => `${r.category}|${r.entitySub || ''}|${new Date(r.fireAt).toISOString()}`)
    .sort()
    .join('\n');

const run = async () => {
  console.log('===========================================================');
  console.log('  PHASE 10: ASSESSMENT DATES vs MARKS → REMINDERS');
  console.log('===========================================================\n');

  const email = `phase10.${Date.now()}@acadova.test`;
  const password = 'Phase10!234';
  let token = '';
  let userId = null;

  try {
    // ---------------------------------------------------------------- setup
    console.log('1. Throwaway account + preferences');
    const reg = await api('/auth/register', {
      method: 'POST',
      body: { name: 'Phase10 Student', email, password, branch: 'Computer Science', semester: 6 },
    });
    if (!reg.data?.token) throw new Error(`Register failed: ${JSON.stringify(reg.data)}`);
    token = reg.data.token;
    userId = reg.data.user?._id;
    console.log(`  ✓ Account created (${email})`);

    const prefsRes = await api('/notifications/preferences', { token });
    const { preferences, categories: metaCategories } = prefsRes.data;
    const wanted = ['internal', 'assignment', 'quiz', 'labInternal'];
    const put = await api('/notifications/preferences', {
      method: 'PUT',
      token,
      body: {
        enabled: true,
        channels: { ...preferences.channels, inApp: true },
        categories: preferences.categories.map((c) =>
          wanted.includes(c.category)
            ? { ...c, enabled: true, channels: { webPush: false, email: false, inApp: true }, leadMinutes: [LEAD_1_DAY] }
            : c
        ),
      },
    });
    check('preferences saved with a single user-selected lead time', put.status === 200 && !!put.data?.preferences);
    check(
      'all four assessment categories are user-selectable',
      wanted.every((w) => metaCategories.some((c) => c.value === w)),
      `available: ${metaCategories.map((c) => c.value).join(', ')}`
    );

    const sem = await api('/academics/semesters', {
      method: 'POST',
      token,
      body: {
        semesterNumber: 6,
        academicYear: '2026–27',
        semesterName: 'Phase 10 Semester',
        startDate: '2026-08-01',
        endDate: '2026-12-15',
        isActive: true,
        workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      },
    });
    check('semester created and active', sem.status === 201 || sem.status === 200);

    const sub = await api('/academics/subjects', {
      method: 'POST',
      token,
      body: { name: 'Phase10 Subject', code: 'P10CS1', credits: 4, hasLab: true, targetAttendance: 75 },
    });
    const subjectId = sub.data?.subject?._id;
    check('lab subject created', !!subjectId);

    // ------------------------------------------------- A/B/C/D/E — dates only
    console.log('\n2. Dates with NO marks still schedule reminders (A–E)');
    const dates = {
      abl1: dstr(10),
      abl2: dstr(12),
      quiz1: dstr(11),
      quiz2: dstr(13),
      int1: dstr(14),
      int2: dstr(16),
      lab: dstr(15),
    };

    const assessment = {
      internals: {
        internal_1: null,
        internal_2: null,
        internalDates: { internal_1: dates.int1, internal_2: dates.int2 },
      },
      abls: [1, 2].map((n) => ({
        number: n,
        submissionDate: n === 1 ? dates.abl1 : dates.abl2,
        marks: null,
        status: 'pending',
      })),
      quizzes: [1, 2].map((n) => ({
        number: n,
        quizDate: n === 1 ? dates.quiz1 : dates.quiz2,
        attendance: 'not_recorded',
        marks: null,
      })),
      labInternal: { date: dates.lab, marks: null },
    };

    const saved = await api(`/academics/assessments/subject/${subjectId}`, { method: 'PUT', token, body: assessment });
    check('assessment saved with dates and zero marks', saved.status === 200 && !!saved.data?.assessment);

    let items = await waitForCount(token, 7, 'date-only assessment');
    const counts = byCategory(items);
    check('A. ABL (assignment) reminders scheduled without marks', counts.assignment === 2, JSON.stringify(counts));
    check('C. Internal reminders scheduled without marks', counts.internal === 2, JSON.stringify(counts));
    check('D. Quiz reminders scheduled without marks', counts.quiz === 2, JSON.stringify(counts));
    check('E. Lab internal reminder scheduled without marks', counts.labInternal === 1, JSON.stringify(counts));
    check(
      'A. ABL reminder date equals the submission date minus the chosen lead time',
      items.some(
        (r) => r.category === 'assignment' && r.entitySub === 'abl:1' && new Date(r.fireAt).toISOString().startsWith(dstr(9))
      )
    );
    const stored = (await api(`/academics/assessments/subject/${subjectId}`, { token })).data.assessment;
    check(
      'no mark was invented for the date-only assessment',
      stored.internals.internal_1 === null &&
        stored.abls.every((a) => a.marks === null) &&
        stored.quizzes.every((q) => q.marks === null) &&
        (stored.labInternal?.marks ?? null) === null
    );
    const beforeMarks = fingerprint(items);

    // ------------------------------------------------ G — marks never matter
    console.log('\n3. Changing MARKS never touches reminders (G)');
    const withMarks = JSON.parse(JSON.stringify(assessment));
    withMarks.internals.internal_1 = 42;
    withMarks.internals.internal_2 = 38;
    withMarks.abls[0].marks = 18;
    withMarks.quizzes[0].attendance = 'attended';
    withMarks.quizzes[0].marks = 17;
    withMarks.labInternal.marks = 19;
    const marksSaved = await api(`/academics/assessments/subject/${subjectId}`, { method: 'PUT', token, body: withMarks });
    check('B. marks accepted alongside the existing dates', marksSaved.status === 200);
    await new Promise((r) => setTimeout(r, 800));
    items = await listReminders(token);
    check('G. reminder set identical after marks were recorded (no add/remove/move)', fingerprint(items) === beforeMarks);
    const storedWithMarks = (await api(`/academics/assessments/subject/${subjectId}`, { token })).data.assessment;
    check('G. the recorded marks were actually persisted', storedWithMarks.internals.internal_1 === 42 && storedWithMarks.abls[0].marks === 18);

    // ------------------------------------------------------ F — no date = none
    console.log('\n4. An assessment with no date schedules nothing (F)');
    const noDate = JSON.parse(JSON.stringify(withMarks));
    noDate.internals.internalDates.internal_2 = null;
    await api(`/academics/assessments/subject/${subjectId}`, { method: 'PUT', token, body: noDate });
    items = await waitForCount(token, 6, 'internal 2 date cleared');
    check('F. clearing the Internal 2 date removed exactly its reminder', !items.some((r) => r.entitySub === 'internal_2'));
    const withoutInternal2 = beforeMarks
      .split('\n')
      .filter((line) => !line.startsWith('internal|internal_2|'))
      .join('\n');
    check('F. every other reminder is untouched', fingerprint(items) === withoutInternal2);

    // ------------------------------------------------- H — dates recalculate
    console.log('\n5. Changing a DATE recalculates the future reminder (H)');
    const moved = JSON.parse(JSON.stringify(noDate));
    moved.quizzes[0].quizDate = dstr(20);
    await api(`/academics/assessments/subject/${subjectId}`, { method: 'PUT', token, body: moved });
    items = await waitFor(
      token,
      (list) =>
        list.length === 6 &&
        list.some(
          (r) =>
            r.category === 'quiz' &&
            r.entitySub === 'quiz:1' &&
            new Date(r.fireAt).toISOString().startsWith(dstr(19))
        ),
      'quiz date moved'
    );
    const quiz1 = items.filter((r) => r.category === 'quiz' && r.entitySub === 'quiz:1');
    check('H. exactly one reminder exists for the moved quiz (no duplicate)', quiz1.length === 1);
    check(
      'H. the quiz reminder follows the new date',
      quiz1.length === 1 && new Date(quiz1[0].fireAt).toISOString().startsWith(dstr(19)),
      quiz1.length ? new Date(quiz1[0].fireAt).toISOString() : 'none'
    );

    // ------------------------------------------- I — preferences reconcile
    console.log('\n6. Preference changes reconcile future reminders (I)');
    // The four assessment categories stay as the student set them; only `quiz`
    // changes, which is what a real settings change looks like.
    const categoriesWith = (target, changes) =>
      preferences.categories.map((c) =>
        c.category === target
          ? { ...c, channels: { webPush: false, email: false, inApp: true }, leadMinutes: [LEAD_1_DAY], ...changes }
          : wanted.includes(c.category)
            ? { ...c, enabled: true, channels: { webPush: false, email: false, inApp: true }, leadMinutes: [LEAD_1_DAY] }
            : c
      );

    const off = await api('/notifications/preferences', {
      method: 'PUT',
      token,
      body: { categories: categoriesWith('quiz', { enabled: false }) },
    });
    check('preferences saved (quiz category off)', off.status === 200);
    items = await waitFor(token, (list) => list.length === 4 && !list.some((r) => r.category === 'quiz'), 'quiz category disabled');
    check('I. disabling one category cancels only its reminders', !items.some((r) => r.category === 'quiz'));

    await api('/notifications/preferences', {
      method: 'PUT',
      token,
      body: { categories: categoriesWith('quiz', { enabled: true }) },
    });
    items = await waitFor(
      token,
      (list) => list.length === 6 && list.filter((r) => r.category === 'quiz').length === 2,
      'quiz category re-enabled'
    );
    check('I. re-enabling the category brings its reminders back without duplicates', items.filter((r) => r.category === 'quiz').length === 2);

    console.log('\n7. Idempotency (J)');
    const before = fingerprint(await listReminders(token));
    await api('/notifications/sync', { method: 'POST', token });
    await api('/notifications/sync', { method: 'POST', token });
    const after = fingerprint(await listReminders(token));
    check('J. repeated syncs produce no duplicates and no losses', before === after);

    console.log('\n8. Master switch');
    await api('/notifications/preferences', { method: 'PUT', token, body: { enabled: false } });
    items = await waitForCount(token, 0, 'master switch off');
    check('master OFF cancels every optional reminder', items.length === 0);
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${err.message}`);
  } finally {
    // ------------------------------------------------------------- cleanup
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      const db = mongoose.connection.db;
      const user = userId
        ? { _id: userId }
        : await db.collection('users').findOne({ email });
      const id = user?._id;
      if (id) {
        const owned = { user: id };
        for (const model of [
          Assessment,
          Assignment,
          Exam,
          TimetableSlot,
          SemesterException,
          ClassSession,
          Subject,
          Semester,
          NotificationPreference,
          ScheduledReminder,
          AppNotification,
          PushSubscription,
        ]) {
          await model.deleteMany(owned);
        }
        await User.deleteOne({ _id: id });
        console.log('\n🧹 Cleanup: throwaway account and its records deleted.');
      }
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
