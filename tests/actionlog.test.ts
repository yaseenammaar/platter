import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { redact, summarizeHook } from '../server/actionlog.ts';
import { openLocalDb } from '../server/localdb.ts';
import { app } from '../server/app.ts';
import { BASE, Client, join, mcp, startTeam } from './helpers.ts';

const owner = new Client();
const admin = new Client();
const dev = new Client();
let devId = '';
let devAgent = '';
let ownerAgent = '';

/** What the PostToolUse hook sends: the first 2 KB of Claude Code's payload. */
const hook = (token: string, payload: unknown, cut = 2000) =>
  app.fetch(new Request(`${BASE}/api/agent/log`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload).slice(0, cut),
  }));
const post = (tool: string, input: any, extra: any = {}) => ({
  session_id: 's1', transcript_path: '/Users/d/.claude/x.jsonl', cwd: '/Users/d/app', hook_event_name: 'PostToolUse',
  tool_name: tool, tool_input: input, tool_response: { ok: true }, ...extra,
});

before(async () => {
  await openLocalDb();
  await startTeam(owner, { name: 'Olive Owner', email: 'olive@x.io', team: 'Log Co', projectKey: 'APP' });
  for (const [c, name, email, role] of [[admin, 'Ada Admin', 'ada@x.io', 'admin'], [dev, 'Dana Dev', 'dev@x.io', 'member']] as const) {
    const { link } = await owner.ok('POST', '/api/invites', { email, role });
    await join(c, link, { name, password: 'password-1234' });
  }
  devId = (await dev.ok('GET', '/api/me')).me.id;
  devAgent = (await dev.ok('POST', '/api/agent-tokens', { name: 'dana-agent' })).token;
  ownerAgent = (await owner.ok('POST', '/api/agent-tokens', { name: 'olive-agent' })).token;
});

test('hook payloads become one short line, even when cut off mid-way', () => {
  assert.deepEqual(summarizeHook(JSON.stringify(post('Edit', { file_path: '/Users/d/app/src/login.ts', old_string: 'a', new_string: 'b' }))),
    { action: 'Edit', target: 'src/login.ts', ok: true });
  assert.equal(summarizeHook(JSON.stringify(post('Bash', { command: 'npm test\necho done' })))!.target, 'npm test');
  const huge = JSON.stringify(post('Write', { file_path: '/Users/d/app/README.md', content: 'x'.repeat(50_000) })).slice(0, 2000);
  assert.deepEqual(summarizeHook(huge), { action: 'Write', target: 'README.md', ok: true });
  assert.equal(summarizeHook(JSON.stringify(post('mcp__platter__get_task', { key: 'APP-1' }))), null, 'Platter logs its own tools');
  assert.equal(summarizeHook(JSON.stringify(post('mcp__github__create_pr', { title: 'x' })))!.action, 'github.create_pr');
  assert.equal(summarizeHook(JSON.stringify(post('Bash', { command: 'false' }, { tool_response: { is_error: true } })))!.ok, false);
});

test('secrets are blanked out', () => {
  const s = redact('curl -H "Authorization: Bearer plt_abcdefghijklmnop" https://u:pw@x.io API_KEY=sk-123456789abc --password hunter2');
  for (const leak of ['plt_abcdefghijklmnop', 'pw@', 'sk-123456789abc', 'hunter2']) assert.ok(!s.includes(leak), `${leak} leaked: ${s}`);
  assert.equal(redact('mkdir -p src/lib'), 'mkdir -p src/lib');
});

test('nothing is recorded until the owner turns it on (L1)', async () => {
  assert.equal((await hook(devAgent, post('Edit', { file_path: '/Users/d/app/a.ts' }))).status, 204);
  await mcp(devAgent, 'list_my_tasks');
  assert.equal((await owner.ok('GET', '/api/agent-actions')).actions.length, 0);
  assert.equal((await admin.patch('/api/team', { agent_log: true })).status, 403, 'admins cannot');
  await owner.ok('PATCH', '/api/team', { agent_log: true });
  assert.equal((await owner.ok('GET', '/api/me')).policy.agent_log, true);
});

test('every agent action is logged once, repeats folded, no model involved (L1/L2)', async () => {
  await mcp(devAgent, 'whoami');
  assert.match((await mcp(devAgent, 'whoami')).text, /action log/);
  await mcp(devAgent, 'get_task', { key: 'APP-99' }); // fails
  for (const f of ['src/a.ts', 'src/a.ts', 'src/a.ts', 'src/b.ts']) assert.equal((await hook(devAgent, post('Read', { file_path: `/Users/d/app/${f}` }))).status, 204);
  await hook(devAgent, post('Bash', { command: 'GITHUB_TOKEN=ghp_secretsecretsecret gh pr create' }));
  await hook(devAgent, post('mcp__platter__whoami', {}));
  await hook(ownerAgent, post('Grep', { pattern: 'TODO', path: '/Users/d/app/src' }));

  const { actions } = await owner.ok('GET', '/api/agent-actions');
  const dana = actions.filter((a: any) => a.member_id === devId).reverse().map((a: any) => `${a.source}:${a.action}:${a.target}:${a.n}:${a.ok}`);
  assert.deepEqual(dana, [
    'platter:whoami::2:true',
    'platter:get_task:APP-99:1:false',
    'local:Read:src/a.ts:3:true',
    'local:Read:src/b.ts:1:true',
    'local:Bash:GITHUB_TOKEN=••• gh pr create:1:true',
  ]);
  assert.ok(actions.some((a: any) => a.agent_name === 'olive-agent' && a.target === 'TODO in src'));
});

test('owner and admins see everyone; members see only their own agents (L2)', async () => {
  const all = (await admin.ok('GET', '/api/agent-actions')).actions;
  assert.ok(all.some((a: any) => a.agent_name === 'olive-agent'));
  const mine = (await dev.ok('GET', '/api/agent-actions')).actions;
  assert.ok(mine.length > 0 && mine.every((a: any) => a.member_id === devId));
  const sneaky = (await dev.ok('GET', `/api/agent-actions?member=${(await owner.ok('GET', '/api/me')).me.id}`)).actions;
  assert.ok(sneaky.every((a: any) => a.member_id === devId));
});

test('turning it off stops recording', async () => {
  await owner.ok('PATCH', '/api/team', { agent_log: false });
  const before = (await owner.ok('GET', '/api/agent-actions')).actions.length;
  await hook(devAgent, post('Edit', { file_path: '/Users/d/app/c.ts' }));
  await mcp(devAgent, 'find_work');
  assert.equal((await owner.ok('GET', '/api/agent-actions')).actions.length, before);
});
