import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, href, type Member } from '../api';
import type { SketchName } from '../sketch';
import { Avatar, Battery, Copy, ErrorBox, Menu, Modal, Sketch, firstName, isAdmin, toast, useAction, useApp, useLoad } from '../ui';

const ROLE_BADGE: Record<string, [SketchName, string]> = { owner: ['crown', 'Owner'], admin: ['shield', 'Admin'], viewer: ['eye', 'Viewer'], member: ['plane', 'Teammate'] };

export function TeamPage() {
  const { me, members, reload } = useApp();
  const admin = isAdmin(me);
  const a = useAction();
  const capacity = useLoad(() => api.get<{ agents: any[] }>('/capacity'), [], 20_000);
  const invites = useLoad(() => (admin ? api.get<{ invites: any[] }>('/invites') : Promise.resolve({ invites: [] })), [admin]);
  const [inviting, setInviting] = useState(false);

  const update = (m: Member, patch: any, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    a.run(async () => {
      const r = await api.patch(`/members/${m.id}`, patch);
      if (r.released?.unassigned || r.released?.reviewer_cleared) toast(`${firstName(m.name)}'s open work went back to drafts`);
      else toast('Updated');
      await reload();
    });
  };
  const canManage = (m: Member) => admin && m.id !== me.id && m.role !== 'owner' && (me.role === 'owner' || m.role !== 'admin');
  // Focus lock (F3): only the owner, for anyone who can be given work — themselves included.
  const canLock = (m: Member) => me.role === 'owner' && m.status === 'active' && m.role !== 'viewer';
  const lock = (m: Member, on: boolean) => a.run(async () => {
    await api.patch(`/members/${m.id}/focus`, { on });
    toast(on ? `${firstName(m.name)}'s agents are locked to their task` : `${firstName(m.name)}'s agents are free again`);
    await reload();
  });
  const lockItem = (m: Member) => canLock(m) && (m.agent_focus
    ? { label: 'Lift focus lock', onClick: () => lock(m, false) }
    : { label: 'Lock agents to their task', onClick: () => lock(m, true) });

  return (
    <div className="page">
      <header className="head">
        <h1>Team</h1>
        {admin && <button className="btn primary" onClick={() => setInviting(true)}><Sketch name="mail" size={18} /> Invite</button>}
      </header>
      <ErrorBox error={a.error} />

      <div className="people-grid">
        {members.map((m, idx) => {
          const agents = (capacity.data?.agents ?? []).filter((x) => x.member_id === m.id);
          const busy = (m.in_progress ?? 0) >= 3 || (m.to_review ?? 0) >= 3;
          return (
            <div key={m.id} className={`mate ${m.status === 'suspended' ? 'off' : ''}`} data-tour={idx === 0 ? 'people' : undefined}>
              <div className="mate-top">
                <Avatar name={m.name} size={44} />
                <div className="mate-name">
                  <b>{m.name}{m.id === me.id && <span className="muted"> (you)</span>}</b>
                  <span className="muted small with-icon">{m.status === 'suspended' ? <><Sketch name="zzz" size={13} /> Paused</> : <><Sketch name={ROLE_BADGE[m.role][0]} size={13} /> {ROLE_BADGE[m.role][1]}</>}</span>
                </div>
                {(canManage(m) || canLock(m)) && (
                  <Menu items={!canManage(m) ? [lockItem(m)] : m.status === 'active' ? [
                    lockItem(m),
                    me.role === 'owner' && m.role !== 'admin' && { label: 'Make admin', onClick: () => update(m, { role: 'admin' }) },
                    m.role !== 'member' && { label: 'Make teammate', onClick: () => update(m, { role: 'member' }) },
                    m.role !== 'viewer' && { label: 'Make view-only', onClick: () => update(m, { role: 'viewer' }, `Make ${firstName(m.name)} view-only? Their open tasks go back to drafts.`) },
                    { label: 'Pause access', danger: true, onClick: () => update(m, { status: 'suspended' }, `Pause ${firstName(m.name)}?\n\nThey're signed out, their agents stop working, and their open tasks go back to drafts so nothing gets stuck.`) },
                  ] : [{ label: 'Bring back', onClick: () => update(m, { status: 'active' }) }]} />
                )}
              </div>
              <div className="mate-stats">
                <span title="Doing"><b>{m.in_progress ?? 0}</b> doing</span>
                <span title="Waiting for them to check"><b>{m.to_review ?? 0}</b> to check</span>
                <span title="Finished this week"><b>{m.done_7d ?? 0}</b> done this week</span>
              </div>
              {m.agent_focus && (
                <div className="mate-flag locked with-icon" title={`Set by ${m.focus_by ?? 'the owner'}`}>
                  <Sketch name="lock" size={14} /> {m.focus_task_key ? <>Locked to <Link to={href(`/tasks/${m.focus_task_key}`)} viewTransition>{m.focus_task_key}</Link></> : 'Locked, waiting for a task'}
                </div>
              )}
              {busy && <div className="mate-flag with-icon"><Sketch name="sweat" size={14} /> Pretty busy right now</div>}
              {(m.blocked ?? 0) > 0 && <div className="mate-flag stuck with-icon"><Sketch name="stuck" size={14} /> {m.blocked} stuck</div>}
              <div className="mate-agents">
                {agents.length ? agents.map((ag) => (
                  <div key={ag.id} className="mate-agent" title={ag.name}>
                    <span className="with-icon"><Sketch name="agent" size={14} /> {ag.name}</span>
                    <Battery pct={ag.usage_remaining} />
                  </div>
                )) : <span className="hand small">no co-pilot yet</span>}
              </div>
            </div>
          );
        })}
      </div>

      {admin && (invites.data?.invites.length ?? 0) > 0 && (
        <section className="section">
          <h2><span className="h-icon"><Sketch name="mail" size={20} /></span>Invited, not joined yet</h2>
          {invites.data!.invites.map((i) => (
            <div key={i.id} className="invite-row">
              <span>{i.email}</span>
              <span className="muted small">expires {new Date(i.expires_at).toLocaleDateString()}</span>
              <button className="link-btn small" onClick={() => a.run(async () => { await api.del(`/invites/${i.id}`); invites.reload(); })}>cancel</button>
            </div>
          ))}
        </section>
      )}

      {inviting && <InviteModal onClose={() => { setInviting(false); invites.reload(); }} />}
    </div>
  );
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const { me } = useApp();
  const a = useAction();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [link, setLink] = useState<string | null>(null);
  const send = (e: FormEvent) => {
    e.preventDefault();
    a.run(async () => setLink((await api.post('/invites', { email, role })).link));
  };
  return (
    <Modal title="Invite a teammate" icon="mail" onClose={onClose}>
      {link ? (
        <>
          <p>Send this link to <b>{email}</b>. It works once and expires in a week.</p>
          <div className="secret"><code>{link}</code><Copy text={link} /></div>
          <div className="actions-row"><button className="btn primary" onClick={onClose}>Done</button></div>
        </>
      ) : (
        <form onSubmit={send}>
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" autoFocus required /></label>
          <label>They can…
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="member">Work on tasks and check others' work</option>
              <option value="viewer">Only look around</option>
              {me.role === 'owner' && <option value="admin">Also manage people and projects</option>}
            </select>
          </label>
          <ErrorBox error={a.error} />
          <div className="actions-row"><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn primary" disabled={a.busy}>Get invite link</button></div>
        </form>
      )}
    </Modal>
  );
}
