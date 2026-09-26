import React from 'react';

/* ------------------------------------------------------------------ */
/* Acadova icon set                                                    */
/*                                                                     */
/* One in-house set instead of an icon dependency. Every glyph is      */
/* drawn on the same 24x24 grid, uses a 1.8 default stroke, round caps */
/* and joins, and inherits `currentColor`. That shared geometry is why */
/* icons sit on the same optical baseline next to text.                */
/*                                                                     */
/* Icons are only used where they carry meaning (navigation, action,   */
/* state, external link, edit, delete, sync, filter, search) — never   */
/* as decoration. Sizes are fixed by the call site, never ad hoc.       */
/* ------------------------------------------------------------------ */

const Svg = ({ children, className = '', strokeWidth = 1.8, size, filled = false, ...rest }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    width={size}
    height={size}
    fill={filled ? 'currentColor' : 'none'}
    stroke={filled ? 'none' : 'currentColor'}
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    focusable="false"
    aria-hidden="true"
    {...rest}
  >
    {children}
  </svg>
);

/* ---------------------------- status ---------------------------- */

export const AlertCircle = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.75v5" />
    <path d="M12 16.25h.01" />
  </Svg>
);

export const AlertTriangle = (p) => (
  <Svg {...p}>
    <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20.2h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4.5" />
    <path d="M12 17h.01" />
  </Svg>
);

export const Info = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.25" />
    <path d="M12 7.75h.01" />
  </Svg>
);

export const Check = (p) => (
  <Svg {...p}>
    <path d="M4.75 12.5 9.5 17.25 19.25 6.75" />
  </Svg>
);

export const CheckCircle2 = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.25 10.8 15 16 9.5" />
  </Svg>
);

export const CheckSquare = (p) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
    <path d="M8 12.25 10.8 15 16 9.5" />
  </Svg>
);

export const Ban = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M5.6 5.6 18.4 18.4" />
  </Svg>
);

export const Circle = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
  </Svg>
);

export const X = (p) => (
  <Svg {...p}>
    <path d="M6 6l12 12" />
    <path d="M18 6 6 18" />
  </Svg>
);

/* ---------------------------- navigation ---------------------------- */

export const Menu = (p) => (
  <Svg {...p}>
    <path d="M3.5 6.5h17" />
    <path d="M3.5 12h17" />
    <path d="M3.5 17.5h17" />
  </Svg>
);

export const ChevronDown = (p) => (
  <Svg {...p}>
    <path d="m6 9.5 6 6 6-6" />
  </Svg>
);

export const ChevronUp = (p) => (
  <Svg {...p}>
    <path d="m6 14.5 6-6 6 6" />
  </Svg>
);

export const ArrowRight = (p) => (
  <Svg {...p}>
    <path d="M4.5 12h14" />
    <path d="m13 6.5 5.5 5.5L13 17.5" />
  </Svg>
);

export const ExternalLink = (p) => (
  <Svg {...p}>
    <path d="M13.5 4.5h6v6" />
    <path d="M19.5 4.5 11.5 12.5" />
    <path d="M18 14.5v4a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Svg>
);

export const Plus = (p) => (
  <Svg {...p}>
    <path d="M12 4.75v14.5" />
    <path d="M4.75 12h14.5" />
  </Svg>
);

export const MoreHorizontal = (p) => (
  <Svg {...p}>
    <circle cx="5.25" cy="12" r="1.35" />
    <circle cx="12" cy="12" r="1.35" />
    <circle cx="18.75" cy="12" r="1.35" />
  </Svg>
);

export const ListChecks = (p) => (
  <Svg {...p}>
    <path d="M3.5 6.5 5.5 8.5 9 5" />
    <path d="M3.5 17.5 5.5 19.5 9 16" />
    <path d="M12 6.75h8.5" />
    <path d="M12 12h8.5" />
    <path d="M12 17.25h8.5" />
  </Svg>
);

export const Settings = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M19.3 14.6a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56v.17a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03h-.17a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 9.35a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08a1.7 1.7 0 0 0 1.03-1.56v-.17a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.56 1.03h.17a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03Z" />
  </Svg>
);

export const LogOut = (p) => (
  <Svg {...p}>
    <path d="M15 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H15" />
    <path d="M10 8.5 13.5 12 10 15.5" />
    <path d="M13.5 12H3.5" />
  </Svg>
);

export const Filter = (p) => (
  <Svg {...p}>
    <path d="M3.5 5.5h17l-6.5 7.6v5.6l-4 2.3v-7.9Z" />
  </Svg>
);

/* ---------------------------- domain ---------------------------- */

export const CalendarDays = (p) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
    <path d="M3.5 10h17" />
    <path d="M8 3v4" />
    <path d="M16 3v4" />
    <path d="M8 14h.01" />
    <path d="M12 14h.01" />
    <path d="M16 14h.01" />
    <path d="M8 17.5h.01" />
    <path d="M12 17.5h.01" />
  </Svg>
);

export const CalendarOff = (p) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
    <path d="M3.5 10h17" />
    <path d="M8 3v4" />
    <path d="M16 3v4" />
    <path d="M4.5 20.5 19.5 3.5" />
  </Svg>
);

export const Clock = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.25V12l3.25 2" />
  </Svg>
);

export const BookOpen = (p) => (
  <Svg {...p}>
    <path d="M2.75 4.5h5.5a3.75 3.75 0 0 1 3.75 3.75V20a3 3 0 0 0-3-3h-6.25Z" />
    <path d="M21.25 4.5h-5.5A3.75 3.75 0 0 0 12 8.25V20a3 3 0 0 1 3-3h6.25Z" />
  </Svg>
);

export const GraduationCap = (p) => (
  <Svg {...p}>
    <path d="M2.75 8.5 12 4.25l9.25 4.25L12 12.75Z" />
    <path d="M6.5 10.6v4.4c0 1.4 2.5 2.75 5.5 2.75s5.5-1.35 5.5-2.75v-4.4" />
    <path d="M21.25 8.5v5" />
  </Svg>
);

export const Code2 = (p) => (
  <Svg {...p}>
    <path d="M9 7.5 3.5 12 9 16.5" />
    <path d="M15 7.5 20.5 12 15 16.5" />
    <path d="M13.25 4.5l-2.5 15" />
  </Svg>
);

export const FolderGit2 = (p) => (
  <Svg {...p}>
    <path d="M3.5 6.5A2 2 0 0 1 5.5 4.5h4l2 2.5h7a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
    <circle cx="12" cy="12.5" r="1.9" />
  </Svg>
);

export const ClipboardList = (p) => (
  <Svg {...p}>
    <path d="M9 4.5H7.5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-12a2 2 0 0 0-2-2H15" />
    <rect x="9" y="2.75" width="6" height="3.5" rx="1.25" />
    <path d="M9 11h6" />
    <path d="M9 15h4" />
  </Svg>
);

export const ClipboardCheck = (p) => (
  <Svg {...p}>
    <path d="M9 4.5H7.5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-12a2 2 0 0 0-2-2H15" />
    <rect x="9" y="2.75" width="6" height="3.5" rx="1.25" />
    <path d="M9.25 13.75 11.5 16l3.75-4.25" />
  </Svg>
);

export const FileText = (p) => (
  <Svg {...p}>
    <path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9Z" />
    <path d="M13.5 3.5V9H19" />
    <path d="M9 13h6" />
    <path d="M9 16.5h4" />
  </Svg>
);

export const FlaskConical = (p) => (
  <Svg {...p}>
    <path d="M9.5 3.5h5" />
    <path d="M10.5 3.5v5.2l-4.6 8.1a2 2 0 0 0 1.7 3h8.8a2 2 0 0 0 1.7-3l-4.6-8.1V3.5" />
    <path d="M7.6 14.5h8.8" />
  </Svg>
);

export const Target = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.75" />
    <circle cx="12" cy="12" r="1.1" />
  </Svg>
);

export const Award = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="9" r="5.5" />
    <path d="M8.6 13.7 7.25 21l4.75-2.75L16.75 21l-1.35-7.3" />
  </Svg>
);

export const Pencil = (p) => (
  <Svg {...p}>
    <path d="M16.5 4.4a2.3 2.3 0 0 1 3.25 3.25L7.6 19.8 3.5 20.9l1.1-4.1Z" />
    <path d="m15 5.9 3.25 3.25" />
  </Svg>
);

export const Trash2 = (p) => (
  <Svg {...p}>
    <path d="M4.5 6.75h15" />
    <path d="M9.5 6.75V5.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5v1.25" />
    <path d="M6.5 6.75 7.4 19.2a1.8 1.8 0 0 0 1.8 1.7h5.6a1.8 1.8 0 0 0 1.8-1.7L17.5 6.75" />
    <path d="M10.25 10.5v6.5" />
    <path d="M13.75 10.5v6.5" />
  </Svg>
);

export const Link2 = (p) => (
  <Svg {...p}>
    <path d="M9.25 13.5 14.75 8" />
    <path d="M11.5 6.75 13.4 4.85a3.9 3.9 0 0 1 5.5 5.5l-1.9 1.9" />
    <path d="M12.5 17.25 10.6 19.15a3.9 3.9 0 0 1-5.5-5.5l1.9-1.9" />
  </Svg>
);

export const Github = (p) => (
  <Svg filled {...p}>
    <path d="M12 2.2a9.8 9.8 0 0 0-3.1 19.1c.5.1.68-.22.68-.48v-1.7c-2.72.6-3.3-1.31-3.3-1.31a2.6 2.6 0 0 0-1.09-1.44c-.89-.6.07-.6.07-.6a2.06 2.06 0 0 1 1.5 1.02 2.09 2.09 0 0 0 2.85.81 2.1 2.1 0 0 1 .62-1.31c-2.17-.25-4.45-1.09-4.45-4.83a3.78 3.78 0 0 1 1-2.62 3.52 3.52 0 0 1 .1-2.59s.84-.27 2.75 1a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1 2.75-1a3.52 3.52 0 0 1 .1 2.59 3.78 3.78 0 0 1 1 2.62c0 3.75-2.29 4.58-4.47 4.82a2.33 2.33 0 0 1 .67 1.82v2.7c0 .27.18.59.69.48A9.8 9.8 0 0 0 12 2.2Z" />
  </Svg>
);

/* ---------------------------- controls ---------------------------- */

export const Play = (p) => (
  <Svg {...p}>
    <path d="M7.5 4.9v14.2a.6.6 0 0 0 .92.5l11.2-7.1a.6.6 0 0 0 0-1l-11.2-7.1a.6.6 0 0 0-.92.5Z" />
  </Svg>
);

export const Lock = (p) => (
  <Svg {...p}>
    <rect x="4.5" y="10.25" width="15" height="10.25" rx="2.5" />
    <path d="M8 10.25V7.5a4 4 0 0 1 8 0v2.75" />
  </Svg>
);

export const Bell = (p) => (
  <Svg {...p}>
    <path d="M18 9.6a6 6 0 1 0-12 0c0 5.4-2.25 6.9-2.25 6.9h16.5S18 15 18 9.6Z" />
    <path d="M10.4 19.9a2 2 0 0 0 3.2 0" />
  </Svg>
);

export const BellRing = (p) => (
  <Svg {...p}>
    <path d="M17.5 9.6a5.5 5.5 0 1 0-11 0c0 5.4-2.25 6.9-2.25 6.9h15.5S17.5 15 17.5 9.6Z" />
    <path d="M10.4 19.9a2 2 0 0 0 3.2 0" />
    <path d="M3.2 3.6 1.4 5.4" />
    <path d="M20.8 3.6l1.8 1.8" />
  </Svg>
);

/* ---------------------------- trends ---------------------------- */

export const TrendingUp = (p) => (
  <Svg {...p}>
    <path d="m3.5 16.5 5.5-5.5 3.5 3.5 7-7" />
    <path d="M14.5 7.5h5.5V13" />
  </Svg>
);

export const TrendingDown = (p) => (
  <Svg {...p}>
    <path d="m3.5 7.5 5.5 5.5 3.5-3.5 7 7" />
    <path d="M14.5 16.5h5.5V11" />
  </Svg>
);

export const History = (p) => (
  <Svg {...p}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.7-6.2" />
    <path d="M3.5 4.5V10h5.5" />
    <path d="M12 8.25V12l3 1.75" />
  </Svg>
);

/* ---------------------------- feedback ---------------------------- */

/* A partial ring: the sanctioned "working" indicator. Spin comes from the
   `.icon-spin` utility, which the reduced-motion rules switch off. */
export const Loader2 = (p) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 1 1-3.4-7" />
    <path d="M12 3a9 9 0 0 1 5.6 2" opacity="0.45" />
  </Svg>
);

export const RefreshCw = (p) => (
  <Svg {...p}>
    <path d="M20.5 12a8.5 8.5 0 0 1-14.6 5.9" />
    <path d="M3.5 12a8.5 8.5 0 0 1 14.6-5.9" />
    <path d="M18.1 2.6v3.9h-3.9" />
    <path d="M5.9 21.4v-3.9h3.9" />
  </Svg>
);

/* Deliberately no default export: a barrel object would reference every icon
   and defeat tree-shaking, pulling the whole set into the bundle. */
