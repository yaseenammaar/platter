import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { app } from '../server/app.ts';
import { q } from '../server/db.ts';
import { openLocalDb } from '../server/localdb.ts';
import { BASE, Client, join, mcp, startTeam } from './helpers.ts';

const owner = new Client();
const mate = new Client();
const get = async (path: string) => {
  const res = await app.fetch(new Request(BASE + path));
  return { status: res.status, text: await res.text() };
};

before(async () => {
  await openLocalDb();
  await startTeam(owner, { name: 'Olive Owner', email: 'olive@x.io', team: 'Setup Co' });
  const { link } = await owner.ok('POST', '/api/invites', { email: 'mate@x.io', role: 'member' });
  await join(mate, link, { name: 'Max Mate', password: 'password-1234' });
});

test('connecting gives a one-time setup link; the key is only stored sealed', async () => {
  const r = await owner.ok('POST', '/api/agent-tokens', { name: 'laptop agent' });
  assert.match(r.setup, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(r.setupExpiresInMinutes, 30);
  const rows = await q('SELECT sealed FROM setup_links');
  assert.ok(rows.every((x: any) => !x.sealed.includes(r.token) && !Buffer.from(x.sealed, 'base64url').toString().includes(r.token)));

  const mac = await get(`/s/${r.setup}`);
  assert.equal(mac.status, 200);
  assert.match(mac.text, /^#!\/bin\/sh/);
  assert.ok(mac.text.includes(`PLATTER_KEY='${r.token}'`), 'the script carries the key');
  assert.match(mac.text, /PLATTER_URL='http:\/\/test\.local\/mcp'/);
  assert.match(mac.text, /claude mcp add --transport http --scope user platter "\$PLATTER_URL" --header "Authorization: Bearer \$PLATTER_KEY"/);
  assert.match(mac.text, /pop\('platter'/, 'old keys in folder scopes are cleared too');
  assert.match(mac.text, /401\) echo "Platter refused this key/);
  assert.match(mac.text, /checkin\.py"? --install/);

  const again = await get(`/s/${r.setup}`);
  assert.doesNotMatch(again.text, /Bearer/);
  assert.match(again.text, /already used or has expired/);
  assert.match(again.text, /exit 1/);
});

test('the prompt version gives Claude Code the steps, once', async () => {
  const r = await owner.ok('POST', '/api/agent-tokens', { name: 'linux agent' });
  const p = await get(`/s/${r.setup}?as=prompt`);
  assert.match(p.text, /Platter setup steps/);
  assert.ok(p.text.includes(r.token));
  assert.match(p.text, /api\/agent\/focus/);
  assert.match(p.text, /schedule this every 30 minutes/);
  assert.match((await get(`/s/${r.setup}`)).text, /already used/);
  assert.match((await get('/s/not-a-real-code')).text, /not right/);
});

test('a new link rotates the key; only your own agent', async () => {
  const r = await owner.ok('POST', '/api/agent-tokens', { name: 'desk agent' });
  assert.ok(!(await mcp(r.token, 'whoami')).isError);
  assert.equal((await mate.post(`/api/agent-tokens/${r.id}/relink`)).status, 403);
  const n = await owner.ok('POST', `/api/agent-tokens/${r.id}/relink`);
  assert.notEqual(n.token, r.token);
  assert.match((await get(`/s/${r.setup}`)).text, /already used/, 'the old link is dead');
  const old = await app.fetch(new Request(`${BASE}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${r.token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  }));
  assert.equal(old.status, 401, 'the old key stops working');
  assert.ok((await get(`/s/${n.setup}`)).text.includes(n.token));
  assert.ok(!(await mcp(n.token, 'whoami')).isError);
});

test('links stop working when the agent is disconnected', async () => {
  const r = await owner.ok('POST', '/api/agent-tokens', { name: 'old agent' });
  await owner.req('DELETE', `/api/agent-tokens/${r.id}`);
  assert.match((await get(`/s/${r.setup}`)).text, /already used or has expired/);
});
