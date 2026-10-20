import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { app } from '../server/app.ts';
import { openLocalDb } from '../server/localdb.ts';
import { BASE, Client, join, mcp, startTeam } from './helpers.ts';

const owner = new Client();
const alice = new Client();
const bob = new Client();
let aliceAgent = '';
let bobAgent = '';
let aliceId = '';
let bobId = '';

const goodTask = () => ({
  project: 'WEB',
  title: 'Add password reset flow',
  description: 'Users who forget their password currently have to email support. Add a self-serve reset via emailed link.',
  context: 'Auth lives in src/auth. Use the existing mailer in src/lib/mail.ts.',
  acceptance_criteria: ['Reset link email is sent for a known address', 'Link expires after 1 hour and is single use'],
  assignee_id: aliceId,
  reviewer_id: bobId,
  priority: 'P1',
});

before(async () => {
  await openLocalDb(); // in-memory
});

test('signup needs the signup code and makes you owner of a new team', async () => {
  assert.equal((await owner.get('/api/bootstrap')).data.me, null);
  const bad = await owner.post('/api/signup', { code: 'nope', name: 'Owner', email: 'o@x.io', password: 'longenough1', team: 'Acme' });
  assert.equal(bad.status, 403);
  assert.equal(await startTeam(owner, { name: 'Owner', email: 'o@x.io', team: 'Acme', projectKey: 'WEB' }), 'acme');
  assert.equal((await owner.get('/api/me')).data.me.role, 'owner');
  assert.equal((await owner.post('/api/signup', { code: 'test-code', name: 'Again', email: 'o@x.io', password: 'longenough1', team: 'Other' })).status, 409);
});

test('invites: single-use, role-gated, and joining creates a session', async () => {
  const { link } = await owner.ok('POST', '/api/invites', { email: 'alice@x.io', role: 'member' });
  const token = link.split('/join/')[1];
  assert.equal((await alice.get(`/api/join/${token}`)).data.email, 'alice@x.io');
  assert.equal((await alice.post(`/api/join/${token}`, { name: 'Alice', password: 'short' })).status, 422);
  await join(alice, link, { name: 'Alice', password: 'alicepassword' });
  assert.equal((await bob.post(`/api/join/${token}`, { name: 'Mallory', password: 'alicepassword' })).status, 404);

  const inv2 = await owner.ok('POST', '/api/invites', { email: 'bob@x.io', role: 'member' });
  await join(bob, inv2.link, { name: 'Bob', password: 'bobpassword1' });

  // members cannot invite; non-owners cannot invite admins
  assert.equal((await alice.post('/api/invites', { email: 'c@x.io' })).status, 403);
  const { members } = await owner.ok('GET', '/api/members');
  aliceId = members.find((m: any) => m.email === 'alice@x.io').id;
  bobId = members.find((m: any) => m.email === 'bob@x.io').id;
});

test('CSRF header is required for cookie-authenticated writes', async () => {
  const res = await app.fetch(new Request(`${BASE}/api/tasks`, { method: 'POST', headers: { cookie: owner.cookie, 'content-type': 'application/json' }, body: '{}' }));
  assert.equal(res.status, 403);
});

test('agent tokens and MCP handshake', async () => {
  aliceAgent = (await alice.ok('POST', '/api/agent-tokens', { name: "Alice's Claude Code" })).token;
  bobAgent = (await bob.ok('POST', '/api/agent-tokens', { name: "Bob's reviewer agent" })).token;
  assert.match(aliceAgent, /^plt_/);
  const res = await app.fetch(new Request(`${BASE}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${aliceAgent}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
  }));
  const init = await res.json();
  assert.equal(init.result.serverInfo.name, 'platter');
  assert.match(init.result.instructions, /submit_for_review/);
  const unauth = await app.fetch(new Request(`${BASE}/mcp`, { method: 'POST', body: '{}' }));
  assert.equal(unauth.status, 401);
  assert.match((await mcp(aliceAgent, 'whoami')).text, /Alice/);
});

test('Definition of Ready gate', async () => {
  const r = await owner.post('/api/tasks', { project: 'WEB', title: 'Fix', ready: true });
  assert.equal(r.status, 422);
  assert.ok(r.data.details.length >= 4, JSON.stringify(r.data));
  const self = await owner.post('/api/tasks', { ...goodTask(), reviewer_id: aliceId, ready: true });
  assert.match(self.data.message, /different person/);
  const t = (await owner.ok('POST', '/api/tasks', { ...goodTask(), ready: true })).task;
  assert.equal(t.key, 'WEB-1');
  assert.equal(t.status, 'ready');
});

test('agent-created tasks land in backlog and cannot be marked ready by agents', async () => {
  const r = await mcp(aliceAgent, 'create_task', { project: 'WEB', title: 'Follow-up: rate limit reset', description: 'x', acceptance_criteria: ['limit to 5/hr'] });
  assert.match(r.text, /WEB-2 in Backlog/);
  const t = (await owner.ok('GET', '/api/tasks/WEB-2')).task;
  assert.equal(t.status, 'backlog');
  assert.equal(t.assignee_id, null);
  const res = await new Client(aliceAgent).post('/api/tasks/WEB-2/actions/mark_ready');
  assert.equal(res.status, 403);
});

test('only the assignee (or their agent) can start; agents cannot edit criteria', async () => {
  assert.ok((await mcp(bobAgent, 'start_task', { key: 'WEB-1' })).isError);
  const edit = await new Client(aliceAgent).patch('/api/tasks/WEB-1', { acceptance_criteria: ['easier'] });
  assert.equal(edit.status, 403);
  const started = await mcp(aliceAgent, 'start_task', { key: 'WEB-1' });
  assert.ok(!started.isError, started.text);
  assert.match(started.text, /AC1/);
});

test('acceptance criteria are frozen once work starts', async () => {
  const r = await owner.patch('/api/tasks/WEB-1', { acceptance_criteria: ['Something else entirely'] });
  assert.equal(r.status, 409);
  assert.match(r.data.message, /frozen/);
});

test('submission must address every criterion with evidence', async () => {
  await mcp(aliceAgent, 'log_progress', { key: 'WEB-1', message: 'Added reset token table and endpoint' });
  const thin = await mcp(aliceAgent, 'submit_for_review', { key: 'WEB-1', summary: 'done', criteria: [{ id: 'AC1', evidence: 'yes' }] });
  assert.ok(thin.isError);
  assert.match(thin.text, /Summary/);
  assert.match(thin.text, /AC2/);
  const ok = await mcp(aliceAgent, 'submit_for_review', {
    key: 'WEB-1',
    summary: 'Added POST /auth/reset and /auth/reset/confirm with hashed single-use tokens.',
    criteria: [
      { id: 'AC1', evidence: 'src/auth/reset.ts sends via mailer; test reset.spec.ts "sends email" passes' },
      { id: 'AC2', evidence: 'tokens store expires_at = now()+1h and used_at; spec covers expiry + reuse' },
    ],
    tests: 'npm test — 48 passed',
    artifacts: ['https://github.com/acme/web/pull/42'],
  });
  assert.ok(!ok.isError, ok.text);
});

test('assignee cannot verify own work; reviewer agent must judge every criterion', async () => {
  assert.ok((await mcp(aliceAgent, 'review_task', { key: 'WEB-1', verdict: 'approve', criteria: [] })).isError);
  const partial = await mcp(bobAgent, 'review_task', { key: 'WEB-1', verdict: 'approve', criteria: [{ id: 'AC1', passed: true }] });
  assert.ok(partial.isError);
  assert.match(partial.text, /AC2/);
  const noNote = await mcp(bobAgent, 'review_task', { key: 'WEB-1', verdict: 'reject', criteria: [{ id: 'AC1', passed: true }, { id: 'AC2', passed: false }] });
  assert.ok(noNote.isError);
  const rej = await mcp(bobAgent, 'review_task', {
    key: 'WEB-1', verdict: 'reject', summary: 'Expiry ok but reuse not prevented',
    criteria: [{ id: 'AC1', passed: true }, { id: 'AC2', passed: false, note: 'used_at is never set on confirm — token can be reused' }],
  });
  assert.ok(!rej.isError, rej.text);
  const pack = await mcp(aliceAgent, 'get_task', { key: 'WEB-1' });
  assert.match(pack.text, /Review feedback/);
  assert.match(pack.text, /token can be reused/);
});

test('second attempt gets approved and closes the task', async () => {
  await mcp(aliceAgent, 'submit_for_review', {
    key: 'WEB-1', summary: 'Fixed: confirm endpoint now sets used_at atomically and rejects reused tokens.',
    criteria: [{ id: 'AC1', evidence: 'unchanged from attempt 1, spec still passes' }, { id: 'AC2', evidence: 'UPDATE ... WHERE used_at IS NULL RETURNING; new spec "rejects reuse" passes' }],
  });
  const ok = await mcp(bobAgent, 'review_task', {
    key: 'WEB-1', verdict: 'approve', summary: 'Ran specs locally, read diff.',
    criteria: [{ id: 'AC1', passed: true }, { id: 'AC2', passed: true, note: 'verified' }],
  });
  assert.ok(!ok.isError, ok.text);
  const t = (await owner.ok('GET', '/api/tasks/WEB-1')).task;
  assert.equal(t.status, 'done');
  assert.equal(t.rework_count, 1);
  assert.equal(t.submission.attempt, 2);
  // closed tasks are immutable
  assert.equal((await owner.patch('/api/tasks/WEB-1', { title: 'Something new here' })).status, 403);
});

test('dependencies and WIP limit gate starting work', async () => {
  const base = goodTask();
  const a = (await owner.ok('POST', '/api/tasks', { ...base, title: 'Dependency task one', ready: true })).task;
  const b = (await owner.ok('POST', '/api/tasks', { ...base, title: 'Dependent task two', depends_on: [a.key], ready: true })).task;
  const r = await alice.post(`/api/tasks/${b.key}/actions/start`);
  assert.equal(r.status, 409);
  assert.equal(r.data.error, 'dependencies_open');

  await owner.ok('PATCH', '/api/projects/WEB', { wip_limit: 1 });
  await alice.ok('POST', `/api/tasks/${a.key}/actions/start`);
  const c = (await owner.ok('POST', '/api/tasks', { ...base, title: 'Third independent task', ready: true })).task;
  const wip = await alice.post(`/api/tasks/${c.key}/actions/start`);
  assert.equal(wip.data.error, 'wip_limit');
});

test('people management: role rules and offboarding releases work', async () => {
  assert.equal((await alice.patch(`/api/members/${bobId}`, { status: 'suspended' })).status, 403);
  const res = await owner.ok('PATCH', `/api/members/${aliceId}`, { status: 'suspended' });
  assert.ok(res.released.unassigned >= 1);
  // sessions and agent tokens die immediately
  assert.equal((await alice.get('/api/me')).status, 403);
  const r = await app.fetch(new Request(`${BASE}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${aliceAgent}` }, body: '{}' }));
  assert.equal(r.status, 401);
  const { tasks } = await owner.ok('GET', '/api/tasks?status=in_progress,ready');
  assert.ok(tasks.every((t: any) => t.assignee_id !== aliceId));
  const { activity } = await owner.ok('GET', '/api/activity');
  assert.ok(activity.some((e: any) => e.kind === 'offboarded'));
});

test('login lockout after repeated failures', async () => {
  const c = new Client();
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/login', { email: 'bob@x.io', password: 'wrongwrong' })).status, 401);
  assert.equal((await c.post('/api/login', { email: 'bob@x.io', password: 'bobpassword1' })).status, 429);
});
