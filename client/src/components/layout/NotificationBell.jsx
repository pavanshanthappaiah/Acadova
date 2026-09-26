import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from '../common/Icons';
import API from '../../services/api';
import { useAuth } from '../../context/AuthContext';

/* ------------------------------------------------------------------ */
/* In-app notification bell — history lives on the server, not in      */
/* localStorage. Polls lightly and reflects delivered in-app items.    */
/* ------------------------------------------------------------------ */

const CATEGORY_LINKS = {
  project: '/projects',
  assignment: '/academics',
  quiz: '/academics',
  internal: '/academics',
  labInternal: '/academics',
  routine: '/routine',
  class: '/routine',
  lab: '/routine',
  attendance: '/academics?tab=attendance',
  academicDate: '/academics',
};

const CATEGORY_TONES = {
  assignment: 'bg-accent-soft text-accent-strong',
  quiz: 'bg-accent-soft text-accent-strong',
  internal: 'bg-warn-soft text-warn',
  labInternal: 'bg-warn-soft text-warn',
  attendance: 'bg-danger-soft text-danger',
};

const timeAgo = (iso) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

export const NotificationBell = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const wrapRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await API.get('/notifications?limit=12');
      setItems(res.data.items || []);
      setUnread(res.data.unread || 0);
    } catch {
      /* silent — the bell must never break the header */
    }
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [user, load]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      await load();
      if (unread > 0) {
        try {
          const res = await API.post('/notifications/read', {});
          setUnread(0);
          void res;
        } catch {
          /* ignore */
        }
      }
    }
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        aria-expanded={open}
        onClick={toggle}
        className="relative p-2 -mr-1 rounded-md text-ink-500 hover:text-ink-900 hover:bg-paper-deep focus-visible:outline-none focus-visible:shadow-focus-accent transition-colors"
      >
        <Bell className="w-[18px] h-[18px]" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-[15px] h-[15px] px-0.5 rounded-full bg-accent text-white text-[9px] font-semibold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-24px)] bg-surface border border-line-strong rounded-lg shadow-card z-50 overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-line flex items-center justify-between">
            <p className="text-xs font-semibold text-ink-900">Notifications</p>
            <a href="/settings" className="text-2xs text-accent-strong hover:underline">
              Settings
            </a>
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-line">
            {items.length === 0 && (
              <div className="px-3.5 py-6 text-center">
                <p className="text-xs text-ink-500">No notifications yet.</p>
                <p className="text-2xs text-ink-400 mt-1">
                  Reminders you enable in Settings will appear here.
                </p>
              </div>
            )}
            {items.map((n) => (
              <a
                key={n._id}
                href={CATEGORY_LINKS[n.category] || n.link || '/'}
                onClick={() => setOpen(false)}
                className="block px-3.5 py-2.5 hover:bg-paper-deep/60 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-medium text-ink-900 leading-snug">{n.title}</p>
                  <span className="text-2xs text-ink-400 shrink-0">{timeAgo(n.createdAt)}</span>
                </div>
                {n.body && <p className="text-2xs text-ink-500 mt-0.5 leading-snug">{n.body}</p>}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
