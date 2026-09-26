import React from 'react';
import { Menu } from '../common/Icons';
import { useAuth } from '../../context/AuthContext';
import NotificationBell from './NotificationBell';

/* ------------------------------------------------------------------ */
/* Header                                                             */
/*                                                                     */
/* Sticky context bar: where you are in time on the left, account       */
/* actions on the right. It uses the page surface rather than a blurred */
/* overlay, so content scrolling underneath stays crisply separated by  */
/* a single hairline instead of a glass effect. Sits on the same content */
/* grid as the page below it.                                           */
/* ------------------------------------------------------------------ */
export const Header = ({ onOpenSidebar }) => {
  const { user } = useAuth();

  const now = new Date();
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateLabel = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper">
      <div className="mx-auto flex h-16 w-full max-w-content items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onOpenSidebar}
            aria-label="Open navigation"
            className="pressable -ml-2 rounded p-2 text-ink-600 hover:bg-paper-deep hover:text-ink-900 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden min-w-0 min-[400px]:block">
            <p className="truncate font-display text-sm font-semibold leading-tight text-ink-900">
              {weekday}
            </p>
            <p className="text-2xs leading-tight text-ink-500">{dateLabel}</p>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-3">
          <NotificationBell />
          {user?.name && (
            <p className="hidden truncate text-xs text-ink-500 sm:block">
              Signed in as <span className="font-medium text-ink-900">{user.name}</span>
            </p>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
