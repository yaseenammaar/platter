// Hand-drawn icon set + Pip, Platter's paper-plane mascot.
// Every stroke is drawn twice (a pencil line and a faint offset "ghost" line) and run
// through a tiny turbulence filter so it wobbles like ink on paper.

const P: Record<string, string[]> = {
  home: ['M3.8 11.6 12 4.4l8.3 7.3', 'M6.1 10v9.3c0 .4.3.7.7.7H10v-5.6h4.1V20h3.2c.4 0 .7-.3.7-.7V9.9'],
  board: ['M4.3 4.6c1.5-.1 3-.1 4.5 0 .1 5 .1 10 0 14.9-1.5.1-3 .1-4.5 0-.1-5-.1-10 0-14.9z', 'M10.3 4.4c1.5-.1 3-.1 4.5.1.1 3.2.1 6.5 0 9.7-1.5.1-3 .1-4.5 0-.1-3.3-.1-6.6 0-9.8z', 'M16.2 4.6c1.3-.1 2.6-.1 3.9 0 .1 4 .1 8 0 12-1.3.1-2.6.1-3.9 0-.1-4-.1-8 0-12z'],
  team: ['M9 11.2c1.7 0 3-1.4 3-3.1S10.7 5 9 5 6 6.4 6 8.1s1.3 3.1 3 3.1z', 'M3.4 19.6c.6-3.3 2.8-5.1 5.6-5.1s5 1.8 5.6 5.1', 'M15.8 10.6c1.4-.1 2.4-1.2 2.4-2.6 0-1.5-1.2-2.6-2.7-2.5', 'M17.4 14.5c1.9.6 3 2.3 3.3 4.8'],
  feed: ['M3 12.6h3.6l2-5.2 3.5 10.1 2.5-6.6 1.6 1.7H21'],
  gear: ['M12 15.3c1.8 0 3.2-1.5 3.2-3.3S13.8 8.7 12 8.7 8.8 10.2 8.8 12s1.4 3.3 3.2 3.3z', 'M12 3.2v2.4M12 18.4v2.4M3.2 12h2.4M18.4 12h2.4M5.7 5.7l1.7 1.7M16.6 16.6l1.7 1.7M5.7 18.3l1.7-1.7M16.6 7.4l1.7-1.7'],
  plus: ['M12 5.1c.1 4.7-.1 9.1.1 13.8', 'M5.2 12.1c4.6-.2 9.1.1 13.6-.1'],
  agent: ['M6.6 9.6h10.9c.6 0 1 .4 1 1v7c0 .6-.4 1-1 1H6.6c-.6 0-1-.4-1-1v-7c0-.6.4-1 1-1z', 'M12 9.5V6.6', 'M12 5.9c.5 0 .9-.4.9-.9s-.4-.9-.9-.9-.9.4-.9.9.4.9.9.9z', 'M9.5 13.2v.8M14.5 13.2v.8', 'M10 16.2c1.3.6 2.7.6 4 0', 'M3.6 13v2.6M20.4 13v2.6'],
  check: ['M5 12.9l4.1 4 9.9-10.4'],
  cross: ['M6.6 6.8c3.6 3.5 7.1 7.1 10.7 10.6', 'M17.2 6.7c-3.5 3.5-7 7-10.5 10.5'],
  stuck: ['M8.6 3.9h6.9l4.6 4.7v6.9l-4.6 4.6H8.6L3.9 15.5V8.6z', 'M8.8 12.1c2.1-.1 4.3.1 6.4-.1'],
  handoff: ['M4 9.1h12.6l-3-3.1', 'M20 15H7.4l3 3.1'],
  review: ['M10.6 16.6c3.3 0 6-2.7 6-6s-2.7-6-6-6-6 2.7-6 6 2.7 6 6 6z', 'M15 15.3l4.9 4.6'],
  bolt: ['M13.3 3.2 5.8 13.4h5.5l-1.2 7.4 7.7-10.5h-5.6z'],
  pencil: ['M15.8 4.6l3.6 3.6L9 18.7l-4.7.9 1-4.6z', 'M13.6 6.8l3.6 3.6'],
  done: ['M12 20.4c4.7 0 8.4-3.8 8.4-8.4S16.6 3.6 12 3.6 3.6 7.4 3.6 12s3.7 8.4 8.4 8.4z', 'M8.2 12.3l2.6 2.5 5-5.3'],
  chat: ['M5 5.5h14c.6 0 1 .4 1 1V15c0 .6-.4 1-1 1h-8.5l-4.3 3.5V16H5c-.6 0-1-.4-1-1V6.5c0-.6.4-1 1-1z', 'M8 9.6h8M8 12.4h5'],
  flame: ['M12 21.1c-3.6 0-6-2.4-6-5.6 0-3.3 2.6-4.7 3-8.5 2.2 1.2 3 3 3 4.6 1-.8 1.6-2 1.6-3.4 2.6 1.8 4.4 4.4 4.4 7.3 0 3.2-2.4 5.6-6 5.6z'],
  up: ['M12 19.6V5', 'M6.4 10.4 12 4.8l5.6 5.6'],
  calendar: ['M5 6.2h14c.5 0 .9.4.9.9v12c0 .5-.4.9-.9.9H5c-.5 0-.9-.4-.9-.9v-12c0-.5.4-.9.9-.9z', 'M4.2 10.2h15.6', 'M8.4 3.8v4M15.6 3.8v4'],
  link: ['M10.2 13.8a3.5 3.5 0 0 0 5 0l3.1-3.1a3.5 3.5 0 0 0-5-5l-1 1', 'M13.8 10.2a3.5 3.5 0 0 0-5 0l-3.1 3.1a3.5 3.5 0 0 0 5 5l1-1'],
  sparkle: ['M12 3.4c.6 4.3 2.3 6.3 6.6 7.1-4.3.8-6 2.8-6.6 7.1-.6-4.3-2.3-6.3-6.6-7.1 4.3-.8 6-2.8 6.6-7.1z', 'M19 16.8c.2 1.4.8 2 2.2 2.2-1.4.2-2 .8-2.2 2.2-.2-1.4-.8-2-2.2-2.2 1.4-.2 2-.8 2.2-2.2z'],
  zzz: ['M4.5 10.2h4.6L4.5 15.4h4.8', 'M12 5.6h3.6L12 9.8h3.8', 'M17.5 13.4h2.6l-2.6 3h2.8'],
  thumbUp: ['M7.4 10.6v9.2H4.6c-.4 0-.7-.3-.7-.7v-7.8c0-.4.3-.7.7-.7z', 'M7.4 10.6l3.8-6.4c1.4.1 2.2 1.1 2 2.5l-.6 3h5.2c1.1 0 1.9 1 1.7 2.1l-1.2 6.2c-.2.9-1 1.6-1.9 1.6H7.4'],
  thumbDown: ['M7.4 13.4V4.2H4.6c-.4 0-.7.3-.7.7v7.8c0 .4.3.7.7.7z', 'M7.4 13.4l3.8 6.4c1.4-.1 2.2-1.1 2-2.5l-.6-3h5.2c1.1 0 1.9-1 1.7-2.1l-1.2-6.2c-.2-.9-1-1.6-1.9-1.6H7.4'],
  box: ['M4 8.1 12 4l8 4.1v8L12 20l-8-3.9z', 'M4 8.1l8 4 8-4', 'M12 12.1V20'],
  mail: ['M4.6 6h14.8c.5 0 .9.4.9.9v10.2c0 .5-.4.9-.9.9H4.6c-.5 0-.9-.4-.9-.9V6.9c0-.5.4-.9.9-.9z', 'M4.1 6.6 12 12.6l7.9-6'],
  trash: ['M4.6 6.6h14.8', 'M9.4 6.4V4.6h5.2v1.8', 'M6.4 6.8l.9 12.5c0 .5.4.8.9.8h7.6c.5 0 .9-.3.9-.8l.9-12.5'],
  refresh: ['M19.6 8.6A8 8 0 0 0 4.4 10', 'M19.9 4.4v4.4h-4.3', 'M4.4 15.4A8 8 0 0 0 19.6 14', 'M4.1 19.6v-4.4h4.3'],
  lock: ['M6.4 10.6h11.2c.5 0 .9.4.9.9v7.7c0 .5-.4.9-.9.9H6.4c-.5 0-.9-.4-.9-.9v-7.7c0-.5.4-.9.9-.9z', 'M8.4 10.4V7.6a3.6 3.6 0 0 1 7.2 0v2.8'],
  key: ['M8 15.6c2.1 0 3.8-1.7 3.8-3.8S10.1 8 8 8s-3.8 1.7-3.8 3.8 1.7 3.8 3.8 3.8z', 'M11.6 11.8h8.8M17.6 11.8v3M20.2 11.8v2'],
  dots: ['M6.2 12.1h.1', 'M12 12h.1', 'M17.8 12.1h.1'],
  sun: ['M12 16.2c2.3 0 4.2-1.9 4.2-4.2S14.3 7.8 12 7.8 7.8 9.7 7.8 12s1.9 4.2 4.2 4.2z', 'M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4'],
  moon: ['M19.6 14.6A8 8 0 0 1 9.4 4.4a8 8 0 1 0 10.2 10.2z'],
  eye: ['M2.8 12.2C5 8 8.2 5.9 12 5.9s7 2.1 9.2 6.3C19 16.3 15.8 18.4 12 18.4s-7-2.1-9.2-6.2z', 'M12 14.8c1.4 0 2.6-1.2 2.6-2.6S13.4 9.6 12 9.6s-2.6 1.2-2.6 2.6 1.2 2.6 2.6 2.6z'],
  back: ['M19.4 12.1H5.2', 'M10.6 6.4 4.9 12.1l5.7 5.7'],
  hourglass: ['M7 3.8h10M7 20.2h10', 'M8 4c0 4.4 4 5.6 4 8s-4 3.6-4 8', 'M16 4c0 4.4-4 5.6-4 8s4 3.6 4 8'],
  crown: ['M4.2 17.6 3.4 7.8l4.8 3.6L12 5l3.8 6.4 4.8-3.6-.8 9.8z', 'M4.6 20.2h14.8'],
  shield: ['M12 3.6 19 6.4v5.2c0 4.3-3 7.5-7 8.8-4-1.3-7-4.5-7-8.8V6.4z'],
  hand: ['M8.4 12.2V5.8c0-.8.6-1.4 1.4-1.4s1.4.6 1.4 1.4v5.4', 'M11.2 11V4.6c0-.8.6-1.4 1.4-1.4s1.4.6 1.4 1.4v6.6', 'M14 11.4V6.2c0-.8.6-1.4 1.4-1.4s1.4.6 1.4 1.4v7.4c0 4-2.6 6.8-6.2 6.8-2.6 0-4.2-1.4-5.4-3.8L3.6 13c-.4-.8 0-1.6.8-1.8.6-.2 1.2 0 1.6.6l2.4 3.2'],
  wrench: ['M14.6 4.2a4.6 4.6 0 0 0-4.4 6.2l-5.8 5.8a1.9 1.9 0 0 0 2.7 2.7l5.8-5.8a4.6 4.6 0 0 0 6.2-4.4l-2.7 2.7-2.7-.6-.6-2.7z'],
  sweat: ['M12 20.2c4.5 0 8.2-3.7 8.2-8.2S16.5 3.8 12 3.8 3.8 7.5 3.8 12s3.7 8.2 8.2 8.2z', 'M8.6 15.4c2.1-1.4 4.6-1.4 6.8 0', 'M9 9.8h.1M15 9.8h.1', 'M18.4 3.6c.8 1.2 1.2 2 1.2 2.6 0 .7-.5 1.2-1.2 1.2s-1.2-.5-1.2-1.2c0-.6.4-1.4 1.2-2.6z'],
  folder: ['M3.8 6.4c0-.6.4-1 1-1h4.4l1.8 2h8.2c.6 0 1 .4 1 1v9.8c0 .6-.4 1-1 1H4.8c-.6 0-1-.4-1-1z'],
  scroll: ['M7 4.4h10.6c.8 0 1.4.6 1.4 1.4v11', 'M7 4.4c-1 0-1.8.8-1.8 1.8v1.4h3.6V6.2c0-1-.8-1.8-1.8-1.8z', 'M8.8 6.2v12c0 .8.6 1.4 1.4 1.4h8.4c-.8 0-1.4-.6-1.4-1.4v-1.4H10', 'M11.6 9h4.6M11.6 12h4.6'],
  bell: ['M6.4 16.4V11a5.6 5.6 0 0 1 11.2 0v5.4l1.4 1.6H5z', 'M10.2 20c.4.6 1 .9 1.8.9s1.4-.3 1.8-.9'],
  palm: ['M12.6 20.6c.4-4 .2-7.6-.8-10.6', 'M11.8 10c-1.8-2.6-4.6-3.2-7.4-2 2.4.2 4 1 5.2 2.4', 'M11.8 10c.6-2.8 3-4.6 6.2-4.6-2 1-3.4 2.4-4.2 4.4', 'M11.8 10c2.6-.6 5 .4 6.6 2.8-2.2-.6-4.2-.6-6 .2', 'M4.6 20.6h15'],
  plane: ['M3.6 11.2 20.4 4.2l-4.6 15.4-4.4-5.2z', 'M11.4 14.4 20.4 4.2', 'M11.4 14.4l-1.2 5 2.8-3.2'],
};

export type SketchName = keyof typeof P;

export function Sketch({ name, size = 20, className = '', title }: { name: SketchName; size?: number; className?: string; title?: string }) {
  const paths = P[name] ?? [];
  return (
    <svg className={`sk ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <g className="sk-ghost" transform="translate(0.45 0.35) rotate(0.6 12 12)">{paths.map((d, i) => <path key={i} d={d} />)}</g>
      <g>{paths.map((d, i) => <path key={i} d={d} />)}</g>
    </svg>
  );
}

export type PipMood = 'happy' | 'worried' | 'sleepy' | 'party' | 'thinking';

/** Pip — a little paper plane with opinions. */
export function Pip({ mood = 'happy', size = 64, className = '' }: { mood?: PipMood; size?: number; className?: string }) {
  const eyes = mood === 'sleepy'
    ? <><path d="M27.5 31.5c1 .9 2.2.9 3.2 0" /><path d="M35.5 28.6c1 .9 2.2.9 3.2 0" /></>
    : mood === 'party'
      ? <><path d="M27.4 31.6c.8-1.3 2.4-1.3 3.2 0" /><path d="M35.4 28.6c.8-1.3 2.4-1.3 3.2 0" /></>
      : <><circle cx="29" cy="31" r="1.5" fill="currentColor" stroke="none" /><circle cx="37" cy="28.2" r="1.5" fill="currentColor" stroke="none" /></>;
  const mouth = {
    happy: <path d="M31 35.6c1.6 1.4 3.6 1.1 4.8-.6" />,
    party: <path d="M30.6 35c1.4 2.6 4.4 2.4 5.6-.8-1.8.6-3.8.9-5.6.8z" fill="currentColor" />,
    worried: <path d="M30.8 36.4c.8-.8 1.6-.8 2.4 0s1.6.8 2.4 0" />,
    sleepy: <path d="M32.4 35.6h2" />,
    thinking: <path d="M31.2 36c1.4-.4 2.8-.6 4.2-.4" />,
  }[mood];
  return (
    <svg className={`pip pip-${mood} ${className}`} width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Pip the paper plane">
      <path className="pip-trail" d="M4 46c4-1 6.5-3.6 9.2-6.6M2.8 38.6c2.6-.4 4.4-1.6 6-3.2" strokeDasharray="1.5 3.5" />
      <path className="pip-body" d="M12 33.6 57 13 44.6 55 33.4 41.4z" />
      <path className="pip-wing" d="M12 33.6 57 13 33.4 41.4z" />
      <path d="M33.4 41.4 57 13" />
      <path d="M33.4 41.4 30.6 51.6l7-6" />
      <g className="pip-face">{eyes}{mouth}</g>
      <ellipse className="pip-blush" cx="25.6" cy="34.2" rx="2.2" ry="1.2" stroke="none" />
      <ellipse className="pip-blush" cx="40.8" cy="31.4" rx="2" ry="1.1" stroke="none" />
      {mood === 'party' && <g className="pip-sparks"><path d="M52 4.6v4M50 6.6h4" /><path d="M60 22v3M58.5 23.5h3" /><path d="M8 18.4v3M6.5 19.9h3" /></g>}
      {mood === 'sleepy' && <g className="pip-z"><path d="M48 4h4.4L48 8.6h4.6" /><path d="M56 10h3l-3 3.4h3.2" /></g>}
      {mood === 'thinking' && <g className="pip-dots"><circle cx="50" cy="8" r=".9" fill="currentColor" /><circle cx="54.5" cy="5" r="1.2" fill="currentColor" /><circle cx="59.5" cy="3" r="1.6" fill="currentColor" /></g>}
    </svg>
  );
}

/** One-time SVG defs: the pencil-wobble filter. */
export function SketchDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <filter id="wobble" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="7" />
        <feDisplacementMap in="SourceGraphic" scale="1.3" />
      </filter>
    </svg>
  );
}
