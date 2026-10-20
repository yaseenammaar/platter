import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { q } from '../server/db.ts';
import { openLocalDb } from '../server/localdb.ts';
import { Client, join, mcp, startTeam } from './helpers.ts';

const owner = new Client();
const people: Record<string, { c: Client; id: string; agent: string }> = {};

before(async () => {
  await openLocalDb();
  await startTeam(owner, { name: 'Owner', email: 'o@x.io', team: 'Handoff Co', projectKey: 'APP' });
  for (const name of ['alice', 'bob', 'carol']) {
    const { link } = await owner.ok('POST', '/api/invites', { email: `${name}@x.io`, role: 'member' });
    const c = new Client();
    await join(c, link, { name, password: `${name}-password` });
    const agent = (await c.ok('POST', '/api/agent-tokens', { name: `${name}-agent` })).token;
    people[name] = { c, id: (await c.ok('GET', '/api/me')).me.id, agent };
  }
  await owner.ok('POST', '/api/tasks', {
    project: 'APP', title: 'Build CSV export for reports', ready: true,
    description: 'Finance needs to export the monthly report as CSV instead of copy-pasting from the UI.',
    acceptance_criteria: ['Export button downloads a CSV', 'CSV columns match the on-screen table'],
    assignee_id: people.alice.id, reviewer_id: people.bob.id,
  });
});

test('agents report usage; exhausted agents cannot start work', async () => {
  const r = await mcp(people.alice.agent, 'report_usage', { remaining_percent: 5, note: '5-hour window' });
  assert.match(r.text, /nearly out/);
  const start = await mcp(people.alice.agent, 'start_task', { key: 'APP-1' });
  assert.ok(start.isError);
  assert.match(start.text, /low_capacity/);
  await mcp(people.alice.agent, 'report_usage', { remaining_percent: 60 });
  assert.ok(!(await mcp(people.alice.agent, 'start_task', { key: 'APP-1' })).isError);
});

test('handoff requires real notes; not takeable before handoff', async () => {
  await mcp(people.carol.agent, 'report_usage', { remaining_percent: 80 });
  assert.ok((await mcp(people.carol.agent, 'take_over_task', { key: 'APP-1' })).isError);
  const thin = await mcp(people.alice.agent, 'handoff_task', { key: 'APP-1', notes: 'ran out' });
  assert.ok(thin.isError);
  assert.match(thin.text, /handoff_notes/);
  await mcp(people.alice.agent, 'report_usage', { remaining_percent: 3 });
  const ok = await mcp(people.alice.agent, 'handoff_task', {
    key: 'APP-1', reason: 'usage limit reached',
    notes: 'AC1 done on branch feat/csv-export (button + endpoint). AC2 left: column order differs from table, see ReportTable.tsx.',
  });
  assert.ok(!ok.isError, ok.text);
});

test('the reviewer cannot take over, and low-capacity agents cannot either', async () => {
  await mcp(people.bob.agent, 'report_usage', { remaining_percent: 90 });
  const rev = await mcp(people.bob.agent, 'take_over_task', { key: 'APP-1' });
  assert.ok(rev.isError);
  assert.match(rev.text, /reviewer/);
  await mcp(people.carol.agent, 'report_usage', { remaining_percent: 15 });
  assert.match((await mcp(people.carol.agent, 'take_over_task', { key: 'APP-1' })).text, /low_capacity/);
  // Bob's queue shouldn't show a handoff he can't take; Carol's should.
  assert.doesNotMatch((await mcp(people.bob.agent, 'find_work')).text, /APP-1.*handoff open/);
});

test('a teammate with capacity takes over and sees the handoff notes', async () => {
  await mcp(people.carol.agent, 'report_usage', { remaining_percent: 70 });
  const work = await mcp(people.carol.agent, 'find_work');
  assert.match(work.text, /APP-1/);
  assert.match(work.text, /alice-agent.*3% left/);
  const take = await mcp(people.carol.agent, 'take_over_task', { key: 'APP-1' });
  assert.ok(!take.isError, take.text);
  assert.match(take.text, /feat\/csv-export/);
  const t = (await owner.ok('GET', '/api/tasks/APP-1')).task;
  assert.equal(t.assignee_id, people.carol.id);
  assert.deepEqual(t.contributors, ['alice']);
  assert.equal(t.handoff, null);
  assert.equal((await mcp(people.alice.agent, 'take_over_task', { key: 'APP-1' })).isError, true);
  // Carol's agent can now finish, and Bob can still verify.
  await mcp(people.carol.agent, 'submit_for_review', {
    key: 'APP-1', summary: 'Finished the CSV export Alice started; fixed column order to match the table.',
    criteria: [{ id: 'AC1', evidence: 'Button + /reports/export.csv from feat/csv-export' }, { id: 'AC2', evidence: 'Columns derived from ReportTable column defs; snapshot test added' }],
  });
  assert.ok(!(await mcp(people.bob.agent, 'review_task', { key: 'APP-1', verdict: 'approve', criteria: [{ id: 'AC1', passed: true }, { id: 'AC2', passed: true }] })).isError);
});

test('an exhausted agent that goes silent is automatically offered for takeover (H5)', async () => {
  await owner.ok('POST', '/api/tasks', {
    project: 'APP', title: 'Add dark mode toggle', ready: true,
    description: 'Users keep asking for dark mode; add a toggle in settings that persists per user.',
    acceptance_criteria: ['Toggle in settings switches theme'], assignee_id: people.alice.id, reviewer_id: people.bob.id,
  });
  await mcp(people.alice.agent, 'report_usage', { remaining_percent: 50 });
  await mcp(people.alice.agent, 'start_task', { key: 'APP-2' });
  await mcp(people.alice.agent, 'report_usage', { remaining_percent: 2 });
  assert.equal((await owner.ok('GET', '/api/tasks/APP-2')).task.handoff_open, false);
  await q(`UPDATE tasks SET last_heartbeat_at = now() - interval '2 hours' WHERE number = 2`);
  const t = (await owner.ok('GET', '/api/tasks/APP-2')).task;
  assert.equal(t.handoff_open, true);
  const take = await mcp(people.carol.agent, 'take_over_task', { key: 'APP-2' });
  assert.ok(!take.isError, take.text);
  assert.match(take.text, /silent|previous/i);
});

test('capacity board lists every agent', async () => {
  const { agents } = await owner.ok('GET', '/api/capacity');
  assert.equal(agents.length, 3);
  assert.equal(agents.find((a: any) => a.name === 'alice-agent').state, 'exhausted');
  assert.equal(agents.find((a: any) => a.name === 'carol-agent').state, 'available');
});
