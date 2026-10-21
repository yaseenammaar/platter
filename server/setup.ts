// One-time setup links (Settings → My agent). Instead of a long prompt with the key in it,
// people paste one short line; the link returns the full setup, works once, for 30 minutes.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { one, q } from './db.ts';
import { RuleError } from './rules.ts';

const TTL_MINUTES = 30;

const idOf = (code: string) => createHash('sha256').update(`id:${code}`).digest('hex');
const keyOf = (code: string) => createHash('sha256').update(`key:${code}`).digest();

/** Seal the agent token with a key only the link code can rebuild; the database never holds it readable. */
export async function createSetupLink(agentTokenId: string, token: string) {
  const code = randomBytes(12).toString('base64url');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyOf(code), iv);
  const sealed = Buffer.concat([iv, c.update(token, 'utf8'), c.final(), c.getAuthTag()]).toString('base64url');
  await q('INSERT INTO setup_links (id_hash, agent_token_id, sealed, expires_at) VALUES ($1, $2, $3, $4)', [
    idOf(code), agentTokenId, sealed, new Date(Date.now() + TTL_MINUTES * 60_000),
  ]);
  return { code, expiresInMinutes: TTL_MINUTES };
}

/** Use a link once: returns the agent token and its name, or explains why not. */
export async function redeemSetupLink(code: string) {
  if (!/^[A-Za-z0-9_-]{16}$/.test(code)) throw new RuleError('not_found', 'That setup link is not right', 404);
  const row = await one(
    `UPDATE setup_links s SET used_at = now()
       FROM agent_tokens t
      WHERE s.id_hash = $1 AND s.used_at IS NULL AND s.expires_at > now() AND t.id = s.agent_token_id AND t.revoked_at IS NULL
      RETURNING s.sealed, t.name`,
    [idOf(code)],
  );
  if (!row) throw new RuleError('link_used', 'This setup link was already used or has expired. Make a new one in Platter → Settings → My agent.', 410);
  const buf = Buffer.from(row.sealed, 'base64url');
  const d = createDecipheriv('aes-256-gcm', keyOf(code), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(buf.length - 16));
  const token = Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString('utf8');
  return { token, name: row.name as string };
}

/** What the recurring check-in routine does (Windows / Linux, where the model runs it). */
export const ROUTINE_PROMPT = `Platter check-in routine.
1. Energy: run \`claude -p "/usage"\` in a shell. Find the limit with the highest "% used" and call the Platter tool report_usage with that as used_percent (and its reset time as resets_at). Platter rounds to the nearest 5%.
2. Messages: call Platter check_inbox.
   - Questions from teammates are for you, my agent. Look each one up in Platter (get_task, list_my_tasks, the task's progress), the repo (git log, branches, files) and your own work, then answer it with answer_question: the answer first, then what you checked. If you can't confirm something, say what you found and what is unknown. Never guess, and don't leave questions for me.
   - Answers to my questions: collect them.
3. Finish with a short summary for me: new answers, and the questions you answered. If nothing is new, just say "Nothing new on Platter."`;

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const addCmd = (mcpUrl: string, token: string) =>
  `claude mcp add --transport http --scope user platter ${mcpUrl} --header "Authorization: Bearer ${token}"`;

/** Mac: connect, check, and install Platter's free background check-in. Piped to sh. */
export function macScript(origin: string, mcpUrl: string, token: string, name: string) {
  return `#!/bin/sh
# Platter setup for "${name.replace(/[^\w .'-]/g, '')}". This link has now been used and won't work again.
set -e
command -v claude >/dev/null 2>&1 || { echo "Claude Code isn't installed (no 'claude' command). Install it, then make a new setup link in Platter."; exit 1; }
echo "1/3 Connecting Platter to Claude Code…"
claude mcp remove platter -s user >/dev/null 2>&1 || true
claude mcp add --transport http --scope user platter ${sh(mcpUrl)} --header ${sh(`Authorization: Bearer ${token}`)} >/dev/null
echo "2/3 Checking the connection…"
claude mcp list 2>/dev/null | grep -i '^platter' || echo "   (couldn't list servers; Platter will still show when it hears from your agent)"
echo "3/3 Installing the free background check-in…"
mkdir -p "$HOME/.platter"
curl -fsSL ${sh(`${origin}/checkin.py`)} -o "$HOME/.platter/checkin.py"
python3 "$HOME/.platter/checkin.py" --install
echo ""
echo "Done. Platter is connected. Back in Platter, step 2 turns green."
`;
}

/** Windows / Linux: the steps for Claude Code to follow (hooks + a scheduled routine). */
export function setupPrompt(origin: string, mcpUrl: string, token: string) {
  const auth = `-H 'Authorization: Bearer ${token}'`;
  const focusHook = `curl -fsS -m 3 ${auth} ${origin}/api/agent/focus || true`;
  const logHook = `b=$(head -c 2000); printf '%s' "$b" | curl -fsS -m 3 -X POST ${auth} -H 'content-type: application/json' --data-binary @- ${origin}/api/agent/log >/dev/null 2>&1 &`;
  const cmdHook = (command: string) => [{ hooks: [{ type: 'command', command }] }];
  const hooks = JSON.stringify({ hooks: { SessionStart: cmdHook(focusHook), UserPromptSubmit: cmdHook(focusHook), PostToolUse: cmdHook(logHook) } }, null, 2);
  return `Platter setup steps. Do these four steps in order, then tell me in one line what you did. (This setup link has now been used and won't work again.)

1. Connect: run this in a shell. If it says "platter" already exists, run \`claude mcp remove platter -s user\` first, then run it again.
${addCmd(mcpUrl, token)}

2. Check: run \`claude mcp list\` and make sure platter shows as connected. That is also how Platter knows the setup worked.

3. Team rules: add these hooks to ~/.claude/settings.json. Merge them into any "hooks" already there and keep everything else as it is. If a hook that calls ${origin}/api/agent is already there, replace it rather than adding a second one. They make the owner's focus lock and action log work here, and cost no tokens.
${hooks}

4. Check-in: schedule this every 30 minutes. Use your scheduling tool; in a terminal session without one, run it with /loop 30m.

${ROUTINE_PROMPT}
`;
}
