import React from 'react';
import { Link, useParams, Navigate } from 'react-router-dom';

const DraftNotice = () => (
  <p className="mt-6 mb-8 inline-block rounded-md border border-warn/30 bg-warn-soft px-3 py-1.5 text-2xs font-medium text-warn">
    DRAFT FOR REVIEW
  </p>
);

const TermsBody = () => (
  <article className="space-y-8 text-sm leading-relaxed text-ink-700">
    <DraftNotice />

    <section>
      <h2 className="font-display text-lg font-semibold text-ink-900 mb-2">1. About Acadova</h2>
      <p>
        Acadova is an academic and daily routine companion for students. It lets you record your
        semesters, subjects, labs, weekly college timetable, attendance, and personal routines. The
        service is provided as-is; sections marked for review will be completed before any public
        release.
      </p>
    </section>

    <section>
      <h2 className="font-display text-lg font-semibold text-ink-900 mb-2">2. Your account</h2>
      <p>
        You are responsible for the accuracy of the academic data you enter and for keeping your
        password confidential. One account per person; do not share credentials.
      </p>
    </section>

    <section>
      <h2 className="font-display text-lg font-semibold text-ink-900 mb-2">3. Acceptable use</h2>
      <ul className="list-disc pl-5 space-y-1.5">
        <li>Enter only your own academic and routine information.</li>
        <li>Do not attempt to access other students' accounts or data.</li>
        <li>Do not disrupt or attempt to disrupt the availability of the service.</li>
      </ul>
    </section>

    <section>
      <h2 className="font-display text-lg font-semibold text-ink-900 mb-2">
        4. Data ownership and academic records
      </h2>
      <p>
        All semesters, subjects, timetables, attendance logs, and routines you create remain your
        records. Acadova derives attendance summaries and daily schedules from what you enter; it
        does not verify entries against any institution's official records. Always cross-check
        critical academic obligations with your institution.
      </p>
    </section>

    <section>
      <h2 className="font-display text-lg font-semibold text-ink-900 mb-2">5. Availability</h2>
      <p>
        The service is offered without uptime guarantees. Features may change; data-deleting actions
        (such as deleting a semester) always ask for confirmation first.
      </p>
    </section>

    <section>
      <h2 className="font-display text-lg font-semibold text-ink-900 mb-2">6. Changes to these terms</h2>
      <p>
        These terms may be revised. Continued use of Acadova after a revision constitutes
        acceptance of the updated terms. [Last updated date to be inserted on release.]
      </p>
    </section>
  </article>
);

const PrivacyBody = () => (
  <article className="space-y-8 text-sm leading-relaxed text-ink-700">
    <DraftNotice />

    <section>
      <h2 className="font-display text-lg font-semibold text-ink-900 mb-2">1. What we collect</h2>
      <ul className="list-disc pl-5 space-y-1.5">
        <li>
          <strong className="text-ink-900">Account data:</strong> your name, email address, and a
          salted bcrypt hash of your password. We never store your password in plain text.
        </li>
        <li>
          <strong className="text-ink-900">Academic data you enter:</strong> semesters, subjects,
          lab sections, working days, custom time slots, timetable entries, holidays and
          exceptions, and attendance you mark.
        </li>
        <li>
          <strong className="text-ink-900">Routine data you enter:</strong> personal routine items,
          their schedules, recurrence rules, and per-date completion state.
        </li>
      </ul>
    </section>

    <section>
      <h2 className="font-display text-lg font-semibold text-ink-900 mb-2">2. Why we process it</h2>
      <p>
        Solely to operate Acadova for you: generating today's classes from your timetable,
        computing attendance percentages against your target, and showing your routines. There are
        no advertising, tracking, or profiling uses. [Analytics, if ever added, will be disclosed
        here before activation.]
      </p>
    </section>

    <section>
      <h2 className="font-display text-lg font-semibold text-ink-900 mb-2">3. Security</h2>
      <p>
        Sessions use signed JSON Web Tokens transmitted over HTTPS in production. Passwords are
        hashed with bcrypt. All academic and routine records are scoped to your authenticated
        account and cannot be read by other accounts.
      </p>
    </section>

    <section>
      <h2 className="font-display text-lg font-semibold text-ink-900 mb-2">4. Sharing</h2>
      <p>
        We do not sell or share your academic or routine data with third parties. No data is used
        to train models. [If hosting or subprocessors change, list them here.]
      </p>
    </section>

    <section>
      <h2 className="font-display text-lg font-semibold text-ink-900 mb-2">5. Retention &amp; deletion</h2>
      <p>
        Your data is retained while your account exists. Deleting a semester removes its subjects,
        timetable, and attendance records after confirmation. Account deletion requests [process
        to be defined, pending review] will remove your account and associated records.
      </p>
    </section>

    <section>
      <h2 className="font-display text-lg font-semibold text-ink-900 mb-2">6. Contact</h2>
      <p>[Contact address to be inserted on release.]</p>
    </section>
  </article>
);

export const Legal = () => {
  const { doc } = useParams();

  if (doc !== 'terms' && doc !== 'privacy') return <Navigate to="/legal/terms" replace />;

  const isTerms = doc === 'terms';

  return (
    <div className="min-h-screen bg-paper px-4 sm:px-6 py-10 sm:py-16">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-2.5 mb-8">
          <span className="w-7 h-7 rounded-md bg-accent flex items-center justify-center" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round">
              <path d="M5 7h14M5 12h14M5 17h9" />
            </svg>
          </span>
          <span className="font-display font-semibold text-lg tracking-tightest text-ink-900">Acadova</span>
        </div>

        <h1 className="font-display text-3xl font-semibold tracking-tightest text-ink-900 mb-2">
          {isTerms ? 'Terms of Service' : 'Privacy Policy'}
        </h1>
        <p className="text-sm text-ink-500 mb-8">
          {isTerms
            ? 'The agreement between you and Acadova when you use the application.'
            : 'What Acadova collects, why, and how it is protected.'}
        </p>

        <div className="bg-surface border border-line rounded-xl shadow-card px-6 sm:px-10 py-8">
          {isTerms ? <TermsBody /> : <PrivacyBody />}
        </div>

        <div className="flex items-center gap-5 mt-8 text-xs">
          <Link to="/legal/terms" className={isTerms ? 'text-accent-strong font-medium' : 'text-ink-500 hover:text-ink-900'}>
            Terms of Service
          </Link>
          <Link to="/legal/privacy" className={!isTerms ? 'text-accent-strong font-medium' : 'text-ink-500 hover:text-ink-900'}>
            Privacy Policy
          </Link>
          <Link to="/login" className="ml-auto text-ink-500 hover:text-ink-900">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Legal;
