import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { openLocalDb } from '../server/localdb.ts';
import { Client, join, mcp, startTeam } from './helpers.ts';

// Two unrelated teams that happen to use the same project key.
const ana = new Client();   // owns "Acme"
const ben = new Client();   // owns "Globex"
const sam = new Client();   // member of Acme, later also joins Globex
let anaAgent = '';
let benAgent = '';
let samId = '';
let acme = '';
let globex = '';

const task = (title: string) => ({
  project: 'WEB', title, ready: false,
  description: 'Something both teams might plausibly be working on this week, described in enough detail.',
  acceptance_criteria: ['It works end to end'],
});

before(async () => {
  await openLocalDb();
  acme = await startTeam(ana, { name: 'Ana', email: 'ana@acme.io', team: 'Acme', projectKey: 'WEB' });
  globex = await startTeam(ben, { name: 'Ben', email: 'ben@globex.io', team: 'Globex', projectKey: 'WEB' });
  await ana.ok('POST', '/api/tasks', task('Acme secret launch plan'));
  await ben.ok('POST', '/api/tasks', task('Globex pricing experiment'));
  const { link } = await ana.ok('POST', '/api/invites', { email: 'sam@x.io', role: 'member' });
  await join(sam, link, { name: 'Sam', password: 'sam-password-1' });
  samId = (await sam.ok('GET', '/api/me')).me.id;
  anaAgent = (await ana.ok('POST', '/api/agent-tokens', { name: 'ana-agent' })).token;
  benAgent = (await ben.ok('POST', '/api/agent-tokens', { name: 'ben-agent' })).token;
});

test('same project key in two teams resolves to each team’s own task', async () => {
  assert.equal(acme, 'acme');
  assert.equal(globex, 'globex');
  assert.equal((await ana.ok('GET', '/api/tasks/WEB-1')).task.title, 'Acme secret launch plan');
  assert.equal((await ben.ok('GET', '/api/tasks/WEB-1')).task.title, 'Globex pricing experiment');
});

test('people cannot read or write another team’s data', async () => {
  const spy = new Client();
  spy.cookie = ana.cookie;
  spy.team = globex; // Ana pretends to be in Globex
  assert.equal((await spy.get('/api/tasks')).status, 403);
  assert.equal((await spy.get('/api/tasks/WEB-1')).status, 403);
  assert.equal((await spy.post('/api/invites', { email: 'x@y.io' })).status, 403);
  const { members } = await ana.ok('GET', '/api/members');
  assert.deepEqual(members.map((m: any) => m.email).sort(), ['ana@acme.io', 'sam@x.io']);
  const { activity } = await ana.ok('GET', '/api/activity');
  assert.ok(activity.every((e: any) => !String(e.task_title ?? '').includes('Globex')));
});

test('agents only ever see their own team', async () => {
  const mine = await mcp(anaAgent, 'get_task', { key: 'WEB-1' });
  assert.match(mine.text, /Acme secret launch plan/);
  assert.doesNotMatch(mine.text, /Globex/);
  assert.match((await mcp(benAgent, 'whoami')).text, /Globex/);
  // An agent can't reach across teams even by asking for a person from the other team.
  const ask = await mcp(benAgent, 'ask_teammate', { to: 'ana', question: 'What is in the launch plan?' });
  assert.ok(ask.isError);
  assert.match(ask.text, /Nobody called/);
  // ...or by assigning work to them.
  const r = await new Client(benAgent).post('/api/tasks', { ...task('Sneaky'), assignee_id: samId });
  assert.ok(r.status === 200); // agents can't assign at all; the assignee is dropped (R3)
  assert.equal(r.data.task.assignee_id, null);
  const cross = await ben.post('/api/tasks', { ...task('Assign across teams'), assignee_id: samId });
  assert.equal(cross.status, 422);
  assert.match(cross.data.message, /not on this team/);
});

test('one person can be in several teams with different roles', async () => {
  const { link } = await ben.ok('POST', '/api/invites', { email: 'sam@x.io', role: 'viewer' });
  // Existing account: needs their password (or to already be signed in as them).
  const stranger = new Client();
  assert.equal((await stranger.post(`/api/join/${link.split('/join/')[1]}`, { password: 'wrong-password' })).status, 401);
  const r = await sam.ok('POST', `/api/join/${link.split('/join/')[1]}`, {});
  assert.equal(r.team, 'globex');
  const { teams } = await sam.ok('GET', '/api/me/teams');
  assert.deepEqual(teams.map((t: any) => `${t.slug}:${t.role}`), ['acme:member', 'globex:viewer']);
  sam.team = 'globex';
  assert.equal((await sam.post('/api/tasks', task('Viewer cannot create'))).status, 403);
  sam.team = 'acme';
  assert.equal((await sam.post('/api/tasks', task('Member can create here'))).status, 200);
});

test('pausing someone in one team leaves their other teams alone', async () => {
  await ben.ok('PATCH', `/api/members/${samId}`, { status: 'suspended' });
  sam.team = 'globex';
  assert.equal((await sam.get('/api/tasks')).status, 403);
  sam.team = 'acme';
  assert.equal((await sam.get('/api/tasks')).status, 200);
  const { teams } = await sam.ok('GET', '/api/me/teams');
  assert.deepEqual(teams.map((t: any) => t.slug), ['acme']);
});

test('anyone signed in can start another team', async () => {
  const r = await ana.ok('POST', '/api/teams', { name: 'Acme' });
  assert.equal(r.slug, 'acme-2');
  const { teams } = await ana.ok('GET', '/api/me/teams');
  assert.equal(teams.length, 2);
});

test('the welcome tour shows once per person, and only people can dismiss it', async () => {
  const c = new Client();
  await startTeam(c, { name: 'New Person', email: 'newbie@x.io', team: 'Fresh Team' });
  assert.equal((await c.ok('GET', '/api/me')).onboarded, false);
  await c.ok('POST', '/api/me/onboarded');
  assert.equal((await c.ok('GET', '/api/me')).onboarded, true);
  const agent = new Client((await c.ok('POST', '/api/agent-tokens', { name: 'newbie-agent' })).token);
  assert.equal((await agent.post('/api/me/onboarded')).status, 403);
});
