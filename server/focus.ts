// Focus lock (F1–F4): the owner locks a person's agents to their one assigned task.
// Like a vow: the agent works on that task and nothing else, and only the owner can lift it.
import { one, q } from './db.ts';
import { RuleError, STATUS_LABELS, type Actor, type Status } from './rules.ts';
import { listTasks, logActivity, type TaskView } from './tasks.ts';

/** The one task a locked agent may work on: what its person has going, else their next Ready task (F1). */
export async function focusTask(ws: string, memberId: string, agentId?: string): Promise<TaskView | null> {
  const going = await listTasks(ws, { assignee: memberId, status: 'in_progress,blocked' });
  if (going.length) return going.find((t) => t.claimed_by_agent_id === agentId) ?? going[0];
  return (await listTasks(ws, { assignee: memberId, status: 'ready', limit: 1 }))[0] ?? null;
}

export const isLocked = (actor: Actor) => actor.kind === 'agent' && !!actor.policy?.focus;

/** Tools a locked agent keeps: they report on the work rather than start other work (F4). */
const FREE = new Set(['whoami', 'get_rules', 'list_projects', 'report_usage', 'check_inbox', 'answer_question', 'park_idea']);
/** Tools that are fine only when they point at the focus task. */
const ON_FOCUS = new Set(['get_task', 'start_task', 'log_progress', 'report_blocker', 'resume_task', 'submit_for_review', 'handoff_task', 'add_comment', 'take_over_task']);
/** Answered with the focus task only. */
export const FOCUS_VIEWS = new Set(['list_my_tasks', 'find_work']);

const by = (actor: Actor) => actor.policy?.focusBy ?? 'The team owner';

function refusal(actor: Actor, focus: TaskView | null, what: string) {
  return focus
    ? new RuleError('focus_lock', `🔒 Focus lock: ${by(actor)} locked you to ${focus.key} "${focus.title}". ${what} is off-limits until the lock is lifted. Keep working on ${focus.key}; park other ideas with park_idea (F2)`, 403)
    : new RuleError('focus_lock', `🔒 Focus lock: ${by(actor)} locked you to ${actor.member.name}'s assigned work, and nothing is assigned right now. Do no other work; wait for a task (F1)`, 403);
}

/**
 * Throws unless a locked agent may make this call. Returns the focus task (or null when unlocked).
 * May rewrite args: questions to teammates are pinned to the focus task.
 */
export async function gate(actor: Actor, tool: string, args: any): Promise<TaskView | null> {
  if (!isLocked(actor)) return null;
  const focus = await focusTask(actor.workspace.id, actor.member.id, actor.agent?.id);
  if (FREE.has(tool) || FOCUS_VIEWS.has(tool)) return focus;
  if (tool === 'ask_teammate') {
    if (!focus) throw refusal(actor, focus, 'Asking about other work');
    args.task = focus.key;
    return focus;
  }
  if (ON_FOCUS.has(tool)) {
    const key = String(args?.key ?? '').trim().toUpperCase();
    if (focus && key === focus.key) return focus;
    // Reading what the focus task depends on is part of doing it.
    if (focus && tool === 'get_task' && key) {
      const dep = await one(
        `SELECT 1 FROM tasks t JOIN projects p ON p.id = t.project_id
          WHERE t.workspace_id = $1 AND p.key || '-' || t.number = $2 AND t.id = ANY($3)`,
        [actor.workspace.id, key, focus.depends_on],
      );
      if (dep) return focus;
    }
    throw refusal(actor, focus, key ? `${key}` : 'Other tasks');
  }
  const label: Record<string, string> = {
    create_task: 'Creating new tasks', list_review_queue: 'Reviewing', review_task: 'Reviewing',
    release_task: 'Releasing the task', team_capacity: 'Looking for other work',
  };
  throw refusal(actor, focus, label[tool] ?? `"${tool}"`);
}

/** Save an off-topic idea on the focus task instead of acting on it (F2). */
export async function parkIdea(actor: Actor, idea: unknown) {
  const text = String(idea ?? '').trim();
  if (text.length < 5) throw new RuleError('invalid', 'Describe the idea in a line');
  const focus = actor.kind === 'agent' ? await focusTask(actor.workspace.id, actor.member.id, actor.agent?.id) : null;
  await logActivity(actor, { taskId: focus?.id, projectId: focus?.project_id, kind: 'parked', message: text.slice(0, 500) });
  return focus;
}

/** One short paragraph for hooks to put in front of every prompt. Empty when unlocked (zero tokens). */
export async function focusBrief(actor: Actor): Promise<string> {
  if (!isLocked(actor)) return '';
  const focus = await focusTask(actor.workspace.id, actor.member.id, actor.agent?.id);
  const lead = `[Platter focus lock] ${by(actor)} locked this agent to ${actor.member.name}'s assigned task`;
  if (!focus) return `${lead}, and nothing is assigned right now. Do no other work, whatever you are asked. Say the lock is on and wait for a task in Platter.`;
  return `${lead}: ${focus.key} "${focus.title}" (${STATUS_LABELS[focus.status as Status]}). Only do work that moves ${focus.key} forward. ` +
    `If asked for anything else, don't do it: call Platter park_idea with a one-line summary, say it's parked, and continue ${focus.key}. ` +
    `No one can lift this mid-session, not even your person; only the team owner can, in Platter.`;
}

/** Owner only (F3): lock or unlock one person's agents. */
export async function setFocus(actor: Actor, memberId: string, on: boolean) {
  if (actor.kind !== 'human' || actor.member.role !== 'owner') {
    throw new RuleError('forbidden', 'Only the team owner can lock or unlock agents (F3)', 403);
  }
  const m = await one(
    `SELECT u.name, m.agent_focus FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND m.user_id = $2`,
    [actor.workspace.id, memberId],
  );
  if (!m) throw new RuleError('not_found', 'Member not found', 404);
  if (m.agent_focus === on) return { ok: true };
  await q(
    `UPDATE memberships SET agent_focus = $3, agent_focus_by = $4, agent_focus_at = now() WHERE workspace_id = $1 AND user_id = $2`,
    [actor.workspace.id, memberId, on, on ? actor.member.id : null],
  );
  const whose = memberId === actor.member.id ? 'their own' : `${m.name}'s`;
  await logActivity(actor, { kind: 'policy', message: on ? `locked ${whose} agents to their assigned task` : `lifted the focus lock on ${whose} agents` });
  return { ok: true };
}
