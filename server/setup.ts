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
1. Energy: run \`claude -p "/usage"\` in a shell. Find the limit with the highest "% used" and call the Platter tool report_usage with that as used_percent (and its reset time as resets_at). Send the exact number.
2. Messages: call Platter check_inbox.
   - Questions from teammates are for you, my agent. Look each one up in Platter (get_task, list_my_tasks, the task's progress), the repo (git log, branches, files) and your own work, then answer it with answer_question: the answer first, then what you checked. If you can't confirm something, say what you found and what is unknown. Never guess, and don't leave questions for me.
   - Answers to my questions: collect them.
3. Finish with a short summary for me: new answers, and the questions you answered. If nothing is new, just say "Nothing new on Platter."`;

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const addCmd = (mcpUrl: string, token: string) =>
  `claude mcp add --transport http --scope user platter ${mcpUrl} --header "Authorization: Bearer ${token}"`;

/** Mac: connect, check, and install Platter's free background check-in. Piped to sh.
 *  An old "platter" entry in a folder (local) scope beats the user-scope one, so a re-run that only
 *  replaced the user entry kept sending a dead key (401). Clear every scope, then prove the key works. */
export function macScript(origin: string, mcpUrl: string, token: string, name: string) {
  return `#!/bin/sh
# Platter setup for "${name.replace(/[^\w .'-]/g, '')}". This link has now been used and won't work again.
# The full setup, as asked for in Platter's setup line:
#   1. the "platter" MCP server in Claude Code (user scope), replacing any old Platter keys
#   2. ~/.platter/checkin.py, the same script as scripts/checkin.py in the Platter repo, run by a
#      LaunchAgent every 5 minutes: reports energy, answers teammates' questions
#   3. Claude Code hooks for the owner's focus lock, energy after task steps and the action log
# If they're missing, it first installs what it needs: Apple's Command Line Tools (python3) and the
# Claude Code command line, with Anthropic's official installer (https://claude.ai/install.sh).
# Undo all of it: python3 ~/.platter/checkin.py --uninstall && claude mcp remove platter -s user
set -e
[ "$(uname)" = Darwin ] || { echo "This setup is for macOS. In Platter, pick the Windows / Linux setup line instead."; exit 1; }
# Where Anthropic's installer puts claude; also on PATH for this run, right after installing it.
export PATH="$HOME/.local/bin:$PATH"

echo "Checking what this Mac needs…"
# /usr/bin/python3 is only a stub until the Command Line Tools are in (the check-in runs it).
if ! xcode-select -p >/dev/null 2>&1; then
  echo "   Installing Apple's Command Line Tools (for python3): click Install in the window that opens. This can take a few minutes."
  xcode-select --install >/dev/null 2>&1 || true
  n=0
  until xcode-select -p >/dev/null 2>&1; do
    n=$((n + 1))
    [ "$n" -gt 360 ] && { echo "The Command Line Tools didn't finish installing. Install them with 'xcode-select --install', then make a new setup link in Platter."; exit 1; }
    sleep 5
  done
fi
echo "   python3: ok"
if ! command -v claude >/dev/null 2>&1; then
  echo "   Installing the Claude Code command line…"
  curl -fsSL https://claude.ai/install.sh | bash >/dev/null || { echo "Couldn't install Claude Code. Install it from https://claude.ai/install.sh, then make a new setup link in Platter."; exit 1; }
  command -v claude >/dev/null 2>&1 || { echo "Claude Code installed, but the 'claude' command isn't in $HOME/.local/bin. Open a new Terminal and make a new setup link in Platter."; exit 1; }
fi
echo "   claude: ok ($(claude --version </dev/null 2>/dev/null | head -1))"
PLATTER_URL=${sh(mcpUrl)}
PLATTER_KEY=${sh(token)}
export PLATTER_URL PLATTER_KEY

echo "1/4 Removing old Platter connections…"
claude mcp remove platter -s user </dev/null >/dev/null 2>&1 || true
python3 - <<'PY'
import json, os, shutil, tempfile
p = os.path.realpath(os.path.expanduser('~/.claude.json'))
if not os.path.exists(p):
    raise SystemExit
cfg = json.load(open(p))
gone = []
if (cfg.get('mcpServers') or {}).pop('platter', None) is not None:
    gone.append('every folder')
for proj, v in (cfg.get('projects') or {}).items():
    if isinstance(v, dict) and (v.get('mcpServers') or {}).pop('platter', None) is not None:
        gone.append(proj)
if gone:
    shutil.copy2(p, p + '.before-platter')
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p))
    with os.fdopen(fd, 'w') as f:
        json.dump(cfg, f, indent=2)
    os.chmod(tmp, os.stat(p).st_mode & 0o777)
    os.replace(tmp, p)
    for g in gone:
        print('   removed an old key for ' + g)
PY

echo "2/4 Connecting Platter to Claude Code…"
claude mcp add --transport http --scope user platter "$PLATTER_URL" --header "Authorization: Bearer $PLATTER_KEY" </dev/null >/dev/null

echo "3/4 Checking the connection…"
code=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' -X POST "$PLATTER_URL" -H "Authorization: Bearer $PLATTER_KEY" \\
  -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' </dev/null) || code=000
case "$code" in
  200) echo "   Platter accepted the key." ;;
  401) echo "Platter refused this key: it was replaced (New link) or disconnected after this link was made. Make a new setup link in Platter."; exit 1 ;;
  *) echo "   Couldn't reach Platter (HTTP $code). The setup is saved; it will work once Platter is reachable." ;;
esac
python3 - <<'PY'
import json, os
cfg = json.load(open(os.path.expanduser('~/.claude.json')))
mine = ((cfg.get('mcpServers') or {}).get('platter') or {}).get('headers', {}).get('Authorization')
others = [k for k, v in (cfg.get('projects') or {}).items() if isinstance(v, dict) and 'platter' in (v.get('mcpServers') or {})]
if mine != 'Bearer ' + os.environ['PLATTER_KEY']:
    raise SystemExit('Claude Code did not save the new key. Run this setup again with a new link from Platter.')
for k in others:
    print('   warning: another Platter key is still set for ' + k)
if os.path.exists('.mcp.json') and 'platter' in open('.mcp.json').read():
    print('   warning: ./.mcp.json also defines "platter"; remove it there so this folder uses the new key')
PY

echo "4/4 Installing the free background check-in…"
mkdir -p "$HOME/.platter"
curl -fsSL ${sh(`${origin}/checkin.py`)} -o "$HOME/.platter/checkin.py"
python3 "$HOME/.platter/checkin.py" --install </dev/null
echo ""
echo "Done. Platter is connected. Back in Platter, step 2 turns green."
# The check-in reads energy with 'claude -p /usage', which needs Claude Code signed in.
if ! perl -e 'alarm 90; exec @ARGV' claude -p /usage </dev/null 2>/dev/null | grep -q '% used'; then
  echo "One last step: open Terminal, run 'claude' and sign in. Until then the check-in can't report your energy."
fi
echo "Restart Claude Code (quit the app, or open new sessions): sessions already open keep the old key."
`;
}

/** Windows / Linux: the steps for Claude Code to follow (hooks + a scheduled routine). */
export function setupPrompt(origin: string, mcpUrl: string, token: string) {
  const auth = `-H 'Authorization: Bearer ${token}'`;
  const focusHook = `curl -fsS -m 3 ${auth} ${origin}/api/agent/focus || true`;
  const logHook = `b=$(head -c 2000); printf '%s' "$b" | curl -fsS -m 3 -X POST ${auth} -H 'content-type: application/json' --data-binary @- ${origin}/api/agent/log >/dev/null 2>&1 &`;
  const cmdHook = (command: string) => [{ hooks: [{ type: 'command', command }] }];
  const hooks = JSON.stringify({ hooks: { SessionStart: cmdHook(focusHook), UserPromptSubmit: cmdHook(focusHook), PostToolUse: cmdHook(logHook) } }, null, 2);
  return `Platter setup steps. I want the full setup: do all four steps in order without stopping to ask which ones, then tell me in one line what you did. (This setup link has now been used and won't work again.)

1. Connect: run this in a shell. If it says "platter" already exists, run \`claude mcp remove platter -s user\` first, then run it again.
${addCmd(mcpUrl, token)}

2. Check: run \`claude mcp list\` and make sure platter shows as connected. That is also how Platter knows the setup worked.

3. Team rules: add these hooks to ~/.claude/settings.json. Merge them into any "hooks" already there and keep everything else as it is. If a hook that calls ${origin}/api/agent is already there, replace it rather than adding a second one. They make the owner's focus lock and action log work here, and cost no tokens.
${hooks}

4. Check-in: schedule this every 30 minutes. Use your scheduling tool; in a terminal session without one, run it with /loop 30m.

${ROUTINE_PROMPT}
`;
}
