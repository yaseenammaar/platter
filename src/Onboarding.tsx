// First-run welcome tour: seven little scenes, each a hand-drawn illustration that sketches
// itself in and something to play with. Shown once per person; replay it from Settings.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, href } from './api';
import { Logo, Pip, Sketch, type SketchName } from './sketch';
import { Avatar, Battery, firstName, useApp } from './ui';

/** Open the tour from anywhere (Settings → Replay). */
export const openTour = () => window.dispatchEvent(new Event('platter:tour'));
export const TOUR_EVENT = 'platter:tour';

const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, REDUCED ? 0 : ms));

// ---------- Sketch primitives ----------
/** A pencil line that draws itself in. */
function Ink({ d, delay = 0, dur = 0.8, className = '', ...rest }: { d: string; delay?: number; dur?: number; className?: string } & React.SVGProps<SVGPathElement>) {
  return <path d={d} pathLength={1} className={`ink ${className}`} style={{ animationDelay: `${delay}s`, animationDuration: `${dur}s` }} {...rest} />;
}
/** A soft fill that fades in under its outline. */
const Wash = ({ d, delay = 0, fill = 'var(--pista-soft)' }: { d: string; delay?: number; fill?: string }) => (
  <path d={d} fill={fill} stroke="none" className="wash" style={{ animationDelay: `${delay}s` }} />
);
const Art = ({ children, label, className = '', onClick }: { children: ReactNode; label: string; className?: string; onClick?: () => void }) => (
  <svg viewBox="0 0 360 220" className={`ob-art ${className}`} role="img" aria-label={label} onClick={onClick}
    fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
/** Little sparkle burst, drawn in place. */
const Sparkles = ({ at, delay = 0 }: { at: [number, number][]; delay?: number }) => (
  <g className="ob-sparkles">
    {at.map(([x, y], i) => (
      <Ink key={i} delay={delay + i * 0.08} dur={0.4} d={`M${x} ${y - 7}c.6 4.2 2.2 6 6.4 6.6-4.2.6-5.8 2.4-6.4 6.6-.6-4.2-2.2-6-6.4-6.6 4.2-.6 5.8-2.4 6.4-6.6z`} />
    ))}
  </g>
);
/** "try it" with a hand-drawn arrow. */
const TryIt = ({ children, show = true }: { children: ReactNode; show?: boolean }) =>
  show ? <div className="ob-try"><svg width="34" height="22" viewBox="0 0 34 22" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><Ink d="M2 4c8 1 18 4 26 13" /><Ink d="M21 16.6l7.2.8.4-7" delay={0.5} dur={0.3} /></svg>{children}</div> : null;

// ---------- The robot agent, reused across scenes ----------
function Robot({ x, y, s = 1, working = false, delay = 0, label }: { x: number; y: number; s?: number; working?: boolean; delay?: number; label?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} className={`ob-robot ${working ? 'working' : ''}`}>
      <Wash d="M-30 -24h60c5 0 8 3 8 8v36c0 5-3 8-8 8h-60c-5 0-8-3-8-8v-36c0-5 3-8 8-8z" delay={delay + 0.4} fill="var(--surface)" />
      <Ink d="M-30 -24h60c5 0 8 3 8 8v36c0 5-3 8-8 8h-60c-5 0-8-3-8-8v-36c0-5 3-8 8-8z" delay={delay} />
      <Ink d="M0 -24c.8-4.4-.8-8.6 0-13" delay={delay + 0.3} dur={0.3} />
      <circle className="ob-antenna" cx="0" cy="-41" r="4.5" fill="var(--primary)" />
      <g className="ob-eyes"><circle cx="-13" cy="-4" r="4" fill="currentColor" stroke="none" /><circle cx="13" cy="-4" r="4" fill="currentColor" stroke="none" /></g>
      <Ink d="M-10 10c6 5 14 5 20 0" delay={delay + 0.5} dur={0.4} />
      <Ink d="M-46 -6v14M46 -6v14" delay={delay + 0.6} dur={0.3} />
      <Ink d="M-20 28h40l6 18h-52z" delay={delay + 0.4} />
      {label && <text x="0" y="64" textAnchor="middle" className="ob-label" stroke="none" fill="currentColor">{label}</text>}
    </g>
  );
}

// ---------- Scene 1: lift the lid ----------
function Welcome({ done }: { done: () => void }) {
  const { me, team } = useApp();
  const [lifted, setLifted] = useState(false);
  const lift = () => { if (!lifted) { setLifted(true); done(); } };
  return (
    <>
      <h1>Hi {firstName(me.name)}, welcome to <mark className="hl">{team.name}</mark></h1>
      <p className="lead">This is your team's platter. Everything your team is cooking lives under here.</p>
      <div className="ob-stage">
        <Art label="A serving dome on a platter" className="clickable" onClick={lift}>
          <Ink d="M24 200c100-5 210-5 312 0" dur={1} />
          <g className={`ob-reveal ${lifted ? 'on' : ''}`}>
            {[[-14, 128, -8], [0, 120, 4], [14, 128, 10]].map(([dx, yy, r], i) => (
              <g key={i} transform={`translate(${180 + dx * 3} ${yy}) rotate(${r})`}>
                <rect x="-30" y="-20" width="60" height="40" rx="7" fill="var(--surface)" />
                <path d="M-18 -6h30M-18 4h22" />
              </g>
            ))}
            <g transform="translate(150 54) scale(0.95)"><Pip mood="party" size={64} /></g>
            {lifted && <Sparkles at={[[110, 70], [250, 60], [278, 120], [86, 120]]} delay={0.5} />}
          </g>
          <Wash d="M60 176c0-12 240-12 240 0 0 13-240 13-240 0z" delay={0.6} fill="var(--surface)" />
          <Ink d="M60 176c0-12 240-12 240 0 0 13-240 13-240 0z" delay={0.2} />
          <Ink d="M84 176c40-7 152-7 192 0" delay={0.7} dur={0.5} />
          <g className={`ob-dome ${lifted ? 'lifted' : ''}`}>
            <Wash d="M90 170c0-72 180-72 180 0z" delay={0.9} />
            <Ink d="M90 170c0-72 180-72 180 0z" delay={0.5} />
            <Ink d="M170 116c0-12 20-12 20 0" delay={1.1} dur={0.3} />
            <Ink d="M180 104c.6-2-.6-4 0-6" delay={1.3} dur={0.2} />
            <Ink d="M112 154c4-14 14-24 28-30" delay={1.3} dur={0.4} className="shine" />
          </g>
        </Art>
        <TryIt show={!lifted}>Tap the lid</TryIt>
        {lifted && <p className="ob-note pop">Ta-da! Tasks, agents and teammates, all on one plate.</p>}
      </div>
    </>
  );
}

// ---------- Scene 2: done when… ----------
const DONE_WHEN = ['Reset email arrives', 'Link expires after 1 hour', 'Tests pass'];
function DoneWhen({ done }: { done: () => void }) {
  const [ticks, setTicks] = useState<boolean[]>(DONE_WHEN.map(() => false));
  const all = ticks.every(Boolean);
  useEffect(() => { if (all) done(); }, [all, done]);
  return (
    <>
      <h1>Every task says what “done” looks like</h1>
      <p className="lead">A task gets a doer, a different person to check it, and a short list of “done when” items. No vague tickets.</p>
      <div className="ob-stage">
        <div className={`ob-card ${all ? 'served' : ''}`}>
          <svg className="ob-card-edge" viewBox="0 0 300 200" preserveAspectRatio="none" fill="none" stroke="currentColor" strokeWidth={1.6}>
            <Ink d="M8 6h284c2 0 3 1 3 3v182c0 2-1 3-3 3H8c-2 0-3-1-3-3V9c0-2 1-3 3-3z" dur={1.1} vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="ob-card-top"><span className="key">WEB-12</span><b>Add password reset</b></div>
          <div className="ob-card-label">Done when…</div>
          {DONE_WHEN.map((t, i) => (
            <button key={t} type="button" className={`ob-tick ${ticks[i] ? 'on' : ''}`} style={{ animationDelay: `${0.4 + i * 0.15}s` }}
              onClick={() => setTicks(ticks.map((v, j) => (j === i ? !v : v)))} aria-pressed={ticks[i]}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 4.6c4.6-.3 9.4-.3 14 .1.4 4.8.4 9.6 0 14.4-4.6.4-9.4.4-14 0-.4-4.8-.4-9.7 0-14.5z" />
                {ticks[i] && <Ink d="M7.6 12.4l3 3 6.4-7.4" dur={0.35} />}
              </svg>
              <span>{t}</span>
            </button>
          ))}
          {all && <div className="ob-stamp">Ready to serve</div>}
        </div>
        <TryIt show={!all}>Tick them off</TryIt>
      </div>
    </>
  );
}

// ---------- Scene 3: hand it to your agent ----------
const WORK = [
  { icon: 'eye' as SketchName, text: 'Read WEB-12 and its 3 “done when” items' },
  { icon: 'pencil' as SketchName, text: 'Edit src/auth/reset.ts' },
  { icon: 'check' as SketchName, text: 'npm test: 52 passed' },
  { icon: 'box' as SketchName, text: 'Sent for review, with proof for each item' },
];
function Agent({ done }: { done: () => void }) {
  const [handed, setHanded] = useState(false);
  const [lines, setLines] = useState(0);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const botRef = useRef<HTMLDivElement>(null);

  const hand = async () => {
    if (handed) return;
    setHanded(true);
    setDrag(null);
    for (let i = 1; i <= WORK.length; i++) { await wait(650); setLines(i); }
    done();
  };
  const down = (e: React.PointerEvent) => {
    if (handed) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY };
    setDrag({ x: 0, y: 0 });
  };
  const move = (e: React.PointerEvent) => start.current && setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y });
  const up = () => {
    if (!start.current) return;
    start.current = null;
    const c = cardRef.current?.getBoundingClientRect();
    const b = botRef.current?.getBoundingClientRect();
    if (c && b && c.right > b.left + 20 && c.left < b.right && c.bottom > b.top && c.top < b.bottom) hand();
    else setDrag(null);
  };
  return (
    <>
      <h1>Your agent does the work</h1>
      <p className="lead">Connect Claude Code (or any MCP agent) and it picks up your tasks with the full story, posts updates, and shows proof for every item.</p>
      <div className="ob-stage ob-agent">
        <div className="ob-lane">
          <span className="ob-lane-label">Up next</span>
          <div ref={cardRef} className={`ob-mini ${handed ? 'gone' : ''} ${drag ? 'dragging' : ''}`}
            style={drag ? { transform: `translate(${drag.x}px, ${drag.y}px) rotate(3deg)` } : undefined}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
            role="button" tabIndex={0} aria-label="Task WEB-12, drag it to your agent" onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && hand()}>
            <span className="key">WEB-12</span><b>Add password reset</b>
            <span className="muted small">3 done-when items</span>
          </div>
        </div>
        <div ref={botRef} className="ob-bot">
          <svg viewBox="0 0 160 150" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="ob-art" aria-hidden>
            <Robot x={80} y={70} s={1.2} working={handed && lines < WORK.length} label="your agent" />
            {lines >= WORK.length && <Sparkles at={[[24, 30], [140, 24], [146, 96]]} />}
          </svg>
        </div>
        <div className="ob-log">
          {WORK.slice(0, lines).map((w) => <div key={w.text} className="ob-log-line pop"><Sketch name={w.icon} size={15} /> {w.text}</div>)}
          {handed && lines < WORK.length && <div className="ob-log-line typing"><span /><span /><span /></div>}
        </div>
        <TryIt show={!handed}>Drag the task onto your agent</TryIt>
        {!handed && <button type="button" className="link-btn small ob-alt" onClick={hand}>or just hand it over</button>}
      </div>
    </>
  );
}

// ---------- Scene 4: someone else checks ----------
function Check({ done }: { done: () => void }) {
  const { me, members } = useApp();
  const reviewer = members.find((m) => m.id !== me.id && m.status === 'active')?.name ?? 'Sam Rivera';
  const [state, setState] = useState<'waiting' | 'fix' | 'fixed' | 'served'>('waiting');
  const fix = async () => { setState('fix'); await wait(1400); setState('fixed'); };
  const approve = () => { setState('served'); done(); };
  return (
    <>
      <h1>Someone else always checks</h1>
      <p className="lead">Nobody approves their own work. A teammate (or their agent) checks the proof against each item, and any feedback goes straight back to the doer.</p>
      <div className="ob-stage">
        <div className={`ob-review ${state}`}>
          <div className="ob-reviewer">
            <Avatar name={reviewer} size={56} />
            <span className="muted small">{firstName(reviewer)} checks</span>
            <svg className="ob-glass" width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <Ink d="M10.6 16.6c3.3 0 6-2.7 6-6s-2.7-6-6-6-6 2.7-6 6 2.7 6 6 6z" /><Ink d="M15 15.3l4.9 4.6" delay={0.5} dur={0.3} />
            </svg>
          </div>
          <div className="ob-proof">
            {DONE_WHEN.map((t, i) => (
              <div key={t} className="ob-proof-row" style={{ animationDelay: `${0.3 + i * 0.2}s` }}>
                <span className={`ob-verdict ${state === 'fix' && i === 1 ? 'bad' : state !== 'waiting' && !(state === 'fix' && i === 1) ? 'good' : ''}`}>
                  {state === 'fix' && i === 1 ? <Sketch name="cross" size={14} /> : state !== 'waiting' ? <Sketch name="check" size={14} /> : <Sketch name="eye" size={14} />}
                </span>
                <span><b>AC{i + 1}</b> {t}</span>
              </div>
            ))}
            {state === 'fix' && <div className="ob-feedback pop"><Sketch name="wrench" size={14} /> AC2: add a test for an expired link</div>}
            {state === 'fixed' && <div className="ob-feedback good pop"><Sketch name="bolt" size={14} /> Your agent fixed it and sent it back</div>}
          </div>
          {state === 'served' && <div className="ob-stamp big">Served!</div>}
        </div>
        {state !== 'served' && (
          <div className="ob-actions">
            {state === 'waiting' && <button type="button" className="btn" onClick={fix}><Sketch name="wrench" size={15} /> Needs a fix</button>}
            <button type="button" className="btn primary" onClick={approve} disabled={state === 'fix'}><Sketch name="thumbUp" size={15} /> {state === 'fixed' ? 'Now it looks good' : 'Looks good'}</button>
          </div>
        )}
        <TryIt show={state === 'waiting'}>Be the reviewer</TryIt>
      </div>
    </>
  );
}

// ---------- Scene 5: energy & handoffs ----------
function Energy({ done }: { done: () => void }) {
  const { me, members } = useApp();
  const mate = members.find((m) => m.id !== me.id && m.status === 'active')?.name ?? 'Sam Rivera';
  const [pct, setPct] = useState(80);
  const handed = pct < 10;
  useEffect(() => { if (handed) done(); }, [handed, done]);
  const level = pct < 10 ? 'drained' : pct < 25 ? 'low' : 'full';
  return (
    <>
      <h1>Agents share their energy</h1>
      <p className="lead">Everyone can see how much usage each agent has left. When one runs low mid-task, it passes the plate on with notes, and a teammate's agent finishes it.</p>
      <div className="ob-stage">
        <Art label="Two agents; the task moves to the one with energy">
          <Ink d="M40 196c94-4 186-4 280 0" />
          <Robot x={86} y={104} s={0.95} label="your agent" />
          <Robot x={274} y={104} s={0.95} delay={0.3} working={handed} label={`${firstName(mate)}'s agent`} />
          <path className="ob-arc" d="M112 34C150 -6 210 -6 248 34" strokeDasharray="4 7" />
          <g className={`ob-plate ${handed ? 'moved' : ''}`}>
            <rect x="62" y="12" width="48" height="30" rx="6" fill="var(--surface)" />
            <path d="M70 22h26M70 31h18" />
            {handed && <path d="M108 8l8-8M114 14l10-4" className="ob-whoosh" />}
          </g>
        </Art>
        <div className="ob-energy">
          <span className={`ob-battery ${level}`}><Battery pct={Math.round(pct / 5) * 5} /></span>
          <input type="range" min={0} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} aria-label="Your agent's energy" />
        </div>
        <p className={`ob-note ${handed ? 'pop' : ''}`}>
          {handed
            ? <>Your agent ran low and handed WEB-12 to {firstName(mate)}'s agent, with notes on what's done, what's left, and the branch.</>
            : pct < 25 ? 'Getting low: it finishes what it has, but won\'t take on more.' : 'Plenty of energy. Your agent can take on work.'}
        </p>
        <TryIt show={!handed}>Drain your agent's energy</TryIt>
      </div>
    </>
  );
}

// ---------- Scene 6: just ask ----------
const QUESTIONS = [
  { q: 'Did the login fix ship?', a: 'Yes, merged in PR #118 this morning. I checked the git log and WEB-9 is Done.' },
  { q: 'Is the billing task stuck?', a: 'It is: WEB-5 is blocked waiting on a Stripe test key. I flagged it on the task.' },
  { q: 'When will CSV export be ready?', a: 'Two of three items are done on feat/csv-export; tests are next. Likely today.' },
];
function Ask({ done }: { done: () => void }) {
  const { me, members } = useApp();
  const mate = members.find((m) => m.id !== me.id && m.status === 'active')?.name ?? 'Sam Rivera';
  const [pick, setPick] = useState<number | null>(null);
  const [phase, setPhase] = useState<'idle' | 'flying' | 'thinking' | 'typing' | 'done'>('idle');
  const [typed, setTyped] = useState('');
  const ask = async (i: number) => {
    if (phase !== 'idle' && phase !== 'done') return;
    setPick(i); setTyped(''); setPhase('flying');
    await wait(1100); setPhase('thinking');
    await wait(900); setPhase('typing');
    const text = QUESTIONS[i].a;
    for (let n = 1; n <= text.length; n += 2) { setTyped(text.slice(0, n)); await wait(18); }
    setTyped(text); setPhase('done'); done();
  };
  return (
    <>
      <h1>Just ask a teammate's agent</h1>
      <p className="lead">Ask anyone for an update. The question goes to their agent, which looks it up and answers, so nobody gets interrupted.</p>
      <div className="ob-stage">
        <div className="ob-ask">
          <div className="ob-person"><Avatar name={me.name} size={52} /><span className="small">you</span></div>
          <svg className="ob-path" viewBox="0 0 220 80" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
            <path d="M10 60C60 0 160 0 210 50" strokeDasharray="3 7" className="ob-dash" />
          </svg>
          {phase === 'flying' && <span className="ob-flyer"><Pip size={40} mood="happy" /></span>}
          <div className="ob-person">
            <span className="ob-mate"><Avatar name={mate} size={52} /><span className={`ob-mate-bot ${phase === 'thinking' || phase === 'typing' ? 'busy' : ''}`}><Sketch name="agent" size={18} /></span></span>
            <span className="small">{firstName(mate)}'s agent</span>
          </div>
        </div>
        {pick !== null && <div className="ob-bubble q pop">“{QUESTIONS[pick].q}”</div>}
        {phase === 'thinking' && <div className="ob-bubble a typing"><span /><span /><span /></div>}
        {(phase === 'typing' || phase === 'done') && <div className="ob-bubble a">{typed}<span className="ob-caret" /></div>}
        <div className="ob-chips">
          {QUESTIONS.map((x, i) => (
            <button key={x.q} type="button" className={`toggle ${pick === i ? 'on' : ''}`} onClick={() => ask(i)} disabled={phase === 'flying' || phase === 'thinking' || phase === 'typing'}>{x.q}</button>
          ))}
        </div>
        <TryIt show={phase === 'idle'}>Pick a question</TryIt>
      </div>
    </>
  );
}

// ---------- Scene 7: your plate is ready ----------
function Finale({ finish }: { finish: (to: string) => void }) {
  const { me, members } = useApp();
  const owner = me.role === 'owner';
  const hasAgent = (members.find((m) => m.id === me.id)?.active_agents ?? 0) > 0;
  const [locked, setLocked] = useState(false);
  return (
    <>
      <div className="ob-finale-art">
        <Logo size={88} className="ob-logo-bob" />
        <svg viewBox="0 0 140 120" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <Sparkles at={[[14, 22], [124, 14], [132, 84], [8, 90]]} delay={0.3} />
        </svg>
      </div>
      <h1>Your plate is ready</h1>
      <p className="lead">{hasAgent ? 'Your agent is connected. Tell it “pick up my next Platter task”.' : 'One last thing: connect your agent so it can pick up your tasks. It takes a minute.'}</p>
      {owner && (
        <div className="ob-owner">
          <button type="button" className={`ob-lock ${locked ? 'on' : ''}`} onClick={() => setLocked(!locked)} aria-pressed={locked} aria-label="Try the focus lock">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M6.4 10.6h11.2c.5 0 .9.4.9.9v7.7c0 .5-.4.9-.9.9H6.4c-.5 0-.9-.4-.9-.9v-7.7c0-.5.4-.9.9-.9z" />
              <path className="ob-shackle" d="M8.4 10.4V7.6a3.6 3.6 0 0 1 7.2 0v2.8" />
            </svg>
          </button>
          <div>
            <b>You're the owner.</b>{' '}
            <span className="muted">{locked
              ? 'Locked! That agent now works on its one task, and parks everything else for later.'
              : 'In Team rules you can lock an agent to its task, or log what agents do. Tap the lock.'}</span>
          </div>
        </div>
      )}
      <div className="ob-actions">
        {!hasAgent && me.role !== 'viewer' && <button type="button" className="btn primary big" onClick={() => finish('/settings')}><Sketch name="agent" size={18} /> Connect my agent</button>}
        <button type="button" className={`btn big ${hasAgent || me.role === 'viewer' ? 'primary' : ''}`} onClick={() => finish('/board')}><Sketch name="board" size={18} /> Show me the board</button>
      </div>
    </>
  );
}

// ---------- The tour ----------
const SCENES = ['Welcome', 'Done when', 'Your agent', 'Checking', 'Energy', 'Asking', 'Ready'];

export function Onboarding({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const [played, setPlayed] = useState<boolean[]>(SCENES.map(() => false));
  const [leaving, setLeaving] = useState(false);
  const last = i === SCENES.length - 1;

  const go = (n: number) => { if (n < 0 || n >= SCENES.length) return; setDir(n > i ? 'fwd' : 'back'); setI(n); };
  const markPlayed = useRef((n: number) => setPlayed((p) => p.map((v, j) => (j === n ? true : v)))).current;
  const close = (to?: string) => {
    api.post('/me/onboarded').catch(() => {});
    setLeaving(true);
    setTimeout(() => { onClose(); if (to) nav(href(to), { viewTransition: true }); }, REDUCED ? 0 : 260);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT') return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' && !last) go(i + 1);
      else if (e.key === 'ArrowLeft') go(i - 1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);

  const done = useRef(SCENES.map((_, n) => () => markPlayed(n))).current;
  const scene = [
    <Welcome done={done[0]} />, <DoneWhen done={done[1]} />, <Agent done={done[2]} />, <Check done={done[3]} />,
    <Energy done={done[4]} />, <Ask done={done[5]} />, <Finale finish={close} />,
  ][i];

  return (
    <div className={`ob ${leaving ? 'leaving' : ''}`} role="dialog" aria-modal="true" aria-label="Welcome to Platter">
      <header className="ob-top">
        <span className="ob-brand"><Logo size={30} /> Platter</span>
        <nav className="ob-dots" aria-label="Tour progress">
          {SCENES.map((s, n) => (
            <button key={s} type="button" className={`ob-dot ${n === i ? 'on' : ''} ${played[n] || n < i ? 'seen' : ''}`} onClick={() => go(n)} aria-label={`${n + 1}. ${s}`} aria-current={n === i ? 'step' : undefined}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M8 2.2c3.4 0 5.9 2.5 5.8 5.9-.1 3.3-2.6 5.7-5.9 5.7S2.2 11.3 2.2 8 4.7 2.2 8 2.2z" /></svg>
            </button>
          ))}
        </nav>
        {!last ? <button type="button" className="link-btn small" onClick={() => close()}>Skip</button> : <span className="ob-skip-gap" />}
      </header>
      <main className={`ob-scene ${dir}`} key={i}>{scene}</main>
      {!last && (
        <footer className="ob-bottom">
          <button type="button" className="btn" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Back"><Sketch name="back" size={16} /></button>
          <span className="muted small">{i + 1} of {SCENES.length}</span>
          <button type="button" className={`btn primary ${played[i] ? 'nudge' : ''}`} onClick={() => go(i + 1)}>
            Next <Sketch name="back" size={16} className="flip" />
          </button>
        </footer>
      )}
    </div>
  );
}

