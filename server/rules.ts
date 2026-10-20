// The rulebook. Every workflow transition, permission and quality gate is defined
// here, and the REST API, MCP server and UI all go through these functions — so a
// human clicking a button and an agent calling a tool are held to the same rules.

export type Role = 'owner' | 'admin' | 'member' | 'viewer';
export type Status = 'backlog' | 'ready' | 'in_progress' | 'blocked' | 'in_review' | 'done' | 'cancelled';
export type Action =
  | 'mark_ready' | 'move_to_backlog' | 'start' | 'block' | 'resume' | 'release'
  | 'submit' | 'approve' | 'reject' | 'cancel' | 'reopen';

export interface Member { id: string; name: string; email: string; role: Role; status?: string }
export interface Workspace { id: string; slug: string; name: string }
export interface Actor {
  kind: 'human' | 'agent';
  /** The person, with their role in THIS team. */
  member: Member;
  agent?: { id: string; name: string };
  /** Every action happens inside exactly one team. */
  workspace: Workspace;
}
export interface Criterion { id: string; text: string }

export interface Task {
  id: string;
  status: Status;
  title: string;
  description: string;
  context: string;
  acceptance_criteria: Criterion[];
  assignee_id: string | null;
  reviewer_id: string | null;
  reporter_id: string;
  depends_on: string[];
  rework_count: number;
  submission: any;
  review: any;
}

export const LIMITS = {
  minTitle: 8,
  minDescription: 40,
  minCriterion: 8,
  maxCriteria: 15,
  minSummary: 40,
  minEvidence: 15,
  minReason: 10,
  reworkEscalation: 3,
  heartbeatStaleMinutes: 60,
  passwordMin: 10,
  inviteTtlDays: 7,
  sessionTtlDays: 14,
  maxFailedLogins: 5,
  lockoutMinutes: 15,
  maxOpenAsksPerPerson: 20,
  maxTeamsPerUser: 10,
  usageExhausted: 10,
  usageMinToTakeOver: 25,
  usageReportFreshHours: 12,
  minHandoffNotes: 40,
};

export class RuleError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
    public details: string[] = [],
  ) {
    super(message);
  }
}

/** Human-readable rulebook — served at /api/rules, shown in the UI and given to agents over MCP. */
export const RULEBOOK: { section: string; rules: { id: string; text: string }[] }[] = [
  {
    section: 'People & access',
    rules: [
      { id: 'P0', text: 'Teams are completely separate: people, projects, tasks, agents, check-ins and activity never cross between teams. One person can belong to several teams, with a different role in each.' },
      { id: 'P1', text: 'Roles (per team): Owner (whoever created the team) > Admin (manage people & projects) > Member (create, work on and review tasks) > Viewer (read-only).' },
      { id: 'P2', text: 'Only the Owner can grant or remove the Admin role. Nobody can change the Owner, or their own role/status.' },
      { id: 'P3', text: `People join a team only by invite. Invites are single-use, tied to one email and expire after ${LIMITS.inviteTtlDays} days.` },
      { id: 'P4', text: 'Suspending someone from a team immediately locks them (and all their agent tokens for that team) out of it, and returns their unfinished work to the backlog (unassigned) so nothing stays silently stuck. Their other teams are unaffected.' },
      { id: 'P5', text: 'Every agent acts on behalf of exactly one person in exactly one team, using a named token that person created there. The person is accountable for what their agent does. Tokens can be revoked by their owner or an Admin.' },
      { id: 'P6', text: `Passwords are at least ${LIMITS.passwordMin} characters. ${LIMITS.maxFailedLogins} failed logins lock the account for ${LIMITS.lockoutMinutes} minutes.` },
    ],
  },
  {
    section: 'Definition of Ready (backlog → ready)',
    rules: [
      { id: 'R1', text: `A task can only be marked Ready when it has a clear title (≥ ${LIMITS.minTitle} chars), a description (≥ ${LIMITS.minDescription} chars) and 1–${LIMITS.maxCriteria} testable acceptance criteria.` },
      { id: 'R2', text: 'A Ready task must have an assignee and a reviewer, and they must be different people (no self-review).' },
      { id: 'R3', text: 'Only humans mark tasks Ready. Tasks created by agents always start in the Backlog until a person grooms them.' },
      { id: 'R4', text: 'Acceptance criteria, assignee and reviewer are frozen once work starts. To change them, release the task back to Ready first — so the goalposts never move silently during work or review.' },
    ],
  },
  {
    section: 'Doing the work',
    rules: [
      { id: 'W1', text: 'Only the assignee (or their agent) can start, submit or block a task.' },
      { id: 'W2', text: 'Work cannot start while any task it depends on is not Done.' },
      { id: 'W3', text: 'WIP limit: each person can have at most the project\'s WIP limit (default 3) tasks In Progress at once. Finish before starting more.' },
      { id: 'W4', text: `Agents should post progress updates while working. A task In Progress with no update for ${LIMITS.heartbeatStaleMinutes} minutes is flagged as stale on the board.` },
      { id: 'W5', text: `Blocking a task requires a reason (≥ ${LIMITS.minReason} chars) so the team knows what is needed to unblock it.` },
    ],
  },
  {
    section: 'Submitting for review (in progress → in review)',
    rules: [
      { id: 'S1', text: `A submission needs a summary of what was done (≥ ${LIMITS.minSummary} chars).` },
      { id: 'S2', text: `Every acceptance criterion must be addressed with concrete evidence (≥ ${LIMITS.minEvidence} chars): what changed, where, and how it was checked.` },
      { id: 'S3', text: 'Submissions should state what tests or checks were run and link artifacts (PR, commit, preview URL) when they exist.' },
    ],
  },
  {
    section: 'Verification (in review → done)',
    rules: [
      { id: 'V1', text: 'Only the assigned reviewer (or the reviewer\'s agent) can approve or reject. The assignee can never verify their own work.' },
      { id: 'V2', text: 'The reviewer must give a pass/fail verdict on every acceptance criterion. Approval requires every criterion to pass.' },
      { id: 'V3', text: 'Rejecting requires at least one failed criterion with a note explaining what to fix. The task goes back to In Progress with that feedback attached for the next attempt.' },
      { id: 'V4', text: `A task rejected ${LIMITS.reworkEscalation} or more times is flagged "needs attention" — it probably needs a human conversation, not another attempt.` },
    ],
  },
  {
    section: 'Agent capacity & handoffs',
    rules: [
      { id: 'H1', text: 'Agents share how much of their usage limit is left (report_usage) when they connect, when they start a task, and whenever it drops below 25%. Everyone can see it on the Capacity board.' },
      { id: 'H2', text: `An agent reporting under ${LIMITS.usageExhausted}% remaining cannot start or take over work — it should hand off what it has instead.` },
      { id: 'H3', text: `Handing off needs a handoff note (≥ ${LIMITS.minHandoffNotes} chars): what is done, what is left, and where the work lives (branch, PR, files). Criteria and history stay with the task.` },
      { id: 'H4', text: `Any teammate's agent with at least ${LIMITS.usageMinToTakeOver}% remaining can take over an open handoff — unless its person is the task's reviewer (V1). The taker's person becomes the assignee and WIP limits apply. The previous assignee is kept as a contributor.` },
      { id: 'H5', text: `If an agent reported itself exhausted and then goes silent for ${LIMITS.heartbeatStaleMinutes} minutes, its task is automatically offered for takeover.` },
      { id: 'H6', text: 'The original person (or another of their agents) can always take their own handoff back.' },
    ],
  },
  {
    section: 'Check-ins between teammates',
    rules: [
      { id: 'Q1', text: 'Anyone (or their agent) can ask a teammate for an update. The question goes to the person; their agent may answer it.' },
      { id: 'Q2', text: 'An agent answers only from what it actually knows — work it did, Platter tasks and progress. If it is not sure, it leaves the question for its person. Agent answers are always labelled as such.' },
      { id: 'Q3', text: 'While waiting, the asker immediately gets what the board already knows: the teammate\'s matching tasks and their latest progress.' },
      { id: 'Q4', text: `Be kind to inboxes: at most ${LIMITS.maxOpenAsksPerPerson} unanswered questions to the same person at a time. Check-ins about a task also appear in that task's timeline.` },
    ],
  },
  {
    section: 'Closing & audit',
    rules: [
      { id: 'C1', text: 'Cancelling requires a reason and can only be done by the reporter or an Admin. Reopening a Done task requires a reason and is limited to the reviewer or an Admin.' },
      { id: 'C2', text: 'Everything — edits, transitions, comments, agent progress, reviews — is written to an append-only activity log with who (and which agent) did it.' },
    ],
  },
];

interface ActionDef {
  from: Status[];
  to: Status;
  who: ('assignee' | 'reviewer' | 'reporter' | 'admin')[];
  agents: boolean;
  label: string;
  needsReason?: boolean;
}

export const ACTIONS: Record<Action, ActionDef> = {
  mark_ready: { from: ['backlog'], to: 'ready', who: ['reporter', 'admin'], agents: false, label: 'Mark ready' },
  move_to_backlog: { from: ['ready'], to: 'backlog', who: ['reporter', 'admin'], agents: false, label: 'Move to backlog' },
  start: { from: ['ready'], to: 'in_progress', who: ['assignee'], agents: true, label: 'Start work' },
  block: { from: ['in_progress'], to: 'blocked', who: ['assignee', 'admin'], agents: true, label: 'Mark blocked', needsReason: true },
  resume: { from: ['blocked'], to: 'in_progress', who: ['assignee', 'reporter', 'admin'], agents: true, label: 'Resume' },
  release: { from: ['in_progress', 'blocked'], to: 'ready', who: ['assignee', 'admin'], agents: true, label: 'Release to ready' },
  submit: { from: ['in_progress'], to: 'in_review', who: ['assignee'], agents: true, label: 'Submit for review' },
  approve: { from: ['in_review'], to: 'done', who: ['reviewer'], agents: true, label: 'Approve' },
  reject: { from: ['in_review'], to: 'in_progress', who: ['reviewer'], agents: true, label: 'Request changes' },
  cancel: { from: ['backlog', 'ready', 'in_progress', 'blocked', 'in_review'], to: 'cancelled', who: ['reporter', 'admin'], agents: false, label: 'Cancel', needsReason: true },
  reopen: { from: ['done', 'cancelled'], to: 'ready', who: ['reviewer', 'admin'], agents: false, label: 'Reopen', needsReason: true },
};

export const isAdmin = (a: Actor) => a.member.role === 'owner' || a.member.role === 'admin';
export const canWrite = (a: Actor) => a.member.role !== 'viewer';

function relations(task: Task, actor: Actor) {
  const id = actor.member.id;
  return {
    assignee: task.assignee_id === id,
    reviewer: task.reviewer_id === id,
    reporter: task.reporter_id === id,
    admin: isAdmin(actor),
  };
}

/** Returns the list of unmet Definition-of-Ready items (empty = ready). */
export function definitionOfReady(t: Pick<Task, 'title' | 'description' | 'acceptance_criteria' | 'assignee_id' | 'reviewer_id'>): string[] {
  const missing: string[] = [];
  if ((t.title ?? '').trim().length < LIMITS.minTitle) missing.push(`Title must be at least ${LIMITS.minTitle} characters (R1)`);
  if ((t.description ?? '').trim().length < LIMITS.minDescription) missing.push(`Description must be at least ${LIMITS.minDescription} characters (R1)`);
  const ac = t.acceptance_criteria ?? [];
  if (ac.length < 1) missing.push('Add at least one acceptance criterion (R1)');
  if (ac.length > LIMITS.maxCriteria) missing.push(`At most ${LIMITS.maxCriteria} acceptance criteria — split the task (R1)`);
  if (ac.some((c) => c.text.trim().length < LIMITS.minCriterion)) missing.push(`Each acceptance criterion must be at least ${LIMITS.minCriterion} characters (R1)`);
  if (!t.assignee_id) missing.push('Assign someone to do the work (R2)');
  if (!t.reviewer_id) missing.push('Choose a reviewer to verify the work (R2)');
  if (t.assignee_id && t.reviewer_id && t.assignee_id === t.reviewer_id) missing.push('Reviewer must be a different person from the assignee (R2)');
  return missing;
}

/** Why this actor can't perform this action right now (null = allowed, DB-backed gates excluded). */
export function blockedReason(task: Task, actor: Actor, action: Action): string | null {
  const def = ACTIONS[action];
  if (!def) return `Unknown action "${action}"`;
  if (!canWrite(actor)) return 'Viewers have read-only access (P1)';
  if (!def.from.includes(task.status)) return `Cannot "${def.label}" a task that is ${task.status.replace('_', ' ')}`;
  if (actor.kind === 'agent' && !def.agents) return `"${def.label}" must be done by a person, not an agent (R3/C1)`;
  const rel = relations(task, actor);
  if (!def.who.some((w) => rel[w])) {
    const who = def.who.map((w) => (w === 'admin' ? 'an admin' : `the ${w}`)).join(' or ');
    return `Only ${who} can "${def.label}"${actor.kind === 'agent' ? ' (agents act for the person who owns their token)' : ''}`;
  }
  if ((action === 'approve' || action === 'reject') && task.assignee_id === actor.member.id) {
    return 'You cannot verify your own work (V1)';
  }
  return null;
}

export function assertAction(task: Task, actor: Actor, action: Action) {
  const reason = blockedReason(task, actor, action);
  if (reason) throw new RuleError('forbidden_transition', reason, 403);
}

export function allowedActions(task: Task, actor: Actor): Action[] {
  return (Object.keys(ACTIONS) as Action[]).filter((a) => blockedReason(task, actor, a) === null);
}

export function requireReason(reason: unknown, rule = 'W5'): string {
  const r = typeof reason === 'string' ? reason.trim() : '';
  if (r.length < LIMITS.minReason) {
    throw new RuleError('reason_required', `A reason of at least ${LIMITS.minReason} characters is required (${rule})`);
  }
  return r;
}

export interface SubmissionInput {
  summary?: string;
  criteria?: { id: string; evidence: string }[];
  tests?: string;
  artifacts?: string[];
}

export function validateSubmission(task: Task, input: SubmissionInput) {
  const problems: string[] = [];
  const summary = (input.summary ?? '').trim();
  if (summary.length < LIMITS.minSummary) problems.push(`Summary must be at least ${LIMITS.minSummary} characters (S1)`);
  const given = new Map((input.criteria ?? []).map((c) => [c.id, (c.evidence ?? '').trim()]));
  for (const c of task.acceptance_criteria) {
    const ev = given.get(c.id);
    if (!ev) problems.push(`Missing evidence for criterion ${c.id}: "${c.text}" (S2)`);
    else if (ev.length < LIMITS.minEvidence) problems.push(`Evidence for ${c.id} is too thin — at least ${LIMITS.minEvidence} chars describing what changed and how it was checked (S2)`);
  }
  for (const id of given.keys()) {
    if (!task.acceptance_criteria.some((c) => c.id === id)) problems.push(`Unknown criterion id "${id}"`);
  }
  const artifacts = (input.artifacts ?? []).map((a) => String(a).trim()).filter(Boolean);
  if (problems.length) throw new RuleError('submission_incomplete', 'Submission does not meet the review bar', 422, problems);
  return {
    summary,
    criteria: task.acceptance_criteria.map((c) => ({ id: c.id, evidence: given.get(c.id)! })),
    tests: (input.tests ?? '').trim(),
    artifacts,
  };
}

export interface ReviewInput {
  summary?: string;
  criteria?: { id: string; passed: boolean; note?: string }[];
}

export function validateReview(task: Task, verdict: 'approve' | 'reject', input: ReviewInput) {
  const problems: string[] = [];
  const given = new Map((input.criteria ?? []).map((c) => [c.id, c]));
  for (const c of task.acceptance_criteria) {
    const r = given.get(c.id);
    if (!r || typeof r.passed !== 'boolean') problems.push(`Give a pass/fail verdict for criterion ${c.id}: "${c.text}" (V2)`);
  }
  const results = task.acceptance_criteria.map((c) => ({
    id: c.id,
    passed: given.get(c.id)?.passed === true,
    note: (given.get(c.id)?.note ?? '').trim(),
  }));
  if (!problems.length) {
    const failed = results.filter((r) => !r.passed);
    if (verdict === 'approve' && failed.length) {
      problems.push(`Cannot approve: ${failed.map((f) => f.id).join(', ')} did not pass. Reject with notes instead (V2)`);
    }
    if (verdict === 'reject') {
      if (!failed.length) problems.push('Rejecting requires at least one failed criterion (V3)');
      if (failed.some((f) => f.note.length < LIMITS.minReason)) problems.push(`Each failed criterion needs a note (≥ ${LIMITS.minReason} chars) explaining what to fix (V3)`);
    }
  }
  if (problems.length) throw new RuleError('review_incomplete', 'Review does not meet the verification bar', 422, problems);
  return { verdict, summary: (input.summary ?? '').trim(), criteria: results };
}

export const EDITABLE_FIELDS = [
  'title', 'description', 'context', 'acceptance_criteria', 'type', 'priority',
  'labels', 'depends_on', 'assignee_id', 'reviewer_id', 'due_date',
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

const FROZEN_AFTER_START: EditableField[] = ['acceptance_criteria', 'assignee_id', 'reviewer_id', 'depends_on'];
const ASSIGNEE_FIELDS: EditableField[] = ['context', 'labels'];

/** Throws if this actor may not change these fields on this task right now. */
export function assertCanEdit(task: Task, actor: Actor, fields: EditableField[]) {
  if (!canWrite(actor)) throw new RuleError('forbidden', 'Viewers have read-only access (P1)', 403);
  if (actor.kind === 'agent') throw new RuleError('forbidden', 'Agents cannot edit task definitions — post a comment or progress update instead (R4)', 403);
  if (task.status === 'done' || task.status === 'cancelled') {
    throw new RuleError('forbidden', 'Closed tasks cannot be edited. Reopen it first (C1)', 403);
  }
  const rel = relations(task, actor);
  const full = rel.reporter || rel.admin;
  if (!full) {
    const disallowed = fields.filter((f) => !(rel.assignee && ASSIGNEE_FIELDS.includes(f)));
    if (disallowed.length) {
      throw new RuleError('forbidden', `Only the reporter or an admin can change ${disallowed.join(', ')}`, 403);
    }
  }
  const started = !['backlog', 'ready'].includes(task.status);
  if (started) {
    const frozen = fields.filter((f) => FROZEN_AFTER_START.includes(f));
    // Admins may hand a review to someone else (e.g. reviewer is away), never to the assignee.
    const allowedAdminReviewerSwap = rel.admin && frozen.length === 1 && frozen[0] === 'reviewer_id';
    if (frozen.length && !allowedAdminReviewerSwap) {
      throw new RuleError('frozen', `${frozen.join(', ')} are frozen once work has started. Release the task to Ready first (R4)`, 409);
    }
  }
}

export function normalizeCriteria(input: unknown, existing: Criterion[] = []): Criterion[] {
  if (!Array.isArray(input)) throw new RuleError('invalid', 'acceptance_criteria must be a list');
  const used = new Set<string>();
  let next = existing.reduce((m, c) => Math.max(m, Number(c.id.replace(/\D/g, '')) || 0), 0) + 1;
  return input
    .map((c: any) => (typeof c === 'string' ? { text: c } : c))
    .filter((c: any) => c && typeof c.text === 'string' && c.text.trim())
    .map((c: any) => {
      let id = typeof c.id === 'string' && /^AC\d+$/.test(c.id) && !used.has(c.id) ? c.id : '';
      if (!id) {
        while (used.has(`AC${next}`) || existing.some((e) => e.id === `AC${next}` && !input.some((i: any) => i?.id === e.id))) next++;
        id = `AC${next++}`;
      }
      used.add(id);
      return { id, text: c.text.trim() };
    });
}

export const STATUS_LABELS: Record<Status, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  in_progress: 'In progress',
  blocked: 'Blocked',
  in_review: 'In review',
  done: 'Done',
  cancelled: 'Cancelled',
};
