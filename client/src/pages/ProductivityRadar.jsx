import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, TrendingDown, Award, Clock, CheckCircle2 } from '../components/common/Icons';
import API from '../services/api';
import {
  Button, Card, Field, Textarea, Modal, Badge, EmptyState, SegmentedControl,
  PageHeader, PageFrame, SectionHeader, Skeleton, StateNote,
} from '../components/common/ui';
import { Reveal, AnimatedValue } from '../components/common/motion';

/* ------------------------------------------------------------------ */
/* Reviews                                                             */
/*                                                                     */
/* Every panel here states one of three honest things: what was         */
/* measured, that there is nothing to measure yet, or that the request  */
/* failed. A failed request is never rendered as an empty result, and   */
/* nothing is concluded that the logged data does not support.          */
/* ------------------------------------------------------------------ */

const RANGES = [
  { key: 'radar', title: 'Next 24 to 48 hours', tone: 'danger', icon: AlertTriangle },
  { key: 'approaching', title: '2 to 3 days out', tone: 'warn', icon: Clock },
  { key: 'upcoming', title: '4 to 7 days out', tone: 'neutral', icon: Clock },
];

const prettyDay = (dateStr) => {
  if (!dateStr) return '';
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' });
};

export const ProductivityRadar = () => {
  const [tab, setTab] = useState('radar');

  const [radar, setRadar] = useState(null);
  const [timeLeaks, setTimeLeaks] = useState(null);
  const [consistency, setConsistency] = useState(null);
  const [weeklyReview, setWeeklyReview] = useState(null);

  // Per-panel failure reasons, so one dead endpoint never masquerades as
  // "you have no data" in that panel.
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutForm, setCheckoutForm] = useState({
    completedText: '', missedText: '', energyLevel: 'medium', tomorrowPriority: '', reflectionNotes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const requests = {
      radar: API.get('/productivity/radar'),
      leaks: API.get('/productivity/time-leaks'),
      consistency: API.get('/productivity/consistency'),
      review: API.get('/productivity/weekly-review'),
    };
    const setters = {
      radar: setRadar,
      leaks: setTimeLeaks,
      consistency: setConsistency,
      review: setWeeklyReview,
    };
    const results = await Promise.allSettled(Object.values(requests));
    const nextErrors = {};
    Object.keys(requests).forEach((key, i) => {
      const result = results[i];
      const setValue = setters[key];
      if (result.status !== 'fulfilled') {
        setValue(null);
        nextErrors[key] = result.reason?.response?.data?.message
          || 'Unable to load this review. Please try again.';
        return;
      }
      const payload = result.value?.data;
      // A 200 that says success:false is a failed load, not an empty one.
      if (!payload?.success) {
        setValue(null);
        nextErrors[key] = payload?.message || 'The server returned an unexpected response.';
        return;
      }
      setValue(payload);
    });
    setErrors(nextErrors);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load, nonce]);

  const submitCheckout = async (e) => {
    e.preventDefault();
    setCheckoutError('');
    setCheckoutBusy(true);
    const toLines = (t) => t.split('\n').map((s) => s.trim()).filter(Boolean);
    try {
      const res = await API.post('/productivity/checkout', {
        ...checkoutForm,
        completedItems: toLines(checkoutForm.completedText),
        missedItems: toLines(checkoutForm.missedText),
      });
      if (!res.data?.success) throw new Error();
      setCheckoutOpen(false);
      setCheckoutForm({ completedText: '', missedText: '', energyLevel: 'medium', tomorrowPriority: '', reflectionNotes: '' });
      setNonce((n) => n + 1);
    } catch (err) {
      setCheckoutError(
        err.response?.data?.message || 'Could not save the checkout. Please try again.'
      );
    } finally {
      setCheckoutBusy(false);
    }
  };

  const currentError = errors[tab];

  const buckets = radar?.urgencyBuckets || {};
  const deadlineCount = radar?.totalDeadlines ?? 0;
  const leaks = timeLeaks?.recentLeaks || [];
  const streaks = consistency?.streaks || [];
  const observations = weeklyReview?.observations || [];

  /* ------------------------- shared panel states ------------------------- */

  // One placeholder shape per tab, rendered while the request is in flight.
  // The page header never disappears, so the tab you chose stays visible.
  const PanelSkeleton = ({ rows = 3 }) => (
    <Card className="p-5 sm:p-6" aria-hidden="true">
      <Skeleton className="h-3 w-40" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className={`h-3 ${i === rows - 1 ? 'w-1/2' : 'w-full'}`} />
        ))}
      </div>
    </Card>
  );

  const PanelError = ({ message, onRetry }) => (
    <StateNote
      tone="error"
      title={message}
      action={
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  );

  return (
    <PageFrame>
      <PageHeader
        meta="Growth"
        title="Reviews"
        description="Review your deadlines, schedule variance, and consistency."
        hint="Computed only from what you logged: deadlines met, planned versus actual schedule variance, and consistency across weeks. No data means no review."
        actions={
          <>
            <SegmentedControl
              ariaLabel="Review section"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'radar', label: 'Deadlines' },
                { value: 'leaks', label: 'Time leaks' },
                { value: 'consistency', label: 'Streaks' },
                { value: 'review', label: 'Weekly' },
              ]}
              className="flex-wrap"
            />
            <Button size="sm" variant="secondary" onClick={() => { setCheckoutError(''); setCheckoutOpen(true); }}>
              End-of-day checkout
            </Button>
          </>
        }
      />

      {currentError && !loading && <PanelError message={currentError} onRetry={() => setNonce((n) => n + 1)} />}

      {!currentError && (
        <>
          {/* ------------------------------ DEADLINES ------------------------------ */}
          {tab === 'radar' && (loading && !radar ? (
            <PanelSkeleton rows={3} />
          ) : (
            <Reveal className="space-y-4">
              {/* The headline figure answers "is anything due" before the lists do. */}
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-line bg-surface-muted px-4 py-3.5 sm:px-5">
                <span className="font-display text-2xl font-semibold leading-none text-ink-900">
                  <AnimatedValue value={deadlineCount} />
                </span>
                <span className="text-sm text-ink-600">
                  {deadlineCount === 1 ? 'deadline tracked' : 'deadlines tracked'}
                </span>
                <span className="text-xs text-ink-400">
                  Assignments and exams you recorded in Assessments.
                </span>
              </div>

              {deadlineCount === 0 ? (
                <Card>
                  <EmptyState
                    icon={Award}
                    title="Nothing due in the next week"
                    description="Deadlines you record in Assessments appear here, grouped by how close they are."
                  />
                </Card>
              ) : (
                RANGES.map(({ key, title, tone, icon: Icon }) => {
                  const items = buckets[key] || [];
                  return (
                    <Card key={key} className="p-5 sm:p-6">
                      <SectionHeader
                        level={3}
                        title={title}
                        description={items.length === 0 ? 'Nothing in this window.' : undefined}
                        aside={
                          items.length > 0 ? (
                            <Badge tone={tone === 'neutral' ? 'neutral' : tone}>{items.length}</Badge>
                          ) : undefined
                        }
                        className={items.length === 0 ? 'mb-0' : 'mb-4'}
                      />
                      {items.length > 0 && (
                        <ul className="divide-y divide-line">
                          {items.map((item) => (
                            <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                              <div className="min-w-0">
                                <p className="truncate text-sm text-ink-900">{item.title}</p>
                                {item.subtitle && <p className="text-2xs text-ink-500">{item.subtitle}</p>}
                              </div>
                              {/* The date is metadata: the window heading already
                                  carries the urgency, so the chip stays neutral. */}
                              <Badge>{item.date}</Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Card>
                  );
                })
              )}
            </Reveal>
          ))}

          {/* ------------------------------ TIME LEAKS ----------------------------- */}
          {tab === 'leaks' && (loading && !timeLeaks ? (
            <PanelSkeleton rows={4} />
          ) : (
            <Reveal>
              <Card className="p-5 sm:p-6">
                <SectionHeader
                  title="Schedule variance"
                  description="Planned versus actual time on the blocks you completed, over the last 14 days."
                  aside={
                    timeLeaks?.totalLostMinutes > 0 ? (
                      <Badge tone="danger">
                        {timeLeaks.totalLostMinutes} {timeLeaks.totalLostMinutes === 1 ? 'minute' : 'minutes'} over
                      </Badge>
                    ) : undefined
                  }
                  className="mb-5"
                />

                {leaks.length === 0 ? (
                  <EmptyState
                    icon={TrendingDown}
                    title="No significant variance"
                    description="Blocks you complete stay recorded here. Overruns and underruns appear as they happen."
                  />
                ) : (
                  <ul className="divide-y divide-line">
                    {leaks.map((leak, idx) => (
                      <li key={idx} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-ink-900">{leak.title}</p>
                          <p className="mt-0.5 text-2xs text-ink-500">
                            Planned {leak.planned}m, actual {leak.actual}m
                          </p>
                        </div>
                        <Badge tone={leak.type === 'overrun' ? 'danger' : 'warn'}>
                          {leak.type === 'overrun' ? '+' : '-'}
                          {leak.leakMinutes}m
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </Reveal>
          ))}

          {/* ------------------------------ STREAKS ------------------------------- */}
          {tab === 'consistency' && (loading && !consistency ? (
            <PanelSkeleton rows={2} />
          ) : streaks.length === 0 ? (
            <Card>
              <EmptyState
                icon={Award}
                title="No consistency data yet"
                description="Streaks build from your logged problems, attended classes, and completed activity blocks."
              />
            </Card>
          ) : (
            <Reveal>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {streaks.map((st, idx) => (
                  <Card key={idx} className="flex flex-col gap-3 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="text-sm font-semibold tracking-tight text-ink-900">{st.name}</h2>
                      {st.activeToday && <Badge tone="ok" dot>Today</Badge>}
                    </div>
                    <p className="flex items-baseline gap-1.5">
                      <span className="font-display text-3xl font-semibold leading-none text-ink-900">
                        <AnimatedValue value={st.streak} />
                      </span>
                      <span className="text-sm text-ink-500">{st.streak === 1 ? 'day' : 'days'}</span>
                    </p>
                    {/* A zero must say why, not just sit there as a bare 0. */}
                    <p className="text-2xs leading-relaxed text-ink-400">
                      {st.streak > 0
                        ? st.criterion
                        : st.activeToday
                          ? `${st.criterion} — today counts from tomorrow.`
                          : `No consecutive run yet. ${st.criterion}.`}
                    </p>
                  </Card>
                ))}
              </div>
            </Reveal>
          ))}

          {/* ------------------------------- WEEKLY -------------------------------- */}
          {tab === 'review' && (loading && !weeklyReview ? (
            <PanelSkeleton rows={3} />
          ) : (
            <Reveal>
              {!weeklyReview?.hasActivity ? (
                <Card>
                  <EmptyState
                    icon={Award}
                    title="Nothing logged this week yet"
                    description={`The weekly audit covers ${weeklyReview?.weekRange || 'the last seven days'}. Complete a study block, solve a problem, or log project hours and the review will be built from it.`}
                  />
                </Card>
              ) : (
                <Card className="overflow-hidden">
                  <div className="grid lg:grid-cols-[minmax(0,1fr)_22rem]">
                    <div className="p-5 sm:p-6">
                      <p className="text-2xs font-medium uppercase tracking-wide2 text-ink-400">
                        Logged this week
                      </p>
                      <p className="mt-2.5 flex items-baseline gap-2">
                        <span className="font-display text-[3rem] font-semibold leading-none tracking-tightest text-ink-900">
                          <AnimatedValue value={weeklyReview?.totalHours ?? 0} format={(v) => (Math.round(v * 10) / 10).toString()} />
                        </span>
                        <span className="text-sm font-medium text-ink-500">hours</span>
                      </p>
                      <p className="mt-3 text-sm text-ink-500">
                        {weeklyReview.completedTasks} completed{' '}
                        {weeklyReview.completedTasks === 1 ? 'block' : 'blocks'} across{' '}
                        {weeklyReview.weekRange}
                      </p>
                      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4">
                        <div>
                          <dt className="text-2xs font-medium uppercase tracking-wide2 text-ink-400">Busiest day</dt>
                          <dd className="mt-1 text-sm font-medium text-ink-900">
                            {weeklyReview.bestDay ? (
                              <>
                                {prettyDay(weeklyReview.bestDay)}
                                {weeklyReview.bestDayTied && (
                                  <span className="text-ink-400"> (tied)</span>
                                )}
                              </>
                            ) : (
                              'Not enough data'
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-2xs font-medium uppercase tracking-wide2 text-ink-400">Peak focus band</dt>
                          <dd className="mt-1 text-sm font-medium text-ink-900">
                            {weeklyReview.peakWindow || 'Not enough data'}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <div className="border-t border-line bg-surface-muted p-5 sm:p-6 lg:border-l lg:border-t-0">
                      <p className="text-2xs font-medium uppercase tracking-wide2 text-ink-400">
                        Hours by area
                      </p>
                      <div className="mt-4 space-y-3.5">
                        {[
                          { label: 'Academic', key: 'studyHours', tone: 'accent' },
                          { label: 'Coding', key: 'codingHours', tone: 'neutral' },
                          { label: 'Projects', key: 'projectHours', tone: 'accent' },
                          { label: 'Health', key: 'healthHours', tone: 'neutral' },
                        ].map((area) => {
                          const value = weeklyReview?.[area.key] ?? 0;
                          const total = weeklyReview?.totalHours || 0;
                          const pct = total > 0 ? (value / total) * 100 : 0;
                          return (
                            <div key={area.key}>
                              <div className="flex items-baseline justify-between gap-3">
                                <span className="text-xs text-ink-600">{area.label}</span>
                                <span
                                  className="text-xs font-medium text-ink-900"
                                  style={{ fontVariantNumeric: 'tabular-nums' }}
                                >
                                  {value} h
                                </span>
                              </div>
                              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
                                <div
                                  className={`meter-fill h-full rounded-full ${area.tone === 'accent' ? 'bg-accent' : 'bg-ink-300'}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </Card>
              )}

              {observations.length > 0 && (
                <Card className="mt-4 p-5 sm:p-6">
                  <SectionHeader
                    title="What the week shows"
                    description="Each line is derived from the figures above."
                    className="mb-4"
                  />
                  <ul className="space-y-2.5">
                    {observations.map((obs, idx) => (
                      <li key={idx} className="flex items-start gap-2.5 text-sm leading-relaxed text-ink-700">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                        {obs}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </Reveal>
          ))}
        </>
      )}

      {/* --------------------------- checkout modal --------------------------- */}
      <Modal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        title="End-of-day checkout"
        subtitle="A short, honest close to the day."
      >
        <form onSubmit={submitCheckout} className="space-y-4">
          {checkoutError && <StateNote tone="error">{checkoutError}</StateNote>}
          <Field label="What did you complete today?" hint="One item per line.">
            <Textarea
              rows={3}
              value={checkoutForm.completedText}
              onChange={(e) => setCheckoutForm({ ...checkoutForm, completedText: e.target.value })}
            />
          </Field>
          <Field label="What was missed or deferred?">
            <Textarea
              rows={2}
              value={checkoutForm.missedText}
              onChange={(e) => setCheckoutForm({ ...checkoutForm, missedText: e.target.value })}
            />
          </Field>
          {/* A segmented control owns its accessible name through `ariaLabel`,
              so it is not wrapped in a Field (whose label would point at an id
              the control does not accept). */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-600">Energy level</p>
            <SegmentedControl
              ariaLabel="Energy level"
              value={checkoutForm.energyLevel}
              onChange={(level) => setCheckoutForm({ ...checkoutForm, energyLevel: level })}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ]}
              className="flex-wrap"
            />
          </div>
          <Field label="Tomorrow's top priority" required>
            <Textarea
              rows={2}
              required
              value={checkoutForm.tomorrowPriority}
              onChange={(e) => setCheckoutForm({ ...checkoutForm, tomorrowPriority: e.target.value })}
            />
          </Field>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="secondary" onClick={() => setCheckoutOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={checkoutBusy}>
              {checkoutBusy ? 'Saving' : 'Save checkout'}
            </Button>
          </div>
        </form>
      </Modal>
    </PageFrame>
  );
};

export default ProductivityRadar;
