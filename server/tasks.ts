import { randomUUID } from 'node:crypto';
import { json, one, q } from './db.ts';
import {
  ACTIONS, LIMITS, RuleError, STATUS_LABELS, allowedActions, assertAction, assertCanEdit, canWrite,
  definitionOfReady, normalizeCriteria, requireReason, validateReview, validateSubmission,
  type Action, type Actor, type EditableField, type Status, type Task,
} from './rules.ts';

const TYPES = ['feature', 'bug', 'chore', 'research'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];

const TASK_SELECT = `
  SELECT t.*, p.key AS project_key, p.name AS project_name,
         a.name AS assignee_name, r.name AS reviewer_name, rp.name AS reporter_name,
         ag.name AS claimed_by_agent_name, cag.name AS created_by_agent_name,
         ag.usage_remaining AS claimed_agent_usage_raw, ag.usage_reported_at AS claimed_agent_usage_at,
         ag.usage_resets_at AS claimed_agent_resets_at
    FROM tasks t
    JOIN projects p ON p.id = t.project_id
    LEFT JOIN users a ON a.id = t.assignee_id
    LEFT JOIN users r ON r.id = t.reviewer_id
    LEFT JOIN users rp ON rp.id = t.reporter_id
    LEFT JOIN agent_tokens ag ON ag.id = t.claimed_by_agent_id
    LEFT JOIN agent_tokens cag ON cag.id = t.created_by_agent_id`;

/** A usage report only counts while fresh and before the limit resets (H1). */
export function effectiveUsage(remaining: number | null, reportedAt: any, resetsAt: any): number | null {
  if (remaining === null || remaining === undefined || !reportedAt) return null;
  if (Date.now() - new Date(reportedAt).getTime() > LIMITS.usageReportFreshHours * 3600_000) return null;
  if (resetsAt && new Date(resetsAt).getTime() < Date.now()) return null;
  return Number(remaining);
}

export function formatTask(row: any) {
  const heartbeat = row.last_heartbeat_at ? new Date(row.last_heartbeat_at).getTime() : null;
  const stale = row.status === 'in_progress' && heartbeat !== null && Date.now() - heartbeat > LIMITS.heartbeatStaleMinutes * 60_000;
  const claimedUsage = effectiveUsage(row.claimed_agent_usage_raw, row.claimed_agent_usage_at, row.claimed_agent_resets_at);
  const exhaustedAndSilent = stale && claimedUsage !== null && claimedUsage < LIMITS.usageExhausted;
  const { claimed_agent_usage_raw, claimed_agent_usage_at, claimed_agent_resets_at, ...rest } = row;
  return {
    ...rest,
    key: `${row.project_key}-${row.number}`,
    stale,
    claimed_agent_usage: claimedUsage,
    // Open for takeover: explicit handoff, or an exhausted agent went silent (H5).
    handoff_open: ['in_progress', 'blocked'].includes(row.status) && (!!row.handoff || exhaustedAndSilent),
    needs_attention: row.rework_count >= LIMITS.reworkEscalation && !['done', 'cancelled'].includes(row.status),
  };
}
export type TaskView = ReturnType<typeof formatTask>;

/** Look a task up by key (WEB-12) or id — only ever inside one team (P0). */
export async function findTask(ws: string, ref: string): Promise<TaskView> {
  const m = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/.exec(String(ref).trim());
  const row = m
    ? await one(`${TASK_SELECT} WHERE t.workspace_id = $1 AND p.key = $2 AND t.number = $3`, [ws, m[1].toUpperCase(), Number(m[2])])
    : /^[0-9a-f-]{36}$/i.test(ref)
      ? await one(`${TASK_SELECT} WHERE t.workspace_id = $1 AND t.id = $2`, [ws, ref])
      : null;
  if (!row) throw new RuleError('not_found', `Task ${ref} not found`, 404);
  return formatTask(row);
}

export interface TaskFilters { project?: string; status?: string; assignee?: string; reviewer?: string; q?: string; limit?: number }

export async function listTasks(ws: string, f: TaskFilters = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
  add('t.workspace_id = ?', ws);
  if (f.project) add('p.key = ?', f.project.toUpperCase());
  if (f.status) add('t.status = ANY(?)', f.status.split(','));
  if (f.assignee) add('t.assignee_id = ?', f.assignee);
  if (f.reviewer) add('t.reviewer_id = ?', f.reviewer);
  if (f.q) add('(t.title ILIKE ? OR t.description ILIKE ?)', `%${f.q}%`);
  params.push(Math.min(f.limit ?? 500, 1000));
  const rows = await q(
    `${TASK_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY CASE t.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, t.updated_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows.map(formatTask);
}

export async function logActivity(
  actor: Actor,
  e: { taskId?: string | null; projectId?: string | null; kind: string; message?: string; data?: unknown },
) {
  await q(
    `INSERT INTO activity (workspace_id, task_id, project_id, member_id, agent_id, kind, message, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [actor.workspace.id, e.taskId ?? null, e.projectId ?? null, actor.member.id, actor.agent?.id ?? null, e.kind, e.message ?? '', json(e.data)],
  );
}

export async function listActivity(ws: string, opts: { taskId?: string; limit?: number; before?: number } = {}) {
  const params: unknown[] = [ws];
  const where: string[] = ['e.workspace_id = $1'];
  if (opts.taskId) { params.push(opts.taskId); where.push(`e.task_id = $${params.length}`); }
  if (opts.before) { params.push(opts.before); where.push(`e.id < $${params.length}`); }
  params.push(Math.min(opts.limit ?? 50, 200));
  const rows = await q(
    `SELECT e.*, m.name AS member_name, ag.name AS agent_name,
            CASE WHEN t.id IS NULL THEN NULL ELSE p.key || '-' || t.number END AS task_key, t.title AS task_title
       FROM activity e
       LEFT JOIN users m ON m.id = e.member_id
       LEFT JOIN agent_tokens ag ON ag.id = e.agent_id
       LEFT JOIN tasks t ON t.id = e.task_id
       LEFT JOIN projects p ON p.id = t.project_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.id DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

/** Someone who can be given work in this team: an active, non-viewer member (P0/P1). */
async function assertWorker(ws: string, id: unknown, label: string) {
  if (id === null || id === undefined || id === '') return null;
  const m = await one(
    `SELECT u.id, u.name, m.role, m.status FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = $1 AND m.user_id = $2`,
    [ws, id],
  );
  if (!m) throw new RuleError('invalid', `${label} is not on this team`);
  if (m.status !== 'active') throw new RuleError('invalid', `${label} ${m.name} is suspended`);
  if (m.role === 'viewer') throw new RuleError('invalid', `${label} ${m.name} is a viewer and cannot be assigned work (P1)`);
  return m.id as string;
}

async function resolveDeps(ws: string, input: unknown, selfId?: string): Promise<string[]> {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new RuleError('invalid', 'depends_on must be a list of task keys');
  const ids: string[] = [];
  for (const ref of input) {
    const t = await findTask(ws, String(ref));
    if (t.id === selfId) throw new RuleError('invalid', 'A task cannot depend on itself');
    if (!ids.includes(t.id)) ids.push(t.id);
  }
  return ids;
}

function cleanLabels(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((l) => String(l).trim().toLowerCase()).filter(Boolean))].slice(0, 10);
}

function pick<T>(v: unknown, allowed: string[], label: string, fallback: T): T {
  if (v === undefined || v === null || v === '') return fallback;
  if (!allowed.includes(String(v))) throw new RuleError('invalid', `${label} must be one of ${allowed.join(', ')}`);
  return v as T;
}

export async function createTask(actor: Actor, input: any) {
  if (!canWrite(actor)) throw new RuleError('forbidden', 'Viewers have read-only access (P1)', 403);
  const ws = actor.workspace.id;
  const project = await one('SELECT * FROM projects WHERE workspace_id = $1 AND key = $2 AND NOT archived', [ws, String(input.project ?? '').toUpperCase()]);
  if (!project) throw new RuleError('invalid', `Project "${input.project}" not found`);
  const title = String(input.title ?? '').trim();
  if (!title) throw new RuleError('invalid', 'Title is required');

  const task = {
    title,
    description: String(input.description ?? '').trim(),
    context: String(input.context ?? '').trim(),
    acceptance_criteria: normalizeCriteria(input.acceptance_criteria ?? []),
    type: pick(input.type, TYPES, 'type', 'feature'),
    priority: pick(input.priority, PRIORITIES, 'priority', 'P2'),
    labels: cleanLabels(input.labels),
    depends_on: await resolveDeps(ws, input.depends_on),
    // Agents may propose work but cannot hand it to people (R3).
    assignee_id: actor.kind === 'agent' ? null : await assertWorker(ws, input.assignee_id, 'Assignee'),
    reviewer_id: actor.kind === 'agent' ? null : await assertWorker(ws, input.reviewer_id, 'Reviewer'),
    due_date: input.due_date || null,
  };
  if (task.assignee_id && task.assignee_id === task.reviewer_id) {
    throw new RuleError('invalid', 'Reviewer must be a different person from the assignee (R2)');
  }
  let status: Status = 'backlog';
  if (input.ready && actor.kind === 'human') {
    const missing = definitionOfReady(task);
    if (missing.length) throw new RuleError('not_ready', 'Task does not meet the Definition of Ready', 422, missing);
    status = 'ready';
  }

  const num = await one<{ n: number }>('UPDATE projects SET next_number = next_number + 1 WHERE id = $1 RETURNING next_number - 1 AS n', [project.id]);
  const id = randomUUID();
  await q(
    `INSERT INTO tasks (id, project_id, number, title, description, context, acceptance_criteria, type, priority,
                        status, labels, depends_on, assignee_id, reviewer_id, reporter_id, created_by_agent_id, due_date, workspace_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18)`,
    [id, project.id, num!.n, task.title, task.description, task.context, json(task.acceptance_criteria), task.type,
      task.priority, status, json(task.labels), json(task.depends_on), task.assignee_id, task.reviewer_id,
      actor.member.id, actor.agent?.id ?? null, task.due_date, ws],
  );
  await logActivity(actor, { taskId: id, projectId: project.id, kind: 'created', message: `created "${task.title}" in ${STATUS_LABELS[status]}` });
  return findTask(ws, id);
}

export async function updateTask(actor: Actor, ref: string, patch: any) {
  const ws = actor.workspace.id;
  const task = await findTask(ws, ref);
  const fields = (Object.keys(patch) as EditableField[]).filter((k) =>
    ['title', 'description', 'context', 'acceptance_criteria', 'type', 'priority', 'labels', 'depends_on', 'assignee_id', 'reviewer_id', 'due_date'].includes(k),
  );
  if (!fields.length) return task;
  assertCanEdit(task as Task, actor, fields);

  const next: any = {};
  for (const f of fields) {
    const v = patch[f];
    switch (f) {
      case 'title': next.title = String(v ?? '').trim(); if (!next.title) throw new RuleError('invalid', 'Title is required'); break;
      case 'description': case 'context': next[f] = String(v ?? '').trim(); break;
      case 'acceptance_criteria': next[f] = normalizeCriteria(v, task.acceptance_criteria); break;
      case 'type': next[f] = pick(v, TYPES, 'type', task.type); break;
      case 'priority': next[f] = pick(v, PRIORITIES, 'priority', task.priority); break;
      case 'labels': next[f] = cleanLabels(v); break;
      case 'depends_on': next[f] = await resolveDeps(ws, v, task.id); break;
      case 'assignee_id': next[f] = await assertWorker(ws, v, 'Assignee'); break;
      case 'reviewer_id': next[f] = await assertWorker(ws, v, 'Reviewer'); break;
      case 'due_date': next[f] = v || null; break;
    }
  }
  const merged = { ...task, ...next };
  if (merged.assignee_id && merged.assignee_id === merged.reviewer_id) {
    throw new RuleError('invalid', 'Reviewer must be a different person from the assignee (R2)');
  }
  if (task.status === 'ready') {
    const missing = definitionOfReady(merged);
    if (missing.length) {
      throw new RuleError('not_ready', 'This edit would break the Definition of Ready. Move the task to Backlog first.', 422, missing);
    }
  }
  const changed = Object.keys(next).filter((k) => JSON.stringify(next[k]) !== JSON.stringify((task as any)[k]));
  if (!changed.length) return task;
  const jsonCols = ['acceptance_criteria', 'labels', 'depends_on'];
  const sets = changed.map((k, i) => `${k} = $${i + 3}${jsonCols.includes(k) ? '::jsonb' : ''}`);
  const values = changed.map((k) => (jsonCols.includes(k) ? json(next[k]) : next[k]));
  const updated = await one(
    `UPDATE tasks SET ${sets.join(', ')}, version = version + 1, updated_at = now()
      WHERE id = $1 AND version = $2 RETURNING id`,
    [task.id, task.version, ...values],
  );
  if (!updated) throw new RuleError('conflict', 'Task was changed by someone else — refresh and try again', 409);
  await logActivity(actor, {
    taskId: task.id, projectId: task.project_id, kind: 'edited', message: `edited ${changed.join(', ').replace(/_id\b/g, '')}`,
    data: { before: Object.fromEntries(changed.map((k) => [k, (task as any)[k]])), after: Object.fromEntries(changed.map((k) => [k, next[k]])) },
  });
  return findTask(actor.workspace.id, task.id);
}

export async function transition(actor: Actor, ref: string, action: Action, payload: any = {}) {
  const task = await findTask(actor.workspace.id, ref);
  if (!ACTIONS[action]) throw new RuleError('invalid', `Unknown action "${action}"`, 400);
  assertAction(task as Task, actor, action);
  const def = ACTIONS[action];
  const sets: Record<string, unknown> = {};
  let message = `${def.label.toLowerCase()} (${STATUS_LABELS[task.status as Status]} → ${STATUS_LABELS[def.to]})`;
  let data: any = null;

  switch (action) {
    case 'mark_ready': {
      const missing = definitionOfReady(task);
      if (missing.length) throw new RuleError('not_ready', 'Task does not meet the Definition of Ready', 422, missing);
      break;
    }
    case 'start': {
      if (task.depends_on.length) {
        const open = await q(`${TASK_SELECT} WHERE t.workspace_id = $2 AND t.id = ANY($1) AND t.status <> 'done'`, [task.depends_on, actor.workspace.id]);
        if (open.length) {
          throw new RuleError('dependencies_open', 'Cannot start: dependencies are not done (W2)', 409,
            open.map((d: any) => `${d.project_key}-${d.number} "${d.title}" is ${STATUS_LABELS[d.status as Status]}`));
        }
      }
      await assertAgentHasCapacity(actor, LIMITS.usageExhausted);
      await assertWip(task.assignee_id!, task.assignee_name, task.project_id);
      sets.claimed_by_agent_id = actor.agent?.id ?? null;
      sets.last_heartbeat_at = new Date();
      if (actor.agent) message += ` — picked up by agent "${actor.agent.name}"`;
      break;
    }
    case 'block':
      sets.blocked_reason = requireReason(payload.reason, 'W5');
      message += `: ${sets.blocked_reason}`;
      break;
    case 'resume':
      sets.blocked_reason = null;
      sets.last_heartbeat_at = new Date();
      if (actor.agent) sets.claimed_by_agent_id = actor.agent.id;
      break;
    case 'release':
      sets.handoff = null;
      sets.claimed_by_agent_id = null;
      sets.blocked_reason = null;
      sets.last_heartbeat_at = null;
      if (payload.reason) message += `: ${String(payload.reason).trim()}`;
      break;
    case 'submit': {
      const sub = validateSubmission(task, payload);
      data = {
        ...sub, attempt: task.rework_count + 1, submitted_at: new Date().toISOString(),
        submitted_by: actor.member.name, agent: actor.agent?.name ?? null,
      };
      sets.submission = data;
      sets.handoff = null;
      message += ` — attempt #${data.attempt}`;
      break;
    }
    case 'approve':
    case 'reject': {
      const rev = validateReview(task, action, payload);
      data = { ...rev, reviewed_at: new Date().toISOString(), reviewed_by: actor.member.name, agent: actor.agent?.name ?? null };
      sets.review = data;
      if (action === 'approve') {
        sets.completed_at = new Date();
        sets.claimed_by_agent_id = null;
      } else {
        sets.rework_count = task.rework_count + 1;
        sets.last_heartbeat_at = new Date();
        const failed = rev.criteria.filter((c) => !c.passed).map((c) => c.id);
        message += ` — failed ${failed.join(', ')}`;
      }
      if (actor.agent) message += ` (verified by agent "${actor.agent.name}")`;
      break;
    }
    case 'cancel':
      sets.handoff = null;
      sets.blocked_reason = null;
      sets.claimed_by_agent_id = null;
      message += `: ${requireReason(payload.reason, 'C1')}`;
      break;
    case 'reopen':
      sets.completed_at = null;
      sets.review = null;
      message += `: ${requireReason(payload.reason, 'C1')}`;
      break;
  }

  const keys = Object.keys(sets);
  const jsonCols = ['submission', 'review', 'handoff'];
  const setSql = keys.map((k, i) => `${k} = $${i + 5}${jsonCols.includes(k) ? '::jsonb' : ''}`);
  const values = keys.map((k) => (jsonCols.includes(k) ? json(sets[k]) : sets[k]));
  const updated = await one(
    `UPDATE tasks SET status = $4${setSql.length ? ', ' + setSql.join(', ') : ''}, version = version + 1, updated_at = now()
      WHERE id = $1 AND status = $2 AND version = $3 RETURNING id`,
    [task.id, task.status, task.version, def.to, ...values],
  );
  if (!updated) throw new RuleError('conflict', 'Task was changed by someone else — refresh and try again', 409);
  await logActivity(actor, { taskId: task.id, projectId: task.project_id, kind: action, message, data });
  return findTask(actor.workspace.id, task.id);
}

export async function addComment(actor: Actor, ref: string, body: string) {
  if (!canWrite(actor)) throw new RuleError('forbidden', 'Viewers have read-only access (P1)', 403);
  const task = await findTask(actor.workspace.id, ref);
  const text = String(body ?? '').trim();
  if (!text) throw new RuleError('invalid', 'Comment cannot be empty');
  await logActivity(actor, { taskId: task.id, projectId: task.project_id, kind: 'comment', message: text.slice(0, 5000) });
  return { ok: true };
}

export async function logProgress(actor: Actor, ref: string, body: string) {
  const task = await findTask(actor.workspace.id, ref);
  if (task.assignee_id !== actor.member.id) throw new RuleError('forbidden', 'Only the assignee (or their agent) posts progress (W4)', 403);
  if (!['in_progress', 'blocked'].includes(task.status)) {
    throw new RuleError('invalid_state', `Progress can only be logged on tasks in progress (this one is ${STATUS_LABELS[task.status as Status]}). Start it first.`, 409);
  }
  const text = String(body ?? '').trim();
  if (!text) throw new RuleError('invalid', 'Progress message cannot be empty');
  await q('UPDATE tasks SET last_heartbeat_at = now(), updated_at = now() WHERE id = $1', [task.id]);
  await logActivity(actor, { taskId: task.id, projectId: task.project_id, kind: 'progress', message: text.slice(0, 5000) });
  return { ok: true };
}

/** Everything an agent (or a person) needs to pick the task up cold. */
export async function contextPack(actor: Actor, ref: string) {
  const task = await findTask(actor.workspace.id, ref);
  const project = await one('SELECT key, name, agent_instructions, wip_limit FROM projects WHERE id = $1', [task.project_id]);
  const deps = task.depends_on.length
    ? (await q(`${TASK_SELECT} WHERE t.workspace_id = $2 AND t.id = ANY($1)`, [task.depends_on, actor.workspace.id])).map(formatTask)
        .map((d) => ({ key: d.key, title: d.title, status: d.status, submission_summary: d.submission?.summary ?? null }))
    : [];
  const dependents = (await q(`${TASK_SELECT} WHERE t.workspace_id = $2 AND t.depends_on @> $1::jsonb`, [json([task.id]), actor.workspace.id])).map(formatTask)
    .map((d) => ({ key: d.key, title: d.title, status: d.status }));
  const activity = await listActivity(actor.workspace.id, { taskId: task.id, limit: 30 });
  return {
    task,
    project,
    dependencies: deps,
    dependents,
    activity,
    allowed_actions: allowedActions(task as Task, actor),
    definition_of_ready_gaps: task.status === 'backlog' ? definitionOfReady(task) : [],
    your_role: [
      task.assignee_id === actor.member.id && 'assignee',
      task.reviewer_id === actor.member.id && 'reviewer',
      task.reporter_id === actor.member.id && 'reporter',
    ].filter(Boolean),
  };
}

/** Offboarding (P4): return a suspended member's unfinished work to the backlog. */
export async function releaseMemberWork(actor: Actor, memberId: string) {
  const assigned = await q(
    `UPDATE tasks SET status = 'backlog', assignee_id = NULL, claimed_by_agent_id = NULL, blocked_reason = NULL, handoff = NULL,
            last_heartbeat_at = NULL, version = version + 1, updated_at = now()
      WHERE workspace_id = $2 AND assignee_id = $1 AND status IN ('backlog','ready','in_progress','blocked','in_review') RETURNING id, project_id`,
    [memberId, actor.workspace.id],
  );
  const reviewing = await q(
    `UPDATE tasks SET reviewer_id = NULL,
            status = CASE WHEN status = 'ready' THEN 'backlog' ELSE status END,
            version = version + 1, updated_at = now()
      WHERE workspace_id = $2 AND reviewer_id = $1 AND status IN ('backlog','ready','in_progress','blocked','in_review') RETURNING id, project_id`,
    [memberId, actor.workspace.id],
  );
  for (const t of assigned) await logActivity(actor, { taskId: t.id, projectId: t.project_id, kind: 'offboarded', message: 'assignee was suspended — task returned to backlog unassigned (P4)' });
  for (const t of reviewing) await logActivity(actor, { taskId: t.id, projectId: t.project_id, kind: 'offboarded', message: 'reviewer was suspended — a new reviewer is needed (P4)' });
  return { unassigned: assigned.length, reviewer_cleared: reviewing.length };
}

// ---------- Agent capacity & handoffs (H1–H6) ----------

async function assertWip(memberId: string, memberName: string | null, projectId: string) {
  const project = await one('SELECT wip_limit FROM projects WHERE id = $1', [projectId]);
  const wip = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM tasks WHERE assignee_id = $1 AND project_id = $2 AND status = 'in_progress'`,
    [memberId, projectId],
  );
  if (wip!.n >= project.wip_limit) {
    throw new RuleError('wip_limit', `WIP limit reached: ${memberName ?? 'this person'} already has ${wip!.n} task(s) in progress in this project (limit ${project.wip_limit}). Finish or release one first (W3)`, 409);
  }
}

async function agentUsage(agentId: string) {
  const row = await one('SELECT usage_remaining, usage_reported_at, usage_resets_at FROM agent_tokens WHERE id = $1', [agentId]);
  return row ? effectiveUsage(row.usage_remaining, row.usage_reported_at, row.usage_resets_at) : null;
}

/** Agents need a fresh usage report at or above `min` percent (humans are exempt). */
async function assertAgentHasCapacity(actor: Actor, min: number, requireReport = false) {
  if (actor.kind !== 'agent') return;
  const usage = await agentUsage(actor.agent!.id);
  if (usage === null) {
    if (requireReport) throw new RuleError('usage_unknown', 'Report your remaining usage first with report_usage, so the team knows you can finish this (H1/H4)', 409);
    return;
  }
  if (usage < min) {
    throw new RuleError('low_capacity', `You reported ${usage}% usage remaining; at least ${min}% is needed for this. Hand off unfinished work instead (H2/H4)`, 409);
  }
}

/** Energy is shown in steps of 5% (73 → 75, 68 → 70): precise enough to plan with, without false precision. */
export const roundToFive = (n: number) => Math.min(100, Math.max(0, Math.round(n / 5) * 5));

export async function reportUsage(actor: Actor, input: { remaining_percent?: unknown; used_percent?: unknown; resets_at?: unknown; note?: unknown }) {
  if (actor.kind !== 'agent') throw new RuleError('forbidden', 'Only agents report usage', 403);
  // Claude Code's /usage prints "N% used", so accept that directly as well as "remaining".
  const raw = input.used_percent !== undefined && input.used_percent !== null && input.used_percent !== ''
    ? 100 - Number(input.used_percent)
    : Number(input.remaining_percent);
  if (!Number.isFinite(raw) || raw < 0 || raw > 100) throw new RuleError('invalid', 'Send remaining_percent (0–100) or used_percent (0–100)');
  const pct = roundToFive(raw);
  let resets: Date | null = null;
  if (input.resets_at) {
    resets = new Date(String(input.resets_at));
    if (isNaN(resets.getTime())) throw new RuleError('invalid', 'resets_at must be an ISO date-time, e.g. 2026-10-20T18:00:00Z');
  }
  const note = input.note ? String(input.note).trim().slice(0, 300) : null;
  const prev = await agentUsage(actor.agent!.id);
  await q('UPDATE agent_tokens SET usage_remaining = $2, usage_resets_at = $3, usage_note = $4, usage_reported_at = now() WHERE id = $1', [
    actor.agent!.id, pct, resets, note,
  ]);
  // Only log meaningful changes so the feed isn't flooded with heartbeats.
  const crossed = (t: number) => (prev === null || prev >= t) && pct < t;
  if (prev === null || crossed(LIMITS.usageMinToTakeOver) || crossed(LIMITS.usageExhausted) || (prev < LIMITS.usageMinToTakeOver && pct >= LIMITS.usageMinToTakeOver)) {
    await logActivity(actor, { kind: 'usage', message: `reported ${pct}% usage remaining${resets ? `, resets ${resets.toISOString().slice(0, 16).replace('T', ' ')}Z` : ''}${note ? ` — ${note}` : ''}` });
  }
  const advice = pct < LIMITS.usageExhausted
    ? 'You are nearly out. Hand off any unfinished task now with handoff_task so a teammate\'s agent can continue.'
    : pct < LIMITS.usageMinToTakeOver
      ? 'Capacity is getting low: finish your current task if you can, but do not take over anyone else\'s work. Hand off if you will not finish.'
      : 'You have capacity. If you have nothing assigned, use find_work to pick up handoffs from teammates.';
  return { remaining_percent: pct, advice };
}

export async function requestHandoff(actor: Actor, ref: string, input: { notes?: unknown; reason?: unknown }) {
  const task = await findTask(actor.workspace.id, ref);
  if (!canWrite(actor)) throw new RuleError('forbidden', 'Viewers have read-only access (P1)', 403);
  if (!['in_progress', 'blocked'].includes(task.status)) throw new RuleError('invalid_state', 'Only tasks in progress or blocked can be handed off', 409);
  const isAssignee = task.assignee_id === actor.member.id;
  if (!isAssignee && !(actor.kind === 'human' && ['owner', 'admin'].includes(actor.member.role))) {
    throw new RuleError('forbidden', 'Only the assignee (or their agent) or an admin can hand off a task (H3)', 403);
  }
  const notes = String(input.notes ?? '').trim();
  if (notes.length < LIMITS.minHandoffNotes) {
    throw new RuleError('handoff_notes', `Handoff notes must be at least ${LIMITS.minHandoffNotes} characters: what is done, what is left, where the work lives (H3)`, 422, [
      'Done so far (which criteria are met)', 'What is left', 'Where the work lives: branch / PR / files', 'Gotchas the next agent should know',
    ]);
  }
  const handoff = {
    requested_at: new Date().toISOString(), from_member: actor.member.name, from_member_id: actor.member.id,
    from_agent: actor.agent?.name ?? null, reason: String(input.reason ?? 'usage limit reached').trim().slice(0, 300), notes: notes.slice(0, 5000),
  };
  const updated = await one(
    `UPDATE tasks SET handoff = $3::jsonb, claimed_by_agent_id = NULL, version = version + 1, updated_at = now()
      WHERE id = $1 AND version = $2 RETURNING id`,
    [task.id, task.version, json(handoff)],
  );
  if (!updated) throw new RuleError('conflict', 'Task was changed by someone else — refresh and try again', 409);
  await logActivity(actor, { taskId: task.id, projectId: task.project_id, kind: 'handoff', message: `requested a handoff (${handoff.reason}): ${notes}`, data: handoff });
  return findTask(actor.workspace.id, task.id);
}

export async function takeOver(actor: Actor, ref: string) {
  const task = await findTask(actor.workspace.id, ref);
  if (!canWrite(actor)) throw new RuleError('forbidden', 'Viewers have read-only access (P1)', 403);
  if (!task.handoff_open) {
    throw new RuleError('not_handed_off', `${task.key} is not open for takeover. Only explicit handoffs, or tasks whose exhausted agent went silent, can be taken over (H4/H5)`, 409);
  }
  if (task.reviewer_id === actor.member.id) throw new RuleError('forbidden', 'You are the reviewer of this task, so you cannot also do the work (V1/H4)', 403);
  const sameMember = task.assignee_id === actor.member.id;
  await assertAgentHasCapacity(actor, sameMember ? LIMITS.usageExhausted : LIMITS.usageMinToTakeOver, !sameMember);
  if (!sameMember) {
    const m = await one('SELECT role, status FROM memberships WHERE workspace_id = $1 AND user_id = $2', [actor.workspace.id, actor.member.id]);
    if (!m || m.role === 'viewer' || m.status !== 'active') throw new RuleError('forbidden', 'Only active members can take over work', 403);
    await assertWip(actor.member.id, actor.member.name, task.project_id);
  }
  const contributors = [...(task.contributors ?? [])];
  if (!sameMember && task.assignee_name && !contributors.includes(task.assignee_name)) contributors.push(task.assignee_name);
  const updated = await one(
    `UPDATE tasks SET assignee_id = $3, claimed_by_agent_id = $4, handoff = NULL, contributors = $5::jsonb,
            status = 'in_progress', blocked_reason = NULL, last_heartbeat_at = now(), version = version + 1, updated_at = now()
      WHERE id = $1 AND version = $2 RETURNING id`,
    [task.id, task.version, actor.member.id, actor.agent?.id ?? null, json(contributors)],
  );
  if (!updated) throw new RuleError('conflict', 'Someone else just took this task — pick another', 409);
  const from = task.handoff?.from_agent ?? task.claimed_by_agent_name;
  await logActivity(actor, {
    taskId: task.id, projectId: task.project_id, kind: 'takeover',
    message: sameMember ? `took the task back${actor.agent ? ` with agent "${actor.agent.name}"` : ''}`
      : `took over from ${task.assignee_name ?? 'previous assignee'}${from ? ` (agent "${from}")` : ''}${actor.agent ? ` with agent "${actor.agent.name}"` : ''} — now assignee`,
  });
  return findTask(actor.workspace.id, task.id);
}

/** Open handoffs this actor is allowed to take over. */
export async function listHandoffs(actor: Actor) {
  const rows = await q(`${TASK_SELECT} WHERE t.workspace_id = $1 AND t.status IN ('in_progress','blocked') ORDER BY t.updated_at`, [actor.workspace.id]);
  return rows.map(formatTask).filter((t) => t.handoff_open && t.reviewer_id !== actor.member.id);
}

export async function teamCapacity(ws: string) {
  const rows = await q(`
    SELECT t.id, t.name, t.usage_remaining, t.usage_resets_at, t.usage_reported_at, t.usage_note, t.last_used_at,
           u.id AS member_id, u.name AS member_name,
           (SELECT json_agg(p.key || '-' || x.number) FROM tasks x JOIN projects p ON p.id = x.project_id
             WHERE x.claimed_by_agent_id = t.id AND x.status IN ('in_progress','blocked')) AS working_on
      FROM agent_tokens t
      JOIN users u ON u.id = t.member_id
      JOIN memberships m ON m.user_id = t.member_id AND m.workspace_id = t.workspace_id
     WHERE t.workspace_id = $1 AND t.revoked_at IS NULL AND m.status = 'active'
     ORDER BY u.name, t.name`, [ws]);
  return rows.map((r) => {
    const usage = effectiveUsage(r.usage_remaining, r.usage_reported_at, r.usage_resets_at);
    return {
      ...r,
      usage_remaining: usage,
      working_on: r.working_on ?? [],
      state: usage === null ? 'unknown' : usage < LIMITS.usageExhausted ? 'exhausted' : usage < LIMITS.usageMinToTakeOver ? 'low' : 'available',
    };
  });
}
