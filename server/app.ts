import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { listActions, recordAction, summarizeHook } from './actionlog.ts';
import { answerAsk, askTeammate, closeAsk, inbox, markAnswersSeen, unreadCount } from './asks.ts';
import { focusBrief, setFocus } from './focus.ts';
import {
  AGENT_TOKEN_PREFIX, SESSION_COOKIE, createSession, destroySession, hashPassword, listTeams, newSecret,
  requireUser, resolveActor, resolveUser, sha256, validatePassword, verifyPassword, type User,
} from './auth.ts';
import { one, q } from './db.ts';
import { handleMcp } from './mcp.ts';
import { ACTIONS, LIMITS, RULEBOOK, RuleError, STATUS_LABELS, canWrite, isAdmin, type Action, type Actor } from './rules.ts';
import {
  addComment, contextPack, createTask, listActivity, listHandoffs, listTasks, logActivity, logProgress,
  releaseMemberWork, reportUsage, requestHandoff, takeOver, teamCapacity, transition, updateTask,
} from './tasks.ts';

type Env = { Variables: { actor: Actor } };
export const app = new Hono<Env>();

app.onError((err, c) => {
  if (err instanceof RuleError) {
    return c.json({ error: err.code, message: err.message, details: err.details }, err.status as any);
  }
  console.error(err);
  const msg = `${(err as any)?.name ?? ''} ${(err as any)?.message ?? err}`;
  if (/MissingDatabaseConnection|configured to use Netlify Database/i.test(msg)) {
    return c.json({ error: 'no_database', message: 'Database is not configured. On Netlify, enable Netlify Database for this site and redeploy.' }, 503);
  }
  return c.json({ error: 'internal', message: 'Something went wrong' }, 500);
});

const body = async (c: Context) => {
  try { return (await c.req.json()) ?? {}; } catch { return {}; }
};
const actorOf = (c: Context<Env>) => c.get('actor');
const wsOf = (c: Context<Env>) => c.get('actor').workspace.id;

function requireAdmin(a: Actor) {
  if (!isAdmin(a)) throw new RuleError('forbidden', 'Admins only (P1)', 403);
  if (a.kind === 'agent') throw new RuleError('forbidden', 'Agents cannot manage people or projects', 403);
}
function requireHuman(a: Actor) {
  if (a.kind === 'agent') throw new RuleError('forbidden', 'This action requires a signed-in person', 403);
}
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

function setSessionCookie(c: Context, token: string, expires: Date) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'Lax', path: '/', expires,
    secure: new URL(c.req.url).protocol === 'https:',
  });
}

/** CSRF guard for cookie sessions: browsers can't send this header cross-site without CORS. */
function requireCsrfHeader(c: Context) {
  if (c.req.method !== 'GET' && c.req.header('x-platter') !== '1') throw new RuleError('csrf', 'Missing x-platter header', 403);
}

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'team';

/** Create a team with its owner and a starter project. */
async function createTeam(owner: User, rawName: unknown) {
  const name = String(rawName ?? '').trim();
  if (name.length < 2 || name.length > 60) throw new RuleError('invalid', 'Team name must be 2–60 characters');
  const owned = await one<{ n: number }>(`SELECT count(*)::int AS n FROM memberships WHERE user_id = $1 AND role = 'owner'`, [owner.id]);
  if (owned!.n >= LIMITS.maxTeamsPerUser) throw new RuleError('limit', `You already own ${owned!.n} teams`);
  const base = slugify(name);
  let slug = base;
  for (let i = 2; await one('SELECT 1 FROM workspaces WHERE slug = $1', [slug]); i++) slug = `${base}-${i}`;
  const id = randomUUID();
  await q('INSERT INTO workspaces (id, slug, name, created_by) VALUES ($1, $2, $3, $4)', [id, slug, name, owner.id]);
  await q(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [id, owner.id]);
  await q('INSERT INTO projects (id, workspace_id, key, name) VALUES ($1, $2, $3, $4)', [randomUUID(), id, 'TASK', 'General']);
  const actor: Actor = { kind: 'human', member: { ...owner, role: 'owner' }, workspace: { id, slug, name } };
  await logActivity(actor, { kind: 'joined', message: `created the team` });
  return { slug, name };
}

/** Self-serve team creation can be limited to people holding a code during a beta. */
function checkSignupCode(code: unknown) {
  const required = process.env.SIGNUP_CODE;
  if (required && sha256(String(code ?? '')) !== sha256(required)) {
    throw new RuleError('bad_code', 'That signup code is not right. Ask whoever runs Platter for one.', 403);
  }
}

// ---------- MCP endpoint for agents ----------
app.all('/mcp', (c) => handleMcp(c));

const api = new Hono<Env>();

// ---------- Public ----------
api.get('/bootstrap', async (c) => {
  const user = await resolveUser(getCookie(c, SESSION_COOKIE) ?? null);
  return c.json({
    me: user,
    teams: user ? await listTeams(user.id) : [],
    signupNeedsCode: !!process.env.SIGNUP_CODE,
  });
});

api.post('/signup', async (c) => {
  requireCsrfHeader(c);
  const b = await body(c);
  checkSignupCode(b.code);
  const email = String(b.email ?? '').trim().toLowerCase();
  const name = String(b.name ?? '').trim();
  if (!isEmail(email) || !name) throw new RuleError('invalid', 'Name and a valid email are required');
  if (await one('SELECT id FROM users WHERE email = $1', [email])) {
    throw new RuleError('exists', 'You already have an account — sign in, then create a new team from the team switcher', 409);
  }
  const pw = await hashPassword(validatePassword(b.password));
  const user: User = { id: randomUUID(), name, email };
  await q('INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)', [user.id, email, name, pw]);
  const team = await createTeam(user, b.team);
  const s = await createSession(user.id);
  setSessionCookie(c, s.token, s.expires);
  return c.json({ ok: true, team: team.slug });
});

api.post('/login', async (c) => {
  requireCsrfHeader(c);
  const b = await body(c);
  const email = String(b.email ?? '').trim().toLowerCase();
  const u = await one('SELECT * FROM users WHERE email = $1', [email]);
  const fail = () => new RuleError('bad_login', 'Email or password is incorrect', 401);
  if (!u) throw fail();
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    throw new RuleError('locked', `Too many failed attempts. Try again after ${new Date(u.locked_until).toLocaleTimeString()} (P6)`, 429);
  }
  if (!(await verifyPassword(String(b.password ?? ''), u.password_hash))) {
    const fails = u.failed_logins + 1;
    const lock = fails >= LIMITS.maxFailedLogins ? new Date(Date.now() + LIMITS.lockoutMinutes * 60_000) : null;
    await q('UPDATE users SET failed_logins = $2, locked_until = $3 WHERE id = $1', [u.id, lock ? 0 : fails, lock]);
    throw fail();
  }
  await q('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [u.id]);
  const s = await createSession(u.id);
  setSessionCookie(c, s.token, s.expires);
  return c.json({ ok: true, teams: await listTeams(u.id) });
});

api.post('/logout', async (c) => {
  const t = getCookie(c, SESSION_COOKIE);
  if (t) await destroySession(t);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

async function findInvite(token: string) {
  const inv = await one(
    `SELECT i.*, u.name AS invited_by_name, w.name AS team_name, w.slug AS team_slug
       FROM invites i JOIN users u ON u.id = i.invited_by JOIN workspaces w ON w.id = i.workspace_id
      WHERE i.token_hash = $1`,
    [sha256(token)],
  );
  if (!inv || inv.accepted_at || inv.revoked_at || new Date(inv.expires_at) < new Date()) {
    throw new RuleError('invite_invalid', 'This invite link is invalid, used, or expired. Ask an admin for a new one (P3)', 404);
  }
  return inv;
}

api.get('/join/:token', async (c) => {
  const inv = await findInvite(c.req.param('token'));
  const existing = await one('SELECT id FROM users WHERE email = $1', [inv.email]);
  const me = await resolveUser(getCookie(c, SESSION_COOKIE) ?? null);
  return c.json({
    email: inv.email, role: inv.role, invitedBy: inv.invited_by_name, team: inv.team_name,
    hasAccount: !!existing, signedInAs: me?.email ?? null,
  });
});

/** Accept an invite: new people create an account; existing people just add the team. */
api.post('/join/:token', async (c) => {
  requireCsrfHeader(c);
  const inv = await findInvite(c.req.param('token'));
  const b = await body(c);
  let user = await one<User & { password_hash: string }>('SELECT id, name, email, password_hash FROM users WHERE email = $1', [inv.email]);
  const me = await resolveUser(getCookie(c, SESSION_COOKIE) ?? null);
  if (user) {
    const alreadySignedIn = me?.id === user.id;
    if (!alreadySignedIn && !(await verifyPassword(String(b.password ?? ''), user.password_hash))) {
      throw new RuleError('bad_login', 'Enter the password for your existing Platter account', 401);
    }
  } else {
    const name = String(b.name ?? '').trim();
    if (!name) throw new RuleError('invalid', 'Name is required');
    const pw = await hashPassword(validatePassword(b.password));
    user = { id: randomUUID(), name, email: inv.email, password_hash: pw };
    await q('INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)', [user.id, inv.email, name, pw]);
  }
  const member = await one('SELECT status FROM memberships WHERE workspace_id = $1 AND user_id = $2', [inv.workspace_id, user.id]);
  if (member) throw new RuleError('exists', member.status === 'active' ? 'You are already on this team' : 'Your access to this team is paused — ask an admin', 409);
  const claimed = await one('UPDATE invites SET accepted_at = now() WHERE id = $1 AND accepted_at IS NULL RETURNING id', [inv.id]);
  if (!claimed) throw new RuleError('invite_invalid', 'This invite was already used', 409);
  await q('INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, $3)', [inv.workspace_id, user.id, inv.role]);
  await logActivity(
    { kind: 'human', member: { id: user.id, name: user.name, email: user.email, role: inv.role }, workspace: { id: inv.workspace_id, slug: inv.team_slug, name: inv.team_name } },
    { kind: 'joined', message: `joined as ${inv.role}` },
  );
  if (me?.id !== user.id) {
    const s = await createSession(user.id);
    setSessionCookie(c, s.token, s.expires);
  }
  return c.json({ ok: true, team: inv.team_slug });
});

// ---------- Signed in, not tied to one team ----------
api.get('/me/teams', async (c) => {
  const user = requireUser(await resolveUser(getCookie(c, SESSION_COOKIE) ?? null));
  return c.json({ teams: await listTeams(user.id) });
});

api.post('/teams', async (c) => {
  requireCsrfHeader(c);
  const user = requireUser(await resolveUser(getCookie(c, SESSION_COOKIE) ?? null));
  const b = await body(c);
  return c.json(await createTeam(user, b.name));
});

// ---------- Inside one team ----------
// People send `x-team: <slug>` with their session; agents' tokens already belong to one team.
api.use('*', async (c, next) => {
  const auth = c.req.header('authorization');
  const bearer = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  const session = bearer ? null : getCookie(c, SESSION_COOKIE) ?? null;
  const actor = await resolveActor(bearer, session, c.req.header('x-team') ?? null);
  if (!actor) {
    if (!bearer && session && (await resolveUser(session))) throw new RuleError('not_in_team', 'You are not a member of this team (P0)', 403);
    throw new RuleError('unauthorized', 'Sign in required (or a valid agent token)', 401);
  }
  if (!bearer) requireCsrfHeader(c);
  c.set('actor', actor);
  if (actor.kind !== 'agent') return next();
  const path = c.req.path.replace(/^\/api/, '');
  const hook = path.startsWith('/agent/');
  // A locked agent can't route around the lock through the REST API: Platter work goes through MCP, where it is checked (F2).
  const readsOwnInbox = c.req.method === 'GET' && path === '/asks';
  if (actor.policy?.focus && !hook && !readsOwnInbox && !['/me', '/rules', '/usage'].includes(path)) {
    throw new RuleError('focus_lock', '🔒 Focus lock: use the Platter MCP tools for your focus task (F2)', 403);
  }
  await next();
  if (!hook) await recordAction(actor, { source: 'platter', action: `${c.req.method} ${path}`.slice(0, 60), ok: c.res.status < 400 }).catch(() => {});
});

api.get('/me', async (c) => {
  const actor = actorOf(c);
  const p = await one(
    `SELECT w.agent_log, m.agent_focus, fb.name AS focus_by, u.onboarded_at FROM workspaces w
       JOIN memberships m ON m.workspace_id = w.id AND m.user_id = $2
       JOIN users u ON u.id = m.user_id
       LEFT JOIN users fb ON fb.id = m.agent_focus_by WHERE w.id = $1`,
    [actor.workspace.id, actor.member.id],
  );
  return c.json({
    me: actor.member, agent: actor.agent ?? null, team: actor.workspace,
    policy: { agent_log: !!p?.agent_log, agent_focus: !!p?.agent_focus, focus_by: p?.focus_by ?? null },
    onboarded: !!p?.onboarded_at,
  });
});

/** The welcome tour was finished or skipped: don't show it again, on any device. */
api.post('/me/onboarded', async (c) => {
  const actor = actorOf(c);
  requireHuman(actor);
  await q('UPDATE users SET onboarded_at = coalesce(onboarded_at, now()) WHERE id = $1', [actor.member.id]);
  return c.json({ ok: true });
});

api.patch('/team', async (c) => {
  const actor = actorOf(c);
  requireAdmin(actor);
  const b = await body(c);
  if (b.agent_log !== undefined) {
    if (actor.member.role !== 'owner') throw new RuleError('forbidden', 'Only the team owner can turn the action log on or off (L1)', 403);
    const on = b.agent_log === true;
    await q('UPDATE workspaces SET agent_log = $2 WHERE id = $1', [actor.workspace.id, on]);
    await logActivity(actor, { kind: 'policy', message: on ? 'turned on the agent action log' : 'turned off the agent action log' });
  }
  if (b.name !== undefined) {
    const name = String(b.name ?? '').trim();
    if (name.length < 2 || name.length > 60) throw new RuleError('invalid', 'Team name must be 2–60 characters');
    await q('UPDATE workspaces SET name = $2 WHERE id = $1', [actor.workspace.id, name]);
    await logActivity(actor, { kind: 'project', message: `renamed the team to ${name}` });
  }
  return c.json({ ok: true });
});

api.get('/rules', (c) =>
  c.json({
    rulebook: RULEBOOK,
    limits: LIMITS,
    statuses: STATUS_LABELS,
    actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, { label: v.label, from: v.from, to: v.to, who: v.who, agents: v.agents, needsReason: !!v.needsReason }])),
  }),
);

// ----- People -----
api.get('/members', async (c) => {
  const rows = await q(`
    SELECT u.id, u.name, u.email, m.role, m.status, m.created_at,
      (SELECT count(*)::int FROM agent_tokens t WHERE t.workspace_id = m.workspace_id AND t.member_id = u.id AND t.revoked_at IS NULL) AS active_agents,
      (SELECT max(t.last_used_at) FROM agent_tokens t WHERE t.workspace_id = m.workspace_id AND t.member_id = u.id) AS agent_last_seen,
      (SELECT count(*)::int FROM tasks t WHERE t.workspace_id = m.workspace_id AND t.assignee_id = u.id AND t.status = 'ready') AS ready,
      (SELECT count(*)::int FROM tasks t WHERE t.workspace_id = m.workspace_id AND t.assignee_id = u.id AND t.status = 'in_progress') AS in_progress,
      (SELECT count(*)::int FROM tasks t WHERE t.workspace_id = m.workspace_id AND t.assignee_id = u.id AND t.status = 'blocked') AS blocked,
      (SELECT count(*)::int FROM tasks t WHERE t.workspace_id = m.workspace_id AND t.reviewer_id = u.id AND t.status = 'in_review') AS to_review,
      (SELECT count(*)::int FROM tasks t WHERE t.workspace_id = m.workspace_id AND t.assignee_id = u.id AND t.status = 'done' AND t.completed_at > now() - interval '7 days') AS done_7d,
      (SELECT coalesce(sum(t.rework_count), 0)::int FROM tasks t WHERE t.workspace_id = m.workspace_id AND t.assignee_id = u.id AND t.completed_at > now() - interval '30 days') AS rework_30d,
      m.agent_focus, fb.name AS focus_by,
      CASE WHEN m.agent_focus THEN (SELECT p.key || '-' || t.number FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.workspace_id = m.workspace_id AND t.assignee_id = u.id AND t.status IN ('in_progress','blocked','ready')
        ORDER BY CASE WHEN t.status = 'ready' THEN 1 ELSE 0 END, CASE t.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, t.updated_at DESC
        LIMIT 1) END AS focus_task_key
    FROM memberships m JOIN users u ON u.id = m.user_id
    LEFT JOIN users fb ON fb.id = m.agent_focus_by
    WHERE m.workspace_id = $1
    ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, u.name`, [wsOf(c)]);
  return c.json({ members: rows });
});

api.patch('/members/:id', async (c) => {
  const actor = actorOf(c);
  requireAdmin(actor);
  const b = await body(c);
  const target = await one(
    `SELECT u.id, u.name, m.role, m.status FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = $1 AND m.user_id = $2`,
    [actor.workspace.id, c.req.param('id')],
  );
  if (!target) throw new RuleError('not_found', 'Member not found', 404);
  if (target.id === actor.member.id) throw new RuleError('forbidden', 'You cannot change your own role or status (P2)', 403);
  if (target.role === 'owner') throw new RuleError('forbidden', 'The owner cannot be changed (P2)', 403);
  const owner = actor.member.role === 'owner';
  const changes: string[] = [];
  let releaseWork = false;
  const setM = (col: string, v: string) => q(`UPDATE memberships SET ${col} = $3 WHERE workspace_id = $1 AND user_id = $2`, [actor.workspace.id, target.id, v]);

  if (b.role !== undefined && b.role !== target.role) {
    if (!['admin', 'member', 'viewer'].includes(b.role)) throw new RuleError('invalid', 'Role must be admin, member or viewer');
    if ((b.role === 'admin' || target.role === 'admin') && !owner) throw new RuleError('forbidden', 'Only the owner can grant or remove admin (P2)', 403);
    await setM('role', b.role);
    changes.push(`role ${target.role} → ${b.role}`);
    if (b.role === 'viewer') releaseWork = true;
  }
  if (b.status !== undefined && b.status !== target.status) {
    if (!['active', 'suspended'].includes(b.status)) throw new RuleError('invalid', 'Status must be active or suspended');
    if (target.role === 'admin' && !owner) throw new RuleError('forbidden', 'Only the owner can suspend an admin (P2)', 403);
    await setM('status', b.status);
    if (b.status === 'suspended') releaseWork = true;
    changes.push(b.status === 'suspended' ? 'suspended' : 'reactivated');
  }
  let released = null;
  if (releaseWork) released = await releaseMemberWork(actor, target.id);
  if (changes.length) await logActivity(actor, { kind: 'member', message: `${target.name}: ${changes.join(', ')}`, data: released });
  return c.json({ ok: true, released });
});

// Focus lock (F3): owner only, for anyone on the team including themselves.
api.patch('/members/:id/focus', async (c) => c.json(await setFocus(actorOf(c), c.req.param('id'), (await body(c)).on === true)));

api.get('/invites', async (c) => {
  requireAdmin(actorOf(c));
  const rows = await q(`SELECT i.id, i.email, i.role, i.expires_at, i.created_at, u.name AS invited_by_name
    FROM invites i JOIN users u ON u.id = i.invited_by
    WHERE i.workspace_id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() ORDER BY i.created_at DESC`, [wsOf(c)]);
  return c.json({ invites: rows });
});

api.post('/invites', async (c) => {
  const actor = actorOf(c);
  requireAdmin(actor);
  const ws = actor.workspace.id;
  const b = await body(c);
  const email = String(b.email ?? '').trim().toLowerCase();
  const role = String(b.role ?? 'member');
  if (!isEmail(email)) throw new RuleError('invalid', 'A valid email is required');
  if (!['admin', 'member', 'viewer'].includes(role)) throw new RuleError('invalid', 'Role must be admin, member or viewer');
  if (role === 'admin' && actor.member.role !== 'owner') throw new RuleError('forbidden', 'Only the owner can invite admins (P2)', 403);
  if (await one('SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND u.email = $2', [ws, email])) {
    throw new RuleError('exists', 'That person is already on this team', 409);
  }
  await q('UPDATE invites SET revoked_at = now() WHERE workspace_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL', [ws, email]);
  const token = newSecret();
  await q('INSERT INTO invites (id, workspace_id, email, role, token_hash, invited_by, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    randomUUID(), ws, email, role, sha256(token), actor.member.id, new Date(Date.now() + LIMITS.inviteTtlDays * 86400_000),
  ]);
  await logActivity(actor, { kind: 'invite', message: `invited ${email} as ${role}` });
  return c.json({ link: `${new URL(c.req.url).origin}/join/${token}`, expiresInDays: LIMITS.inviteTtlDays });
});

api.delete('/invites/:id', async (c) => {
  requireAdmin(actorOf(c));
  await q('UPDATE invites SET revoked_at = now() WHERE workspace_id = $1 AND id = $2', [wsOf(c), c.req.param('id')]);
  return c.json({ ok: true });
});

// ----- Agent tokens (each belongs to one person in one team) -----
api.get('/agent-tokens', async (c) => {
  const actor = actorOf(c);
  requireHuman(actor);
  const all = c.req.query('all') === '1' && isAdmin(actor);
  const rows = await q(
    `SELECT t.id, t.name, t.token_prefix, t.last_used_at, t.created_at, t.revoked_at, t.member_id, u.name AS member_name
       FROM agent_tokens t JOIN users u ON u.id = t.member_id
      WHERE t.workspace_id = $1 AND t.revoked_at IS NULL ${all ? '' : 'AND t.member_id = $2'} ORDER BY t.created_at DESC`,
    all ? [actor.workspace.id] : [actor.workspace.id, actor.member.id],
  );
  return c.json({ tokens: rows });
});

api.post('/agent-tokens', async (c) => {
  const actor = actorOf(c);
  requireHuman(actor);
  if (!canWrite(actor)) throw new RuleError('forbidden', 'Viewers cannot create agent tokens', 403);
  const name = String((await body(c)).name ?? '').trim();
  if (name.length < 3 || name.length > 60) throw new RuleError('invalid', 'Give the agent a name of 3–60 characters (e.g. "Claude Code on laptop")');
  const active = await one<{ n: number }>('SELECT count(*)::int AS n FROM agent_tokens WHERE workspace_id = $1 AND member_id = $2 AND revoked_at IS NULL', [actor.workspace.id, actor.member.id]);
  if (active!.n >= 10) throw new RuleError('limit', 'You already have 10 active agent tokens in this team. Revoke unused ones first.');
  const token = newSecret(AGENT_TOKEN_PREFIX);
  const id = randomUUID();
  await q('INSERT INTO agent_tokens (id, workspace_id, member_id, name, token_hash, token_prefix) VALUES ($1,$2,$3,$4,$5,$6)', [
    id, actor.workspace.id, actor.member.id, name, sha256(token), token.slice(0, AGENT_TOKEN_PREFIX.length + 4),
  ]);
  await logActivity(actor, { kind: 'agent_token', message: `connected agent "${name}"` });
  return c.json({ id, token, mcpUrl: `${new URL(c.req.url).origin}/mcp` });
});

api.delete('/agent-tokens/:id', async (c) => {
  const actor = actorOf(c);
  requireHuman(actor);
  const t = await one('SELECT * FROM agent_tokens WHERE workspace_id = $1 AND id = $2', [actor.workspace.id, c.req.param('id')]);
  if (!t) throw new RuleError('not_found', 'Token not found', 404);
  if (t.member_id !== actor.member.id && !isAdmin(actor)) throw new RuleError('forbidden', 'You can only revoke your own agent tokens (P5)', 403);
  await q('UPDATE agent_tokens SET revoked_at = now() WHERE id = $1', [t.id]);
  await logActivity(actor, { kind: 'agent_token', message: `revoked agent "${t.name}"` });
  return c.json({ ok: true });
});

// ----- Projects -----
api.get('/projects', async (c) => {
  const rows = await q(`SELECT p.*,
      (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status NOT IN ('done','cancelled')) AS open_tasks
    FROM projects p WHERE p.workspace_id = $1 AND NOT p.archived ORDER BY p.created_at`, [wsOf(c)]);
  return c.json({ projects: rows });
});

function projectFields(b: any) {
  const out: any = {};
  if (b.name !== undefined) { out.name = String(b.name).trim(); if (!out.name) throw new RuleError('invalid', 'Name is required'); }
  if (b.agent_instructions !== undefined) out.agent_instructions = String(b.agent_instructions);
  if (b.wip_limit !== undefined) {
    out.wip_limit = Number(b.wip_limit);
    if (!Number.isInteger(out.wip_limit) || out.wip_limit < 1 || out.wip_limit > 20) throw new RuleError('invalid', 'WIP limit must be 1–20');
  }
  return out;
}

api.post('/projects', async (c) => {
  const actor = actorOf(c);
  requireAdmin(actor);
  const b = await body(c);
  const key = String(b.key ?? '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) throw new RuleError('invalid', 'Key must be 2–10 letters/digits starting with a letter (e.g. WEB)');
  if (await one('SELECT id FROM projects WHERE workspace_id = $1 AND key = $2', [actor.workspace.id, key])) throw new RuleError('exists', `Project key ${key} is taken`, 409);
  const f = projectFields({ name: b.name ?? '', ...b });
  await q('INSERT INTO projects (id, workspace_id, key, name, agent_instructions, wip_limit) VALUES ($1,$2,$3,$4,$5,$6)', [
    randomUUID(), actor.workspace.id, key, f.name, f.agent_instructions ?? '', f.wip_limit ?? 3,
  ]);
  await logActivity(actor, { kind: 'project', message: `created project ${key}` });
  return c.json({ ok: true, key });
});

api.patch('/projects/:key', async (c) => {
  const actor = actorOf(c);
  requireAdmin(actor);
  const f = projectFields(await body(c));
  const keys = Object.keys(f);
  if (keys.length) {
    await q(`UPDATE projects SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE workspace_id = $1 AND key = $2`, [
      actor.workspace.id, c.req.param('key').toUpperCase(), ...keys.map((k) => f[k]),
    ]);
    await logActivity(actor, { kind: 'project', message: `updated project ${c.req.param('key').toUpperCase()} (${keys.join(', ')})` });
  }
  return c.json({ ok: true });
});

// ----- Tasks -----
api.get('/tasks', async (c) => {
  const f = c.req.query();
  const tasks = await listTasks(wsOf(c), {
    project: f.project, status: f.status, q: f.q,
    assignee: f.assignee === 'me' ? actorOf(c).member.id : f.assignee,
    reviewer: f.reviewer === 'me' ? actorOf(c).member.id : f.reviewer,
  });
  return c.json({ tasks });
});
api.post('/tasks', async (c) => c.json({ task: await createTask(actorOf(c), await body(c)) }));
api.get('/tasks/:key', async (c) => c.json(await contextPack(actorOf(c), c.req.param('key'))));
api.patch('/tasks/:key', async (c) => c.json({ task: await updateTask(actorOf(c), c.req.param('key'), await body(c)) }));
api.post('/tasks/:key/actions/:action', async (c) =>
  c.json({ task: await transition(actorOf(c), c.req.param('key'), c.req.param('action') as Action, await body(c)) }),
);
api.post('/tasks/:key/comments', async (c) => c.json(await addComment(actorOf(c), c.req.param('key'), (await body(c)).body)));
api.post('/tasks/:key/progress', async (c) => c.json(await logProgress(actorOf(c), c.req.param('key'), (await body(c)).message)));

api.post('/tasks/:key/handoff', async (c) => c.json({ task: await requestHandoff(actorOf(c), c.req.param('key'), await body(c)) }));
api.post('/tasks/:key/takeover', async (c) => c.json({ task: await takeOver(actorOf(c), c.req.param('key')) }));
api.get('/handoffs', async (c) => c.json({ tasks: await listHandoffs(actorOf(c)) }));
api.get('/capacity', async (c) => c.json({ agents: await teamCapacity(wsOf(c)), limits: { exhausted: LIMITS.usageExhausted, minToTakeOver: LIMITS.usageMinToTakeOver } }));
api.post('/usage', async (c) => c.json(await reportUsage(actorOf(c), await body(c))));

// ----- Check-ins -----
api.get('/asks', async (c) => {
  const r = await inbox(actorOf(c));
  if (c.req.query('seen') === '1') await markAnswersSeen(actorOf(c));
  return c.json(r);
});
api.get('/asks/unread', async (c) => c.json({ unread: await unreadCount(actorOf(c)) }));
api.post('/asks', async (c) => c.json(await askTeammate(actorOf(c), await body(c))));
api.post('/asks/:id/answer', async (c) => c.json(await answerAsk(actorOf(c), c.req.param('id'), (await body(c)).answer)));
api.post('/asks/:id/close', async (c) => c.json(await closeAsk(actorOf(c), c.req.param('id'))));

// ----- Hooks in the agent's own client (Bearer agent token) -----
function requireAgent(a: Actor) {
  if (a.kind !== 'agent') throw new RuleError('forbidden', 'This endpoint is for agent tokens', 403);
}
/** SessionStart / UserPromptSubmit hook: the focus lock as plain text, or nothing at all when unlocked. */
api.get('/agent/focus', async (c) => {
  requireAgent(actorOf(c));
  return c.text(await focusBrief(actorOf(c)));
});
/** PostToolUse hook: one line per tool the agent ran. A no-op unless the owner turned the log on (L1). */
api.post('/agent/log', async (c) => {
  const actor = actorOf(c);
  requireAgent(actor);
  if (actor.policy?.log) {
    const s = summarizeHook((await c.req.text()).slice(0, 8000));
    if (s) await recordAction(actor, { source: 'local', ...s });
  }
  return c.body(null, 204);
});
api.get('/agent-actions', async (c) => {
  const f = c.req.query();
  return c.json({ actions: await listActions(actorOf(c), { member: f.member, before: Number(f.before) || undefined, limit: Number(f.limit) || 100 }) });
});

api.get('/activity', async (c) => {
  const before = Number(c.req.query('before')) || undefined;
  return c.json({ activity: await listActivity(wsOf(c), { limit: Number(c.req.query('limit')) || 50, before }) });
});

app.route('/api', api);
app.notFound((c) => c.json({ error: 'not_found', message: 'No such endpoint' }, 404));
