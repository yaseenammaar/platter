import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, href, lastTeam, setTeam, type Team } from './api';
import { BoardPage } from './pages/Board';
import { FeedPage } from './pages/Feed';
import { HomePage } from './pages/Home';
import { Onboarding, TOUR_EVENT } from './Onboarding';
import { NewTaskPage } from './pages/NewTask';
import { SettingsPage } from './pages/Settings';
import { TaskPage } from './pages/Task';
import { TeamPage } from './pages/Team';
import { Logo, SketchDefs, type SketchName } from './sketch';
import { AppCtx, Avatar, ErrorBox, Loading, Pip, Sketch, Toaster, toast, useAction, useApp, useLoad, useTheme, type AppState } from './ui';

const HAS_VT = typeof document !== 'undefined' && 'startViewTransition' in document;

interface Boot { me: { id: string; name: string; email: string } | null; teams: Team[]; signupNeedsCode: boolean }

export function App() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [fatal, setFatal] = useState<unknown>(null);

  const load = useCallback(async (attempt = 0): Promise<void> => {
    try {
      setBoot(await api.get<Boot>('/bootstrap'));
    } catch (e: any) {
      // API still starting (dev) or a cold start hiccup: retry a few times before giving up.
      if ([502, 503, 504].includes(e?.status) && e?.code !== 'no_database' && attempt < 8) {
        setTimeout(() => load(attempt + 1), 1000);
        return;
      }
      setFatal(e);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (fatal) return <Center><h1>Hmm, something's off</h1><ErrorBox error={fatal} /></Center>;
  if (!boot) return <><SketchDefs /><Loading text="Warming up…" /></>;

  const home = boot.me ? (boot.teams.find((t) => t.slug === lastTeam()) ?? boot.teams[0]) : null;
  return (
    <>
      <SketchDefs />
      <BrowserRouter>
        <Routes>
          <Route path="/join/:token" element={<JoinPage boot={boot} onDone={load} />} />
          <Route path="/signup" element={boot.me ? <Navigate to="/" /> : <SignupPage needsCode={boot.signupNeedsCode} onDone={load} />} />
          <Route path="/login" element={boot.me ? <Navigate to="/" /> : <LoginPage onDone={load} />} />
          <Route path="/teams" element={boot.me ? <TeamsPage boot={boot} onDone={load} /> : <Navigate to="/login" />} />
          <Route path="/t/:team/*" element={boot.me ? <TeamGate boot={boot} /> : <Navigate to="/login" />} />
          <Route path="*" element={!boot.me ? <Navigate to="/login" /> : home ? <Navigate to={`/t/${home.slug}`} /> : <Navigate to="/teams" />} />
        </Routes>
      </BrowserRouter>
    </>
  );
}

/** Everything under /t/:team — loads that team and renders the app for it. */
function TeamGate({ boot }: { boot: Boot }) {
  const { team } = useParams();
  setTeam(team!); // before any child renders, so every request carries this team
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const [me, m, p, r] = await Promise.all([api.get('/me'), api.get('/members'), api.get('/projects'), api.get('/rules')]);
      setState({
        me: me.me, workspace: me.team.name, team: me.team, teams: boot.teams, policy: me.policy, onboarded: me.onboarded,
        members: m.members, projects: p.projects, rules: r, reload: load,
      });
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [boot.teams]);
  useEffect(() => { setState(null); load(); }, [team, load]);

  if (error) {
    return (
      <Center>
        <Pip mood="worried" size={64} />
        <h1>Not your team</h1>
        <p className="muted">{error.code === 'not_in_team' ? "You're not a member of this team, or your access was paused." : error.message}</p>
        <Link to="/teams" className="btn primary big">See my teams</Link>
      </Center>
    );
  }
  if (!state) return <Loading />;
  return <AppCtx.Provider value={state}><Shell /></AppCtx.Provider>;
}

function Shell() {
  const s = useApp();
  const loc = useLocation();
  const inbox = useLoad(() => api.get<{ unread: number }>('/asks/unread'), [s.team.slug], 20_000);
  // First time here: the welcome tour. Settings can replay it.
  const [tour, setTour] = useState(!s.onboarded);
  useEffect(() => {
    const open = () => setTour(true);
    window.addEventListener(TOUR_EVENT, open);
    return () => window.removeEventListener(TOUR_EVENT, open);
  }, []);
  return (
    <div className="shell">
      <TopBar />
      <main className="main">
        <div className={`view ${HAS_VT ? '' : 'enter'}`} key={HAS_VT ? undefined : loc.pathname}>
          <Routes>
            <Route index element={<HomePage onInboxChange={inbox.reload} />} />
            <Route path="board" element={<BoardPage />} />
            <Route path="team" element={<TeamPage />} />
            <Route path="feed" element={<FeedPage />} />
            <Route path="new" element={s.me.role === 'viewer' ? <Navigate to={href('/')} /> : <NewTaskPage />} />
            <Route path="tasks/:key" element={<TaskRoute />} />
            <Route path="settings/*" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to={href('/')} />} />
          </Routes>
        </div>
      </main>
      <Dock unread={inbox.data?.unread ?? 0} />
      <Toaster />
      {tour && <Onboarding onClose={() => setTour(false)} />}
    </div>
  );
}

function TopBar() {
  const { setTheme, isDark } = useTheme();
  return (
    <header className="topbar">
      <TeamSwitcher />
      <button className="theme-btn" aria-label="Switch light / dark"
        onClick={(e) => setTheme(isDark() ? 'light' : 'dark', { x: e.clientX, y: e.clientY })}>
        <Sketch name={isDark() ? 'sun' : 'moon'} size={18} />
      </button>
    </header>
  );
}

/** Team name in the top-left; click to hop between teams or start a new one. */
function TeamSwitcher() {
  const { team, teams } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="switcher" ref={ref}>
      <button className="brand" data-tour="team" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Platter, team ${team.name}. Switch team`}>
        <Logo size={36} />
        <span className="brand-text">
          <span className="brand-name">Platter</span>
          <span className="brand-team">{team.name}<span className="chev">▾</span></span>
        </span>
      </button>
      {open && (
        <div className="menu-pop switch-pop surface">
          <div className="pop-label">Your teams</div>
          {teams.map((t) => (
            <a key={t.slug} href={`/t/${t.slug}`} className={`pop-team ${t.slug === team.slug ? 'on' : ''}`}>
              <span>{t.name}</span><span className="muted small">{t.role}</span>
              {t.slug === team.slug && <Sketch name="check" size={14} />}
            </a>
          ))}
          <div className="pop-sep" />
          <a href="/teams" className="pop-team"><Sketch name="plus" size={14} /> New team</a>
        </div>
      )}
    </div>
  );
}

interface DockItem { to: string; icon?: SketchName; label: string; match: (p: string) => boolean }

/** Floating bottom navigation. The active item grows to show its name. */
function Dock({ unread }: { unread: number }) {
  const { me, team } = useApp();
  const loc = useLocation();
  const rel = loc.pathname.replace(`/t/${team.slug}`, '') || '/';
  const items: DockItem[] = [
    { to: '/', icon: 'home', label: 'Home', match: (p) => p === '/' },
    { to: '/board', icon: 'board', label: 'Board', match: (p) => p.startsWith('/board') || p.startsWith('/tasks') },
    { to: '/team', icon: 'team', label: 'Team', match: (p) => p.startsWith('/team') },
    { to: '/feed', icon: 'feed', label: 'Feed', match: (p) => p.startsWith('/feed') },
    { to: '/settings', label: 'You', match: (p) => p.startsWith('/settings') },
  ];
  const active = items.find((i) => i.match(rel))?.to ?? null;
  return (
    <nav className="dock" aria-label="Main">
      {items.map((i) => (
        <NavLink key={i.to} to={href(i.to)} end={i.to === '/'} viewTransition className={`dock-item ${active === i.to ? 'on' : ''}`} aria-label={i.label} data-tour={`dock-${i.label.toLowerCase()}`}>
          {i.icon ? <Sketch name={i.icon} size={20} /> : <Avatar name={me.name} size={24} />}
          <span className="dock-label">{i.label}</span>
          {i.to === '/' && unread > 0 && <b className="badge">{unread}</b>}
        </NavLink>
      ))}
      {me.role !== 'viewer' && (
        <NavLink to={href('/new')} viewTransition className="dock-new" aria-label="New task" data-tour="new">
          <Sketch name="plus" size={18} /><span>New</span>
        </NavLink>
      )}
    </nav>
  );
}

function TaskRoute() {
  const { key } = useParams();
  return <TaskPage key={key} taskKey={key!} />;
}

const Center = ({ children }: { children: React.ReactNode }) => (
  <div className="center"><div className="auth">{children}</div></div>
);

// ---------- Signed-out pages ----------

function LoginPage({ onDone }: { onDone: () => Promise<void> }) {
  const a = useAction();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); a.run(async () => { await api.post('/login', { email, password }); await onDone(); }); };
  return (
    <Center>
      <form onSubmit={submit}>
        <Pip mood="happy" size={64} className="floaty" />
        <h1>Welcome back</h1>
        <p className="hand lead">Sign in to pick up where your team left off.</p>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <ErrorBox error={a.error} />
        <button className="btn primary big" disabled={a.busy}>Sign in</button>
        <p className="muted small center-text">New here? <Link to="/signup">Start a team</Link> or ask your team for an invite link.</p>
      </form>
    </Center>
  );
}

function SignupPage({ needsCode, onDone }: { needsCode: boolean; onDone: () => Promise<void> }) {
  const a = useAction();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', password: '', team: '', code: '' });
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    a.run(async () => { const r = await api.post('/signup', f); setTeam(r.team); await onDone(); nav(`/t/${r.team}`); });
  };
  return (
    <Center>
      <form onSubmit={submit}>
        <Pip mood="party" size={64} className="floaty" />
        <h1>Start a team</h1>
        <p className="hand lead">You'll be the owner. Invite your people after.</p>
        <label>Team name<input value={f.team} onChange={set('team')} placeholder="Acme Engineering" autoFocus required /></label>
        <label>Your name<input value={f.name} onChange={set('name')} required /></label>
        <label>Email<input type="email" value={f.email} onChange={set('email')} required /></label>
        <label>Password<input type="password" value={f.password} onChange={set('password')} minLength={10} placeholder="10+ characters" required /></label>
        {needsCode && <label>Signup code<input value={f.code} onChange={set('code')} required /><span className="hint">Platter is invite-only right now.</span></label>}
        <ErrorBox error={a.error} />
        <button className="btn primary big" disabled={a.busy}>Create team</button>
        <p className="muted small center-text">Already have an account? <Link to="/login">Sign in</Link></p>
      </form>
    </Center>
  );
}

/** Pick a team, or start another. Also where you land if you're in none. */
function TeamsPage({ boot, onDone }: { boot: Boot; onDone: () => Promise<void> }) {
  const a = useAction();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const create = (e: FormEvent) => {
    e.preventDefault();
    a.run(async () => { const r = await api.post('/teams', { name }); toast(`${r.name} is ready`); await onDone(); nav(`/t/${r.slug}`); });
  };
  return (
    <Center>
      <Pip mood={boot.teams.length ? 'happy' : 'thinking'} size={64} />
      <h1>{boot.teams.length ? 'Your teams' : 'No team yet'}</h1>
      <p className="hand lead">Signed in as {boot.me!.email}</p>
      <div className="team-list">
        {boot.teams.map((t) => (
          <Link key={t.slug} to={`/t/${t.slug}`} className="team-row">
            <b>{t.name}</b><span className="muted small">{t.role}</span><Sketch name="back" size={16} className="flip" />
          </Link>
        ))}
      </div>
      <form className="inline" onSubmit={create}>
        <input placeholder="New team name" value={name} onChange={(e) => setName(e.target.value)} required />
        <button className="btn">Create</button>
      </form>
      <ErrorBox error={a.error} />
      <button className="link-btn small" onClick={async () => { await api.post('/logout'); await onDone(); nav('/login'); }}>Sign out</button>
    </Center>
  );
}

function JoinPage({ boot, onDone }: { boot: Boot; onDone: () => Promise<void> }) {
  const { token } = useParams();
  const nav = useNavigate();
  const a = useAction();
  const [info, setInfo] = useState<any>(null);
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => { api.get(`/join/${token}`).then(setInfo, setLoadErr); }, [token]);
  const signedInAsInvitee = info && boot.me?.email === info.email;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    a.run(async () => {
      const r = await api.post(`/join/${token}`, signedInAsInvitee ? {} : { name, password });
      setTeam(r.team);
      await onDone();
      nav(`/t/${r.team}`);
    });
  };
  return (
    <Center>
      <form onSubmit={submit}>
        <Pip mood="party" size={64} className="floaty" />
        <h1>Join {info?.team ?? 'the team'}</h1>
        <ErrorBox error={loadErr} />
        {info && (
          <>
            <p className="hand lead">{info.invitedBy} invited {info.email}.</p>
            {signedInAsInvitee ? null : info.hasAccount ? (
              <label>Your Platter password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
                <span className="hint">You already have an account — this adds {info.team} to your teams.</span></label>
            ) : (
              <>
                <label>Your name<input value={name} onChange={(e) => setName(e.target.value)} autoFocus required /></label>
                <label>Pick a password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} placeholder="10+ characters" required /></label>
              </>
            )}
            <ErrorBox error={a.error} />
            <button className="btn primary big" disabled={a.busy}>Join {info.team}</button>
          </>
        )}
      </form>
    </Center>
  );
}
