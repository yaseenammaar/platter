import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { openLocalDb } from '../server/localdb.ts';
import { Client, join, mcp, startTeam } from './helpers.ts';

const owner = new Client();
const p: Record<string, { c: Client; id: string; agent: string }> = {};

before(async () => {
  await openLocalDb();
  await startTeam(owner, { name: 'Yaseen Khan', email: 'y@x.io', team: 'Growth', projectKey: 'GRO' });
  for (const [name, email] of [['Mubeen Ali', 'mubeen@x.io'], ['Sam Lee', 'sam@x.io'], ['Sam Ortiz', 'sortiz@x.io']]) {
    const { link } = await owner.ok('POST', '/api/invites', { email, role: 'member' });
    const c = new Client();
    await join(c, link, { name, password: 'password-1234' });
    p[name] = { c, id: (await c.ok('GET', '/api/me')).me.id, agent: (await c.ok('POST', '/api/agent-tokens', { name: `${name.split(' ')[0]}-agent` })).token };
  }
  p.Yaseen = { c: owner, id: (await owner.ok('GET', '/api/me')).me.id, agent: (await owner.ok('POST', '/api/agent-tokens', { name: 'yaseen-agent' })).token };
  await owner.ok('POST', '/api/tasks', {
    project: 'GRO', title: 'List our apps in SaaS directories for backlinks', ready: true,
    description: 'Submit each of our apps to the top 20 SaaS directories to build backlinks and referral traffic.',
    acceptance_criteria: ['All apps submitted to the 20 directories in the sheet'], assignee_id: p['Mubeen Ali'].id, reviewer_id: p.Yaseen.id,
  });
  await mcp(p['Mubeen Ali'].agent, 'start_task', { key: 'GRO-1' });
  await mcp(p['Mubeen Ali'].agent, 'log_progress', { key: 'GRO-1', message: 'Submitted to 12 of 20 directories; 3 pending approval.' });
});

test('ask a teammate by first name; board knowledge comes back instantly', async () => {
  const r = await mcp(p.Yaseen.agent, 'ask_teammate', { to: 'mubeen', question: 'Did you list the apps to the directory for backlinks or not?' });
  assert.ok(!r.isError, r.text);
  assert.match(r.text, /Asked Mubeen Ali/);
  assert.match(r.text, /GRO-1/);
  assert.match(r.text, /12 of 20 directories/);
});

test('ambiguous or unknown names are explained, not guessed', async () => {
  const amb = await mcp(p.Yaseen.agent, 'ask_teammate', { to: 'sam', question: 'Any update on the launch post?' });
  assert.ok(amb.isError);
  assert.match(amb.text, /Sam Lee/);
  assert.match(amb.text, /Sam Ortiz/);
  assert.ok((await mcp(p.Yaseen.agent, 'ask_teammate', { to: 'nobody', question: 'hello there?' })).isError);
});

test("the teammate's agent sees and answers it; the asker gets the answer", async () => {
  const inbox = await mcp(p['Mubeen Ali'].agent, 'check_inbox');
  assert.match(inbox.text, /directory for backlinks/);
  const id = /id ([0-9a-f-]{36})/.exec(inbox.text)![1];
  assert.ok((await mcp(p['Sam Lee'].agent, 'answer_question', { id, answer: 'yes' })).isError, 'only the addressee may answer');
  const ans = await mcp(p['Mubeen Ali'].agent, 'answer_question', { id, answer: 'Partly — 12 of 20 done per GRO-1, 3 awaiting approval. Rest by Friday.' });
  assert.ok(!ans.isError, ans.text);
  assert.equal((await owner.ok('GET', '/api/asks/unread')).unread, 1);
  const mine = await mcp(p.Yaseen.agent, 'check_inbox');
  assert.match(mine.text, /12 of 20 done/);
  assert.match(mine.text, /via agent Mubeen-agent/);
  assert.equal((await owner.ok('GET', '/api/asks/unread')).unread, 0);
});

test('people can ask and answer from the app too', async () => {
  const { id } = await owner.ok('POST', '/api/asks', { to_member_id: p['Sam Lee'].id, question: 'Can you review the landing copy today?' });
  const { for_me } = await p['Sam Lee'].c.ok('GET', '/api/asks');
  assert.equal(for_me[0].id, id);
  await p['Sam Lee'].c.ok('POST', `/api/asks/${id}/answer`, { answer: 'Yep, after lunch.' });
  const { my_questions } = await owner.ok('GET', '/api/asks');
  assert.equal(my_questions.find((x: any) => x.id === id).answer, 'Yep, after lunch.');
});
