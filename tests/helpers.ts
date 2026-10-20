import assert from 'node:assert/strict';
import { app } from '../server/app.ts';

export const BASE = 'http://test.local';
process.env.SIGNUP_CODE = 'test-code';

export class Client {
  cookie = '';
  /** Team slug this person is currently working in (sent as x-team). */
  team = '';
  constructor(public bearer?: string) {}
  async req(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-platter': '1' };
    if (this.cookie) headers.cookie = this.cookie;
    if (this.bearer) headers.authorization = `Bearer ${this.bearer}`;
    if (this.team) headers['x-team'] = this.team;
    const res = await app.fetch(new Request(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const data = res.status === 202 ? null : await res.json();
    return { status: res.status, data };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b: unknown = {}) => this.req('POST', p, b);
  patch = (p: string, b: unknown) => this.req('PATCH', p, b);
  async ok(method: string, p: string, b?: unknown) {
    const r = await this.req(method, p, b);
    assert.ok(r.status < 300, `${method} ${p} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }
}

let rpcId = 0;
export async function mcp(token: string, tool: string, args: any = {}) {
  const res = await app.fetch(new Request(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name: tool, arguments: args } }),
  }));
  const data = await res.json();
  return { text: data.result.content[0].text as string, isError: !!data.result.isError };
}


/** Sign up a new person who creates a team (and a project with the given key). */
export async function startTeam(c: Client, o: { name: string; email: string; team: string; projectKey?: string }) {
  const r = await c.ok('POST', '/api/signup', { name: o.name, email: o.email, password: 'longenough1', team: o.team, code: 'test-code' });
  c.team = r.team;
  if (o.projectKey) await c.ok('POST', '/api/projects', { key: o.projectKey, name: o.projectKey });
  return r.team as string;
}

/** Accept an invite link and switch the client into that team. */
export async function join(c: Client, link: string, body: Record<string, unknown>) {
  const r = await c.ok('POST', `/api/join/${link.split('/join/')[1]}`, body);
  c.team = r.team;
  return r;
}
