import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  CalendarDays,
  ClipboardList,
  ListChecks,
  FolderGit2,
  Code2,
  GraduationCap,
  Settings as SettingsIcon,
  LogOut,
  X,
} from '../common/Icons';
import { useAuth } from '../../context/AuthContext';

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/*                                                                     */
/* Four groups, fixed order: what is happening today, then academics,   */
/* then growth work, then account. One icon size throughout, one        */
/* active treatment (a 2px accent rule plus a tinted wash), and no      */
/* enlarged icons or oversized active pills.                            */
/* ------------------------------------------------------------------ */
export const NAV_GROUPS = [
  {
    label: 'Daily',
    items: [
      { name: 'Today', path: '/', icon: CalendarDays, end: true },
      { name: 'My Day', path: '/routine', icon: ListChecks },
    ],
  },
  {
    label: 'Academics',
    items: [{ name: 'Semester', path: '/academics', icon: GraduationCap }],
  },
  {
    label: 'Growth',
    items: [
      { name: 'Projects', path: '/projects', icon: FolderGit2 },
      { name: 'Problems', path: '/problems', icon: Code2 },
      { name: 'Reviews', path: '/productivity', icon: ClipboardList },
    ],
  },
  {
    label: 'Account',
    items: [{ name: 'Settings', path: '/settings', icon: SettingsIcon }],
  },
];

export const Sidebar = ({ isOpen, setIsOpen }) => {
  const { user, logout } = useAuth();

  return (
    <>
      {isOpen && (
        <div
          className="animate-fade-in fixed inset-0 z-40 bg-ink-900/25 lg:hidden"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        aria-label="Primary navigation"
        className={`fixed bottom-0 left-0 top-0 z-50 flex w-64 flex-col border-r border-line bg-paper transition-transform duration-200 ease-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Brand lockup. The mark is dark artwork on a near-white field, so
            multiply blends its background into the paper instead of showing
            a tile. */}
        <div className="flex h-16 items-center justify-between border-b border-line px-5">
          <div className="flex items-center gap-2.5">
            <img
              src="/acadova-mark.png"
              alt=""
              width="30"
              height="30"
              className="h-[30px] w-[30px] shrink-0 mix-blend-multiply"
              aria-hidden="true"
            />
            <span className="font-display text-[17px] font-semibold tracking-tightest text-ink-900">
              Acadova
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="Close navigation"
            className="pressable rounded p-1.5 text-ink-400 hover:bg-paper-deep hover:text-ink-900 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-6 last:mb-0">
              <p className="mb-2 px-3 text-2xs font-semibold uppercase tracking-wide2 text-ink-400">
                {group.label}
              </p>
              <div className="space-y-px">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.end}
                      onClick={() => setIsOpen(false)}
                      className={({ isActive }) =>
                        [
                          'nav-item flex h-9 items-center gap-2.5 rounded pl-3.5 pr-3 text-sm',
                          isActive
                            ? 'bg-accent-wash font-semibold text-accent-strong'
                            : 'text-ink-600 hover:bg-paper-deep/70 hover:text-ink-900',
                        ].join(' ')
                      }
                    >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                      <span className="truncate">{item.name}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Active semester. Real user data only, or nothing at all. */}
        {user?.semester && (
          <div className="mx-3 mb-3 rounded-lg border border-line bg-surface-muted px-3.5 py-3">
            <p className="text-2xs font-semibold uppercase tracking-wide2 text-ink-400">
              Active semester
            </p>
            <p className="mt-1 truncate text-sm font-medium text-ink-900">
              Semester {user.semester}
              {user.branch ? ` · ${user.branch.split(' ')[0]}` : ''}
            </p>
            {user.targetAttendance ? (
              <p className="mt-0.5 text-2xs text-ink-500">Attendance target {user.targetAttendance}%</p>
            ) : null}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-accent-fade bg-accent-soft text-xs font-semibold text-accent-strong"
            >
              {user?.name ? user.name.charAt(0).toUpperCase() : 'S'}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-ink-900">{user?.name || 'Student'}</p>
              <p className="truncate text-2xs text-ink-400">{user?.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            aria-label="Sign out"
            title="Sign out"
            className="pressable shrink-0 rounded p-1.5 text-ink-400 hover:bg-danger-soft hover:text-danger"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
