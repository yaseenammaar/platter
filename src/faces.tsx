// Hand-drawn profile pictures. Every person gets a little doodled face picked from
// their name — same name, same face, everywhere — inked in their tint colour.

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

const HEADS = [{ rx: 8.4, ry: 8.9 }, { rx: 7.8, ry: 9.4 }, { rx: 8.9, ry: 8.5 }];

// Hair drawn behind the head (long styles) and on top of it.
const HAIR_BACK: Record<number, string> = {
  4: 'M10.6 30.4c-1.8-8.2-1.4-15.2 1.9-18.9 3.9-4.3 11.1-4.3 15 0 3.3 3.7 3.7 10.7 1.9 18.9-1.2.4-2.4.4-3.6 0l-.4-6.2H14.6l-.4 6.2c-1.2.4-2.4.4-3.6 0z',
};
const HAIR: string[][] = [
  ['M11.8 17.4c-.6-5.2 2.9-8.7 8.2-8.7s8.8 3.5 8.2 8.7c-1.7-2.5-3.8-3.7-6.6-3.9-2.7 1.7-6.1 2.3-9.8 3.9z'],
  ['M11.7 18.2c-.9-6.2 3.4-9.9 8.7-9.7 4.5.2 8 3.1 7.9 8.8-3.5-.4-6.5-2-8.5-4.7-1.8 2.9-4.7 4.8-8.1 5.6z'],
  [], // curly: drawn as loops below
  ['M11.8 17.4c-.6-5.2 2.9-8.7 8.2-8.7s8.8 3.5 8.2 8.7c-2.4-2.2-5.2-3.3-8.2-3.3s-5.8 1.1-8.2 3.3z', 'M20 9.6c-1.9 0-3.4-1.5-3.4-3.3S18.1 3 20 3s3.4 1.5 3.4 3.3-1.5 3.3-3.4 3.3z'],
  ['M12 16c2.7-.3 5.7-1.7 7.8-4.2 1.4 2.5 4.4 3.9 8.2 4.2-1-4.6-4-6.9-8-6.9s-7 2.4-8 6.9z'],
  ['M11.9 16.6l.5-4.4 2.3 1.6.8-4.4 2.7 2.5 1.8-4.1 2 3.9 2.7-2.7.6 4.4 2.4-1.4.4 4.7c-2.9-1.5-5.8-2.1-9.1-2.1s-6.3.6-8.9 2z'],
  ['M11.2 16.8c0-5.4 3.9-8.7 8.8-8.7s8.8 3.3 8.8 8.7z', 'M10.6 16.5c6.3-.5 12.5-.5 18.8 0l-.2 2.6c-6.1-.4-12.3-.4-18.4 0z', 'M20 8.2c-1 0-1.9-.8-1.9-1.8s.9-1.8 1.9-1.8 1.9.8 1.9 1.8-.9 1.8-1.9 1.8z'],
  ['M16 11.4c1.4-.6 2.8-.8 4.2-.6'],
];
const CURLS = [[12.6, 15.2], [14.2, 12], [17, 10], [20.4, 9.3], [23.7, 10.1], [26.3, 12.2], [27.6, 15.4]];

export function SketchFace({ name, size }: { name: string; size: number }) {
  const pick = chooser(hash(name.trim().toLowerCase()));
  const head = HEADS[pick(HEADS.length)];
  const hair = pick(HAIR.length);
  const eyes = pick(5);
  const mouth = pick(5);
  const brows = pick(3) === 0;
  const collar = pick(3);
  const extra = pick(6); // 0 freckles, 1 beard (short hair only), 2 earring
  const beard = extra === 1 && hair !== 4;
  const cy = 18.6;
  const ink = { stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const solid = { ...ink, fill: 'currentColor' };
  const ly = cy + 0.6;

  return (
    <svg className="face" width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      {/* shoulders & neck */}
      <path d="M6.2 41.5c.9-6.6 5.8-10.4 13.8-10.4s12.9 3.8 13.8 10.4" fill="currentColor" fillOpacity={0.22} {...ink} />
      {collar === 0 && <path d="M16.9 31.2l3.1 3.6 3.1-3.6" fill="none" {...ink} />}
      {collar === 1 && <path d="M16.4 31.4c2.4 1.6 4.8 1.6 7.2 0" fill="none" {...ink} />}
      <path d="M17.6 26.4v4.4M22.4 26.4v4.4" fill="none" {...ink} />
      {HAIR_BACK[hair] && <path d={HAIR_BACK[hair]} {...solid} fillOpacity={0.9} />}
      {/* ears + head */}
      <path d={`M${20 - head.rx + 0.2} ${cy - 1.4}c-1.7-.5-2.6 1.2-1.7 2.7.4.7 1 .9 1.8.8`} fill="var(--surface)" {...ink} />
      <path d={`M${20 + head.rx - 0.2} ${cy - 1.4}c1.7-.5 2.6 1.2 1.7 2.7-.4.7-1 .9-1.8.8`} fill="var(--surface)" {...ink} />
      {extra === 2 && <circle cx={20 - head.rx - 0.6} cy={cy + 2.6} r={0.9} {...solid} />}
      <ellipse cx="20" cy={cy} rx={head.rx} ry={head.ry} fill="var(--surface)" {...ink} />
      {beard && <path d="M12.4 20.6c.5 5.9 3.4 8.7 7.6 8.7s7.1-2.8 7.6-8.7c-1.5 1.6-2.8 2.3-4.2 2.3-1 0-2-.8-3.4-.8s-2.4.8-3.4.8c-1.4 0-2.7-.7-4.2-2.3z" {...solid} />}
      {/* hair on top */}
      {hair === 2 ? CURLS.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2.5} {...solid} />) : HAIR[hair].map((d, i) => <path key={i} d={d} {...(hair === 7 ? { ...ink, fill: 'none' } : solid)} />)}
      {/* brows */}
      {brows && <path d={`M15 ${ly - 3}c1-.6 2.2-.7 3.2-.4M21.8 ${ly - 3.4}c1-.3 2.2-.2 3.2.4`} fill="none" {...ink} />}
      {/* eyes */}
      {eyes === 0 && <><circle cx="16.6" cy={ly} r="1.1" {...solid} strokeWidth={0} /><circle cx="23.4" cy={ly} r="1.1" {...solid} strokeWidth={0} /></>}
      {eyes === 1 && <path d={`M15.3 ${ly + 0.5}c.7-1 1.9-1 2.6 0M22.1 ${ly + 0.5}c.7-1 1.9-1 2.6 0`} fill="none" {...ink} />}
      {eyes === 2 && (
        <>
          <circle cx="16.4" cy={ly} r="2.7" fill="none" {...ink} />
          <circle cx="23.6" cy={ly} r="2.7" fill="none" {...ink} />
          <path d={`M19.1 ${ly - 0.2}c.6-.4 1.2-.4 1.8 0`} fill="none" {...ink} />
          <circle cx="16.4" cy={ly} r=".85" {...solid} strokeWidth={0} /><circle cx="23.6" cy={ly} r=".85" {...solid} strokeWidth={0} />
        </>
      )}
      {eyes === 3 && <><circle cx="16.6" cy={ly} r="1.1" {...solid} strokeWidth={0} /><path d={`M22.1 ${ly + 0.4}c.7-.9 1.9-.9 2.6 0`} fill="none" {...ink} /></>}
      {eyes === 4 && <><ellipse cx="16.6" cy={ly} rx="1.2" ry="1.6" {...solid} strokeWidth={0} /><ellipse cx="23.4" cy={ly} rx="1.2" ry="1.6" {...solid} strokeWidth={0} /></>}
      {/* cheeks, freckles */}
      <ellipse cx="14.4" cy={cy + 3.6} rx="1.7" ry="1" fill="currentColor" fillOpacity={0.2} />
      <ellipse cx="25.6" cy={cy + 3.6} rx="1.7" ry="1" fill="currentColor" fillOpacity={0.2} />
      {extra === 0 && [[14, 21.4], [15.4, 22.6], [24.6, 22.6], [26, 21.4]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r=".42" fill="currentColor" />)}
      {/* mouth */}
      <g stroke={beard ? 'var(--surface)' : 'currentColor'}>
        {mouth === 0 && <path d="M17.4 23.8c1.5 1.4 3.7 1.4 5.2 0" fill="none" {...ink} stroke={undefined} />}
        {mouth === 1 && <path d="M17 23.4c1.8 2.6 4.8 2.6 6 0z" fill={beard ? 'var(--surface)' : 'currentColor'} {...ink} stroke={undefined} />}
        {mouth === 2 && <ellipse cx="20" cy="24.3" rx="1.1" ry="1.3" fill="none" {...ink} stroke={undefined} />}
        {mouth === 3 && <path d="M17.9 24.4c1.4.4 2.9.2 4.2-.9" fill="none" {...ink} stroke={undefined} />}
        {mouth === 4 && <path d="M17.6 23.6c.8.9 1.6.9 2.4 0s1.6-.9 2.4 0" fill="none" {...ink} stroke={undefined} />}
      </g>
    </svg>
  );
}
