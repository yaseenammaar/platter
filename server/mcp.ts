// Stateless MCP server (Streamable HTTP transport, JSON responses).
// Agents connect with:  Authorization: Bearer plt_...
import type { Context } from 'hono';
import { recordAction } from './actionlog.ts';
import { answerAsk, askTeammate, inbox, markAnswersSeen } from './asks.ts';
import { resolveActor } from './auth.ts';
import { q } from './db.ts';
import { FOCUS_VIEWS, focusBrief, gate, isLocked, parkIdea } from './focus.ts';
import { LIMITS, RULEBOOK, RuleError, STATUS_LABELS, type Actor, type Status } from './rules.ts';
import {
  addComment, contextPack, createTask, listHandoffs, listTasks, logProgress, reportUsage, requestHandoff, takeOver,
  teamCapacity, transition, type TaskView,
} from './tasks.ts';

const SERVER_INFO = { name: 'platter', version: '0.1.0' };

const WORKFLOW = `You are connected to Platter, your team's task board. You act on behalf of the person who owns your token, inside one team, and they are accountable for what you do. (Call \`whoami\` to see which person and team.)

## Share your capacity (usage limits)
- Right after connecting, call \`report_usage\` with how much of your usage limit is left, and report again when you start a task and whenever you drop below ${LIMITS.usageMinToTakeOver}%.
- Get the real number, don't guess: in Claude Code run \`claude -p "/usage"\` in a shell. Each limit line reads like "Current session: 37% used · resets …". Take the line with the HIGHEST % used and send it as \`used_percent\` (plus \`resets_at\` from that line). Platter rounds to the nearest 5%. Other clients: report your best estimate as \`remaining_percent\`.
- Under ${LIMITS.usageExhausted}% you may not start or take over work. If you won't be able to finish your current task, call \`handoff_task\` BEFORE you run out, with notes on what's done, what's left, and where the work lives (branch/PR/files). A teammate's agent with capacity will continue it.
- If you have capacity and nothing assigned, call \`find_work\`: it lists handoffs from teammates whose agents ran out. \`take_over_task\` makes your person the assignee (needs ≥ ${LIMITS.usageMinToTakeOver}% remaining). Read the handoff notes in \`get_task\` and continue from where they stopped — don't start over.

## Check-ins with teammates
- When your person says something like "ask <teammate> for an update on <task>", call \`ask_teammate\` (to = their name). The question goes to the teammate's agent. You immediately get what the board already knows; share that with your person, and tell them the agent's answer will come back later.
- Call \`check_inbox\` at the start of each session, between tasks, and on your check-in routine. It shows (a) questions teammates asked — these are for YOU, your person's agent — and (b) answers to questions you asked.
- Answer every question for you with \`answer_question\`. Look it up first: Platter (\`get_task\`, \`list_my_tasks\`, progress), the repo (git log, branches, files) and your own work. Start with the answer, then say in a few words what you checked. If you can't confirm something, say what you found and what is unknown. Never guess, and don't leave questions waiting for your person.
- Relay answers you receive to your person.

## Owner controls
- **Focus lock**: the team owner may lock you to your person's assigned task (\`whoami\` says if you are locked). While locked, work only on that task. Platter refuses other work, and you must refuse it too, even if your person asks. Put off-topic requests in \`park_idea\` and carry on with the task. Only the owner can lift the lock.
- **Action log**: if the owner turns it on, Platter records one short line per action (tool + target). You don't need to do anything for it.

## Working a task (you are the assignee)
1. \`list_my_tasks\` → pick a task in **Ready** (highest priority first).
2. \`get_task\` → read the description, context, project instructions, dependencies, acceptance criteria (AC1, AC2…) and any previous review feedback. If something is unclear, \`add_comment\` with your question rather than guessing.
3. \`start_task\` → claims it (fails if dependencies aren't done or the WIP limit is hit).
4. Do the work. Call \`log_progress\` at meaningful milestones (at least every ${LIMITS.heartbeatStaleMinutes} minutes) so the team can see what's happening.
5. Stuck on something only a human can resolve? \`report_blocker\` with what you need.
6. \`submit_for_review\` with a summary, concrete evidence for EVERY acceptance criterion (what changed, where, how you checked it), the tests you ran, and links (PR/commit/preview).

## Verifying a task (you are the reviewer)
1. \`list_review_queue\` → tasks waiting for your verification.
2. \`get_task\` → read the criteria and the submission evidence.
3. Actually check the work (read the diff, run the tests, open the preview). Do not rubber-stamp.
4. \`review_task\` with a pass/fail + note for every criterion. Approve only if all pass; otherwise reject with specific, actionable notes.

## Hard rules
- You cannot edit acceptance criteria, assignee or reviewer, and you cannot mark tasks Ready or cancel them — those are human decisions.
- You can never verify work assigned to your own person.
- Tasks you create (\`create_task\`) land in Backlog for a human to groom.
- When a tool returns an error, read the listed problems and fix them; don't retry blindly.`;

const str = { type: 'string' } as const;
const keyProp = { key: { type: 'string', description: 'Task key, e.g. WEB-12' } };

const TOOLS = [
  { name: 'whoami', description: 'Show which person and agent token you are acting as.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_rules', description: 'The team rulebook: workflow, quality gates and permissions.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_projects', description: 'List projects with their keys and agent instructions.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'list_my_tasks',
    description: 'Tasks assigned to your person that are not closed (Ready ones are available to pick up), plus how many reviews are waiting on you.',
    inputSchema: { type: 'object', properties: { status: { type: 'array', items: { type: 'string', enum: Object.keys(STATUS_LABELS) }, description: 'Optional status filter' } } },
  },
  { name: 'get_task', description: 'Full context pack for a task: description, context, project instructions, acceptance criteria, dependencies, submission, review feedback, recent activity and which actions you may take.', inputSchema: { type: 'object', properties: keyProp, required: ['key'] } },
  { name: 'start_task', description: 'Claim a Ready task assigned to your person and move it to In Progress.', inputSchema: { type: 'object', properties: keyProp, required: ['key'] } },
  { name: 'log_progress', description: 'Post a progress update on a task you are working on (also acts as a heartbeat).', inputSchema: { type: 'object', properties: { ...keyProp, message: str }, required: ['key', 'message'] } },
  { name: 'report_blocker', description: 'Mark your in-progress task Blocked and say what is needed to unblock it.', inputSchema: { type: 'object', properties: { ...keyProp, reason: str }, required: ['key', 'reason'] } },
  { name: 'resume_task', description: 'Move a Blocked task back to In Progress once unblocked.', inputSchema: { type: 'object', properties: keyProp, required: ['key'] } },
  { name: 'release_task', description: 'Give up a task you started and return it to Ready (e.g. wrong person, cannot complete).', inputSchema: { type: 'object', properties: { ...keyProp, reason: str }, required: ['key', 'reason'] } },
  {
    name: 'submit_for_review',
    description: 'Submit finished work for verification. Evidence is required for every acceptance criterion.',
    inputSchema: {
      type: 'object',
      properties: {
        ...keyProp,
        summary: { type: 'string', description: `What was done and why (≥ ${LIMITS.minSummary} chars)` },
        criteria: {
          type: 'array',
          description: 'One entry per acceptance criterion',
          items: { type: 'object', properties: { id: { type: 'string', description: 'e.g. AC1' }, evidence: { type: 'string', description: `What changed, where, and how it was checked (≥ ${LIMITS.minEvidence} chars)` } }, required: ['id', 'evidence'] },
        },
        tests: { type: 'string', description: 'Tests/checks run and their results' },
        artifacts: { type: 'array', items: str, description: 'Links: PR, commit, preview URL, docs' },
      },
      required: ['key', 'summary', 'criteria'],
    },
  },
  { name: 'list_review_queue', description: 'Tasks In Review where your person is the reviewer.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'review_task',
    description: 'Verify a submission. Give pass/fail for every acceptance criterion. Approve moves it to Done; reject sends it back with your notes.',
    inputSchema: {
      type: 'object',
      properties: {
        ...keyProp,
        verdict: { type: 'string', enum: ['approve', 'reject'] },
        summary: { type: 'string', description: 'Overall verdict and what you checked' },
        criteria: {
          type: 'array',
          items: { type: 'object', properties: { id: str, passed: { type: 'boolean' }, note: { type: 'string', description: 'Required for failures: what is wrong and what to do' } }, required: ['id', 'passed'] },
        },
      },
      required: ['key', 'verdict', 'criteria'],
    },
  },
  {
    name: 'report_usage',
    description: 'Tell the team how much of your usage limit is left (rounded to the nearest 5%). In Claude Code, read the exact figure from `claude -p "/usage"` and send the tightest limit as used_percent. Call on connect, when starting a task, and when you drop below 25%.',
    inputSchema: {
      type: 'object',
      properties: {
        used_percent: { type: 'number', minimum: 0, maximum: 100, description: 'Exact % used, from /usage (the highest of the limits shown). Preferred.' },
        remaining_percent: { type: 'number', minimum: 0, maximum: 100, description: '% of your usage limit left, if you only have that' },
        resets_at: { type: 'string', description: 'ISO date-time when your limit resets, if known' },
        note: { type: 'string', description: 'Optional, e.g. "5-hour window", "weekly cap"' },
      },
      required: [],
    },
  },
  {
    name: 'handoff_task',
    description: 'Running out of usage (or otherwise can\'t finish)? Hand your in-progress task to a teammate\'s agent with notes on what is done, what is left and where the work lives.',
    inputSchema: {
      type: 'object',
      properties: {
        ...keyProp,
        notes: { type: 'string', description: 'Done so far (which criteria), what is left, branch/PR/files, gotchas' },
        reason: { type: 'string', description: 'e.g. "usage limit reached, resets 18:00Z"' },
      },
      required: ['key', 'notes'],
    },
  },
  { name: 'find_work', description: 'What to work on next: your Ready tasks, plus open handoffs from teammates you are allowed to take over, plus the team capacity board.', inputSchema: { type: 'object', properties: {} } },
  { name: 'take_over_task', description: 'Take over an open handoff. Your person becomes the assignee; continue from the handoff notes.', inputSchema: { type: 'object', properties: keyProp, required: ['key'] } },
  { name: 'team_capacity', description: 'Every teammate\'s agent with its reported usage remaining and what it is working on.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'ask_teammate',
    description: 'Ask a teammate\'s agent for an update, e.g. "did you list the apps in the directory for backlinks?". Returns what the board already knows right away; their agent\'s answer arrives later via check_inbox.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Teammate name, first name or email' },
        question: str,
        task: { type: 'string', description: 'Optional task key the question is about' },
      },
      required: ['to', 'question'],
    },
  },
  { name: 'check_inbox', description: 'Questions teammates asked (they are for you, your person\'s agent — answer each one), plus answers to questions you asked.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'answer_question',
    description: 'Answer a teammate\'s question. Look it up first (Platter, the repo, your own work); lead with the answer, then say briefly what you checked. If you can\'t confirm something, say what you found and what is unknown. Never guess.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Question id from check_inbox' }, answer: str }, required: ['id', 'answer'] },
  },
  {
    name: 'park_idea',
    description: 'Under a focus lock: save an off-topic request or idea on your focus task instead of acting on it. Use it whenever you are asked for work outside the task.',
    inputSchema: { type: 'object', properties: { idea: { type: 'string', description: 'One line: what was asked or thought of' } }, required: ['idea'] },
  },
  { name: 'add_comment', description: 'Comment on a task (questions, notes, findings).', inputSchema: { type: 'object', properties: { ...keyProp, body: str }, required: ['key', 'body'] } },
  {
    name: 'create_task',
    description: 'Propose a new task (follow-up, bug you found, split-out work). It lands in Backlog for a human to groom and assign.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project key' },
        title: str, description: str,
        context: { type: 'string', description: 'Relevant files, links, background' },
        acceptance_criteria: { type: 'array', items: str },
        type: { type: 'string', enum: ['feature', 'bug', 'chore', 'research'] },
        priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
        labels: { type: 'array', items: str },
        depends_on: { type: 'array', items: str, description: 'Task keys this depends on' },
      },
      required: ['project', 'title', 'description'],
    },
  },
];

const fmtTime = (d: any) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) + 'Z' : '—');
const line = (t: TaskView) =>
  `- **${t.key}** [${STATUS_LABELS[t.status as Status]}] ${t.priority} ${t.type} — ${t.title}` +
  `${t.assignee_name ? ` · assignee: ${t.assignee_name}` : ''}${t.reviewer_name ? ` · reviewer: ${t.reviewer_name}` : ''}` +
  `${t.handoff_open ? ' 🔁 handoff open' : ''}${t.needs_attention ? ' ⚠ needs attention' : ''}${t.stale ? ' ⏱ stale' : ''}`;

async function renderCapacity(ws: string) {
  const rows = await teamCapacity(ws);
  if (!rows.length) return '_No agents connected._';
  return rows.map((r) => `- ${r.member_name} / "${r.name}": ${r.usage_remaining === null ? 'unknown (no fresh report)' : `${r.usage_remaining}% left`} [${r.state}]` +
    `${r.usage_resets_at && r.usage_remaining !== null ? `, resets ${fmtTime(r.usage_resets_at)}` : ''}${r.working_on.length ? ` — working on ${r.working_on.join(', ')}` : ''}`).join('\n');
}

function renderPack(p: Awaited<ReturnType<typeof contextPack>>) {
  const t = p.task;
  const out: string[] = [];
  out.push(`# ${t.key}: ${t.title}`);
  out.push(`Status: **${STATUS_LABELS[t.status as Status]}** · ${t.priority} · ${t.type}${t.labels.length ? ' · labels: ' + t.labels.join(', ') : ''}${t.due_date ? ' · due ' + String(t.due_date).slice(0, 10) : ''}`);
  out.push(`Assignee: ${t.assignee_name ?? '—'} · Reviewer: ${t.reviewer_name ?? '—'} · Reporter: ${t.reporter_name}${t.rework_count ? ` · Rework rounds: ${t.rework_count}` : ''}`);
  out.push(`Your role: ${p.your_role.join(', ') || 'none'} · Actions you can take now: ${p.allowed_actions.join(', ') || 'none'}`);
  if (t.blocked_reason) out.push(`\n> **Blocked:** ${t.blocked_reason}`);
  if (t.contributors?.length) out.push(`Previous contributors: ${t.contributors.join(', ')}`);
  if (t.handoff_open) {
    out.push(t.handoff
      ? `\n## 🔁 Handoff open — from ${t.handoff.from_member}${t.handoff.from_agent ? ` (agent ${t.handoff.from_agent})` : ''}, ${fmtTime(t.handoff.requested_at)}\nReason: ${t.handoff.reason}\n\n${t.handoff.notes}\n\nContinue from here — use \`take_over_task\` first.`
      : `\n## 🔁 Open for takeover\nAgent "${t.claimed_by_agent_name}" reported ${t.claimed_agent_usage}% usage left and has been silent since ${fmtTime(t.last_heartbeat_at)} (H5). Check recent progress below, then \`take_over_task\`.`);
  } else if (t.handoff === null && t.contributors?.length && t.status === 'in_progress') {
    const last = p.activity.find((x: any) => x.kind === 'handoff');
    if (last) out.push(`\n## Notes from the previous agent\n${last.data?.notes ?? last.message}`);
  }
  out.push(`\n## Description\n${t.description || '_none_'}`);
  if (t.context) out.push(`\n## Context\n${t.context}`);
  out.push(`\n## Acceptance criteria\n${t.acceptance_criteria.map((c: any) => `- **${c.id}**: ${c.text}`).join('\n') || '_none_'}`);
  if (p.project?.agent_instructions) out.push(`\n## Project ${p.project.key} instructions\n${p.project.agent_instructions}`);
  if (p.dependencies.length) out.push(`\n## Depends on\n${p.dependencies.map((d) => `- ${d.key} [${STATUS_LABELS[d.status as Status]}] ${d.title}${d.submission_summary ? `\n  Outcome: ${d.submission_summary}` : ''}`).join('\n')}`);
  if (p.dependents.length) out.push(`\n## Blocks\n${p.dependents.map((d) => `- ${d.key} [${STATUS_LABELS[d.status as Status]}] ${d.title}`).join('\n')}`);
  if (t.review && t.review.verdict === 'reject' && t.status !== 'done') {
    out.push(`\n## ⚠ Review feedback from ${t.review.reviewed_by}${t.review.agent ? ` (agent ${t.review.agent})` : ''} — fix these before resubmitting`);
    if (t.review.summary) out.push(t.review.summary);
    out.push(t.review.criteria.map((c: any) => `- ${c.id}: ${c.passed ? '✅ passed' : '❌ FAILED'}${c.note ? ' — ' + c.note : ''}`).join('\n'));
  }
  if (t.submission) {
    const s = t.submission;
    out.push(`\n## Submission (attempt #${s.attempt}, ${fmtTime(s.submitted_at)} by ${s.submitted_by}${s.agent ? ` via ${s.agent}` : ''})\n${s.summary}`);
    out.push(s.criteria.map((c: any) => `- **${c.id}** evidence: ${c.evidence}`).join('\n'));
    if (s.tests) out.push(`Tests: ${s.tests}`);
    if (s.artifacts?.length) out.push(`Artifacts: ${s.artifacts.join(', ')}`);
  }
  if (t.review && t.review.verdict === 'approve') out.push(`\n## Approved by ${t.review.reviewed_by} ${fmtTime(t.review.reviewed_at)}\n${t.review.summary}`);
  if (p.definition_of_ready_gaps.length) out.push(`\n## Not ready yet\n${p.definition_of_ready_gaps.map((g) => `- ${g}`).join('\n')}`);
  const acts = p.activity.filter((a: any) => ['comment', 'progress', 'block', 'reject', 'edited'].includes(a.kind)).slice(0, 15).reverse();
  if (acts.length) {
    out.push(`\n## Recent discussion & progress`);
    out.push(acts.map((a: any) => `- ${fmtTime(a.created_at)} ${a.member_name ?? 'system'}${a.agent_name ? ` (agent ${a.agent_name})` : ''} [${a.kind}]: ${a.message}`).join('\n'));
  }
  return out.join('\n');
}

function renderFocus(actor: Actor, focus: TaskView | null) {
  const head = `# 🔒 Focus lock (set by ${actor.policy?.focusBy ?? 'the team owner'})`;
  if (!focus) return `${head}\nNothing is assigned to ${actor.member.name} right now, so there is nothing you may work on. Do no other work; park ideas with \`park_idea\`.`;
  const next = focus.status === 'ready' ? '`start_task` it, then work only on it.' : '`get_task` for the details and keep going.';
  return `${head}\nYour one task:\n${line(focus)}\n\n${next} Everything else waits until the owner lifts the lock. Park other ideas with \`park_idea\`.`;
}

async function callTool(actor: Actor, name: string, a: any): Promise<string> {
  const focus = await gate(actor, name, a);
  if (isLocked(actor) && FOCUS_VIEWS.has(name)) return renderFocus(actor, focus);
  switch (name) {
    case 'whoami':
      return `Acting as **${actor.member.name}** (${actor.member.email}, role ${actor.member.role}) in team **${actor.workspace.name}** via agent token "${actor.agent?.name}". Everything you see and do is limited to this team.` +
        (isLocked(actor) ? `\n\n🔒 Focus lock is ON (set by ${actor.policy?.focusBy ?? 'the team owner'}): work only on ${focus ? `${focus.key} "${focus.title}"` : 'your assigned task (none right now)'}.` : '') +
        (actor.policy?.log ? '\n\n📝 The owner turned on the action log: each action you take is recorded as one line (tool + target).' : '');
    case 'park_idea': {
      const t = await parkIdea(actor, a.idea);
      return `Parked${t ? ` on ${t.key}` : ''}. The team can see it, and it waits until the work is done.${t ? ` Back to ${t.key}.` : ''}`;
    }
    case 'get_rules':
      return RULEBOOK.map((s) => `## ${s.section}\n${s.rules.map((r) => `- **${r.id}** ${r.text}`).join('\n')}`).join('\n\n');
    case 'list_projects': {
      const rows = await q('SELECT key, name, agent_instructions, wip_limit FROM projects WHERE workspace_id = $1 AND NOT archived ORDER BY created_at', [actor.workspace.id]);
      return rows.map((p) => `## ${p.key} — ${p.name} (WIP limit ${p.wip_limit})\n${p.agent_instructions || '_no agent instructions_'}`).join('\n\n');
    }
    case 'list_my_tasks': {
      const status = Array.isArray(a.status) && a.status.length ? a.status.join(',') : 'ready,in_progress,blocked,in_review,backlog';
      const tasks = await listTasks(actor.workspace.id, { assignee: actor.member.id, status });
      const reviews = await listTasks(actor.workspace.id, { reviewer: actor.member.id, status: 'in_review' });
      const body = tasks.length ? tasks.map(line).join('\n') : '_No tasks assigned._';
      return `# Tasks assigned to ${actor.member.name}\n${body}\n\n${reviews.length} task(s) waiting for your review — see \`list_review_queue\`.`;
    }
    case 'list_review_queue': {
      const reviews = await listTasks(actor.workspace.id, { reviewer: actor.member.id, status: 'in_review' });
      return reviews.length ? `# Waiting for ${actor.member.name}'s verification\n${reviews.map(line).join('\n')}` : '_Nothing to review._';
    }
    case 'get_task':
      return renderPack(await contextPack(actor, a.key));
    case 'start_task': {
      const t = await transition(actor, a.key, 'start');
      return `${t.key} is now In Progress and claimed by you.\n\n` + renderPack(await contextPack(actor, a.key));
    }
    case 'log_progress':
      await logProgress(actor, a.key, a.message);
      return 'Progress logged.';
    case 'report_blocker': {
      const t = await transition(actor, a.key, 'block', { reason: a.reason });
      return `${t.key} marked Blocked. The team can see your reason. Use resume_task once unblocked.`;
    }
    case 'resume_task': {
      const t = await transition(actor, a.key, 'resume');
      return `${t.key} is back In Progress.`;
    }
    case 'release_task': {
      const t = await transition(actor, a.key, 'release', { reason: a.reason });
      return `${t.key} released back to Ready.`;
    }
    case 'submit_for_review': {
      const t = await transition(actor, a.key, 'submit', a);
      return `${t.key} submitted for review (attempt #${t.submission.attempt}). Reviewer: ${t.reviewer_name}.`;
    }
    case 'review_task': {
      if (a.verdict !== 'approve' && a.verdict !== 'reject') throw new RuleError('invalid', 'verdict must be "approve" or "reject"');
      const t = await transition(actor, a.key, a.verdict, a);
      return a.verdict === 'approve' ? `${t.key} approved and moved to Done.` : `${t.key} sent back to In Progress with your feedback (rework round ${t.rework_count}).`;
    }
    case 'report_usage': {
      const r = await reportUsage(actor, a);
      return `Recorded ${r.remaining_percent}% remaining. ${r.advice}`;
    }
    case 'handoff_task': {
      const t = await requestHandoff(actor, a.key, a);
      return `${t.key} is now open for handoff. Teammates' agents with capacity can take it over; your person (or another of their agents) can also take it back. Stop working on it now.`;
    }
    case 'find_work': {
      const mine = await listTasks(actor.workspace.id, { assignee: actor.member.id, status: 'ready,in_progress' });
      const handoffs = await listHandoffs(actor);
      const reviews = await listTasks(actor.workspace.id, { reviewer: actor.member.id, status: 'in_review' });
      return [
        `# Your work\n${mine.length ? mine.map(line).join('\n') : '_Nothing assigned and ready._'}`,
        `# Open handoffs you can take over\n${handoffs.length ? handoffs.map(line).join('\n') : '_None right now._'}`,
        `# Reviews waiting on you\n${reviews.length ? reviews.map(line).join('\n') : '_None._'}`,
        `# Check-ins\n${(await inbox(actor)).for_me.length} question(s) for your person — see \`check_inbox\`.`,
        `# Team capacity\n${await renderCapacity(actor.workspace.id)}`,
      ].join('\n\n');
    }
    case 'take_over_task': {
      const t = await takeOver(actor, a.key);
      return `You now own ${t.key} (In Progress). Read the handoff notes and recent progress, then continue.\n\n` + renderPack(await contextPack(actor, a.key));
    }
    case 'team_capacity':
      return `# Team agent capacity\n${await renderCapacity(actor.workspace.id)}`;
    case 'ask_teammate': {
      const r = await askTeammate(actor, a);
      const hints = r.hints.length
        ? r.hints.map((h: any) => `- ${h.key} [${STATUS_LABELS[h.status as Status]}] ${h.title} (assignee: ${h.assignee ?? '—'})` +
            (h.last_update ? `\n  Latest: ${fmtTime(h.last_update.created_at)} ${h.last_update.member_name}${h.last_update.agent_name ? ` (agent ${h.last_update.agent_name})` : ''} [${h.last_update.kind}]: ${h.last_update.message}` : '')).join('\n')
        : '_Nothing on the board obviously matches._';
      const who = r.has_agent ? `${r.to}'s agent` : `${r.to} (no agent connected)`;
      return `Asked ${who}, question id ${r.id}${a.task ? ` about ${a.task}` : ''}. The answer comes back through check_inbox.\n\n## What the board already knows\n${hints}`;
    }
    case 'check_inbox': {
      const r = await inbox(actor);
      await markAnswersSeen(actor);
      const forMe = r.for_me.length
        ? r.for_me.map((x: any) => `- id ${x.id} — from ${x.from_name}${x.from_agent_name ? ` (via ${x.from_agent_name})` : ''}, ${fmtTime(x.created_at)}${x.task_key ? ` about ${x.task_key}` : ''}:\n  "${x.question}"`).join('\n')
        : '_None._';
      const answered = r.my_questions.filter((x: any) => x.status === 'answered');
      const waiting = r.my_questions.filter((x: any) => x.status === 'open');
      const answers = answered.length
        ? answered.map((x: any) => `- To ${x.to_name}: "${x.question}"\n  → ${x.answer} — ${x.answered_by_name}${x.answered_by_agent_name ? ` via agent ${x.answered_by_agent_name}` : ''}, ${fmtTime(x.answered_at)}`).join('\n')
        : '_None yet._';
      return `# Questions for you (${actor.member.name}'s agent)${r.for_me.length ? ' — look each one up and answer it with answer_question' : ''}\n${forMe}\n\n# Answers to your questions\n${answers}${waiting.length ? `\n\n_Still waiting on ${waiting.length}: ${waiting.map((x: any) => x.to_name).join(', ')}._` : ''}`;
    }
    case 'answer_question':
      await answerAsk(actor, a.id, a.answer);
      return 'Answer sent. It is labelled as coming from you (the agent).';
    case 'add_comment':
      await addComment(actor, a.key, a.body);
      return 'Comment added.';
    case 'create_task': {
      const t = await createTask(actor, a);
      return `Created ${t.key} in Backlog. A person needs to assign it and mark it Ready.`;
    }
  }
  throw new RuleError('unknown_tool', `Unknown tool "${name}"`, 400);
}

/** The one thing a tool call was about, for the action log: a task key, a person, a question. */
const actionTarget = (a: any) =>
  String(a.key ?? a.to ?? a.project ?? (a.id ? `question ${String(a.id).slice(0, 8)}` : ''));

type RpcReq = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: any };

async function dispatch(actor: Actor, msg: RpcReq) {
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
  switch (msg.method) {
    case 'initialize': {
      const brief = await focusBrief(actor);
      return ok({
        protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: brief ? `${brief}\n\n${WORKFLOW}` : WORKFLOW,
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call': {
      const { name, arguments: args } = msg.params ?? {};
      const a = args ?? {};
      const log = (good: boolean) => recordAction(actor, { source: 'platter', action: String(name), target: actionTarget(a), ok: good }).catch(() => {});
      try {
        const text = await callTool(actor, name, a);
        await log(true);
        return ok({ content: [{ type: 'text', text }] });
      } catch (e) {
        await log(false);
        if (e instanceof RuleError) {
          const text = `Error (${e.code}): ${e.message}${e.details.length ? '\n' + e.details.map((d) => `- ${d}`).join('\n') : ''}`;
          return ok({ content: [{ type: 'text', text }], isError: true });
        }
        throw e;
      }
    }
    case 'resources/list':
      return ok({ resources: [] });
    case 'prompts/list':
      return ok({ prompts: [] });
    default:
      return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
  }
}

export async function handleMcp(c: Context) {
  if (c.req.method === 'GET' || c.req.method === 'DELETE') {
    // No server-initiated stream / sessions: stateless server.
    return c.body(null, 405, { Allow: 'POST' });
  }
  if (c.req.method !== 'POST') return c.body(null, 405, { Allow: 'POST' });
  const auth = c.req.header('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  const actor = token ? await resolveActor(token, null, null) : null;
  if (!actor || actor.kind !== 'agent') {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized: send "Authorization: Bearer <agent token>". Create a token in Platter → Agents.' } }, 401);
  }
  let payload: RpcReq | RpcReq[];
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }
  const msgs = Array.isArray(payload) ? payload : [payload];
  const responses = [];
  for (const m of msgs) {
    if (m.id === undefined || m.id === null) continue; // notification
    responses.push(await dispatch(actor, m));
  }
  if (!responses.length) return c.body(null, 202);
  return c.json(Array.isArray(payload) ? responses : responses[0]);
}
