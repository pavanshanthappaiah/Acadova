import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';

export const AppLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { pathname } = useLocation();

  return (
    <div className="flex min-h-screen bg-paper">
      {/* Keyboard users should be able to jump the navigation groups. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded focus:border focus:border-accent focus:bg-surface focus:px-3.5 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-strong"
      >
        Skip to content
      </a>

      <Sidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />

        <main
          id="main-content"
          className="mx-auto w-full max-w-content flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-9"
        >
          {/* Keyed on the route so each page settles in once on entry. The
              distance is small and it never delays the content. */}
          <div key={pathname} className="page-enter">
            <Outlet />
          </div>
        </main>

        <footer className="no-print border-t border-line px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-content flex-col items-center justify-between gap-3 text-2xs text-ink-400 sm:flex-row">
            <p>Acadova. Academic and daily companion for students.</p>
            <div className="flex items-center gap-5">
              <Link className="hover:text-ink-700" to="/legal/terms">
                Terms of Service
              </Link>
              <Link className="hover:text-ink-700" to="/legal/privacy">
                Privacy Policy
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default AppLayout;
