import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { openLocalDb } from '../server/localdb.ts';
import { app } from '../server/app.ts';
import { BASE, Client, join, mcp, startTeam } from './helpers.ts';

const owner = new Client();
const dev = new Client();
let ownerId = '';
let devId = '';
let devAgent = '';
let ownerAgent = '';

const task = (title: string, assignee: string, reviewer: string, extra: any = {}) => owner.ok('POST', '/api/tasks', {
  project: 'APP', title, ready: true, assignee_id: assignee, reviewer_id: reviewer,
  description: 'A task with enough description to pass the definition of ready check.',
  acceptance_criteria: ['It works and the tests pass'], ...extra,
});
const brief = async (token: string) => {
  const res = await app.fetch(new Request(`${BASE}/api/agent/focus`, { headers: { authorization: `Bearer ${token}` } }));
  return { status: res.status, text: await res.text() };
};

before(async () => {
  await openLocalDb();
  await startTeam(owner, { name: 'Olive Owner', email: 'olive@x.io', team: 'Focus Co', projectKey: 'APP' });
  ownerId = (await owner.ok('GET', '/api/me')).me.id;
  const { link } = await owner.ok('POST', '/api/invites', { email: 'dev@x.io', role: 'member' });
  await join(dev, link, { name: 'Dana Dev', password: 'password-1234' });
  devId = (await dev.ok('GET', '/api/me')).me.id;
  devAgent = (await dev.ok('POST', '/api/agent-tokens', { name: 'dana-agent' })).token;
  ownerAgent = (await owner.ok('POST', '/api/agent-tokens', { name: 'olive-agent' })).token;
  await task('Fix the login redirect bug', devId, ownerId, { priority: 'P1' }); // APP-1
  await task('Write the onboarding email copy', devId, ownerId, { priority: 'P3' }); // APP-2
  await task('Review the pricing page', ownerId, devId); // APP-3, Dana reviews
});

test('unlocked agents work as usual and get no focus brief', async () => {
  assert.equal((await brief(devAgent)).text, '');
  const r = await mcp(devAgent, 'find_work');
  assert.match(r.text, /APP-1/);
  assert.match(r.text, /APP-2/);
});

test('only the owner can lock agents (F3)', async () => {
  const r = await dev.patch(`/api/members/${devId}/focus`, { on: true });
  assert.equal(r.status, 403);
  await owner.ok('PATCH', `/api/members/${devId}/focus`, { on: true });
  const m = (await owner.ok('GET', '/api/members')).members.find((x: any) => x.id === devId);
  assert.equal(m.agent_focus, true);
  assert.equal(m.focus_task_key, 'APP-1');
  assert.equal(m.focus_by, 'Olive Owner');
  // Dana's agent can't lift it either.
  assert.equal((await dev.patch(`/api/members/${devId}/focus`, { on: false })).status, 403);
});

test('a locked agent sees one task and is refused everything else (F1/F2)', async () => {
  const work = await mcp(devAgent, 'find_work');
  assert.match(work.text, /Focus lock/);
  assert.match(work.text, /APP-1/);
  assert.doesNotMatch(work.text, /APP-2/);

  const other = await mcp(devAgent, 'start_task', { key: 'APP-2' });
  assert.ok(other.isError);
  assert.match(other.text, /focus_lock/);
  assert.match(other.text, /APP-1/);

  for (const [tool, args] of [
    ['get_task', { key: 'APP-2' }], ['list_review_queue', {}], ['review_task', { key: 'APP-3', verdict: 'approve', criteria: [] }],
    ['create_task', { project: 'APP', title: 'Refactor everything', description: 'x' }], ['release_task', { key: 'APP-1', reason: 'bored of it now' }],
  ] as const) {
    const r = await mcp(devAgent, tool, args);
    assert.ok(r.isError, `${tool} should be refused`);
    assert.match(r.text, /Focus lock/);
  }

  const start = await mcp(devAgent, 'start_task', { key: 'APP-1' });
  assert.ok(!start.isError, start.text);
  assert.ok(!(await mcp(devAgent, 'log_progress', { key: 'APP-1', message: 'Found the redirect loop in auth middleware.' })).isError);
});

test('the REST API is closed to a locked agent too', async () => {
  const c = new Client(devAgent);
  assert.equal((await c.post('/api/tasks/APP-2/actions/start')).status, 403);
  assert.equal((await c.get('/api/tasks')).status, 403);
  assert.equal((await c.get('/api/me')).status, 200);
});

test('off-topic ideas are parked on the focus task; asks are pinned to it (F2/F4)', async () => {
  const p = await mcp(devAgent, 'park_idea', { idea: 'Person asked to redesign the settings page' });
  assert.ok(!p.isError, p.text);
  assert.match(p.text, /Parked on APP-1/);
  const { activity } = await owner.ok('GET', '/api/tasks/APP-1');
  assert.ok(activity.some((e: any) => e.kind === 'parked' && /redesign the settings/.test(e.message)));

  const ask = await mcp(devAgent, 'ask_teammate', { to: 'olive', question: 'Which redirect URL should login use?' });
  assert.ok(!ask.isError, ask.text);
  assert.match(ask.text, /about APP-1/);
});

test('the hook brief names the task and the owner; whoami says so', async () => {
  const b = await brief(devAgent);
  assert.equal(b.status, 200);
  assert.match(b.text, /Olive Owner locked/);
  assert.match(b.text, /APP-1 "Fix the login redirect bug"/);
  assert.match(b.text, /park_idea/);
  assert.match((await mcp(devAgent, 'whoami')).text, /Focus lock is ON/);
  // Only agent tokens can read it.
  assert.equal((await owner.get('/api/agent/focus')).status, 403);
});

test('after submitting, the lock moves to the next assigned task (F3)', async () => {
  const sub = await mcp(devAgent, 'submit_for_review', {
    key: 'APP-1', summary: 'Fixed the redirect loop by checking the session before redirecting to /login.',
    criteria: [{ id: 'AC1', evidence: 'Login now redirects once; npm test passes (42 tests).' }],
  });
  assert.ok(!sub.isError, sub.text);
  assert.match((await brief(devAgent)).text, /APP-2/);
  assert.ok(!(await mcp(devAgent, 'start_task', { key: 'APP-2' })).isError);
});

test('other agents are unaffected, and lifting the lock frees the agent', async () => {
  assert.ok(!(await mcp(ownerAgent, 'list_review_queue')).isError);
  await owner.ok('PATCH', `/api/members/${devId}/focus`, { on: false });
  assert.equal((await brief(devAgent)).text, '');
  assert.ok(!(await mcp(devAgent, 'list_review_queue')).isError);
  const feed = (await owner.ok('GET', '/api/activity')).activity.map((e: any) => e.message);
  assert.ok(feed.some((m: string) => /locked Dana Dev's agents/.test(m)));
  assert.ok(feed.some((m: string) => /lifted the focus lock on Dana Dev's agents/.test(m)));
});
