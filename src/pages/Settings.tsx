import { useState, type FormEvent } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { api, type Project, href } from '../api';
import type { SketchName } from '../sketch';
import { Battery, Copy, Empty, ErrorBox, Menu, Pip, Sketch, Text, firstName, isAdmin, timeAgo, toast, useAction, useApp, useLoad, useTheme, type Theme } from '../ui';

export function SettingsPage() {
  const { me } = useApp();
  return (
    <div className="page narrow">
      <header className="head"><h1>Settings</h1></header>
      <nav className="tabs">
        <NavLink to={href('/settings')} end viewTransition><Sketch name="agent" size={16} /> My agent</NavLink>
        <NavLink to={href('/settings/projects')} viewTransition><Sketch name="folder" size={16} /> Projects</NavLink>
        <NavLink to={href('/settings/rules')} viewTransition><Sketch name="scroll" size={16} /> How we work</NavLink>
      </nav>
      <Routes>
        <Route index element={me.role === 'viewer' ? <Empty mood="happy">View-only members don't connect agents.</Empty> : <AgentSetup />} />
        <Route path="projects" element={<Projects />} />
        <Route path="rules" element={<Rules />} />
      </Routes>
      <Appearance />
      <div className="signout">
        <button className="link-btn" onClick={async () => { await api.post('/logout'); location.href = '/'; }}>Sign out</button>
      </div>
    </div>
  );
}

// ---------- My agent ----------
function AgentSetup() {
  const { me } = useApp();
  const a = useAction();
  const [name, setName] = useState('Claude Code');
  const [created, setCreated] = useState<{ token: string; mcpUrl: string } | null>(null);
  const [client, setClient] = useState<'claude' | 'other'>('claude');
  const tokens = useLoad(() => api.get<{ tokens: any[] }>(`/agent-tokens${isAdmin(me) ? '?all=1' : ''}`), []);
  const capacity = useLoad(() => api.get<{ agents: any[] }>('/capacity'), []);

  const create = (e: FormEvent) => {
    e.preventDefault();
    a.run(async () => { setCreated(await api.post('/agent-tokens', { name })); tokens.reload(); capacity.reload(); });
  };
  const revoke = (id: string, n: string) => {
    if (!confirm(`Disconnect "${n}"? It stops working right away.`)) return;
    a.run(async () => { await api.del(`/agent-tokens/${id}`); toast('Disconnected'); tokens.reload(); });
  };

  const url = created?.mcpUrl ?? `${location.origin}/mcp`;
  const tok = created?.token ?? 'YOUR_TOKEN';
  const cmd = client === 'claude'
    ? `claude mcp add --transport http --scope user platter ${url} --header "Authorization: Bearer ${tok}"`
    : JSON.stringify({ mcpServers: { platter: { type: 'http', url, headers: { Authorization: `Bearer ${tok}` } } } }, null, 2);
  const autopilot = `## Platter
At the start of every session: call Platter report_usage (roughly how much of your usage limit is left), then check_inbox and find_work.
Work tasks through Platter and submit proof for every "done when" item. Before you run out of usage mid-task, use handoff_task.
When I say "ask <person> …", use ask_teammate. Answer teammates' questions only if you actually know.`;

  const all = tokens.data?.tokens ?? [];
  const mine = all.filter((t) => t.member_id === me.id);
  const others = all.filter((t) => t.member_id !== me.id);
  const energy = new Map((capacity.data?.agents ?? []).map((x) => [x.id, x.usage_remaining]));

  return (
    <div className="stack">
      <div className="steps">
        <div className="step">
          <span className="step-n">1</span>
          <div className="step-body">
            <b>Name your agent</b>
            <form className="inline" onSubmit={create}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Claude Code – laptop" />
              <button className="btn primary" disabled={a.busy || name.trim().length < 3}>Connect</button>
            </form>
            {created && <div className="ok-note with-icon"><Sketch name="key" size={16} /> Connected! The command below has your key in it. Copy it now — we won't show the key again.</div>}
          </div>
        </div>
        <div className="step">
          <span className="step-n">2</span>
          <div className="step-body">
            <b>Paste this in your terminal</b>
            <div className="chips">
              <button className={`toggle ${client === 'claude' ? 'on' : ''}`} onClick={() => setClient('claude')}>Claude Code</button>
              <button className={`toggle ${client === 'other' ? 'on' : ''}`} onClick={() => setClient('other')}>Cursor & others</button>
            </div>
            <div className="code"><pre>{cmd}</pre><Copy text={cmd} /></div>
          </div>
        </div>
        <div className="step">
          <span className="step-n">3</span>
          <div className="step-body">
            <b>Just talk to it</b>
            <ul className="say-list">
              <li>“Pick up my next Platter task”</li>
              <li>“Review the tasks waiting for me”</li>
              <li>“Ask a teammate for an update on their task”</li>
            </ul>
            <details className="more">
              <summary>Make it automatic (recommended)</summary>
              <p className="muted small">Add this to your CLAUDE.md so your agent shares its energy, checks messages and finds work on its own.</p>
              <div className="code"><pre>{autopilot}</pre><Copy text={autopilot} /></div>
            </details>
          </div>
        </div>
      </div>

      <ErrorBox error={a.error} />
      {mine.length > 0 && (
        <section className="section">
          <h2>Your connected agents</h2>
          {mine.map((t) => (
            <div key={t.id} className="agent-row">
              <span className="with-icon"><Sketch name="agent" size={16} /> <b>{t.name}</b></span>
              <Battery pct={energy.get(t.id)} />
              <span className="muted small">{t.last_used_at ? `active ${timeAgo(t.last_used_at)}` : 'not used yet'}</span>
              <Menu items={[{ label: 'Disconnect', danger: true, onClick: () => revoke(t.id, t.name) }]} />
            </div>
          ))}
        </section>
      )}
      {others.length > 0 && (
        <details className="more">
          <summary>Everyone's agents (admin)</summary>
          {others.map((t) => (
            <div key={t.id} className="agent-row">
              <span className="with-icon"><Sketch name="agent" size={16} /> <b>{t.name}</b> <span className="muted">· {firstName(t.member_name)}</span></span>
              <Battery pct={energy.get(t.id)} />
              <span className="muted small">{t.last_used_at ? `active ${timeAgo(t.last_used_at)}` : 'not used yet'}</span>
              <Menu items={[{ label: 'Disconnect', danger: true, onClick: () => revoke(t.id, t.name) }]} />
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

// ---------- Projects ----------
function Projects() {
  const { me, projects, reload } = useApp();
  const admin = isAdmin(me);
  const a = useAction();
  const [f, setF] = useState({ key: '', name: '' });
  return (
    <div className="stack">
      {admin && <TeamName />}
      {projects.map((p) => <ProjectCard key={p.key} p={p} admin={admin} onSaved={reload} />)}
      {admin && (
        <form className="inline new-project" onSubmit={(e) => { e.preventDefault(); a.run(async () => { await api.post('/projects', f); setF({ key: '', name: '' }); toast('Project created'); await reload(); }); }}>
          <input placeholder="New project name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          <input placeholder="CODE" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.toUpperCase() })} style={{ width: 100 }} required />
          <button className="btn"><Sketch name="plus" size={16} /> Add</button>
        </form>
      )}
      <ErrorBox error={a.error} />
    </div>
  );
}

function ProjectCard({ p, admin, onSaved }: { p: Project; admin: boolean; onSaved: () => void }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ name: p.name, wip_limit: p.wip_limit, agent_instructions: p.agent_instructions });
  const a = useAction();
  return (
    <div className="panel">
      <div className="panel-head">
        <b>{p.name}</b><span className="key">{p.key}</span><span className="muted small">{p.open_tasks} open</span>
        <span className="spacer" />
        {admin && !edit && <button className="btn small" onClick={() => setEdit(true)}>Edit</button>}
      </div>
      {edit ? (
        <>
          <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>What should every agent know? <span className="hint">repo, how to run tests, conventions, no-go areas</span>
            <textarea rows={7} value={f.agent_instructions} onChange={(e) => setF({ ...f, agent_instructions: e.target.value })}
              placeholder={'Repo: https://github.com/acme/web — one PR per task\nTests: npm test (must pass)\nDon’t touch billing/'} />
          </label>
          <details className="more">
            <summary>Advanced</summary>
            <label>Max tasks one person can have going at once<input type="number" min={1} max={20} value={f.wip_limit} onChange={(e) => setF({ ...f, wip_limit: Number(e.target.value) })} /></label>
          </details>
          <ErrorBox error={a.error} />
          <div className="actions-row">
            <button className="btn" onClick={() => setEdit(false)}>Cancel</button>
            <button className="btn primary" disabled={a.busy} onClick={() => a.run(async () => { await api.patch(`/projects/${p.key}`, f); setEdit(false); toast('Saved'); onSaved(); })}>Save</button>
          </div>
        </>
      ) : p.agent_instructions ? (
        <details className="soft"><summary className="with-icon"><Sketch name="agent" size={15} /> What agents are told</summary><Text>{p.agent_instructions}</Text></details>
      ) : (
        <p className="muted small">{admin ? 'Tip: tell agents about the repo and how to run tests — hit Edit.' : 'No agent notes yet.'}</p>
      )}
    </div>
  );
}

// ---------- How we work ----------
const BASICS: [SketchName, string, string][] = [
  ['pencil', 'Every task says what “done” looks like', 'and who does it, plus a different person to check it.'],
  ['agent', 'Your agent works for you', 'it picks up your tasks, posts updates, and shows proof for each “done when” item.'],
  ['review', 'Someone else always checks', 'nobody approves their own work. Feedback goes straight back to the doer.'],
  ['bolt', 'Agents share their energy', 'when one runs low it passes the task on with notes, and a teammate’s agent continues.'],
  ['chat', 'Just ask', 'ask a teammate a question — they or their agent answer, and it comes back to you.'],
  ['palm', 'Not too much at once', 'there’s a cap on how many tasks one person has going, so things actually finish.'],
];

function Rules() {
  const { rules } = useApp();
  return (
    <div className="stack">
      <div className="basics">
        {BASICS.map(([e, t, d]) => (
          <div key={t} className="basic surface"><span className="basic-icon"><Sketch name={e} size={26} /></span><div><b>{t}</b> <span className="muted">— {d}</span></div></div>
        ))}
      </div>
      <details className="more">
        <summary>The full rulebook</summary>
        {rules.rulebook.map((s: any) => (
          <div key={s.section} className="rule-sec">
            <h3>{s.section}</h3>
            <ul>{s.rules.map((r: any) => <li key={r.id}>{r.text.replace(/\s*\((?:[A-Z]\d+)(?:\/[A-Z]\d+)*\)/g, '')}</li>)}</ul>
          </div>
        ))}
      </details>
    </div>
  );
}

// ---------- Appearance ----------
function Appearance() {
  const { theme, setTheme } = useTheme();
  const opts: [Theme, SketchName, string][] = [['light', 'sun', 'Light'], ['dark', 'moon', 'Dark'], ['system', 'sparkle', 'Match my device']];
  return (
    <section className="section appearance">
      <h2><span className="h-icon"><Pip size={30} mood="happy" /></span>Appearance</h2>
      <div className="chips">
        {opts.map(([v, icon, label]) => (
          <button key={v} className={`toggle ${theme === v ? 'on' : ''}`} onClick={(e) => setTheme(v, { x: e.clientX, y: e.clientY })}>
            <Sketch name={icon} size={15} /> {label}
          </button>
        ))}
      </div>
    </section>
  );
}

function TeamName() {
  const { workspace, reload } = useApp();
  const [name, setName] = useState(workspace);
  const a = useAction();
  return (
    <form className="panel inline" onSubmit={(e) => { e.preventDefault(); a.run(async () => { await api.patch('/team', { name }); toast('Team renamed'); await reload(); }); }}>
      <span className="muted small" style={{ whiteSpace: 'nowrap' }}>Team name</span>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn" disabled={a.busy || name.trim() === workspace}>Save</button>
      <ErrorBox error={a.error} />
    </form>
  );
}
