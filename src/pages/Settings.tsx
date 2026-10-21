import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { api, type Member, type Project, href } from '../api';
import type { SketchName } from '../sketch';
import { Avatar, Battery, Copy, Empty, ErrorBox, Menu, Sketch, Switch, Text, firstName, isAdmin, timeAgo, toast, useAction, useApp, useLoad } from '../ui';

export function SettingsPage() {
  const { me } = useApp();
  return (
    <div className="page narrow">
      <header className="head"><h1>Settings</h1></header>
      <nav className="tabs">
        <NavLink to={href('/settings')} end viewTransition><Sketch name="agent" size={16} /> My agent</NavLink>
        <NavLink to={href('/settings/projects')} viewTransition><Sketch name="folder" size={16} /> Projects</NavLink>
        <NavLink to={href('/settings/team-rules')} viewTransition data-tour="team-rules"><Sketch name="lock" size={16} /> Team rules</NavLink>
        <NavLink to={href('/settings/rules')} viewTransition><Sketch name="scroll" size={16} /> How we work</NavLink>
      </nav>
      <Routes>
        <Route index element={me.role === 'viewer' ? <Empty mood="happy">View-only members don't connect agents.</Empty> : <AgentSetup />} />
        <Route path="projects" element={<Projects />} />
        <Route path="team-rules" element={<TeamRules />} />
        <Route path="rules" element={<Rules />} />
      </Routes>
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
  const [created, setCreated] = useState<{ id: string; token: string; mcpUrl: string; setup: string; setupExpiresInMinutes: number } | null>(null);
  // Macs get the free background check-in; everyone else the scheduled routine.
  const [client, setClient] = useState<'mac' | 'claude' | 'other'>(() => (/Mac/i.test(navigator.userAgent) ? 'mac' : 'claude'));
  const [verified, setVerified] = useState<'no' | 'yes' | 'skipped'>('no');
  const tokens = useLoad(() => api.get<{ tokens: any[] }>(`/agent-tokens${isAdmin(me) ? '?all=1' : ''}`), []);
  const capacity = useLoad(() => api.get<{ agents: any[] }>('/capacity'), []);

  const create = (e: FormEvent) => {
    e.preventDefault();
    a.run(async () => { setCreated(await api.post('/agent-tokens', { name })); setVerified('no'); tokens.reload(); capacity.reload(); });
  };
  // Step 2 is done when Platter hears from the new token: its first MCP call stamps last_used_at.
  useEffect(() => {
    if (!created || verified !== 'no') return;
    const check = async () => {
      const r = await api.get<{ tokens: any[] }>('/agent-tokens').catch(() => null);
      const t = r?.tokens.find((x) => x.id === created.id);
      if (t?.last_used_at) { setVerified('yes'); toast(`${t.name} is connected`, true); tokens.reload(); capacity.reload(); }
    };
    const id = setInterval(() => document.visibilityState === 'visible' && check(), 3000);
    return () => clearInterval(id);
  }, [created, verified]); // eslint-disable-line react-hooks/exhaustive-deps
  const revoke = (id: string, n: string) => {
    if (!confirm(`Disconnect "${n}"? It stops working right away.`)) return;
    a.run(async () => { await api.del(`/agent-tokens/${id}`); toast('Disconnected'); tokens.reload(); });
  };

  const url = created?.mcpUrl ?? `${location.origin}/mcp`;
  const origin = url.replace(/\/mcp$/, '');
  const tok = created?.token ?? '';
  // One short line; the link returns the full setup (with the key) once, then stops working.
  const link = (code: string) => `${origin}/s/${code}`;
  const macLine = (code: string) => `Set up Platter for me, all of it (connection, background check-in and hooks), by running: curl -fsSL ${link(code)} | sh`;
  const otherLine = (code: string) => `Set up Platter for me, all of it: run curl -fsSL "${link(code)}?as=prompt" and do every step it prints.`;
  const HIDDEN = '••••••••';
  const line = client === 'mac' ? macLine : otherLine;
  const config = (t: string) => JSON.stringify({ mcpServers: { platter: { type: 'http', url, headers: { Authorization: `Bearer ${t}` } } } }, null, 2);
  const relink = () => a.run(async () => { setCreated(await api.post(`/agent-tokens/${created!.id}/relink`)); toast('New setup link ready'); });
  const autopilot = `## Platter
At the start of every session: get my exact usage by running \`claude -p "/usage"\`, then call Platter report_usage with the highest "% used" as used_percent. Then check_inbox and find_work.
Work tasks through Platter and submit proof for every "done when" item. Before you run out of usage mid-task, use handoff_task.
When I say "ask <person> …", use ask_teammate. Teammates' questions in check_inbox are for you: look each one up and answer it with answer_question.`;

  const all = tokens.data?.tokens ?? [];
  const mine = all.filter((t) => t.member_id === me.id);
  const others = all.filter((t) => t.member_id !== me.id);
  const energy = new Map((capacity.data?.agents ?? []).map((x) => [x.id, x.usage_remaining]));

  return (
    <div className="stack">
      <div className="steps" data-tour="agent-setup">
        <div className="step">
          <span className="step-n">1</span>
          <div className="step-body">
            <b>Name your agent</b>
            <form className="inline" onSubmit={create}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Claude Code – laptop" />
              <button className="btn primary" disabled={a.busy || name.trim().length < 3}>Connect</button>
            </form>
            {created && <div className="ok-note with-icon"><Sketch name="key" size={16} /> Key made and kept out of sight. The setup below carries it for you.</div>}
          </div>
        </div>
        {created && (
          <div className={`step rise ${verified !== 'no' ? 'done' : ''}`}>
            <span className="step-n">{verified !== 'no' ? <Sketch name="check" size={14} /> : 2}</span>
            <div className="step-body">
              <b>{client === 'other' ? 'Add Platter to your agent' : 'Paste this into Claude Code'}</b>
              <div className="chips">
                <button className={`toggle ${client === 'mac' ? 'on' : ''}`} onClick={() => setClient('mac')}>Claude Code · Mac</button>
                <button className={`toggle ${client === 'claude' ? 'on' : ''}`} onClick={() => setClient('claude')}>Claude Code · Windows / Linux</button>
                <button className={`toggle ${client === 'other' ? 'on' : ''}`} onClick={() => setClient('other')}>Cursor & others</button>
              </div>
              {client !== 'other' ? (
                <>
                  <p className="muted small">
                    {client === 'mac'
                      ? <>One line does it all: connects Platter, checks the connection, and installs a free background check-in. It reports your energy every 5 minutes and after each task step without using the model, only wakes Claude when a teammate asks you something, and carries your owner&apos;s focus lock and action log into Claude Code.</>
                      : <>One line does it all: Claude Code connects Platter, checks the connection, adds the hooks for your owner&apos;s focus lock and action log (they cost no tokens), and schedules a check-in every 30 minutes.</>}
                  </p>
                  <div className="code one-line"><pre>{line(HIDDEN)}</pre><Copy text={line(created.setup)} label="Copy" /></div>
                  <p className="muted small with-icon">
                    <Sketch name="lock" size={13} /> The link works once, for {created.setupExpiresInMinutes} minutes, and your key never shows on screen.
                    <span className="spacer" />
                    <button type="button" className="link-btn small" onClick={relink} disabled={a.busy}>Used or expired? New link</button>
                  </p>
                  {client === 'mac' && <p className="muted small">To remove it later: <code>python3 ~/.platter/checkin.py --uninstall</code></p>}
                </>
              ) : (
                <>
                  <p className="muted small">Add this to your agent&apos;s MCP settings, then start a new chat so it connects. Your key is hidden here; Copy includes it.</p>
                  <div className="code"><pre>{config(`${tok.slice(0, 8)}${HIDDEN}`)}</pre><Copy text={config(tok)} /></div>
                </>
              )}
              {verified === 'no' ? (
                <div className="verify with-icon">
                  <span className="verify-dot" /> Waiting for your agent to say hello…
                  <span className="spacer" />
                  <button type="button" className="link-btn small" onClick={() => setVerified('skipped')}>Skip the check</button>
                </div>
              ) : verified === 'yes' ? (
                <div className="ok-note with-icon"><Sketch name="check" size={16} /> Verified! Platter just heard from {created && name.trim()}.</div>
              ) : (
                <div className="muted small with-icon"><Sketch name="hourglass" size={14} /> Skipped the check. Your agent shows as active below once it connects.</div>
              )}
            </div>
          </div>
        )}
        {created && verified !== 'no' && (
          <div className="step rise">
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
        )}
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
  ['chat', 'Just ask', 'ask a teammate’s agent a question. It looks it up and answers, and the answer comes back to you.'],
  ['palm', 'Not too much at once', 'there’s a cap on how many tasks one person has going, so things actually finish.'],
  ['lock', 'The owner can lock agents to one task', 'a locked agent works only on its assigned task and parks everything else for later.'],
  ['feed', 'The owner can log what agents do', 'one short line per action, kept on Platter’s side, so it costs agents nothing.'],
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

// ---------- Team rules (set by the owner) ----------
function TeamRules() {
  const { me, members, policy, reload } = useApp();
  const owner = me.role === 'owner';
  const a = useAction();
  const people = members.filter((m) => m.status === 'active' && m.role !== 'viewer');
  const setLog = (on: boolean) => a.run(async () => {
    await api.patch('/team', { agent_log: on });
    toast(on ? 'Action log is on' : 'Action log is off');
    await reload();
  });
  const setFocus = (m: Member, on: boolean) => a.run(async () => {
    await api.patch(`/members/${m.id}/focus`, { on });
    toast(on ? `${firstName(m.name)}'s agents are locked to their task` : `${firstName(m.name)}'s agents are free again`);
    await reload();
  });
  const agents = (m: Member) => (m.active_agents ? `${m.active_agents} agent${m.active_agents > 1 ? 's' : ''}, free to work on anything` : 'no agent yet');
  return (
    <div className="stack">
      {!owner && <div className="tip surface"><Sketch name="crown" size={16} /> Only the team owner can change these. You can see what's on.</div>}
      <section className="panel rule-panel">
        <div className="panel-head">
          <span className="h-icon"><Sketch name="lock" size={20} /></span><b>Focus lock</b>
        </div>
        <p className="muted small">
          Lock someone's agents to the task assigned to them. A locked agent works on that one task: Platter refuses other work,
          and anything else it's asked to do gets parked for later. When the task is sent for review, the lock moves to their next one. Only you can lift it.
        </p>
        <div className="lock-list">
          {people.map((m) => (
            <div key={m.id} className={`lock-row ${m.agent_focus ? 'locked' : ''}`}>
              <Avatar name={m.name} size={34} />
              <span className="lock-who">
                <b>{m.name}{m.id === me.id && <span className="muted"> (you)</span>}</b>
                <span className="muted small with-icon">
                  {m.agent_focus
                    ? <><Sketch name="lock" size={13} /> {m.focus_task_key ? <>Locked to <Link to={href(`/tasks/${m.focus_task_key}`)} viewTransition>{m.focus_task_key}</Link></> : 'Locked. Nothing assigned yet'}</>
                    : agents(m)}
                </span>
              </span>
              <Switch on={!!m.agent_focus} disabled={!owner || a.busy} onChange={(on) => setFocus(m, on)} label={`Focus lock for ${m.name}`} />
            </div>
          ))}
        </div>
      </section>
      <section className="panel rule-panel">
        <div className="panel-head">
          <span className="h-icon"><Sketch name="feed" size={20} /></span><b>Action log</b>
          <span className="spacer" />
          <Switch on={policy.agent_log} disabled={!owner || a.busy} onChange={setLog} label="Agent action log" />
        </div>
        <p className="muted small">
          Record every action every agent takes as one short line: the tool and what it touched (a file, a command, a task).
          No file contents, and anything that looks like a secret is blanked out. Platter and a background hook write it, not the agent, so it costs no tokens. Lines are kept for 30 days.
        </p>
        {policy.agent_log && <Link to={href('/feed?view=log')} viewTransition className="link-btn small">See the log</Link>}
      </section>
      <p className="muted small">
        Platter enforces both on its side. To make them reach inside Claude Code too, each person pastes the setup from <Link to={href('/settings')} viewTransition>My agent, step 2</Link>.
      </p>
      <ErrorBox error={a.error} />
    </div>
  );
}
