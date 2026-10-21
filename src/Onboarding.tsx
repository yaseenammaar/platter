// First-run tour of the real app. Each stop opens the right page, dims everything else,
// draws a sketched outline around the thing to use, and says what it's for and how to use it.
// Shown once per person; replay it from Settings.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, href } from './api';
import { Logo, Sketch, type SketchName } from './sketch';
import { firstName, useApp } from './ui';

export const TOUR_EVENT = 'platter:tour';
/** Open the tour from anywhere (Settings → Replay). */
export const openTour = () => window.dispatchEvent(new Event(TOUR_EVENT));

const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Stop {
  /** Page to open first (inside the team). */
  route?: string;
  /** `data-tour` of the element to point at. No target = a centred card. */
  target?: string;
  icon: SketchName;
  title: string;
  body: ReactNode;
  /** How to do it, in one line. */
  how?: ReactNode;
}

function stopsFor(o: { name: string; team: string; canWork: boolean; owner: boolean; hasMates: boolean; hasAgent: boolean }): Stop[] {
  const stops: (Stop | false)[] = [
    {
      route: '/', icon: 'sparkle', title: `Welcome to ${o.team}, ${firstName(o.name)}!`,
      body: 'Platter is where your team and your AI agents share the work. This quick tour shows you where everything is. It takes about a minute.',
    },
    {
      target: 'team', icon: 'team', title: 'Your team',
      body: 'This is the team you are working in. Everything you see belongs to it.',
      how: <>Tap the name to <b>switch teams</b> or <b>start a new one</b>.</>,
    },
    o.canWork && {
      target: 'new', icon: 'plus', title: 'Make a task',
      body: 'Every task says what “done” looks like, who does it, and a different person who checks it.',
      how: <>Tap <b>New</b>, write the title and a few <b>“done when”</b> items, then pick who does it and who checks it.</>,
    },
    {
      route: '/board', target: 'board', icon: 'board', title: 'The board',
      body: 'Every task, by stage: To do, Doing, Review and Done. Tasks move along as people and agents work on them.',
      how: <>Tap any card to see its <b>story</b>: updates, the proof for each item, and the review.</>,
    },
    o.hasMates && o.canWork && {
      route: '/', target: 'ask', icon: 'chat', title: 'Ask a teammate',
      body: "Want an update? Ask here. The question goes to the teammate's agent, which looks it up and answers, so nobody gets interrupted.",
      how: <>Pick a <b>person</b>, type your question, press <b>Ask</b>. The answer shows up here on Home.</>,
    },
    {
      route: '/team', target: 'people', icon: 'bolt', title: 'Your team at a glance',
      body: "Who's doing what, what's waiting to be checked, and how much energy each person's agent has left.",
      how: <>When an agent runs low it <b>hands its task on</b>, and someone else's agent can pick it up from Home.</>,
    },
    {
      target: 'dock-feed', icon: 'feed', title: 'The feed',
      body: 'Everything that happens on the team, in plain words: new tasks, updates from agents, reviews, questions and answers.',
    },
    o.canWork && {
      route: '/settings', target: 'agent-setup', icon: 'agent', title: 'Connect your agent',
      body: o.hasAgent ? 'Your agent is connected. You can add another here any time, for example for a second laptop.'
        : 'Your agent (Claude Code, Cursor…) picks up your tasks, posts updates, and shows proof for every item.',
      how: <>Name it, press <b>Connect</b>, then paste the setup into Claude Code. You'll see a tick once it's connected.</>,
    },
    o.owner && {
      route: '/settings', target: 'team-rules', icon: 'lock', title: 'Team rules (owners only)',
      body: "Lock someone's agent to its one task so it can't wander off, or keep a one-line log of everything agents do.",
      how: <>Open <b>Team rules</b> and flip the switches.</>,
    },
    {
      icon: 'done', title: "That's it, you're ready!",
      body: o.hasAgent || !o.canWork ? 'Head to the board and see what your team is cooking.' : 'One last thing: connect your agent so it can start picking up your tasks.',
    },
  ];
  return stops.filter(Boolean) as Stop[];
}

type Rect = { x: number; y: number; w: number; h: number };
const PAD = 8;

/** Where the target is on screen right now, with a little breathing room. */
function measure(name?: string): Rect | null {
  if (!name) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
}

/** A hand-drawn rounded box, slightly wonky, with an overshooting end like a pen stroke. */
function scribble({ x, y, w, h }: Rect) {
  const k = Math.min(16, h / 2, w / 2);
  return `M${x + k + 4} ${y - 1.5} L${x + w - k} ${y + 0.8} Q${x + w + 0.5} ${y} ${x + w + 0.6} ${y + k} L${x + w - 0.8} ${y + h - k} ` +
    `Q${x + w} ${y + h + 0.6} ${x + w - k} ${y + h + 0.4} L${x + k} ${y + h - 0.8} Q${x - 0.6} ${y + h} ${x - 0.4} ${y + h - k} ` +
    `L${x + 0.8} ${y + k} Q${x} ${y - 0.4} ${x + k + 10} ${y - 2.6}`;
}

export function Onboarding({ onClose }: { onClose: () => void }) {
  const { me, team, members } = useApp();
  const hasAgent = (members.find((m) => m.id === me.id)?.active_agents ?? 0) > 0;
  const canWork = me.role !== 'viewer';
  const [stops] = useState(() => stopsFor({
    name: me.name, team: team.name, canWork, owner: me.role === 'owner', hasAgent,
    hasMates: members.some((m) => m.id !== me.id && m.status === 'active'),
  }));
  const nav = useNavigate();
  const loc = useLocation();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [view, setView] = useState({ w: innerWidth, h: innerHeight });
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(220);
  const stop = stops[i];
  const last = i === stops.length - 1;

  const close = useCallback((to?: string) => {
    api.post('/me/onboarded').catch(() => {});
    setLeaving(true);
    setTimeout(() => { onClose(); if (to) nav(href(to), { viewTransition: true }); }, REDUCED ? 0 : 220);
  }, [nav, onClose]);

  // Open the stop's page, wait for its target to appear, bring it into view.
  useEffect(() => {
    setReady(false);
    if (stop.route && loc.pathname.replace(/\/$/, '') !== href(stop.route).replace(/\/$/, '')) nav(href(stop.route));
    let tries = 0;
    let t = 0;
    const find = () => {
      const el = stop.target ? document.querySelector<HTMLElement>(`[data-tour="${stop.target}"]`) : null;
      // Pages load their data first; give the target up to 5s to show up.
      if (stop.target && !el && tries++ < 100) { t = window.setTimeout(find, 50); return; }
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.top < 70 || r.bottom > innerHeight - 120) el.scrollIntoView({ block: 'center', behavior: REDUCED ? 'auto' : 'smooth' });
      }
      t = window.setTimeout(() => { setRect(measure(stop.target)); setReady(true); }, el ? 350 : 0);
    };
    t = window.setTimeout(find, 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  // Follow the target while the page settles, scrolls or resizes.
  useEffect(() => {
    const follow = () => { setView({ w: innerWidth, h: innerHeight }); if (ready) setRect(measure(stop.target)); };
    const id = setInterval(follow, 400);
    addEventListener('resize', follow);
    addEventListener('scroll', follow, true);
    return () => { clearInterval(id); removeEventListener('resize', follow); removeEventListener('scroll', follow, true); };
  }, [ready, stop.target]);

  useLayoutEffect(() => { if (cardRef.current && cardRef.current.offsetHeight !== cardH) setCardH(cardRef.current.offsetHeight); });

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' && !last) setI(i + 1);
      else if (e.key === 'ArrowLeft' && i > 0) setI(i - 1);
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  });

  // Card beside the target: below it if there's room, else above. Centred without a target.
  // On phones it docks to the bottom edge instead.
  const { w: vw, h: vh } = view;
  const spot = rect && ready ? rect : null;
  const narrow = vw < 560;
  const cardW = Math.min(360, vw - 32);
  let cardStyle: React.CSSProperties | undefined;
  let arrow: 'up' | 'down' | null = null;
  let arrowX = 0;
  if (spot && !narrow) {
    const below = spot.y + spot.h + 18 + cardH < vh - 8;
    const top = below ? spot.y + spot.h + 18 : Math.max(16, spot.y - 18 - cardH);
    const left = Math.min(Math.max(16, spot.x + spot.w / 2 - cardW / 2), vw - cardW - 16);
    cardStyle = { top, left, width: cardW };
    arrow = below ? 'up' : 'down';
    arrowX = Math.min(Math.max(24, spot.x + spot.w / 2 - left), cardW - 24);
  } else if (!spot) {
    cardStyle = { top: Math.max(16, (vh - cardH) / 2), left: (vw - cardW) / 2, width: cardW };
  }
  const docked = !!spot && narrow;
  // Docked cards sit at the bottom edge, unless that's where the target is (the dock).
  const dockTop = docked && spot!.y + spot!.h / 2 > vh / 2;

  return (
    <div className={`tour ${leaving ? 'leaving' : ''}`} role="dialog" aria-modal="true" aria-label="Platter tour">
      <svg className="tour-shade" width={vw} height={vh} aria-hidden>
        <defs>
          <mask id="tour-hole">
            <rect width={vw} height={vh} fill="#fff" />
            {spot && <rect className="tour-hole" x={spot.x} y={spot.y} width={spot.w} height={spot.h} rx={14} fill="#000" />}
          </mask>
        </defs>
        <rect width={vw} height={vh} className="tour-dim" mask="url(#tour-hole)" />
        {spot && <path key={i} className="tour-ring" d={scribble(spot)} pathLength={1} />}
      </svg>

      <div ref={cardRef} key={i} className={`tour-card surface ${docked ? `docked ${dockTop ? 'top' : ''}` : ''} ${ready ? 'in' : ''}`} style={cardStyle}>
        {arrow && <span className={`tour-arrow ${arrow}`} style={{ left: arrowX }} />}
        <div className="tour-head">
          {i === 0 || last ? <Logo size={40} className="tour-logo" /> : <span className="tour-icon"><Sketch name={stop.icon} size={20} /></span>}
          <b>{stop.title}</b>
        </div>
        <p>{stop.body}</p>
        {stop.how && <div className="tour-how"><Sketch name="hand" size={16} /><span>{stop.how}</span></div>}
        <div className="tour-foot">
          <span className="tour-dots" aria-label={`Step ${i + 1} of ${stops.length}`}>
            {stops.map((_, n) => <span key={n} className={n === i ? 'on' : n < i ? 'seen' : ''} />)}
          </span>
          {last ? (
            <span className="tour-btns">
              {!hasAgent && canWork && <button type="button" className="btn" onClick={() => close('/settings')}>Connect my agent</button>}
              <button type="button" className="btn primary" onClick={() => close('/board')} autoFocus>Show me the board</button>
            </span>
          ) : (
            <span className="tour-btns">
              {i === 0
                ? <button type="button" className="link-btn small" onClick={() => close()}>Skip tour</button>
                : <button type="button" className="btn" onClick={() => setI(i - 1)} aria-label="Back"><Sketch name="back" size={16} /></button>}
              <button type="button" className="btn primary" onClick={() => setI(i + 1)} autoFocus>
                {i === 0 ? "Let's go" : 'Next'} <Sketch name="back" size={16} className="flip" />
              </button>
            </span>
          )}
        </div>
        {!last && i > 0 && <button type="button" className="tour-x" onClick={() => close()} aria-label="End tour"><Sketch name="cross" size={14} /></button>}
      </div>
    </div>
  );
}
