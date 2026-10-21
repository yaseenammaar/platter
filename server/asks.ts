// Check-ins (Q1–Q4): "hey agent, ask <teammate> for an update on <task>".
import { randomUUID } from 'node:crypto';
import { one, q } from './db.ts';
import { LIMITS, RuleError, canWrite, type Actor } from './rules.ts';
import { findTask, logActivity } from './tasks.ts';

const STOP = new Set(('the a an and or but if then than that this those these with without from into onto about for of to in on at by is are was were be been ' +
  'has have had did does do done not yet ask asked check whether she he they her his their them you your our we me my it its any some please can could would ' +
  'should will just still already list listed update status hey tell know').split(' '));

/** Find a teammate (in this team only) from a name, first name or email the agent was given. */
export async function resolvePerson(ws: string, ref: string) {
  const r = String(ref ?? '').trim().toLowerCase();
  if (!r) throw new RuleError('invalid', 'Say who to ask (name or email)');
  const all = await q(
    `SELECT u.id, u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = $1 AND m.status = 'active'`,
    [ws],
  );
  const exact = all.filter((m) => m.email.toLowerCase() === r || m.name.toLowerCase() === r);
  const loose = exact.length ? exact : all.filter((m) => m.name.toLowerCase().split(/\s+/).includes(r) || m.name.toLowerCase().startsWith(r) || m.email.toLowerCase().startsWith(r + '@'));
  if (loose.length === 1) return loose[0];
  if (!loose.length) throw new RuleError('not_found', `Nobody called "${ref}" on the team`, 404, all.map((m) => `${m.name} <${m.email}>`));
  throw new RuleError('ambiguous', `More than one person matches "${ref}" — use their full name or email`, 409, loose.map((m) => `${m.name} <${m.email}>`));
}

/** What the board already knows that might answer the question (Q3). */
async function boardHints(ws: string, toMemberId: string, question: string, taskId: string | null) {
  const words = [...new Set(question.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])].filter((w) => !STOP.has(w)).slice(0, 8);
  let tasks: any[] = [];
  if (taskId) tasks = [await findTask(ws, taskId)];
  else if (words.length) {
    const conds = words.map((_, i) => `(t.title ILIKE $${i + 2} OR t.description ILIKE $${i + 2} OR t.context ILIKE $${i + 2})`);
    const rows = await q(
      `SELECT t.id, (${conds.map((c) => `CASE WHEN ${c} THEN 1 ELSE 0 END`).join(' + ')}) AS score
         FROM tasks t WHERE t.workspace_id = $${words.length + 2}
          AND (t.assignee_id = $1 OR t.reviewer_id = $1 OR t.reporter_id = $1 OR t.contributors::text ILIKE '%' || (SELECT name FROM users WHERE id = $1) || '%')
          AND (${conds.join(' OR ')})
        ORDER BY score DESC, t.updated_at DESC LIMIT 3`,
      [toMemberId, ...words.map((w) => `%${w}%`), ws],
    );
    for (const r of rows) tasks.push(await findTask(ws, r.id));
  }
  const out = [];
  for (const t of tasks) {
    const last = await one(
      `SELECT e.message, e.created_at, e.kind, m.name AS member_name, ag.name AS agent_name FROM activity e
         LEFT JOIN users m ON m.id = e.member_id LEFT JOIN agent_tokens ag ON ag.id = e.agent_id
        WHERE e.task_id = $1 AND e.kind IN ('progress','submit','approve','reject','block','handoff','comment')
        ORDER BY e.id DESC LIMIT 1`,
      [t.id],
    );
    out.push({ key: t.key, title: t.title, status: t.status, assignee: t.assignee_name, last_update: last });
  }
  return out;
}

export async function askTeammate(actor: Actor, input: { to?: string; to_member_id?: string; question?: string; task?: string }) {
  if (!canWrite(actor)) throw new RuleError('forbidden', 'Viewers have read-only access (P1)', 403);
  const question = String(input.question ?? '').trim();
  if (question.length < 5) throw new RuleError('invalid', 'What do you want to ask?');
  const ws = actor.workspace.id;
  const to = input.to_member_id
    ? await one(
      `SELECT u.id, u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.status = 'active'`,
      [ws, input.to_member_id],
    )
    : await resolvePerson(ws, input.to ?? '');
  if (!to) throw new RuleError('not_found', 'That person is not on the team', 404);
  if (to.id === actor.member.id) throw new RuleError('invalid', 'That\'s you! Ask a teammate instead.');
  const task = input.task ? await findTask(ws, input.task) : null;
  const open = await one<{ n: number }>(`SELECT count(*)::int AS n FROM asks WHERE workspace_id = $2 AND to_member_id = $1 AND status = 'open'`, [to.id, ws]);
  if (open!.n >= LIMITS.maxOpenAsksPerPerson) {
    throw new RuleError('inbox_full', `${to.name} already has ${open!.n} unanswered questions. Wait for some answers first (Q4)`, 429);
  }
  const id = randomUUID();
  await q(
    `INSERT INTO asks (id, from_member_id, from_agent_id, to_member_id, task_id, question, workspace_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, actor.member.id, actor.agent?.id ?? null, to.id, task?.id ?? null, question.slice(0, 2000), ws],
  );
  await logActivity(actor, { taskId: task?.id, projectId: task?.project_id, kind: 'ask', message: `asked ${to.name}: ${question}`, data: { ask_id: id } });
  return { id, to: to.name, hints: await boardHints(ws, to.id, question, task?.id ?? null) };
}

const ASK_SELECT = `
  SELECT a.*, f.name AS from_name, fa.name AS from_agent_name, t.name AS to_name,
         ab.name AS answered_by_name, aa.name AS answered_by_agent_name,
         CASE WHEN k.id IS NULL THEN NULL ELSE p.key || '-' || k.number END AS task_key, k.title AS task_title
    FROM asks a
    JOIN users f ON f.id = a.from_member_id
    JOIN users t ON t.id = a.to_member_id
    LEFT JOIN agent_tokens fa ON fa.id = a.from_agent_id
    LEFT JOIN users ab ON ab.id = a.answered_by_member_id
    LEFT JOIN agent_tokens aa ON aa.id = a.answered_by_agent_id
    LEFT JOIN tasks k ON k.id = a.task_id
    LEFT JOIN projects p ON p.id = k.project_id`;

/** Questions waiting for me, and recent answers to my questions. */
export async function inbox(actor: Actor) {
  const ws = actor.workspace.id;
  const forMe = await q(`${ASK_SELECT} WHERE a.workspace_id = $2 AND a.to_member_id = $1 AND a.status = 'open' ORDER BY a.created_at`, [actor.member.id, ws]);
  const mine = await q(
    `${ASK_SELECT} WHERE a.workspace_id = $2 AND a.from_member_id = $1 AND (a.status = 'open' OR a.answered_at > now() - interval '7 days')
      ORDER BY coalesce(a.answered_at, a.created_at) DESC LIMIT 30`,
    [actor.member.id, ws],
  );
  return { for_me: forMe, my_questions: mine };
}

export async function unreadCount(actor: Actor) {
  const r = await one<{ n: number }>(
    `SELECT (SELECT count(*) FROM asks WHERE workspace_id = $2 AND to_member_id = $1 AND status = 'open')
          + (SELECT count(*) FROM asks WHERE workspace_id = $2 AND from_member_id = $1 AND status = 'answered' AND asker_seen_at IS NULL) AS n`,
    [actor.member.id, actor.workspace.id],
  );
  return Number(r!.n);
}

export async function markAnswersSeen(actor: Actor) {
  await q(`UPDATE asks SET asker_seen_at = now() WHERE workspace_id = $2 AND from_member_id = $1 AND status = 'answered' AND asker_seen_at IS NULL`, [actor.member.id, actor.workspace.id]);
}

export async function answerAsk(actor: Actor, id: string, answerText: string) {
  const ask = await one(`${ASK_SELECT} WHERE a.workspace_id = $2 AND a.id = $1`, [id, actor.workspace.id]);
  if (!ask) throw new RuleError('not_found', 'Question not found', 404);
  if (ask.to_member_id !== actor.member.id) throw new RuleError('forbidden', `This question is for ${ask.to_name}, not you (Q1)`, 403);
  if (ask.status !== 'open') throw new RuleError('invalid_state', 'This question was already answered', 409);
  const answer = String(answerText ?? '').trim();
  if (answer.length < 2) throw new RuleError('invalid', 'Write an answer');
  const done = await one(
    `UPDATE asks SET answer = $2, answered_by_member_id = $3, answered_by_agent_id = $4, status = 'answered', answered_at = now()
      WHERE id = $1 AND status = 'open' RETURNING id`,
    [id, answer.slice(0, 4000), actor.member.id, actor.agent?.id ?? null],
  );
  if (!done) throw new RuleError('conflict', 'Someone just answered this', 409);
  const task = ask.task_id ? await findTask(actor.workspace.id, ask.task_id) : null;
  await logActivity(actor, { taskId: task?.id, projectId: task?.project_id, kind: 'answer', message: `answered ${ask.from_name}: ${answer}`, data: { ask_id: id, question: ask.question } });
  return { ok: true };
}

export async function closeAsk(actor: Actor, id: string) {
  const ask = await one('SELECT * FROM asks WHERE workspace_id = $2 AND id = $1', [id, actor.workspace.id]);
  if (!ask) throw new RuleError('not_found', 'Question not found', 404);
  if (ask.from_member_id !== actor.member.id) throw new RuleError('forbidden', 'Only the person who asked can withdraw it', 403);
  await q(`UPDATE asks SET status = 'closed' WHERE id = $1`, [id]);
  return { ok: true };
}

