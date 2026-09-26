/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /* ---- Canvas ---- */
        paper: {
          DEFAULT: '#F7F5F1', // warm near-white page background (never pure white)
          deep: '#F1EEE8',    // sunken wells, table headers
        },
        /* ---- Surfaces ---- */
        surface: {
          DEFAULT: '#FFFFFF',
          muted: '#FBFAF7',
        },
        /* ---- Ink (text) ---- */
        ink: {
          900: '#1C1917', // primary text
          700: '#3F3B37', // strong secondary
          600: '#57534E', // secondary
          500: '#78716C', // muted text
          400: '#9B948C', // faint text
          300: '#C0B9AF', // disabled
        },
        /* ---- Lines ---- */
        line: {
          DEFAULT: '#E7E2DA', // hairline borders
          strong: '#D8D1C6',  // emphasized borders
          accent: '#BFD6D2',  // accent hairline
        },
        /* ---- The one accent: deep teal ---- */
        accent: {
          DEFAULT: '#0F6E63',
          strong: '#0A544C',
          soft: '#E4EEEC',   // tinted fills
          wash: '#F0F5F4',   // faintest fill
          fade: '#7FA39D',   // quiet accent text on paper
        },
        /* ---- Support hues (used sparingly, desaturated) ---- */
        ok: {
          DEFAULT: '#217A57',
          soft: '#E3EFE7',
        },
        warn: {
          DEFAULT: '#A05E1F',
          soft: '#F4EAD9',
        },
        danger: {
          DEFAULT: '#B4423D',
          soft: '#F6E4E2',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Helvetica Neue',
          'Arial', 'system-ui', 'sans-serif',
        ],
        display: [
          'Charter', 'Bitstream Charter', 'Sitka Text', 'Cambria',
          'Georgia', 'ui-serif', 'serif',
        ],
        mono: [
          'ui-monospace', 'SF Mono', 'Cascadia Mono', 'Menlo',
          'Consolas', 'Liberation Mono', 'monospace',
        ],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      letterSpacing: {
        tightest: '-0.025em',
        wide2: '0.08em',
      },
      /* Radius is a hierarchy, not a default: chips are near-square, controls
         are gently rounded, surfaces get a moderate corner, and only overlays
         are allowed a stronger radius. Nothing is a capsule. */
      borderRadius: {
        sm: '5px',       /* badges, chips, skeletons */
        DEFAULT: '7px',  /* buttons, inputs, selects */
        md: '8px',       /* inline notes, segmented tracks */
        lg: '10px',      /* cards and panels */
        xl: '14px',      /* modals, sheets */
        '2xl': '18px',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
        standard: 'cubic-bezier(0.2, 0, 0, 1)',
      },
      boxShadow: {
        card: '0 1px 2px rgba(28, 25, 23, 0.04)',
        lift: '0 6px 20px -8px rgba(28, 25, 23, 0.14)',
        overlay: '0 24px 60px -20px rgba(28, 25, 23, 0.35)',
        'focus-accent': '0 0 0 3px rgba(15, 110, 99, 0.18)',
      },
      maxWidth: {
        content: '72rem',
      },
    },
  },
  plugins: [],
};
