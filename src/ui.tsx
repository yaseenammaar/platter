import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { ApiError, Member, Project, Status, Task, Team } from './api';
import { SketchFace } from './faces';
import { Pip, Sketch, type PipMood, type SketchName } from './sketch';

export { Pip, Sketch };

// ---------- App context ----------
export interface AppState {
  me: Member;
  /** Team name (kept as `workspace` for older components). */
  workspace: string;
  team: { id: string; slug: string; name: string };
  /** Every team the signed-in person belongs to, for the switcher. */
  teams: Team[];
  members: Member[];
  projects: Project[];
  rules: any;
  /** Owner controls: the team's action log, and whether my own agents are focus-locked. */
  policy: { agent_log: boolean; agent_focus: boolean; focus_by: string | null };
  reload: () => Promise<void>;
}
export const AppCtx = createContext<AppState>(null as any);
export const useApp = () => useContext(AppCtx);
export const isAdmin = (m: Member) => m.role === 'owner' || m.role === 'admin';
export const firstName = (n?: string | null) => (n ?? '').split(/\s+/)[0];

// ---------- Friendly vocabulary (the server keeps the precise terms) ----------
export const COLUMNS = [
  { id: 'todo', title: 'To do', icon: 'pencil', statuses: ['backlog', 'ready'] },
  { id: 'doing', title: 'Doing', icon: 'bolt', statuses: ['in_progress', 'blocked'] },
  { id: 'review', title: 'Review', icon: 'review', statuses: ['in_review'] },
  { id: 'done', title: 'Done', icon: 'done', statuses: ['done'] },
] as const;

export const STATUS_WORD: Record<Status, string> = {
  backlog: 'Draft', ready: 'Up next', in_progress: 'Doing', blocked: 'Stuck',
  in_review: 'In review', done: 'Done', cancelled: 'Dropped',
};

export interface Line { icon: SketchName; text: string; tone: string }

/** One short sentence that says what's going on with a task. */
export function statusLine(t: Task): Line {
  const who = (n: string | null) => firstName(n) || 'someone';
  if (t.handoff_open) return { icon: 'hand', text: `Needs a hand — ${t.handoff ? `${who(t.handoff.from_member)}'s agent ran out of energy` : 'the agent went quiet'}`, tone: 'handoff' };
  switch (t.status) {
    case 'backlog': return { icon: 'pencil', text: 'Draft', tone: 'muted' };
    case 'ready': return { icon: 'eye', text: `Up next for ${who(t.assignee_name)}`, tone: 'todo' };
    case 'in_progress':
      if (t.review?.verdict === 'reject') return { icon: 'wrench', text: `${who(t.assignee_name)} is fixing feedback`, tone: 'doing' };
      return { icon: 'bolt', text: t.claimed_by_agent_name ? `${who(t.assignee_name)}'s agent is on it` : `${who(t.assignee_name)} is on it`, tone: 'doing' };
    case 'blocked': return { icon: 'stuck', text: 'Stuck', tone: 'stuck' };
    case 'in_review': return { icon: 'review', text: `Waiting for ${who(t.reviewer_name)} to check`, tone: 'review' };
    case 'done': return { icon: 'done', text: t.review?.reviewed_by ? `Done · checked by ${who(t.review.reviewed_by)}` : 'Done', tone: 'done' };
    default: return { icon: 'trash', text: 'Dropped', tone: 'muted' };
  }
}

/** Strip rule codes like "(R2)" or "(H2/H4)" — humans get plain words, agents get the codes. */
export const plain = (s: string) => s.replace(/\s*\((?:[A-Z]\d+)(?:\s*\/\s*[A-Z]\d+)*\)/g, '').trim();

// ---------- Theme (system / light / dark), with a circular reveal ----------
export type Theme = 'system' | 'light' | 'dark';
const readTheme = (): Theme => {
  try { return (localStorage.getItem('platter_theme') as Theme) || 'system'; } catch { return 'system'; }
};
const applyTheme = (t: Theme) => {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
};
applyTheme(readTheme());

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const isDark = () => theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const setTheme = (next: Theme, from?: { x: number; y: number }) => {
    const swap = () => {
      try { localStorage.setItem('platter_theme', next); } catch { /* private mode */ }
      applyTheme(next);
      setThemeState(next);
    };
    const doc = document as any;
    if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return swap();
    if (from) {
      document.documentElement.style.setProperty('--vt-x', `${from.x}px`);
      document.documentElement.style.setProperty('--vt-y', `${from.y}px`);
    }
    document.documentElement.classList.add('theme-swap');
    doc.startViewTransition(() => flushSync(swap)).finished.finally(() => document.documentElement.classList.remove('theme-swap'));
  };
  return { theme, setTheme, isDark };
}

// ---------- Data hooks ----------
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    setData(null);
    reload();
    if (!pollMs) return;
    const id = setInterval(() => document.visibilityState === 'visible' && reload(), pollMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, reload, setData };
}

/** Wraps an async action with busy + error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}

export function timeAgo(d: string | null | undefined) {
  if (!d) return '';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 0) {
    const m = Math.round(-s / 60);
    return m < 60 ? `in ${m}m` : `in ${Math.round(m / 60)}h`;
  }
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return new Date(d).toLocaleDateString();
}

// ---------- Small components ----------
const TINTS = ['blue', 'purple', 'orange', 'yellow', 'green', 'pink'];
const tint = (s: string) => TINTS[[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 7) % TINTS.length];
/** Everyone's sketched profile picture, picked from their name. */
export function Avatar({ name, size = 24 }: { name?: string | null; size?: number }) {
  if (!name) return <span className="avatar empty" style={{ width: size, height: size, fontSize: size * 0.45 }} title="Nobody yet">?</span>;
  return (
    <span className={`avatar t-${tint(name)}`} title={name} role="img" aria-label={name} style={{ width: size, height: size }}>
      <SketchFace name={name} size={size} />
    </span>
  );
}

/** A pill on/off switch. */
export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (on: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!on)}>
      <span className="switch-knob" />
    </button>
  );
}

export interface PickOption { id: string; name: string; note?: ReactNode; /** Instead of a face, e.g. for "Everyone". */ icon?: SketchName }

const PickFace = ({ o, size }: { o: PickOption; size: number }) => o.icon
  ? <span className="avatar pick-icon" style={{ width: size, height: size }}><Sketch name={o.icon} size={size * 0.6} /></span>
  : <Avatar name={o.name} size={size} />;

/** Choose a person: faces, names and a note per person, with keyboard support. */
export function PersonPicker({ options, value, onChange, placeholder = 'someone…', label, render }: {
  options: PickOption[]; value: string; onChange: (id: string) => void; placeholder?: string; label: string;
  /** How the chosen person reads on the button. */
  render?: (o: PickOption) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const chosen = options.find((o) => o.id === value);
  const shown = options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  useEffect(() => { setHi(Math.max(0, shown.findIndex((o) => o.id === value))); }, [open, query]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }, [hi]);
  const choose = (o: PickOption) => { onChange(o.id); setOpen(false); setQuery(''); };
  const key = (e: React.KeyboardEvent) => {
    if (!open && ['ArrowDown', 'Enter', ' '].includes(e.key)) { e.preventDefault(); setOpen(true); return; }
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => Math.min(shown.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && shown[hi]) { e.preventDefault(); choose(shown[hi]); }
  };
  return (
    <div className="picker" ref={ref} onKeyDown={key}>
      <button type="button" className={`picker-btn ${chosen ? 'chosen' : ''}`} onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open} aria-label={label}>
        {chosen ? <><PickFace o={chosen} size={24} /><span>{render ? render(chosen) : firstName(chosen.name)}</span></> : <span className="muted">{placeholder}</span>}
        <span className="chev">▾</span>
      </button>
      {open && (
        <div className="picker-pop surface">
          {options.length > 6 && (
            <input className="picker-search" placeholder="Find someone" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} />
          )}
          <div className="picker-list" role="listbox" aria-label={label} ref={listRef}>
            {shown.map((o, i) => (
              <button type="button" key={o.id} role="option" aria-selected={o.id === value} className={`picker-row ${i === hi ? 'on' : ''}`}
                onMouseEnter={() => setHi(i)} onClick={() => choose(o)}>
                <PickFace o={o} size={32} />
                <span className="picker-text"><b>{o.name}</b>{o.note && <span className="muted small">{o.note}</span>}</span>
                {o.id === value && <Sketch name="check" size={15} />}
              </button>
            ))}
            {!shown.length && <div className="muted small picker-none">Nobody called that</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** A status chip with a sketched icon. */
export const Chip = ({ icon, tone, children }: { icon: SketchName; tone: string; children: ReactNode }) => (
  <span className={`chip ${tone}`}><Sketch name={icon} size={14} />{children}</span>
);

/** Agent usage shown as energy. */
export function Battery({ pct, compact }: { pct: number | null | undefined; compact?: boolean }) {
  if (pct === null || pct === undefined) {
    return <span className="battery unknown" title="Hasn't said how much energy it has"><Sketch name="zzz" size={15} />{!compact && ' resting'}</span>;
  }
  const level = pct < 10 ? 'drained' : pct < 25 ? 'low' : 'full';
  return (
    <span className={`battery ${level}`} title={`${pct}% of its usage limit left`}>
      <span className="battery-body"><span className="battery-fill" style={{ width: `${Math.max(pct, 4)}%` }} /></span>
      {!compact && <span className="battery-pct">{pct}%</span>}
    </span>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  return (
    <div className="oops" role="alert">
      <Pip mood="worried" size={40} />
      <div>
        <b>{plain(e.message ?? String(error))}</b>
        {e.details?.length ? <ul>{e.details.map((d) => <li key={d}>{plain(d)}</li>)}</ul> : null}
      </div>
    </div>
  );
}

export function Modal({ title, icon, onClose, children, wide }: { title: string; icon?: SketchName; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const [leaving, setLeaving] = useState(false);
  const close = useCallback(() => { setLeaving(true); setTimeout(onClose, 180); }, [onClose]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [close]);
  return (
    <div className={`backdrop ${leaving ? 'leaving' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`modal surface ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <button className="x" onClick={close} aria-label="Close"><Sketch name="cross" size={16} /></button>
        <h2>{icon && <span className="h-icon"><Sketch name={icon} size={22} /></span>}{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** "⋯" dropdown for secondary actions. */
export function Menu({ items }: { items: ({ label: string; onClick: () => void; danger?: boolean } | false | null | undefined)[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const real = items.filter(Boolean) as { label: string; onClick: () => void; danger?: boolean }[];
  if (!real.length) return null;
  return (
    <div className="menu" ref={ref}>
      <button className="btn icon " onClick={() => setOpen(!open)} aria-label="More"><Sketch name="dots" size={20} /></button>
      {open && (
        <div className="menu-pop surface">
          {real.map((i) => (
            <button key={i.label} className={i.danger ? 'danger' : ''} onClick={() => { setOpen(false); i.onClick(); }}>{i.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn small" onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      {done ? <><Sketch name="check" size={14} /> Copied</> : label}
    </button>
  );
}

/** Pip says something (handwritten speech). */
export const Says = ({ mood = 'happy', size = 56, children }: { mood?: PipMood; size?: number; children: ReactNode }) => (
  <div className="says"><Pip mood={mood} size={size} /><span className="bubble-hand">{children}</span></div>
);

export const Empty = ({ mood = 'sleepy', children }: { mood?: PipMood; children: ReactNode }) => (
  <div className="empty-state"><Pip mood={mood} size={84} /><div className="hand">{children}</div></div>
);

export const Loading = ({ text = 'Folding your board…' }: { text?: string }) => (
  <div className="loading"><Pip mood="thinking" size={70} className="flying" /><span className="hand">{text}</span></div>
);

/** Light formatting: keep line breaks, linkify URLs, render `code`. */
export function Text({ children }: { children: string }) {
  if (!children) return null;
  const parts = children.split(/(https?:\/\/[^\s)]+|`[^`]+`)/g);
  return (
    <div className="prose">
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a>
          : /^`[^`]+`$/.test(p) ? <code key={i}>{p.slice(1, -1)}</code>
            : <span key={i}>{p}</span>,
      )}
    </div>
  );
}

// ---------- Toasts (with a little celebration) ----------
type ToastMsg = { id: number; text: string; party?: boolean };
let pushToast: (t: ToastMsg) => void = () => {};
export const toast = (text: string, party = false) => pushToast({ id: Date.now() + Math.random(), text, party });

export function Toaster() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(() => {
    pushToast = (t) => {
      setItems((xs) => [...xs, t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 3400);
    };
  }, []);
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className="toast surface">
          {t.party && <div className="confetti">{Array.from({ length: 8 }, (_, i) => <span key={i} style={{ ['--i' as any]: i }}><Sketch name="sparkle" size={18} /></span>)}</div>}
          <Pip mood={t.party ? 'party' : 'happy'} size={30} />
          {t.text}
        </div>
      ))}
    </div>
  );
}
