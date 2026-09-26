import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play } from './Icons';
import { Button } from './ui';

const SEEN_KEY = 'acadova.intro.seen';
/** The brand film, served from public/ so it streams without being bundled. */
const VIDEO_SRC = '/acadova-intro.mp4';
/** Hard ceiling: a hung video must never hold the app hostage. */
const WATCHDOG_MS = 25000;
/** Ceiling for the interactive fallback, in case the visitor walks away. */
const FALLBACK_MS = 20000;
/** Long enough for the 700ms fade to complete before the overlay unmounts. */
const FADE_MS = 750;

const shouldPlay = () => {
  try {
    // An intro film is exactly what reduced-motion asks us not to force.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    if (sessionStorage.getItem(SEEN_KEY)) return false;
  } catch {
    /* storage or matchMedia unavailable — play it */
  }
  return true;
};

const markSeen = () => {
  try {
    sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* private mode — the intro simply plays again next time */
  }
};

/**
 * The Acadova intro film, full bleed and full screen, played once per browser
 * session as the site is entered. It is always skippable (button, Escape, or a
 * click), it hands over immediately if the film cannot play, and if the browser
 * refuses muted autoplay it waits on a branded panel with a Play button rather
 * than showing nothing.
 */
export const IntroSplash = () => {
  const videoRef = useRef(null);
  const closedRef = useRef(false);
  const [phase, setPhase] = useState(() => (shouldPlay() ? 'playing' : 'off'));
  // The film eases in from the paper background rather than snapping on.
  const [revealed, setRevealed] = useState(false);

  const finish = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    setPhase('closing');
    window.setTimeout(() => setPhase('off'), FADE_MS);
  }, []);

  // Freeze the page behind the film and claim the session.
  useEffect(() => {
    if (phase === 'off') return undefined;
    markSeen();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => {
      if (event.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [phase, finish]);

  // Entry half of the fade. Hold the overlay at opacity 0 until the film has
  // decoded its first frame (so paper never pops into a half-loaded film), then
  // wait two painted frames — one commits opacity 0, the next flips it — so the
  // CSS transition always has a real start value and eases instead of snapping.
  // A timeout guarantees entry even on a stalled network. `finish` drives the
  // exit half the same way: the intro dissolves into the page beneath it.
  useEffect(() => {
    if (phase === 'off') return undefined;
    const video = videoRef.current;
    let rafA = 0;
    let rafB = 0;
    let settled = false;
    let fallback = 0;
    const reveal = () => {
      if (settled) return;
      settled = true;
      rafA = window.requestAnimationFrame(() => {
        rafB = window.requestAnimationFrame(() => setRevealed(true));
      });
    };
    const onReady = () => reveal();
    if (!video || video.readyState >= 2) reveal();
    else video.addEventListener('loadeddata', onReady);
    fallback = window.setTimeout(reveal, 700);
    return () => {
      settled = true;
      window.cancelAnimationFrame(rafA);
      window.cancelAnimationFrame(rafB);
      window.clearTimeout(fallback);
      if (video) video.removeEventListener('loadeddata', onReady);
    };
  }, [phase]);

  // Autoplay is only reliable when muted; a refusal is a prompt, not a failure.
  useEffect(() => {
    if (phase !== 'playing') return undefined;
    const video = videoRef.current;
    if (!video) return undefined;
    let cancelled = false;
    const attempt = video.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(() => {
        if (!cancelled && !closedRef.current) setPhase('blocked');
      });
    }
    const watchdog = window.setTimeout(finish, WATCHDOG_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(watchdog);
    };
  }, [phase, finish]);

  // The interactive fallback still hands over on its own.
  useEffect(() => {
    if (phase !== 'blocked') return undefined;
    const timer = window.setTimeout(finish, FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [phase, finish]);

  const startPlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    const attempt = video.play();
    if (attempt && typeof attempt.catch === 'function') attempt.catch(() => finish());
    setPhase('playing');
  };

  if (phase === 'off') return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Acadova intro"
      onClick={finish}
      className={`fixed inset-0 z-[60] overflow-hidden bg-paper transition-opacity duration-700 ${
        phase === 'closing' || !revealed ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {phase === 'blocked' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-8 px-6 bg-paper">
          <img
            src="/acadova-logo.png"
            alt="Acadova"
            width="512"
            height="388"
            className="h-20 sm:h-24 w-auto mix-blend-multiply"
          />
          <Button size="md" onClick={startPlayback}>
            <Play className="w-4 h-4" /> Play intro
          </Button>
        </div>
      ) : (
        <video
          ref={videoRef}
          src={VIDEO_SRC}
          autoPlay
          muted
          playsInline
          preload="auto"
          onEnded={finish}
          onError={finish}
          className="absolute inset-0 w-full h-full object-cover bg-paper"
          aria-label="Acadova brand film"
        />
      )}

      {/* Footer: the brand lockup sits at the foot of the screen. Its near-white
          plate is multiplied away by the paper film behind it, so only the mark
          and wordmark read. */}
      {phase !== 'blocked' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 sm:bottom-7 flex justify-center">
          <img
            src="/acadova-logo.png"
            alt="Acadova"
            width="512"
            height="388"
            className="h-8 sm:h-10 w-auto mix-blend-multiply opacity-90"
          />
        </div>
      )}

      {/* Skip control: no plate, no border — it blends into the film and only
          asserts itself on hover or keyboard focus. */}
      {phase !== 'blocked' && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            finish();
          }}
          autoFocus
          className="absolute bottom-5 sm:bottom-7 right-5 sm:right-7 rounded-sm px-1 py-1 text-xs sm:text-sm tracking-wide text-ink-400 transition-colors hover:text-ink-600 focus-visible:text-ink-900"
        >
          Skip intro
        </button>
      )}
    </div>
  );
};

export default IntroSplash;
