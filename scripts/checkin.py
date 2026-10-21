#!/usr/bin/env python3
"""Platter check-in that costs no tokens most of the time (macOS + Claude Code).

Works with the Python 3.9 that ships with macOS. Get it from your Platter site:
  mkdir -p ~/.platter && curl -fsSL <your-platter>/checkin.py -o ~/.platter/checkin.py && python3 ~/.platter/checkin.py --install

Every run:
  1. Energy: reads `claude -p "/usage"` (a local command, no model call) and posts the
     tightest limit to Platter.
  2. Questions: asks Platter whether teammates asked you anything.
  3. Only if they did, starts a slimmed-down Claude Code run (Platter tools only, no plugins
     or skills, Sonnet by default) to look each question up and answer it.

The agent token is read from your Claude Code config (the "platter" MCP server), so nothing
secret is stored here. Settings, all optional:
  PLATTER_MODEL    model for answering (default: sonnet)
  PLATTER_WORKDIR  folder the answering agent starts in, e.g. your repos (default: home)
  CLAUDE_BIN       path to the claude CLI
  PLATTER_URL + PLATTER_TOKEN  use this MCP URL and agent token instead of the Claude Code config

Run it by hand to try it:  python3 scripts/checkin.py
Energy only (what the Claude Code hook runs after a task step):  python3 scripts/checkin.py --energy
One-line action log (what the hook runs after every tool, if the owner turned the log on):  --log
Focus lock note (what the hook runs before each prompt; prints nothing unless the owner locked you):  --focus
Install it (every 5 minutes, macOS, plus the hook):  python3 scripts/checkin.py --install
Remove it:  python3 scripts/checkin.py --uninstall
"""
from __future__ import annotations

import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

HOME = Path.home()
STATE = HOME / '.platter'
LOG = HOME / 'Library' / 'Logs' / 'platter-checkin.log'
LABEL = 'so.platter.checkin'
INTERVAL = 300  # seconds: energy every 5 minutes costs nothing, so check often
# Platter tools after which energy is posted at once (task started, submitted, reviewed, handed on).
TASK_STEPS = 'mcp__platter__(start_task|submit_for_review|review_task|take_over_task|handoff_task|resume_task)'
SETTINGS = HOME / '.claude' / 'settings.json'
# The stable macOS shim, not a versioned path (Xcode's moves when Xcode updates).
PYTHON = '/usr/bin/python3' if Path('/usr/bin/python3').exists() else sys.executable
PLIST = HOME / 'Library' / 'LaunchAgents' / f'{LABEL}.plist'
MONTHS = {m: i + 1 for i, m in enumerate('jan feb mar apr may jun jul aug sep oct nov dec'.split())}


def log(msg: str) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open('a') as f:
        f.write(f'{datetime.now():%Y-%m-%d %H:%M} {msg}\n')
    # Keep the log small: last 500 lines.
    lines = LOG.read_text().splitlines()
    if len(lines) > 600:
        LOG.write_text('\n'.join(lines[-500:]) + '\n')


def claude_bin() -> str:
    return os.environ.get('CLAUDE_BIN') or shutil.which('claude') or str(HOME / '.local' / 'bin' / 'claude')


def platter_server() -> dict:
    """The "platter" MCP server from ~/.claude.json (user scope first, then any project)."""
    if os.environ.get('PLATTER_URL') and os.environ.get('PLATTER_TOKEN'):
        return {'type': 'http', 'url': os.environ['PLATTER_URL'], 'headers': {'Authorization': f'Bearer {os.environ["PLATTER_TOKEN"]}'}}
    cfg = json.loads((HOME / '.claude.json').read_text())
    found = cfg.get('mcpServers', {}).get('platter')
    if not found:
        for proj in cfg.get('projects', {}).values():
            found = (proj.get('mcpServers') or {}).get('platter')
            if found:
                break
    if not found or 'url' not in found:
        sys.exit('No "platter" MCP server in ~/.claude.json. Connect your agent in Platter → Settings first.')
    return found


def api(server: dict, method: str, path: str, body: dict | None = None):
    base = server['url'].rsplit('/mcp', 1)[0]
    req = urllib.request.Request(base + '/api' + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    for k, v in (server.get('headers') or {}).items():
        req.add_header(k, v)
    req.add_header('content-type', 'application/json')
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read() or b'null') if r.status != 204 else None


def parse_reset(text: str):
    """'Oct 21 at 7:30pm (Asia/Dubai)' or '7:30pm (Asia/Dubai)' → ISO time, else None."""
    m = re.search(r'(?:([A-Za-z]{3})[a-z]* (\d{1,2})(?:, (\d{4}))?)?,? ?(?:at )?(?:(\d{1,2})(?::(\d{2}))? ?(am|pm))? ?\(([^)]+)\)', text)
    if not m:
        return None
    mon, day, year, hour, minute, ampm, zone = m.groups()
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(zone)
    except Exception:
        return None
    if not mon and not hour:
        return None
    now = datetime.now(tz)
    h = int(hour) % 12 + (12 if ampm == 'pm' else 0) if hour else 0
    when = now.replace(hour=h, minute=int(minute or 0), second=0, microsecond=0)
    if mon and MONTHS.get(mon.lower()):
        when = when.replace(month=MONTHS[mon.lower()], day=int(day), year=int(year) if year else now.year)
        if when < now - timedelta(days=1) and not year:
            when = when.replace(year=now.year + 1)
    elif when < now:
        when += timedelta(days=1)
    return when.isoformat()


def report_energy(server: dict) -> str:
    out = subprocess.run([claude_bin(), '-p', '/usage'], capture_output=True, text=True, timeout=120).stdout
    limits = re.findall(r'^(.+?):\s*(\d+(?:\.\d+)?)% used(?:\s*·\s*resets (.+))?$', out, re.M)
    if not limits:
        return 'energy: /usage had no limits'
    label, used, resets = max(limits, key=lambda x: float(x[1]))
    body = {'used_percent': float(used), 'note': label.strip()}
    iso = parse_reset(resets) if resets else None
    if iso:
        body['resets_at'] = iso
    r = api(server, 'POST', '/usage', body)
    return f'energy: {r["remaining_percent"]}% left'


ANSWER = """You are {name}'s agent on Platter, the team's task board. Teammates asked these questions, and they are for you:

{questions}

For each one, look it up first: Platter (get_task, list_my_tasks, find_work) and the code on this machine (git log, branches, files). Then call answer_question with its id. Start with the answer, then say in a few words what you checked. If you can't confirm something, say what you found and what is unknown. Never guess.

When every question is answered, reply with only: Answered {n}."""

TOOLS = ['mcp__platter__answer_question', 'mcp__platter__get_task', 'mcp__platter__list_my_tasks', 'mcp__platter__find_work',
         'Read', 'Grep', 'Glob', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git branch:*)', 'Bash(git status:*)', 'Bash(ls:*)']


def answer_questions(server: dict, me: dict, asks: list) -> str:
    qs = '\n'.join(f'- id {a["id"]}: from {a["from_name"]}{" about " + a["task_key"] if a.get("task_key") else ""}: "{a["question"]}"' for a in asks)
    prompt = ANSWER.format(name=me['name'], questions=qs, n=len(asks))
    # Only Platter's tools, no plugins, hooks or skills: about 14k tokens of context instead of ~60k.
    fd, cfg = tempfile.mkstemp(suffix='.json')
    os.write(fd, json.dumps({'mcpServers': {'platter': server}}).encode())
    os.close(fd)
    os.chmod(cfg, 0o600)
    try:
        r = subprocess.run(
            [claude_bin(), '-p', prompt, '--output-format', 'json', '--model', os.environ.get('PLATTER_MODEL', 'sonnet'),
             '--strict-mcp-config', '--mcp-config', cfg, '--setting-sources', 'project', '--disable-slash-commands',
             '--tools', 'Read,Grep,Glob,Bash', '--allowedTools', *TOOLS, '--no-session-persistence'],
            capture_output=True, text=True, timeout=900, cwd=os.environ.get('PLATTER_WORKDIR', str(HOME)),
        )
    finally:
        os.remove(cfg)
    try:
        d = json.loads(r.stdout)
        u = d.get('usage', {})
        tokens = sum(u.get(k, 0) for k in ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'))
        return f'questions: {len(asks)}, {str(d.get("result", "")).strip()[:60]} ({tokens} tokens)'
    except Exception:
        return f'questions: {len(asks)}, claude failed: {(r.stderr or r.stdout).strip()[:120]}'


def energy_only() -> None:
    """Right after a task step: just post energy. Own lock, so it never waits on a question run."""
    STATE.mkdir(exist_ok=True)
    with (STATE / 'energy.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        try:
            log(f'after a task step · {report_energy(platter_server())}')
        except Exception as e:
            log(f'after a task step · energy failed: {e}')


def focus_note() -> None:
    """SessionStart / UserPromptSubmit hook: print the owner's focus lock, if any, for Claude to see.
    Prints nothing when unlocked, so it adds no tokens; never fails the prompt."""
    try:
        sys.stdin.buffer.read()
        server = platter_server()
        base = server['url'].rsplit('/mcp', 1)[0]
        req = urllib.request.Request(base + '/api/agent/focus')
        for k, v in (server.get('headers') or {}).items():
            req.add_header(k, v)
        with urllib.request.urlopen(req, timeout=3) as r:
            sys.stdout.write(r.read().decode())
    except Exception:
        pass


def log_action() -> None:
    """PostToolUse hook: send this tool call to Platter as one line (tool + target), then get out of the way.

    Platter keeps only the tool and its target and drops the rest; nothing is stored unless the
    team owner turned the action log on. The upload happens in a detached child, so the agent
    never waits on the network.
    """
    raw = sys.stdin.buffer.read()[:2000]  # read everything so the writer never blocks; send only the start
    if not raw or os.fork():
        return
    os.setsid()
    devnull = os.open(os.devnull, os.O_RDWR)
    for fd in (0, 1, 2):
        os.dup2(devnull, fd)
    try:
        server = platter_server()
        base = server['url'].rsplit('/mcp', 1)[0]
        req = urllib.request.Request(base + '/api/agent/log', method='POST', data=raw)
        for k, v in (server.get('headers') or {}).items():
            req.add_header(k, v)
        req.add_header('content-type', 'application/json')
        urllib.request.urlopen(req, timeout=5).close()
    except Exception:
        pass
    os._exit(0)


def run() -> None:
    STATE.mkdir(exist_ok=True)
    with (STATE / 'checkin.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return  # the previous check-in is still running
        server = platter_server()
        parts = []
        try:
            parts.append(report_energy(server))
        except Exception as e:  # keep going: questions still matter
            parts.append(f'energy failed: {e}')
        me = api(server, 'GET', '/me')['me']
        asks = [a for a in api(server, 'GET', '/asks')['for_me'] if a.get('status') == 'open']
        parts.append(answer_questions(server, me, asks) if asks else 'questions: none (0 tokens)')
        log(' · '.join(parts))


def install() -> None:
    # Run a private copy, so moving or deleting the repo doesn't break the schedule.
    STATE.mkdir(exist_ok=True)
    script = STATE / 'checkin.py'
    if Path(__file__).resolve() != script.resolve():  # installed from Platter, it already lives here
        shutil.copy(Path(__file__).resolve(), script)
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    env = {'PATH': f'{Path(claude_bin()).parent}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin'}
    for k in ('PLATTER_MODEL', 'PLATTER_WORKDIR', 'CLAUDE_BIN'):
        if os.environ.get(k):
            env[k] = os.environ[k]
    env_xml = ''.join(f'<key>{k}</key><string>{v}</string>' for k, v in env.items())
    PLIST.write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>{LABEL}</string>
  <key>ProgramArguments</key><array><string>{PYTHON}</string><string>{script}</string></array>
  <key>StartInterval</key><integer>{INTERVAL}</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key><dict>{env_xml}</dict>
  <key>StandardErrorPath</key><string>{LOG}</string>
</dict></plist>
""")
    subprocess.run(['launchctl', 'unload', str(PLIST)], capture_output=True)
    subprocess.run(['launchctl', 'load', str(PLIST)], check=True)
    set_hooks(script)
    print(f'Installed. Every {INTERVAL // 60} minutes: energy (free) and teammates\' questions.')
    print('Also: energy right after each task step, the owner\'s focus lock, and a one-line action log if the owner turned it on.')
    print(f'Log: {LOG}')


def set_hooks(script: Path | None) -> int:
    """Add (or remove, with None) our Claude Code hooks in ~/.claude/settings.json, keeping everything else.
    Returns how many of our hooks were there before."""
    if not script and not SETTINGS.exists():
        return 0
    cfg = json.loads(SETTINGS.read_text()) if SETTINGS.exists() else {}
    hooks = cfg.setdefault('hooks', {})
    ours = ('checkin.py --energy', 'checkin.py --log', 'checkin.py --focus')
    wanted: dict[str, list] = {}
    if script:
        focus = [{'hooks': [{'type': 'command', 'command': f'{PYTHON} {script} --focus'}]}]
        wanted = {
            # The owner's focus lock, in front of every session and prompt (prints nothing when unlocked).
            'SessionStart': focus,
            'UserPromptSubmit': focus,
            'PostToolUse': [
                {'matcher': TASK_STEPS, 'hooks': [{'type': 'command', 'command': f'{PYTHON} {script} --energy >/dev/null 2>&1 &'}]},
                {'hooks': [{'type': 'command', 'command': f'{PYTHON} {script} --log'}]},
            ],
        }
    found = 0
    for event in set(hooks) | set(wanted):
        before = hooks.get(event, [])
        groups = [g for g in before if not any(o in h.get('command', '') for h in g.get('hooks', []) for o in ours)]
        found += len(before) - len(groups)
        groups += wanted.get(event, [])
        if groups:
            hooks[event] = groups
        else:
            hooks.pop(event, None)
    if not script and not found:
        return 0  # nothing of ours: leave the file exactly as it is
    if not hooks:
        cfg.pop('hooks', None)
    SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS.write_text(json.dumps(cfg, indent=2) + '\n')
    return found


def uninstall() -> None:
    """Remove what --install added, and say exactly what was (or wasn't) there."""
    removed = []
    if subprocess.run(['launchctl', 'list', LABEL], capture_output=True).returncode == 0:
        subprocess.run(['launchctl', 'unload', str(PLIST)], capture_output=True)
        removed.append('the background job (every 5 minutes)')
    if PLIST.exists():
        PLIST.unlink()
        removed.append(f'its schedule ({PLIST})')
    copy = STATE / 'checkin.py'
    if copy.exists():
        copy.unlink()
        removed.append(f'the installed script ({copy})')
    n = set_hooks(None)
    if n:
        removed.append(f'{n} Claude Code hook{"s" if n > 1 else ""} from {SETTINGS}')
    for lock in ('checkin.lock', 'energy.lock'):
        (STATE / lock).unlink(missing_ok=True)
    if not removed:
        print(f'Nothing to remove: no Platter check-in is installed for {HOME}.')
        print('If you installed it from another account or shell, run --uninstall there.')
        return
    print('Removed:')
    for r in removed:
        print(f'  - {r}')
    print(f'Kept: the log at {LOG}, if you want to look back.')


if __name__ == '__main__':
    {'--install': install, '--uninstall': uninstall, '--energy': energy_only, '--log': log_action, '--focus': focus_note}.get(sys.argv[1] if len(sys.argv) > 1 else '', run)()
