// Agent action log (L1–L2): when the owner turns it on, every agent action becomes one tiny row —
// the tool and its target, nothing else. Platter writes rows for its own tools; a background
// hook in the agent's client sends the rest. Neither path goes through the model, so no tokens.
import { one, q } from './db.ts';
import { RuleError, isAdmin, type Actor } from './rules.ts';

const MAX_TARGET = 120;
const FOLD_MINUTES = 10;

/** Strip anything that looks like a credential before it is stored. */
export function redact(s: string) {
  return s
    .replace(/(bearer\s+)\S+/gi, '$1•••')
    .replace(/\b(?:plt|sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs]|AKIA|AIza)[-_A-Za-z0-9]{8,}/g, '•••')
    .replace(/((?:token|secret|passw(?:or)?d|pwd|api[_-]?key|auth|credential)[A-Za-z_]*["']?\s*[=:]\s*["']?)[^\s"'&]+/gi, '$1•••')
    .replace(/(--password[= ])\S+/g, '$1•••')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1•••@');
}

const clip = (s: string) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > MAX_TARGET ? one.slice(0, MAX_TARGET - 1) + '…' : one;
};

export async function recordAction(actor: Actor, a: { source: 'platter' | 'local'; action: string; target?: string; ok?: boolean }) {
  if (actor.kind !== 'agent' || !actor.policy?.log) return;
  const action = a.action.slice(0, 60);
  const target = clip(redact(a.target ?? ''));
  const ok = a.ok !== false;
  const last = await one(
    `SELECT id, action, target, ok, last_at FROM agent_actions WHERE agent_id = $1 ORDER BY id DESC LIMIT 1`,
    [actor.agent!.id],
  );
  if (last && last.action === action && last.target === target && last.ok === ok &&
      Date.now() - new Date(last.last_at).getTime() < FOLD_MINUTES * 60_000) {
    await q('UPDATE agent_actions SET n = n + 1, last_at = now() WHERE id = $1', [last.id]);
    return;
  }
  const task = await one(
    `SELECT id FROM tasks WHERE workspace_id = $1 AND claimed_by_agent_id = $2 AND status IN ('in_progress','blocked') ORDER BY updated_at DESC LIMIT 1`,
    [actor.workspace.id, actor.agent!.id],
  );
  await q(
    `INSERT INTO agent_actions (workspace_id, agent_id, member_id, task_id, source, action, target, ok) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [actor.workspace.id, actor.agent!.id, actor.member.id, task?.id ?? null, a.source, action, target, ok],
  );
  // Keep the log small (L2).
  if (Math.random() < 0.02) await q(`DELETE FROM agent_actions WHERE workspace_id = $1 AND created_at < now() - interval '30 days'`, [actor.workspace.id]);
}

/** A string field from hook JSON that the hook may have cut off mid-way (it only sends the first 2 KB). */
function field(raw: string, key: string): string {
  const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(raw);
  if (!m) return '';
  const body = m[1].replace(/\\u[0-9a-fA-F]{0,3}$|\\$/, '');
  try { return JSON.parse(`"${body}"`); } catch { return body; }
}

const INPUT_KEYS = ['file_path', 'notebook_path', 'command', 'pattern', 'url', 'query', 'description', 'path'];

/**
 * Turn a Claude Code PostToolUse payload into "Edit · src/app.ts" style parts.
 * Returns null for Platter's own tools (Platter already logged them).
 */
export function summarizeHook(raw: string): { action: string; target: string; ok: boolean } | null {
  let tool = '';
  let cwd = '';
  let input: Record<string, any> = {};
  let ok = true;
  try {
    const j = JSON.parse(raw);
    tool = String(j.tool_name ?? '');
    cwd = String(j.cwd ?? '');
    input = j.tool_input && typeof j.tool_input === 'object' ? j.tool_input : {};
    const res = j.tool_response;
    if (res && typeof res === 'object' && (res.is_error === true || res.success === false || res.interrupted === true)) ok = false;
  } catch {
    tool = field(raw, 'tool_name');
    cwd = field(raw, 'cwd');
    for (const k of INPUT_KEYS) { const v = field(raw, k); if (v) input[k] = v; }
  }
  if (!tool) return null;
  if (/^mcp__platter__/.test(tool)) return null;
  const rel = (p: string) => (cwd && p.startsWith(cwd + '/') ? p.slice(cwd.length + 1) : p);
  let action = tool;
  let target = '';
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (mcp) action = `${mcp[1]}.${mcp[2]}`.slice(0, 60);
  if (input.file_path || input.notebook_path) target = rel(String(input.file_path || input.notebook_path));
  else if (tool === 'Bash' && input.command) target = String(input.command).split('\n')[0];
  else if (input.pattern) target = String(input.pattern) + (input.path ? ` in ${rel(String(input.path))}` : '');
  else if (input.url) target = String(input.url).replace(/^https?:\/\//, '').replace(/[?#].*$/, '');
  else if (input.query) target = String(input.query);
  else if (input.description) target = String(input.description);
  else if (input.path) target = rel(String(input.path));
  return { action, target, ok };
}

/** Owner/admins see every agent; everyone else sees their own agents (L2). */
export async function listActions(actor: Actor, opts: { member?: string; before?: number; limit?: number }) {
  if (actor.kind !== 'human') throw new RuleError('forbidden', 'This action requires a signed-in person', 403);
  const params: unknown[] = [actor.workspace.id];
  const where = ['a.workspace_id = $1'];
  const member = isAdmin(actor) ? opts.member : actor.member.id;
  if (member) { params.push(member); where.push(`a.member_id = $${params.length}`); }
  if (opts.before) { params.push(opts.before); where.push(`a.id < $${params.length}`); }
  params.push(Math.min(opts.limit ?? 100, 300));
  const rows = await q(
    `SELECT a.id, a.source, a.action, a.target, a.ok, a.n, a.created_at, a.last_at, a.member_id,
            u.name AS member_name, ag.name AS agent_name,
            CASE WHEN t.id IS NULL THEN NULL ELSE p.key || '-' || t.number END AS task_key
       FROM agent_actions a
       JOIN users u ON u.id = a.member_id
       JOIN agent_tokens ag ON ag.id = a.agent_id
       LEFT JOIN tasks t ON t.id = a.task_id
       LEFT JOIN projects p ON p.id = t.project_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.id DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}
