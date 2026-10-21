// Profile pictures: a little original pocket critter per person, picked from their name —
// same name, same critter, everywhere. Soft pastel fills, thin coloured outlines, dot eyes
// and blush: chibi, round and friendly.

/** FNV-1a: small, stable, well spread. */
function hash(s: string) {
  let h = 0x811c9dc5;
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193) >>> 0;
  return h;
}

/** Draws independent choices out of one hash. */
function chooser(seed: number) {
  let h = seed;
  return (n: number) => {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return h % n;
  };
}

/** Body colour + the slightly deeper outline drawn in that same hue. */
const COATS = [
  { name: 'mint', fill: '#cfe8e1', ink: '#5c9a8b' },
  { name: 'sky', fill: '#cddff3', ink: '#5d86b3' },
  { name: 'lilac', fill: '#e2d6f3', ink: '#8a70b8' },
  { name: 'peach', fill: '#f9dcc4', ink: '#c4865a' },
  { name: 'pink', fill: '#f6d3df', ink: '#c3708f' },
  { name: 'butter', fill: '#f5e7b0', ink: '#b09234' },
  { name: 'sage', fill: '#d8e8c6', ink: '#6f9556' },
  { name: 'coral', fill: '#f4cbc2', ink: '#c56f60' },
  { name: 'cloud', fill: '#dcdbe8', ink: '#77749a' },
];
/** Don't put a sky-blue critter on a sky-blue circle. */
const CLASH: Record<string, string[]> = {
  blue: ['sky', 'cloud'], purple: ['lilac', 'cloud'], orange: ['peach', 'coral'],
  yellow: ['butter', 'peach'], green: ['sage', 'mint'], pink: ['pink', 'coral'],
};
const BELLY = '#fff7ea';
const EYE = '#3b3346';
const BLUSH = '#f4a3b4';

// Head-and-body in one soft shape, running off the bottom of the circle.
const BODIES = [
  'M7 44c0-6 1.4-10.4 3.2-13.6C9 28.4 8.5 26.4 8.5 24.5 8.5 17.6 13.6 12 20 12s11.5 5.6 11.5 12.5c0 1.9-.5 3.9-1.7 5.9C31.6 33.6 33 38 33 44z',
  'M4.5 44c0-8 2-13 4.8-16.4C8.8 20.8 13.6 14.6 20 14.6s11.2 6.2 10.7 13c2.8 3.4 4.8 8.4 4.8 16.4z',
  'M8.6 44c0-6 1-10 2.7-13-1.4-2-2.1-4.2-2.1-6.6C9.2 17 14.1 11 20 11s10.8 6 10.8 13.4c0 2.4-.7 4.6-2.1 6.6 1.7 3 2.7 7 2.7 13z',
];
const HEAD_TOP = [12, 14.6, 11];

/** Things on top of the head. `body` = drawn in the coat colour; `extra` = their own colour. */
type Part = { d: string; fill?: 'body' | 'inner' | 'none' | string };
const TOPS: Part[][] = [
  // cat ears
  [{ d: 'M10.6 19 9.8 10.4c-.1-1 1-1.6 1.8-1l6.2 5.2z', fill: 'body' }, { d: 'M29.4 19l.8-8.6c.1-1-1-1.6-1.8-1l-6.2 5.2z', fill: 'body' },
    { d: 'M11.7 15.8l-.4-4.2 3.2 2.7z', fill: 'inner' }, { d: 'M28.3 15.8l.4-4.2-3.2 2.7z', fill: 'inner' }],
  // long bunny ears
  [{ d: 'M13.2 15.6c-1.8-4.6-1.8-9.6.4-11.6 2-1.6 4 2.6 4.4 9.6z', fill: 'body' }, { d: 'M26.8 15.6c1.8-4.6 1.8-9.6-.4-11.6-2-1.6-4 2.6-4.4 9.6z', fill: 'body' },
    { d: 'M14.6 12.6c-.8-2.8-.7-5.4.2-6.4.9-.6 1.8 1.6 2 5.6z', fill: 'inner' }, { d: 'M25.4 12.6c.8-2.8.7-5.4-.2-6.4-.9-.6-1.8 1.6-2 5.6z', fill: 'inner' }],
  // round bear ears
  [{ d: 'M11.6 18.6a4 4 0 1 1 3.4-6.2', fill: 'body' }, { d: 'M28.4 18.6a4 4 0 1 0-3.4-6.2', fill: 'body' }],
  // antennae with little bobbles
  [{ d: 'M16.2 13.2c-1.2-2.8-3-4.6-5-5.2', fill: 'none' }, { d: 'M23.8 13.2c1.2-2.8 3-4.6 5-5.2', fill: 'none' },
    { d: 'M10.9 9.9a1.9 1.9 0 1 1 .1-3.8 1.9 1.9 0 0 1-.1 3.8z', fill: 'body' }, { d: 'M29.1 9.9a1.9 1.9 0 1 0-.1-3.8 1.9 1.9 0 0 0 .1 3.8z', fill: 'body' }],
  // one little horn
  [{ d: 'M18 12.8l1.5-5.6c.1-.5.9-.5 1 0l1.5 5.6z', fill: '#f5e7b0' }],
  // floppy side fins
  [{ d: 'M9.6 22c-4-1-6.2 1.4-5.6 4.6.4 2 2.6 2.4 5.2 1.6z', fill: 'body' }, { d: 'M30.4 22c4-1 6.2 1.4 5.6 4.6-.4 2-2.6 2.4-5.2 1.6z', fill: 'body' }],
  // a sprout
  [{ d: 'M20 12.4c0-2 .4-3.4 1.2-4.4', fill: 'none' }, { d: 'M21.2 7.8c1.6-2.2 4.4-2.8 6.4-2-.6 2.4-3 4-6.4 2z', fill: '#d8e8c6' },
    { d: 'M20.4 9.2c-1.4-1.6-3.6-2-5.2-1.2.6 1.8 2.6 2.8 5.2 1.2z', fill: '#d8e8c6' }],
  // droopy puppy ears
  [{ d: 'M11.8 15.6c-3.8.2-5.8 3.8-5.2 7.8.3 1.8 2 2.2 3.2.8z', fill: 'body' }, { d: 'M28.2 15.6c3.8.2 5.8 3.8 5.2 7.8-.3 1.8-2 2.2-3.2.8z', fill: 'body' }],
  // a tuft of fluff
  [{ d: 'M15.6 13.8c.2-2.4 1.6-3.8 3-3.4.4-1.6 2.4-2 3.4-.6 1.6-.4 3 1.2 2.4 3.6', fill: 'body' }],
];

export function SketchFace({ name, size, tint }: { name: string; size: number; tint?: string }) {
  const pick = chooser(hash(name.trim().toLowerCase()));
  const avoid = CLASH[tint ?? ''] ?? [];
  const coats = COATS.filter((c) => !avoid.includes(c.name));
  const coat = coats[pick(coats.length)];
  const bodyIdx = pick(BODIES.length);
  const top = TOPS[pick(TOPS.length)];
  const eyes = pick(5);
  const mouth = pick(5);
  const marking = pick(5); // 0 none, 1 gem, 2 stripes, 3 freckles, 4 cheek spots
  const belly = pick(3) !== 0;
  const arms = pick(2) === 0;
  const line = { stroke: coat.ink, strokeWidth: 1.25, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const fillOf = (f: Part['fill']) => (f === 'body' ? coat.fill : f === 'inner' ? BLUSH : f === 'none' ? 'none' : f ?? coat.fill);
  const ey = 23.8 + (HEAD_TOP[bodyIdx] - 12) * 0.35;
  const L = 15.5, R = 24.5;
  const shine = (x: number, y: number) => <circle cx={x + 0.5} cy={y - 0.55} r={0.5} fill="#fff" />;

  return (
    <svg className="face critter" width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      {/* things behind the head */}
      {top.filter((p) => p.fill !== 'inner').map((p, i) => <path key={i} d={p.d} fill={fillOf(p.fill)} {...line} />)}
      <path d={BODIES[bodyIdx]} fill={coat.fill} {...line} />
      {top.filter((p) => p.fill === 'inner').map((p, i) => <path key={`in${i}`} d={p.d} fill={BLUSH} fillOpacity={0.75} stroke="none" />)}
      {belly && <path d="M13.2 44c0-5.4 3-9.2 6.8-9.2s6.8 3.8 6.8 9.2z" fill={BELLY} {...line} strokeWidth={1} />}
      {arms && (
        <>
          <path d="M13.4 33.6c-2.1.1-3.5 1.6-3.3 3 .2 1.3 1.9 1.4 3.4.4z" fill={coat.fill} {...line} />
          <path d="M26.6 33.6c2.1.1 3.5 1.6 3.3 3-.2 1.3-1.9 1.4-3.4.4z" fill={coat.fill} {...line} />
        </>
      )}
      {/* markings */}
      {marking === 1 && <circle cx="20" cy={ey - 5.4} r="1.25" fill="#f08aa3" stroke={coat.ink} strokeWidth={0.8} />}
      {marking === 2 && <path d={`M17.8 ${ey - 9.6}l.5 2.2M20 ${ey - 10.2}v2.4M22.2 ${ey - 9.6}l-.5 2.2`} fill="none" {...line} />}
      {marking === 3 && [[13.2, ey + 3.2], [14.3, ey + 4.1], [25.7, ey + 4.1], [26.8, ey + 3.2]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r=".38" fill={coat.ink} />)}
      {/* cheeks */}
      {marking === 4
        ? <><circle cx="12.6" cy={ey + 3} r="1.9" fill="#f7b9a0" /><circle cx="27.4" cy={ey + 3} r="1.9" fill="#f7b9a0" /></>
        : <><ellipse cx="13.2" cy={ey + 2.8} rx="1.6" ry=".95" fill={BLUSH} opacity={0.8} /><ellipse cx="26.8" cy={ey + 2.8} rx="1.6" ry=".95" fill={BLUSH} opacity={0.8} /></>}
      {/* eyes */}
      {eyes === 0 && <><circle cx={L} cy={ey} r="1.25" fill={EYE} /><circle cx={R} cy={ey} r="1.25" fill={EYE} /></>}
      {eyes === 1 && <><circle cx={L} cy={ey} r="1.6" fill={EYE} />{shine(L, ey)}<circle cx={R} cy={ey} r="1.6" fill={EYE} />{shine(R, ey)}</>}
      {eyes === 2 && <path d={`M${L - 1.3} ${ey + 0.5}c.7-1.1 1.9-1.1 2.6 0M${R - 1.3} ${ey + 0.5}c.7-1.1 1.9-1.1 2.6 0`} fill="none" stroke={EYE} strokeWidth={1.1} strokeLinecap="round" />}
      {eyes === 3 && <path d={`M${L - 1.4} ${ey}h2.8M${R - 1.4} ${ey}h2.8`} stroke={EYE} strokeWidth={1.1} strokeLinecap="round" />}
      {eyes === 4 && <><ellipse cx={L} cy={ey} rx="1.3" ry="1.75" fill={EYE} />{shine(L, ey)}<ellipse cx={R} cy={ey} rx="1.3" ry="1.75" fill={EYE} />{shine(R, ey)}</>}
      {/* mouth */}
      <g fill="none" stroke={EYE} strokeWidth={0.95} strokeLinecap="round" strokeLinejoin="round">
        {mouth === 0 && <path d={`M18.2 ${ey + 2.8}c.5.7 1.3.7 1.8 0 .5.7 1.3.7 1.8 0`} />}
        {mouth === 1 && <path d={`M18.6 ${ey + 2.8}c.8.8 2 .8 2.8 0`} />}
        {mouth === 2 && <><path d={`M18.5 ${ey + 2.6}c.3 1.9 2.7 1.9 3 0z`} fill={EYE} /><path d={`M19.3 ${ey + 3.7}c.4.3 1 .3 1.4 0`} stroke={BLUSH} /></>}
        {mouth === 3 && <><path d={`M18.4 ${ey + 2.8}c.9.8 2.3.8 3.2 0`} /><path d={`M20.6 ${ey + 3.3}l.3.8.4-.7`} fill="#fff" strokeWidth={0.6} /></>}
        {mouth === 4 && <ellipse cx="20" cy={ey + 3.2} rx=".75" ry=".85" />}
      </g>
    </svg>
  );
}
