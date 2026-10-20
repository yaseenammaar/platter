import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Criterion, type Task, href } from '../api';
import { ErrorBox, Sketch, toast, useAction, useApp } from '../ui';

export interface TaskDraft {
  project: string; title: string; description: string; context: string;
  acceptance_criteria: Criterion[]; type: string; priority: string; labels: string;
  depends_on: string; assignee_id: string; reviewer_id: string; due_date: string;
}

export function draftFromTask(t: Task, depKeys: string[]): TaskDraft {
  return {
    project: t.project_key, title: t.title, description: t.description, context: t.context,
    acceptance_criteria: t.acceptance_criteria, type: t.type, priority: t.priority, labels: t.labels.join(', '),
    depends_on: depKeys.join(', '), assignee_id: t.assignee_id ?? '', reviewer_id: t.reviewer_id ?? '',
    due_date: t.due_date ? String(t.due_date).slice(0, 10) : '',
  };
}

export function draftToPayload(d: TaskDraft) {
  return {
    ...d,
    acceptance_criteria: d.acceptance_criteria.filter((c) => c.text.trim()),
    labels: d.labels.split(',').map((s) => s.trim()).filter(Boolean),
    depends_on: d.depends_on.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
    assignee_id: d.assignee_id || null,
    reviewer_id: d.reviewer_id || null,
    due_date: d.due_date || null,
  };
}

/** What's still missing before the task can go (mirrors the server's Definition of Ready). */
export function missing(d: TaskDraft, L: any): string[] {
  const ac = d.acceptance_criteria.filter((c) => c.text.trim());
  const m: string[] = [];
  if (d.title.trim().length < L.minTitle) m.push('a clearer title');
  if (d.description.trim().length < L.minDescription) m.push('a bit more on why');
  if (!ac.length || ac.some((c) => c.text.trim().length < L.minCriterion)) m.push('what “done” looks like');
  if (!d.assignee_id) m.push('who does it');
  if (!d.reviewer_id || d.reviewer_id === d.assignee_id) m.push('someone else to check it');
  return m;
}

export function TaskForm({ draft, setDraft, locked = [], showProject = true }: {
  draft: TaskDraft; setDraft: (d: TaskDraft) => void; locked?: string[]; showProject?: boolean;
}) {
  const { members, projects } = useApp();
  const people = members.filter((m) => m.status === 'active' && m.role !== 'viewer');
  const set = (k: keyof TaskDraft) => (e: any) => setDraft({ ...draft, [k]: e.target.value });
  const ac = draft.acceptance_criteria;
  const setAc = (i: number, text: string) => setDraft({ ...draft, acceptance_criteria: ac.map((c, j) => (j === i ? { ...c, text } : c)) });
  const isLocked = (f: string) => locked.includes(f);

  return (
    <div className="form">
      <input className="title-input" value={draft.title} onChange={set('title')} placeholder="What needs to happen?" autoFocus />
      <textarea className="plain" rows={3} value={draft.description} onChange={set('description')} placeholder="Why does it matter? Any details…" />

      <div className="field">
        <div className="field-label">Done when… {isLocked('acceptance_criteria') && <span className="lock with-icon"><Sketch name="lock" size={13} /> locked while in progress</span>}</div>
        {ac.map((c, i) => (
          <div key={i} className="done-row">
            <span className="tick-empty" />
            <input value={c.text} disabled={isLocked('acceptance_criteria')} onChange={(e) => setAc(i, e.target.value)}
              placeholder={i === 0 ? 'e.g. Users get an email with a reset link' : 'Another thing that must be true'}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setDraft({ ...draft, acceptance_criteria: [...ac, { id: '', text: '' }] }); } }} />
            {!isLocked('acceptance_criteria') && ac.length > 1 && (
              <button type="button" className="x-small" onClick={() => setDraft({ ...draft, acceptance_criteria: ac.filter((_, j) => j !== i) })} aria-label="Remove">×</button>
            )}
          </div>
        ))}
        {!isLocked('acceptance_criteria') && (
          <button type="button" className="link-btn with-icon" onClick={() => setDraft({ ...draft, acceptance_criteria: [...ac, { id: '', text: '' }] })}><Sketch name="plus" size={14} /> add another</button>
        )}
      </div>

      <div className="row2">
        <label>Who's doing it?
          <select value={draft.assignee_id} onChange={set('assignee_id')} disabled={isLocked('assignee_id')}>
            <option value="">Pick someone</option>
            {people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label>Who checks it?
          <select value={draft.reviewer_id} onChange={set('reviewer_id')} disabled={isLocked('reviewer_id')}>
            <option value="">Pick someone</option>
            {people.filter((m) => m.id !== draft.assignee_id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      </div>

      <label><span className="with-icon"><Sketch name="agent" size={16} /> Notes for the agent <span className="hint">optional — files, links, gotchas</span></span>
        <textarea rows={2} value={draft.context} onChange={set('context')} placeholder="e.g. Code is in src/auth. Use the existing mailer." />
      </label>

      <details className="more">
        <summary>More options</summary>
        <div className="row2">
          <label>How urgent?
            <select value={draft.priority} onChange={set('priority')}>
              <option value="P0">Drop everything</option><option value="P1">High</option><option value="P2">Normal</option><option value="P3">Whenever</option>
            </select>
          </label>
          <label>Kind
            <select value={draft.type} onChange={set('type')}>
              <option value="feature">Feature</option><option value="bug">Bug</option><option value="chore">Chore</option><option value="research">Research</option>
            </select>
          </label>
          <label>Due<input type="date" value={draft.due_date} onChange={set('due_date')} /></label>
          {showProject && projects.length > 1 && (
            <label>Project
              <select value={draft.project} onChange={set('project')}>
                {projects.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
            </label>
          )}
          <label>Waits for <span className="hint">task codes, e.g. WEB-3</span><input value={draft.depends_on} onChange={set('depends_on')} disabled={isLocked('depends_on')} /></label>
          <label>Tags<input value={draft.labels} onChange={set('labels')} placeholder="frontend, auth" /></label>
        </div>
      </details>
    </div>
  );
}

export function NewTaskPage() {
  const { projects, rules, team } = useApp();
  const nav = useNavigate();
  const a = useAction();
  const [draft, setDraft] = useState<TaskDraft>({
    project: localStorage.getItem(`platter_project:${team.slug}`) || projects[0]?.key || '', title: '', description: '', context: '',
    acceptance_criteria: [{ id: '', text: '' }], type: 'feature', priority: 'P2', labels: '', depends_on: '',
    assignee_id: '', reviewer_id: '', due_date: '',
  });
  const gaps = missing(draft, rules.limits);
  const create = (ready: boolean) => (e?: FormEvent) => {
    e?.preventDefault();
    a.run(async () => {
      const { task } = await api.post<{ task: Task }>('/tasks', { ...draftToPayload(draft), ready });
      toast(ready ? 'On the platter!' : 'Tucked away as a draft');
      nav(href(`/tasks/${task.key}`), { viewTransition: true });
    });
  };
  return (
    <form className="page narrow" onSubmit={create(true)}>
      <TaskForm draft={draft} setDraft={setDraft} />
      <ErrorBox error={a.error} />
      <div className="actions-row sticky">
        {gaps.length > 0 && <span className="hand grow">still needs {gaps.join(', ')}</span>}
        <button type="button" className="btn" disabled={a.busy || !draft.title.trim()} onClick={create(false)}>Save draft</button>
        <button className="btn primary" disabled={a.busy || gaps.length > 0}><Sketch name="plane" size={18} /> Let's go</button>
      </div>
    </form>
  );
}
