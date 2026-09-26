/**
 * Phase 11 — every assessment saves its own date and its own marks.
 *
 * Runs against the live local API with a throwaway account and cleans up after
 * itself. Each check sends exactly what the UI sends: only the fields the
 * student touched. The rules under test:
 *
 *   • date and marks are independent — one can exist without the other
 *   • saving one assessment never requires, validates or overwrites another
 *   • omitted fields keep their stored value; nothing is nulled out
 *   • missing marks stay null and are never turned into 0
 *   • marks never touch reminders; a date only moves its own reminder
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

const listReminders = async (token) => (await api('/notifications/reminders', { token })).data.items || [];

const fingerprint = (items) =>
  items
    .map((r) => `${r.category}|${r.entitySub || ''}|${new Date(r.fireAt).toISOString()}`)
    .sort()
    .join('\n');

const waitForCount = async (token, expected, label, timeoutMs = 8000) => {
  const started = Date.now();
  let items = await listReminders(token);
  while (items.length !== expected && Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 150));
    items = await listReminders(token);
  }
  if (items.length !== expected) {
    throw new Error(`${label}: expected ${expected} scheduled reminders, got ${items.length}`);
  }
  return items;
};

const waitFor = async (token, predicate, label, timeoutMs = 8000) => {
  const started = Date.now();
  let items = await listReminders(token);
  while (!predicate(items) && Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 150));
    items = await listReminders(token);
  }
  if (!predicate(items)) throw new Error(`${label}: condition never held`);
  return items;
};

const run = async () => {
  console.log('===========================================================');
  console.log('  PHASE 11: PER-ASSESSMENT INDEPENDENCE (DATE vs MARKS)');
  console.log('===========================================================\n');

  const email = `phase11.${Date.now()}@acadova.test`;
  const password = 'Phase11!234';
  let token = '';
  let userId = null;
  let subjectId = null;

  const save = (body) => api(`/academics/assessments/subject/${subjectId}`, { method: 'PUT', token, body });
  // Always assert against what is stored, never what the response echoed.
  const stored = async () => (await api(`/academics/assessments/subject/${subjectId}`, { token })).data.assessment;
  const internalDate = (doc, n) => doc.internals.internalDates?.[`internal_${n}`] ?? null;
  const internalMarks = (doc, n) => doc.internals[`internal_${n}`] ?? null;
  const abl = (doc, n) => doc.abls.find((a) => a.number === n) || {};
  const quiz = (doc, n) => doc.quizzes.find((q) => q.number === n) || {};
  const lab = (doc) => doc.labInternal || {};

  try {
    console.log('0. Throwaway account, semester and lab subject');
    const reg = await api('/auth/register', {
      method: 'POST',
      body: { name: 'Phase11 Student', email, password, branch: 'Computer Science', semester: 6 },
    });
    if (!reg.data?.token) throw new Error(`Register failed: ${JSON.stringify(reg.data)}`);
    token = reg.data.token;
    userId = reg.data.user?._id;

    const prefsRes = await api('/notifications/preferences', { token });
    const { preferences } = prefsRes.data;
    const wanted = ['internal', 'assignment', 'quiz', 'labInternal'];
    await api('/notifications/preferences', {
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

    const sem = await api('/academics/semesters', {
      method: 'POST',
      token,
      body: {
        semesterNumber: 6,
        academicYear: '2026–27',
        semesterName: 'Phase 11 Semester',
        startDate: '2026-08-01',
        endDate: '2026-12-15',
        isActive: true,
        workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      },
    });
    if (sem.status > 201) throw new Error(`Semester failed: ${JSON.stringify(sem.data)}`);

    const sub = await api('/academics/subjects', {
      method: 'POST',
      token,
      body: { name: 'Phase11 Subject', code: 'P11CS1', credits: 4, hasLab: true, targetAttendance: 75 },
    });
    subjectId = sub.data?.subject?._id;
    if (!subjectId) throw new Error(`Subject failed: ${JSON.stringify(sub.data)}`);
    console.log(`  ✓ account ${email}, subject ${subjectId}`);

    // Nothing has been saved yet: a brand-new subject must start completely empty.
    const blank = await stored();
    console.log(
      `  ✓ empty scaffold: internals ${internalMarks(blank, 1)}/${internalMarks(blank, 2)}, dates ${internalDate(blank, 1)}/${internalDate(blank, 2)}\n`
    );

    const D = {
      int1: dstr(20),
      int2: dstr(22),
      abl1: dstr(24),
      abl2: dstr(26),
      quiz1: dstr(28),
      quiz2: dstr(30),
      lab: dstr(32),
    };

    // ------------------------------------------------------------ INTERNALS
    console.log('1. Internals — date and marks on their own');

    // Internal 1 date only. Internal 2 must stay untouched and no marks appear.
    await save({ internals: { internalDates: { internal_1: D.int1 } } });
    let doc = await stored();
    check(
      '1. Internal 1 date saved without an Internal 2 date',
      internalDate(doc, 1) === D.int1 && internalDate(doc, 2) === null && internalMarks(doc, 1) === null
    );

    // Internal 1 marks only — the date must survive untouched.
    await save({ internals: { internal_1: 42 } });
    doc = await stored();
    check(
      '2. Internal 1 marks saved without Internal 2 marks (date preserved)',
      internalMarks(doc, 1) === 42 && internalDate(doc, 1) === D.int1 && internalMarks(doc, 2) === null
    );

    await save({ internals: { internalDates: { internal_2: D.int2 } } });
    doc = await stored();
    check(
      '3. Internal 2 date saved independently (Internal 1 untouched)',
      internalDate(doc, 2) === D.int2 && internalDate(doc, 1) === D.int1 && internalMarks(doc, 1) === 42
    );

    await save({ internals: { internal_2: 38 } });
    doc = await stored();
    check(
      '4. Internal 2 marks saved independently (its date preserved)',
      internalMarks(doc, 2) === 38 && internalDate(doc, 2) === D.int2 && internalMarks(doc, 1) === 42
    );

    // ------------------------------------------------------------------ ABL
    console.log('\n2. ABL — due date and marks on their own, no other dates required');

    // A due date with no other assessment present at all (Internal 2 exists now,
    // but ABL 2, quizzes and the lab are still completely empty).
    const abl1Date = await save({ abls: [{ number: 1, submissionDate: D.abl1 }] });
    doc = await stored();
    check(
      '5. ABL 1 date saved independently (ABL 2, quizzes and lab still empty)',
      abl1Date.status === 200 &&
        abl(doc, 1).submissionDate === D.abl1 &&
        abl(doc, 2).submissionDate === null &&
        quiz(doc, 1).quizDate === null &&
        lab(doc).date === null
    );

    await save({ abls: [{ number: 1, marks: 18 }] });
    doc = await stored();
    check('6. ABL 1 marks saved independently (due date preserved)', abl(doc, 1).marks === 18 && abl(doc, 1).submissionDate === D.abl1);

    await save({ abls: [{ number: 2, submissionDate: D.abl2 }] });
    doc = await stored();
    check(
      '7. ABL 2 date saved independently (ABL 1 untouched)',
      abl(doc, 2).submissionDate === D.abl2 && abl(doc, 1).submissionDate === D.abl1 && abl(doc, 1).marks === 18
    );

    await save({ abls: [{ number: 2, marks: 16 }] });
    doc = await stored();
    check('8. ABL 2 marks saved independently (its date preserved)', abl(doc, 2).marks === 16 && abl(doc, 2).submissionDate === D.abl2);

    // ---------------------------------------------------------------- QUIZZES
    console.log('\n3. Quizzes — date and marks on their own, attendance still optional');

    const quiz1Only = await save({ quizzes: [{ number: 1, quizDate: D.quiz1 }] });
    doc = await stored();
    check(
      '9. Quiz 1 date saved independently without a quiz 2 date',
      quiz1Only.status === 200 && quiz(doc, 1).quizDate === D.quiz1 && quiz(doc, 2).quizDate === null
    );

    // Marks recorded before the attendance status is known must persist.
    await save({ quizzes: [{ number: 1, marks: 17 }] });
    doc = await stored();
    check(
      '10. Quiz 1 marks saved independently (no attendance required, date preserved)',
      quiz(doc, 1).marks === 17 && quiz(doc, 1).quizDate === D.quiz1 && quiz(doc, 1).attendance === 'not_recorded'
    );

    await save({ quizzes: [{ number: 2, quizDate: D.quiz2 }] });
    doc = await stored();
    check(
      '11. Quiz 2 date saved independently (Quiz 1 untouched)',
      quiz(doc, 2).quizDate === D.quiz2 && quiz(doc, 1).quizDate === D.quiz1 && quiz(doc, 1).marks === 17
    );

    await save({ quizzes: [{ number: 2, marks: 15 }] });
    doc = await stored();
    check('12. Quiz 2 marks saved independently (its date preserved)', quiz(doc, 2).marks === 15 && quiz(doc, 2).quizDate === D.quiz2);

    // ------------------------------------------------------------ LAB INTERNAL
    console.log('\n4. Lab internal — date and marks on their own');

    await save({ labInternal: { date: D.lab } });
    doc = await stored();
    check(
      '13. Lab internal date saved independently (no theory assessment required)',
      lab(doc).date === D.lab && lab(doc).marks === null && internalMarks(doc, 1) === 42
    );

    await save({ labInternal: { marks: 19 } });
    doc = await stored();
    const afterLabMarks = doc;
    check('14. Lab internal marks saved independently (its date preserved)', lab(doc).marks === 19 && lab(doc).date === D.lab);

    // -------------------------------------------------- NOTHING INVENTED / LOST
    console.log('\n5. Nothing is invented, and nothing is lost');

    const snapshot = await stored();
    check(
      '15. every missing mark is still unrecorded (never 0)',
      internalMarks(snapshot, 1) === 42 &&
        internalMarks(snapshot, 2) === 38 &&
        abl(snapshot, 1).marks === 18 &&
        abl(snapshot, 2).marks === 16 &&
        quiz(snapshot, 1).marks === 17 &&
        quiz(snapshot, 2).marks === 15 &&
        lab(snapshot).marks === 19
    );

    // 16 — a date edit leaves marks alone.
    await save({ internals: { internalDates: { internal_1: dstr(40) } } });
    doc = await stored();
    check('16. updating a date does not change marks', internalDate(doc, 1) === dstr(40) && internalMarks(doc, 1) === 42);

    // 17 — a marks edit leaves the date alone.
    await save({ internals: { internal_1: 47 } });
    doc = await stored();
    check('17. updating marks does not change the date', internalMarks(doc, 1) === 47 && internalDate(doc, 1) === dstr(40));

    // 18 — one assessment's save cannot overwrite another.
    await save({ quizzes: [{ number: 1, marks: 20 }] });
    doc = await stored();
    check(
      '18. updating one assessment does not overwrite any other',
      quiz(doc, 1).marks === 20 &&
        quiz(doc, 2).marks === 15 &&
        quiz(doc, 2).quizDate === D.quiz2 &&
        internalMarks(doc, 1) === 47 &&
        internalDate(doc, 2) === D.int2 &&
        abl(doc, 1).marks === 18 &&
        abl(doc, 2).submissionDate === D.abl2 &&
        lab(doc).marks === 19
    );

    // 19 — a payload that mentions one assessment only must never be rejected
    //      because another assessment is empty.
    const freshSub = await api('/academics/subjects', {
      method: 'POST',
      token,
      body: { name: 'Phase11 Subject 2', code: 'P11CS2', credits: 3, hasLab: false, targetAttendance: 75 },
    });
    const emptySubjectId = freshSub.data?.subject?._id;
    const single = await api(`/academics/assessments/subject/${emptySubjectId}`, {
      method: 'PUT',
      token,
      body: { internals: { internal_1: 30 } },
    });
    const emptyDoc = (await api(`/academics/assessments/subject/${emptySubjectId}`, { token })).data.assessment;
    check(
      '19. unrelated empty assessments cause no validation error',
      single.status === 200 &&
        emptyDoc.internals.internal_1 === 30 &&
        emptyDoc.internals.internal_2 === null &&
        emptyDoc.abls.every((a) => a.submissionDate === null && a.marks === null) &&
        emptyDoc.quizzes.every((q) => q.quizDate === null && q.marks === null) &&
        (emptyDoc.labInternal?.date ?? null) === null,
      `status ${single.status} ${single.data?.message || ''}`
    );

    // 20 — removing a date keeps marks, removing marks keeps the date.
    await save({ internals: { internalDates: { internal_2: null } } });
    let afterRemoveDate = await stored();
    const marksKeptAfterDateRemoval = internalDate(afterRemoveDate, 2) === null && internalMarks(afterRemoveDate, 2) === 38;

    await save({ internals: { internal_2: null } });
    afterRemoveDate = await stored();
    check(
      '20. removing a date keeps its marks; removing marks keeps its date (and nothing else changes)',
      marksKeptAfterDateRemoval &&
        internalMarks(afterRemoveDate, 2) === null &&
        internalDate(afterRemoveDate, 2) === null &&
        internalMarks(afterRemoveDate, 1) === 47 &&
        abl(afterRemoveDate, 1).marks === 18 &&
        lab(afterRemoveDate).marks === 19
    );

    // ---------------------------------------------------------------- REMINDERS
    console.log('\n6. Reminders follow dates only');

    // Restore Internal 2's date so all seven assessments carry a date.
    await save({ internals: { internalDates: { internal_2: D.int2 } } });
    let items = await waitForCount(token, 7, 'all seven dated assessments');
    const withMarksFingerprint = fingerprint(items);

    // 21 — marks-only writes must not move the reminder set.
    await save({ internals: { internal_1: 45 } });
    await save({ abls: [{ number: 1, marks: 11 }] });
    await save({ quizzes: [{ number: 2, marks: 9 }] });
    await save({ labInternal: { marks: 7 } });
    await new Promise((r) => setTimeout(r, 900));
    items = await listReminders(token);
    check(
      '21. changing marks never creates, removes or reschedules a reminder',
      fingerprint(items) === withMarksFingerprint,
      `${items.length} reminder(s)`
    );

    // 22 — moving one date recalculates exactly that reminder.
    const movedDate = dstr(50);
    await save({ internals: { internalDates: { internal_2: movedDate } } });
    items = await waitFor(
      token,
      (list) =>
        list.length === 7 &&
        list.some(
          (r) => r.category === 'internal' && r.entitySub === 'internal_2' && new Date(r.fireAt).toISOString().startsWith(dstr(49))
        ),
      'internal 2 date moved'
    );
    const others = items.filter((r) => r.entitySub !== 'internal_2');
    const expectedOthers = withMarksFingerprint
      .split('\n')
      .filter((line) => !line.startsWith('internal|internal_2|'))
      .join('\n');
    check(
      '22. changing one assessment date recalculates only that reminder',
      items.filter((r) => r.entitySub === 'internal_2').length === 1 && fingerprint(others) === expectedOthers
    );

    void afterLabMarks;
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${err.message}`);
  } finally {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      const db = mongoose.connection.db;
      const user = userId ? { _id: userId } : await db.collection('users').findOne({ email });
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
