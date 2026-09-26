import React from 'react';
import { Link } from 'react-router-dom';

export const AuthShell = ({ title, subtitle, children, footer }) => (
  <div className="min-h-screen bg-paper flex flex-col items-center justify-center px-4 py-12">
    <div className="w-full max-w-md">
      <div className="flex justify-center mb-8">
        {/* The lockup already carries the wordmark, so it stands in for the
            mark + text pair; multiply blends its light field into the paper. */}
        <img
          src="/acadova-logo.png"
          alt="Acadova, plan, learn, do, grow"
          width="512"
          height="388"
          className="h-24 w-auto mix-blend-multiply"
        />
      </div>

      <h1 className="font-display text-2xl font-semibold tracking-tightest text-ink-900 text-center">
        {title}
      </h1>
      <p className="text-sm text-ink-500 text-center mt-1.5">{subtitle}</p>

      <div className="mt-8 bg-surface border border-line rounded-xl shadow-card p-6 sm:p-8">{children}</div>

      {footer && <div className="mt-6 text-center text-sm text-ink-500">{footer}</div>}

      <p className="mt-10 text-center text-2xs text-ink-400">
        <Link to="/legal/terms" className="hover:text-ink-600">Terms of Service</Link>
        <span className="mx-2" aria-hidden="true">·</span>
        <Link to="/legal/privacy" className="hover:text-ink-600">Privacy Policy</Link>
      </p>
    </div>
  </div>
);

export default AuthShell;
