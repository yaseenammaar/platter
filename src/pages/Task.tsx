import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ActivityItem, type ContextPack, type Task, href } from '../api';
import type { SketchName } from '../sketch';
import {
  Avatar, Battery, Copy, ErrorBox, Loading, Menu, Modal, STATUS_WORD, Sketch, Text, firstName, isAdmin, plain, statusLine,
  timeAgo, toast, useAction, useApp, useLoad,
} from '../ui';
import { TaskForm, draftFromTask, draftToPayload, type TaskDraft } from './NewTask';

// The single most useful next step for this person, in priority order.
const PRIMARY: Record<string, [string, SketchName]> = {
  takeover: ['Pick up this plate', 'hand'], approve: ['Check the work', 'review'], submit: ['Send for review', 'box'],
  start: ['Start', 'plane'], resume: ["I'm unstuck", 'bolt'], mark_ready: ["Let's go", 'plane'],
};
const SECONDARY: Record<string, string> = {
  block: "I'm stuck…", release: 'Put back in To do', move_to_backlog: 'Back to drafts', cancel: 'Drop this task…', reopen: 'Reopen…',
};
const REASON_ACTIONS = ['block', 'cancel', 'reopen'];

export function TaskPage({ taskKey }: { taskKey: string }) {
  const { me } = useApp();
  const { data, error, reload } = useLoad(() => api.get<ContextPack>(`/tasks/${taskKey}`), [taskKey], 10_000);
  const [modal, setModal] = useState<string | null>(null);
  const [editing, setEditing] = useState<TaskDraft | null>(null);
  const act = useAction();

  if (error && !data) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <Loading text="Unfolding the details…" />;
  const t = data.task;
  const allowed = new Set(data.allowed_actions);
  const closed = t.status === 'done' || t.status === 'cancelled';
  const started = !['backlog', 'ready'].includes(t.status);
  const canEdit = !closed && me.role !== 'viewer' && (t.reporter_id === me.id || isAdmin(me) || t.assignee_id === me.id);
  const canTakeOver = t.handoff_open && me.role !== 'viewer' && t.reviewer_id !== me.id;
  const canHandOff = !t.handoff && ['in_progress', 'blocked'].includes(t.status) && (t.assignee_id === me.id || isAdmin(me));
  if (canTakeOver) allowed.add('takeover');

  const primary = Object.keys(PRIMARY).find((a) => allowed.has(a));
  const line = statusLine(t);
  const close = () => { setModal(null); act.setError(null); };

  const doAction = (action: string, payload: any = {}) =>
    act.run(async () => {
      if (action === 'takeover') await api.post(`/tasks/${t.key}/takeover`);
      else await api.post(`/tasks/${t.key}/actions/${action}`, payload);
      setModal(null);
      if (action === 'approve') toast('Served! Nice work, team', true);
      else if (action === 'takeover') toast("It's on your plate now");
      else if (action === 'submit') toast('Sent for review');
      else if (action === 'start') toast('On it!');
      await reload();
    });
  const click = (a: string) => {
    if (a === 'submit' || a === 'approve' || a === 'handoff' || REASON_ACTIONS.includes(a)) setModal(a);
    else doAction(a);
  };

  const saveEdit = () =>
    act.run(async () => {
      const p: any = draftToPayload(editing!);
      delete p.project;
      if (started) { delete p.acceptance_criteria; delete p.assignee_id; delete p.depends_on; if (!isAdmin(me)) delete p.reviewer_id; }
      if (!(t.reporter_id === me.id || isAdmin(me))) for (const k of Object.keys(p)) if (!['context', 'labels'].includes(k)) delete p[k];
      await api.patch(`/tasks/${t.key}`, p);
      setEditing(null);
      await reload();
    });

  if (editing) {
    return (
      <div className="page narrow">
        <TaskForm draft={editing} setDraft={setEditing} showProject={false}
          locked={started ? ['acceptance_criteria', 'assignee_id', 'depends_on', ...(isAdmin(me) ? [] : ['reviewer_id'])] : []} />
        <ErrorBox error={act.error} />
        <div className="actions-row">
          <button className="btn" onClick={() => { setEditing(null); act.setError(null); }}>Cancel</button>
          <button className="btn primary" disabled={act.busy} onClick={saveEdit}>Save</button>
        </div>
      </div>
    );
  }

  const subByAc = new Map<string, string>((t.submission?.criteria ?? []).map((c: any) => [c.id, c.evidence]));
  const revByAc = new Map<string, any>((t.review?.criteria ?? []).map((c: any) => [c.id, c]));
  const feedback = t.review?.verdict === 'reject' && t.status === 'in_progress' ? t.review : null;

  return (
    <div className="page narrow task">
      <div className="crumb"><Link to={href('/board')} viewTransition className="with-icon"><Sketch name="back" size={16} /> Board</Link><span className="key">{t.key}</span></div>
      <h1 className="task-title" style={{ viewTransitionName: 'task-title' }}>
        {t.priority === 'P0' && <span className="hot"><Sketch name="flame" size={26} /></span>}{t.title}
      </h1>
      <div className="task-bar">
        <span className={`status ${line.tone}`}><Sketch name={line.icon} size={16} /> {line.text}</span>
        <span className="spacer" />
        {primary && (
          <button className="btn primary" disabled={act.busy} onClick={() => click(primary)}>
            <Sketch name={PRIMARY[primary][1]} size={18} /> {PRIMARY[primary][0]}
          </button>
        )}
        <Menu items={[
          canEdit && { label: 'Edit', onClick: () => setEditing(draftFromTask(t, data.dependencies.map((d) => d.key))) },
          canHandOff && { label: 'Hand off to a teammate…', onClick: () => setModal('handoff') },
          ...Object.keys(SECONDARY).filter((a) => allowed.has(a)).map((a) => ({ label: SECONDARY[a], onClick: () => click(a), danger: a === 'cancel' })),
        ]} />
      </div>
      {!modal && <ErrorBox error={act.error} />}

      {t.handoff_open && (
        <div className="note handoff rise">
          <b className="with-icon"><Sketch name="hand" size={18} /> {t.handoff ? `${firstName(t.handoff.from_member)}'s agent ran out of energy and passed this on` : `${firstName(t.assignee_name)}'s agent went quiet while low on energy`}</b>
          {t.handoff && <Text>{t.handoff.notes}</Text>}
          <div className="muted small">Any teammate's agent with energy left can continue: <code>Take over {t.key} in Platter</code></div>
        </div>
      )}
      {t.status === 'blocked' && <div className="note stuck rise"><b className="with-icon"><Sketch name="stuck" size={18} /> Stuck:</b> {t.blocked_reason}</div>}
      {feedback && (
        <div className="note review rise">
          <b className="with-icon"><Sketch name="wrench" size={18} /> {firstName(feedback.reviewed_by)} asked for changes</b>
          {feedback.summary && <p>{feedback.summary}</p>}
        </div>
      )}
      {data.definition_of_ready_gaps.length > 0 && (
        <div className="note todo rise">
          <b className="with-icon"><Sketch name="pencil" size={18} /> Still a draft.</b> To get it going: {data.definition_of_ready_gaps.map((g) => plain(g).replace(/^./, (c) => c.toLowerCase())).join(' · ')}
        </div>
      )}

      <div className="people">
        <Person label="Doing it" name={t.assignee_name} extra={t.claimed_by_agent_name && ['in_progress', 'blocked'].includes(t.status) ? <span className="agent"><Sketch name="agent" size={14} /> agent <Battery pct={t.claimed_agent_usage} compact /></span> : null} />
        <Person label="Checking it" name={t.reviewer_name} />
        <Person label="Asked by" name={t.reporter_name} />
        {t.due_date && <div className="person"><span className="muted small">Due</span><b className="with-icon"><Sketch name="calendar" size={16} /> {new Date(t.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</b></div>}
      </div>

      {t.description && <section className="block"><Text>{t.description}</Text></section>}
      {t.context && (
        <details className="block soft surface">
          <summary className="with-icon"><Sketch name="agent" size={16} /> Notes for the agent</summary>
          <Text>{t.context}</Text>
        </details>
      )}

      <section className="block">
        <h3>Done when…</h3>
        <ul className="checklist">
          {t.acceptance_criteria.map((c, i) => {
            const rv = revByAc.get(c.id);
            const ev = subByAc.get(c.id);
            const state = rv ? (rv.passed ? 'pass' : 'fail') : ev ? 'claimed' : 'todo';
            return (
              <li key={c.id} className={`${state} rise`} style={{ ['--d' as any]: `${i * 50}ms` }}>
                <span className="tick">{state === 'pass' ? <Sketch name="check" size={14} /> : state === 'fail' ? <Sketch name="cross" size={13} /> : state === 'claimed' ? <span className="dot" /> : null}</span>
                <div>
                  <div>{c.text}</div>
                  {ev && <details className="proof"><summary>{state === 'claimed' ? 'See proof' : 'Proof'}</summary><Text>{ev}</Text></details>}
                  {rv?.note && <div className={`rv-note ${state} with-icon`}><Sketch name={rv.passed ? 'thumbUp' : 'thumbDown'} size={14} /> {rv.note}</div>}
                </div>
              </li>
            );
          })}
          {!t.acceptance_criteria.length && <li className="todo muted">Nothing listed yet</li>}
        </ul>
        {t.submission && (
          <details className="proof-all">
            <summary className="with-icon"><Sketch name="box" size={16} /> What was delivered</summary>
            <Text>{t.submission.summary}</Text>
            {t.submission.tests && <p className="small"><b>Tested:</b> {t.submission.tests}</p>}
            {t.submission.artifacts?.map((a: string) => <a key={a} href={a} target="_blank" rel="noreferrer" className="link-pill"><Sketch name="link" size={13} /> {a.replace(/^https?:\/\//, '')}</a>)}
          </details>
        )}
      </section>

      {(data.dependencies.length > 0 || data.dependents.length > 0) && (
        <section className="block deps">
          {data.dependencies.map((d) => <Link key={d.key} to={href(`/tasks/${d.key}`)} viewTransition className="dep with-icon"><Sketch name="hourglass" size={16} /> Waits for <b>{d.title}</b> <span className="muted">· {STATUS_WORD[d.status]}</span></Link>)}
          {data.dependents.map((d) => <Link key={d.key} to={href(`/tasks/${d.key}`)} viewTransition className="dep with-icon"><Sketch name="link" size={16} /> Unblocks <b>{d.title}</b></Link>)}
        </section>
      )}

      {t.status === 'ready' && t.assignee_id === me.id && <AgentTip text={`Pick up ${t.key} from Platter and finish it.`} />}
      {t.status === 'in_review' && t.reviewer_id === me.id && <AgentTip text={`Check ${t.key} in Platter against its done-when list.`} />}

      <Story items={data.activity} task={t} onPosted={reload} canPost={me.role !== 'viewer'} />

      {modal === 'submit' && <SubmitModal task={t} busy={act.busy} error={act.error} onClose={close} onSubmit={(p) => doAction('submit', p)} />}
      {modal === 'approve' && <ReviewModal task={t} busy={act.busy} error={act.error} onClose={close} onSubmit={(v, p) => doAction(v, p)} />}
      {modal === 'handoff' && (
        <HandoffModal busy={act.busy} error={act.error} onClose={close}
          onSubmit={(p) => act.run(async () => { await api.post(`/tasks/${t.key}/handoff`, p); setModal(null); toast('Passed on — someone will catch it'); await reload(); })} />
      )}
      {modal && REASON_ACTIONS.includes(modal) && <ReasonModal action={modal} busy={act.busy} error={act.error} onClose={close} onSubmit={(reason) => doAction(modal, { reason })} />}
    </div>
  );
}

function Person({ label, name, extra }: { label: string; name: string | null; extra?: React.ReactNode }) {
  return (
    <div className="person">
      <span className="muted small">{label}</span>
      <span className="person-row"><Avatar name={name} size={26} /> <b>{name ? firstName(name) : <span className="muted">nobody yet</span>}</b> {extra}</span>
    </div>
  );
}

function AgentTip({ text }: { text: string }) {
  return <div className="tip surface"><Sketch name="sparkle" size={16} /> Tell your agent: <code>{text}</code> <Copy text={text} /></div>;
}

// ---------- Story (activity, in plain words) ----------
const SAY: Record<string, string> = {
  created: 'created this', edited: 'edited the details', mark_ready: 'put it on the platter',
  move_to_backlog: 'moved it back to drafts', start: 'started working', submit: 'sent it for review',
  approve: 'approved it — served', reject: 'asked for changes', block: 'got stuck', resume: 'got unstuck',
  release: 'put it back in To do', cancel: 'dropped it', reopen: 'reopened it', handoff: 'passed it on',
  takeover: 'picked up the plate', offboarded: 'returned it to drafts (teammate left)', ask: 'asked', answer: 'answered',
};
const KIND_ICON: Record<string, SketchName> = {
  start: 'plane', submit: 'box', approve: 'done', reject: 'wrench', block: 'stuck', resume: 'bolt', handoff: 'hand',
  takeover: 'handoff', ask: 'chat', answer: 'chat', usage: 'bolt', created: 'sparkle', mark_ready: 'plane', progress: 'feed', comment: 'chat',
};
const SHOW_BODY = new Set(['comment', 'progress', 'block', 'handoff', 'ask', 'answer']);
const QUIET = new Set(['edited', 'mark_ready', 'move_to_backlog', 'created', 'offboarded']);

export function storyText(e: ActivityItem) {
  if (e.kind === 'block') return e.message.split(': ').slice(1).join(': ');
  if (e.kind === 'handoff') return e.data?.notes ?? e.message;
  if (e.kind === 'ask' || e.kind === 'answer') return e.message.replace(/^(asked|answered) [^:]+: /, '');
  return e.message;
}

export function StoryLine({ e, showTask }: { e: ActivityItem; showTask?: boolean }) {
  const who = firstName(e.member_name) || 'Platter';
  const verb = SAY[e.kind]
    ?? (e.kind === 'progress' ? 'gave an update'
      : e.kind === 'comment' ? 'said'
        : e.kind === 'usage' ? e.message.replace(/^reported /, 'has ').replace(' usage remaining', ' energy left')
          : e.message); // people events ("joined as member", "invited …") already read naturally
  return (
    <div className={`story-line k-${e.kind}`}>
      <span className="story-av">
        <Avatar name={e.member_name} size={28} />
        {KIND_ICON[e.kind] && <span className="story-kind"><Sketch name={KIND_ICON[e.kind]} size={12} /></span>}
      </span>
      <div className="story-body">
        <div>
          <b>{who}</b>{e.agent_name && <span className="via" title={`via ${e.agent_name}`}> <Sketch name="agent" size={13} /></span>}{' '}
          <span className="muted">{verb}</span>
          {showTask && e.task_key && <> · <Link to={href(`/tasks/${e.task_key}`)} viewTransition className="story-task">{e.task_title}</Link></>}
          <span className="muted small"> · {timeAgo(e.created_at)}</span>
        </div>
        {SHOW_BODY.has(e.kind) && <div className={`bubble ${e.kind}`}><Text>{storyText(e)}</Text></div>}
      </div>
    </div>
  );
}

function Story({ items, task, onPosted, canPost }: { items: ActivityItem[]; task: Task; onPosted: () => void; canPost: boolean }) {
  const [body, setBody] = useState('');
  const [all, setAll] = useState(false);
  const a = useAction();
  const shown = all ? items : items.filter((e) => !QUIET.has(e.kind));
  return (
    <section className="block story">
      <h3>Story</h3>
      {canPost && (
        <form className="say surface" onSubmit={(e) => { e.preventDefault(); a.run(async () => { await api.post(`/tasks/${task.key}/comments`, { body }); setBody(''); onPosted(); }); }}>
          <input placeholder="Say something, answer a question, add a link…" value={body} onChange={(e) => setBody(e.target.value)} />
          <button className="btn icon primary" disabled={!body.trim() || a.busy} aria-label="Send"><Sketch name="plane" size={18} /></button>
        </form>
      )}
      <ErrorBox error={a.error} />
      {shown.map((e) => <StoryLine key={e.id} e={e} />)}
      {items.length !== shown.length && <button className="link-btn small" onClick={() => setAll(true)}>Show everything ({items.length - shown.length} more)</button>}
    </section>
  );
}

// ---------- Modals ----------
function SubmitModal({ task, busy, error, onClose, onSubmit }: { task: Task; busy: boolean; error: unknown; onClose: () => void; onSubmit: (p: any) => void }) {
  const [summary, setSummary] = useState('');
  const [ev, setEv] = useState<Record<string, string>>({});
  const [links, setLinks] = useState('');
  return (
    <Modal title="Show your work" icon="box" onClose={onClose} wide>
      <label>What did you do?<textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="A couple of sentences for the reviewer" /></label>
      {task.acceptance_criteria.map((c) => (
        <label key={c.id}><span className="with-icon"><Sketch name="check" size={15} /> {c.text}</span>
          <input value={ev[c.id] ?? ''} onChange={(e) => setEv({ ...ev, [c.id]: e.target.value })} placeholder="How do we know? (what changed, how you checked)" />
        </label>
      ))}
      <label>Links <span className="hint">PR, preview, doc — optional</span><input value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://…" /></label>
      <ErrorBox error={error} />
      <div className="actions-row">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={() => onSubmit({
          summary, artifacts: links.split(/[\s,]+/).filter(Boolean),
          criteria: task.acceptance_criteria.map((c) => ({ id: c.id, evidence: ev[c.id] ?? '' })),
        })}>Send for review</button>
      </div>
    </Modal>
  );
}

function ReviewModal({ task, busy, error, onClose, onSubmit }: { task: Task; busy: boolean; error: unknown; onClose: () => void; onSubmit: (v: 'approve' | 'reject', p: any) => void }) {
  const [res, setRes] = useState<Record<string, { passed?: boolean; note: string }>>({});
  const [summary, setSummary] = useState('');
  const ev = new Map<string, string>((task.submission?.criteria ?? []).map((c: any) => [c.id, c.evidence]));
  const all = task.acceptance_criteria.every((c) => res[c.id]?.passed !== undefined);
  const allPass = all && task.acceptance_criteria.every((c) => res[c.id]?.passed);
  const payload = { summary, criteria: task.acceptance_criteria.map((c) => ({ id: c.id, passed: res[c.id]?.passed === true, note: res[c.id]?.note ?? '' })) };
  return (
    <Modal title="Does it work?" icon="review" onClose={onClose} wide>
      {task.submission?.summary && <div className="delivered"><span className="hand">{firstName(task.submission.submitted_by)} says…</span><Text>{task.submission.summary}</Text></div>}
      {task.acceptance_criteria.map((c) => {
        const r = res[c.id] ?? { note: '' };
        return (
          <div key={c.id} className={`judge ${r.passed === true ? 'pass' : r.passed === false ? 'fail' : ''}`}>
            <div className="judge-q">{c.text}</div>
            {ev.get(c.id) && <div className="muted small">Proof: {ev.get(c.id)}</div>}
            <div className="judge-row">
              <button className={`thumb ${r.passed === true ? 'on' : ''}`} onClick={() => setRes({ ...res, [c.id]: { ...r, passed: true } })}><Sketch name="thumbUp" size={16} /> Works</button>
              <button className={`thumb no ${r.passed === false ? 'on' : ''}`} onClick={() => setRes({ ...res, [c.id]: { ...r, passed: false } })}><Sketch name="thumbDown" size={16} /> Not yet</button>
              {r.passed === false && <input autoFocus placeholder="What needs fixing?" value={r.note} onChange={(e) => setRes({ ...res, [c.id]: { ...r, note: e.target.value } })} />}
            </div>
          </div>
        );
      })}
      <label>Anything else? <span className="hint">optional</span><input value={summary} onChange={(e) => setSummary(e.target.value)} /></label>
      <ErrorBox error={error} />
      <div className="actions-row">
        <button className="btn" onClick={onClose}>Cancel</button>
        {all && !allPass && <button className="btn warn" disabled={busy} onClick={() => onSubmit('reject', payload)}><Sketch name="wrench" size={16} /> Send back</button>}
        {allPass && <button className="btn primary" disabled={busy} onClick={() => onSubmit('approve', payload)}><Sketch name="sparkle" size={16} /> Ship it</button>}
        {!all && <button className="btn primary" disabled>Check each item first</button>}
      </div>
    </Modal>
  );
}

function HandoffModal({ busy, error, onClose, onSubmit }: { busy: boolean; error: unknown; onClose: () => void; onSubmit: (p: any) => void }) {
  const [notes, setNotes] = useState('');
  return (
    <Modal title="Pass it on" icon="hand" onClose={onClose}>
      <p className="hand lead">A teammate's agent with energy left will pick it up from here.</p>
      <label>Leave a note for whoever continues<textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={'What’s done, what’s left, where the work is (branch / PR), anything tricky'} /></label>
      <ErrorBox error={error} />
      <div className="actions-row">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={() => onSubmit({ notes, reason: 'passed on by a person' })}>Pass it on</button>
      </div>
    </Modal>
  );
}

function ReasonModal({ action, busy, error, onClose, onSubmit }: { action: string; busy: boolean; error: unknown; onClose: () => void; onSubmit: (r: string) => void }) {
  const [reason, setReason] = useState('');
  const copy: Record<string, [SketchName, string, string, string]> = {
    block: ['stuck', 'What’s in the way?', 'What do you need to get unstuck?', "I'm stuck"],
    cancel: ['trash', 'Drop this task?', 'Why isn’t it needed anymore?', 'Drop it'],
    reopen: ['refresh', 'Reopen this?', 'What still needs doing?', 'Reopen'],
  };
  const [icon, title, prompt, cta] = copy[action];
  return (
    <Modal title={title} icon={icon} onClose={onClose}>
      <label>{prompt}<textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
      <ErrorBox error={error} />
      <div className="actions-row">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className={`btn ${action === 'cancel' ? 'warn' : 'primary'}`} disabled={busy} onClick={() => onSubmit(reason)}>{cta}</button>
      </div>
    </Modal>
  );
}
