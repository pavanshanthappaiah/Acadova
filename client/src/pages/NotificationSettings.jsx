import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, BellRing, Check } from '../components/common/Icons';
import API from '../services/api';
import { Button, Card, SectionHeader } from '../components/common/ui';
import { useAuth } from '../context/AuthContext';

/* ------------------------------------------------------------------ */
/* Notification preferences — the student controls everything          */
/*                                                                     */
/* Master switch → channels (with browser permission flow) →           */
/* per-category progressive disclosure: enable, channels, reminders.   */
/* Nothing is hardcoded: every timing is user-selected, and changing   */
/* preferences resyncs future reminders immediately.                   */
/* ------------------------------------------------------------------ */

const b64urlToUint8 = (base64) => {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

const urlBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const Toggle = ({ checked, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-focus-accent ${
      checked ? 'bg-accent border-accent' : 'bg-paper-deep border-line-strong'
    }`}
  >
    <span
      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-surface border transition-transform duration-150 ${
        checked ? 'translate-x-[19px] border-accent' : 'translate-x-[2px] border-line-strong'
      }`}
    />
  </button>
);

/** One collapsible top-level block inside the notifications card. */
const Disclosure = ({ id, label, open, onToggle, disabled = false, children }) => (
  <div className={`border-b border-line ${disabled ? 'opacity-45 pointer-events-none' : ''}`}>
    <button
      type="button"
      aria-expanded={open}
      aria-controls={id}
      onClick={onToggle}
      className="w-full flex items-center justify-between gap-3 py-3 text-left"
    >
      <span className="text-xs font-semibold uppercase tracking-wide2 text-ink-400">{label}</span>
      <ChevronDown className={`w-3.5 h-3.5 text-ink-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && (
      <div id={id} className="pb-3">
        {children}
      </div>
    )}
  </div>
);

const LeadSelect = ({ options, value, onChange, ariaLabel }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const selected = options.filter((o) => value.includes(o.minutes));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className="w-full sm:w-80 inline-flex items-center justify-between gap-2 text-xs px-3 h-8 rounded-md border border-line-strong bg-surface text-ink-700 hover:border-accent focus-visible:outline-none focus-visible:shadow-focus-accent"
      >
        <span className="truncate text-left flex-1">
          {selected.length ? selected.map((o) => o.label).join(', ') : 'No reminders selected'}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-ink-400 shrink-0" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-40 mt-1 w-full sm:w-80 bg-surface border border-line-strong rounded-md shadow-card p-1.5 max-h-72 overflow-y-auto"
        >
          {options.map((o) => {
            const isOn = value.includes(o.minutes);
            return (
              <button
                key={o.minutes}
                type="button"
                role="option"
                aria-selected={isOn}
                onClick={() =>
                  onChange(isOn ? value.filter((m) => m !== o.minutes) : [...value, o.minutes])
                }
                className={`w-full flex items-center justify-between gap-2 px-2.5 h-8 rounded text-xs text-left ${
                  isOn ? 'bg-accent-soft text-accent-strong' : 'text-ink-700 hover:bg-paper-deep'
                }`}
              >
                <span>{o.label}</span>
                {isOn && <Check className="w-3.5 h-3.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const NotificationSettings = () => {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState(null);
  const [meta, setMeta] = useState(null);
  const [openCat, setOpenCat] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [permState, setPermState] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const [expandedDefaults, setExpandedDefaults] = useState(false);
  const [openBody, setOpenBody] = useState(false); // whole notifications config
  const [openDelivery, setOpenDelivery] = useState(false);
  const [openCategories, setOpenCategories] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await API.get('/notifications/preferences');
      setPrefs(res.data.preferences);
      setMeta(res.data);
    } catch (err) {
      setError('Could not load notification preferences.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (next) => {
      setError('');
      setMessage('');
      try {
        const res = await API.put('/notifications/preferences', next);
        setPrefs(res.data.preferences);
        setMessage(
          res.data?.sync?.created
            ? `Saved, ${res.data.sync.created} reminder(s) scheduled.`
            : 'Saved. Future reminders recalculated.'
        );
      } catch (err) {
        setError(err.response?.data?.message || 'Could not save preferences.');
      }
    },
    []
  );

  // A category can only deliver through a channel that is on both globally and
  // for that category — say so plainly rather than silently sending nothing.
  const channelsBlocked = (cat) =>
    !(
      (prefs.channels.webPush && cat.channels.webPush) ||
      (prefs.channels.email && cat.channels.email) ||
      (prefs.channels.inApp && cat.channels.inApp)
    );

  const patchCategory = (category, patch) => {
    const categories = prefs.categories.map((c) => {
      if (c.category !== category) return c;
      const next = { ...c, ...patch };
      // Turning a category on means it should actually deliver something: inherit
      // the master channels instead of leaving every channel off.
      if (patch.enabled === true && !next.channels.webPush && !next.channels.email && !next.channels.inApp) {
        next.channels = { ...prefs.channels };
      }
      return next;
    });
    save({ categories });
  };

  const patchChannel = (scope, channel, value) => {
    if (scope === 'global') {
      save({ channels: { ...prefs.channels, [channel]: value } });
    } else {
      const cat = prefs.categories.find((c) => c.category === scope);
      patchCategory(scope, { channels: { ...cat.channels, [channel]: value } });
    }
  };

  /* ---------------- web push permission flow ---------------- */
  const enableWebPush = async () => {
    setError('');
    try {
      if (typeof Notification === 'undefined') {
        setError('This browser does not support notifications.');
        return;
      }
      const permission = await Notification.requestPermission();
      setPermState(permission);
      if (permission !== 'granted') {
        setError('Browser notification permission was not granted.');
        return;
      }
      if (!meta?.vapidPublicKey) {
        setError(
          'Push is not configured on the server yet. Channel saved, but nothing can be delivered until VAPID keys are set.'
        );
        return;
      }
      const reg = await navigator.serviceWorker.register('/service-worker.js');
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64urlToUint8(meta.vapidPublicKey),
      });
      await API.post('/notifications/push/subscribe', sub.toJSON());
      setMessage('Browser notifications enabled.');
    } catch (err) {
      setError(err.message || 'Could not enable browser notifications.');
    }
  };

  const pushReady =
    permState === 'granted' && Boolean(meta?.vapidPublicKey) && 'serviceWorker' in navigator;

  const sendTest = async () => {
    try {
      const res = await API.post('/notifications/test');
      setMessage(res.data.note || 'Test dispatched.');
    } catch {
      setError('Test notification failed.');
    }
  };

  const catLabel = useMemo(() => {
    const map = new Map((meta?.categories || []).map((c) => [c.value, c.label]));
    return (v) => map.get(v) || v;
  }, [meta]);

  if (!prefs) {
    return (
      <Card className="p-5 sm:p-6">
        <SectionHeader title="Notifications" />
        <p className="text-sm text-ink-400">{error || 'Loading preferences…'}</p>
      </Card>
 );
  }

  const defaults = meta.leadOptions.filter((o) => prefs.categories.some((c) => c.leadMinutes.includes(o.minutes)));

  return (
    <Card className="p-5 sm:p-6">
      <SectionHeader
        title="Notifications"
        description={
          prefs.enabled
            ? 'On. You choose what is sent and exactly when.'
            : 'Off. No optional reminders are generated. Your delivered history is kept.'
        }
        hint="You decide whether reminders are sent, and exactly when. Nothing is sent on unselected timings."
        aside={
          <div className="flex items-center gap-2">
            <span className={`text-2xs font-medium ${prefs.enabled ? 'text-ok' : 'text-ink-400'}`}>
              {prefs.enabled ? 'On' : 'Off'}
            </span>
            {/* Master switch stays visible whether or not the config is open. */}
            <Toggle
              checked={prefs.enabled}
              onChange={(v) => save({ enabled: v })}
              label="Toggle notifications"
            />
            <button
              type="button"
              aria-expanded={openBody}
              aria-controls="notification-config"
              onClick={() => setOpenBody((v) => !v)}
              title={openBody ? 'Collapse notification settings' : 'Expand notification settings'}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-400 hover:text-ink-900 hover:bg-paper-deep transition-colors focus-visible:outline-none focus-visible:shadow-focus-accent"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${openBody ? 'rotate-180' : ''}`} />
            </button>
          </div>
        }
      />

      {/* The whole configuration sits behind the top-level disclosure so the
          Settings page stays compact; the master switch stays visible above. */}
      {openBody && (
      <div id="notification-config">
      {message && (
        <div role="status" className="mb-3 p-3 rounded-md bg-ok-soft border border-ok/25 text-ok text-xs flex items-center gap-2">
          <Check className="w-4 h-4" /> {message}
        </div>
      )}
      {error && (
        <div role="alert" className="mb-3 p-3 rounded-md bg-danger-soft border border-danger/25 text-danger text-xs">
          {error}
        </div>
      )}

      {/* ---------------- delivery channels ---------------- */}
      <Disclosure
        id="notification-delivery"
        label="Delivery"
        open={openDelivery}
        onToggle={() => setOpenDelivery((v) => !v)}
      >
        <div className="flex items-center justify-between gap-3 py-1.5">
          <div>
            <p className="text-sm text-ink-900">Web Push</p>
            <p className="text-2xs text-ink-500">
              Browser notifications.
              {permState === 'granted'
                ? ' Permission granted.'
                : permState === 'denied'
                ? ' Permission blocked in your browser settings.'
                : ' Permission not requested yet.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!pushReady && prefs.channels.webPush && (
              <Button size="xs" variant="secondary" onClick={enableWebPush}>
                Enable browser notifications
              </Button>
            )}
            <Toggle
              checked={prefs.channels.webPush}
              onChange={(v) => patchChannel('global', 'webPush', v)}
              label="Toggle web push"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 py-1.5">
          <div>
            <p className="text-sm text-ink-900">Email</p>
            <p className="text-2xs text-ink-500">
              {meta?.emailConfigured ? 'Delivered to your account email.' : 'No SMTP configured on this server. Delivery will be logged, not sent.'}
            </p>
          </div>
          <Toggle
            checked={prefs.channels.email}
            onChange={(v) => patchChannel('global', 'email', v)
            }
            label="Toggle email"
          />
        </div>

        <div className="flex items-center justify-between gap-3 py-1.5">
          <div>
            <p className="text-sm text-ink-900">In-App</p>
            <p className="text-2xs text-ink-500">Shown in the header bell.</p>
          </div>
          <Toggle
            checked={prefs.channels.inApp}
            onChange={(v) => patchChannel('global', 'inApp', v)}
            label="Toggle in-app"
          />
        </div>
      </Disclosure>

      {/* ---------------- categories ---------------- */}
      <Disclosure
        id="notification-categories"
        label="By category"
        open={openCategories}
        onToggle={() => setOpenCategories((v) => !v)}
      >
        <div className="flex items-center justify-end mb-2">
          <button
            type="button"
            className="text-2xs text-ink-400 hover:text-ink-600 underline decoration-line-strong"
            onClick={() => setExpandedDefaults((v) => !v)}
          >
            {expandedDefaults ? 'Hide defaults' : 'What are the defaults?'}
          </button>
        </div>

        {expandedDefaults && (
          <div className="mb-3 p-3 rounded-md bg-paper-deep border border-line text-2xs text-ink-600 space-y-1">
            <p>
              New students start with notifications <strong>on</strong> but every category{' '}
              <strong>off</strong> and no reminders selected. Nothing is sent until you turn it on.
            </p>
            <p>
              Default channels: in-app <strong>on</strong>, web push and email <strong>off</strong>.
              Reminders are planned up to 21 days ahead and recalculate the moment you save changes.
            </p>
          </div>
        )}

        <div className="divide-y divide-line border border-line rounded-lg overflow-hidden">
          {prefs.categories.map((cat) => {
            const isOpen = openCat === cat.category;
            const on = cat.enabled;
            return (
              <div key={cat.category} className={on ? 'bg-surface' : 'bg-surface'}>
                {/* CATEGORY | STATE | CHEVRON — fixed tracks, so a long category
                    name can never push the state or the chevron around. */}
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpenCat(isOpen ? null : cat.category)}
                  className="w-full grid grid-cols-[minmax(0,1fr)_3rem_1.25rem] items-center gap-2 px-3.5 py-2.5 hover:bg-paper-deep/60 transition-colors text-left"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${on ? 'bg-accent' : 'bg-line-strong'}`} />
                    <span className="text-sm text-ink-900 truncate">{catLabel(cat.category)}</span>
                    {on && (
                      <span className="text-2xs text-ink-400 truncate hidden sm:inline">
                        {channelsBlocked(cat)
                          ? 'no channel on'
                          : cat.leadMinutes.length
                            ? `${cat.leadMinutes.length} reminder timing(s)`
                            : 'no timings selected'}
                      </span>
                    )}
                  </span>
                  <span className={`text-2xs text-right ${on ? 'text-ok' : 'text-ink-400'}`}>
                    {on ? 'On' : 'Off'}
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-ink-400 justify-self-end transition-transform ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {isOpen && (
                  <div className="px-3.5 pb-3.5 pt-1 bg-paper-deep/40 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-ink-600">Enable notifications</span>
                      <Toggle
                        checked={on}
                        onChange={(v) => patchCategory(cat.category, { enabled: v })}
                        label={`Enable ${catLabel(cat.category)} notifications`}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-ink-600">Web push</span>
                      <Toggle
                        checked={cat.channels.webPush}
                        onChange={(v) => patchChannel(cat.category, 'webPush', v)}
                        label={`${catLabel(cat.category)} web push`}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-ink-600">Email</span>
                      <Toggle
                        checked={cat.channels.email}
                        onChange={(v) => patchChannel(cat.category, 'email', v)}
                        label={`${catLabel(cat.category)} email`}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-ink-600">In-app</span>
                      <Toggle
                        checked={cat.channels.inApp}
                        onChange={(v) => patchChannel(cat.category, 'inApp', v)}
                        label={`${catLabel(cat.category)} in-app`}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-ink-600">Remind me</span>
                      <LeadSelect
                        ariaLabel={`Reminder timing for ${catLabel(cat.category)}`}
                        options={meta.leadOptions}
                        value={cat.leadMinutes}
                        onChange={(mins) => patchCategory(cat.category, { leadMinutes: mins })}
                      />
                    </div>
                    <p className="text-2xs text-ink-400">
                      Exactly the timings you select fire reminders. Nothing else. Changing them
                      recalculates upcoming reminders; already-delivered history is kept.
                    </p>
                    {on && channelsBlocked(cat) && (
                      <p className="text-2xs text-warn" role="status">
                        No channel is on for {catLabel(cat.category)}, so nothing will be sent yet '
                        turn one on here and in Delivery above.
                      </p>
                    )}
                    {on && !cat.leadMinutes.length && (
                      <p className="text-2xs text-warn" role="status">
                        Pick at least one reminder timing, otherwise no reminder is generated.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Disclosure>

      {/* ---------------- test ---------------- */}
      <div className="mt-4 pt-4 border-t border-line flex items-center justify-between gap-3">
        <p className="text-2xs text-ink-500">Send a one-off test to the bell (respects your in-app channel settings).</p>
        <Button size="sm" variant="secondary" onClick={sendTest}>
          <BellRing className="w-3.5 h-3.5" /> Send test
        </Button>
      </div>
      </div>
      )}
    </Card>
  );
};

export default NotificationSettings;
