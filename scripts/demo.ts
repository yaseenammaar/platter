// Populates a running local Platter with demo teams, agents and work in every state.
// Usage: DEMO_EMAIL=you@x DEMO_PASSWORD=... [DEMO_TEAM="Sniff Engineering"] npx tsx scripts/demo.ts   (API at http://localhost:8787)
// Creates your account + team (or signs you in if the account exists), then a second team you're also in.
const API = process.env.API_URL ?? 'http://localhost:8787';

class Session {
  cookie = '';
  team = '';
  constructor(public bearer?: string) {}
  async call(method: string, path: string, body?: unknown) {
    const res = await fetch(API + path, {
      method,
      headers: {
        'content-type': 'application/json', 'x-platter': '1',
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.bearer ? { authorization: `Bearer ${this.bearer}` } : {}),
        ...(this.team ? { 'x-team': this.team } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${path}: ${data.message} ${JSON.stringify(data.details ?? [])}`);
    return data;
  }
}

let id = 0;
async function tool(token: string, name: string, args: any = {}) {
  const res = await fetch(`${API}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }),
  });
  const r = (await res.json()).result;
  if (r.isError) throw new Error(`${name}: ${r.content[0].text}`);
  return r.content[0].text as string;
}

const owner = new Session();
const code = process.env.SIGNUP_CODE ?? 'local-dev';
const signup = await owner.call('POST', '/api/signup', {
  name: process.env.DEMO_NAME ?? 'Yaseen', email: process.env.DEMO_EMAIL, password: process.env.DEMO_PASSWORD,
  team: process.env.DEMO_TEAM ?? 'Sniff Engineering', code,
});
owner.team = signup.team;
await owner.call('POST', '/api/projects', { key: 'WEB', name: 'Web App' });
await owner.call('PATCH', '/api/projects/WEB', {
  agent_instructions: 'Repo: https://github.com/acme/web — branch from main, one PR per task titled "WEB-N: …".\nRun tests: `npm test` · Lint: `npm run lint` (both must pass before submitting).\nDon\'t add dependencies without commenting on the task first.',
});

const team: Record<string, { s: Session; id: string; agent: string }> = {};
for (const [name, email] of [['Priya Shah', 'priya@example.test'], ['Marco Diaz', 'marco@example.test'], ['Lena Kim', 'lena@example.test']]) {
  const { link } = await owner.call('POST', '/api/invites', { email, role: 'member' });
  const s = new Session();
  s.team = (await s.call('POST', `/api/join/${link.split('/join/')[1]}`, { name, password: 'demo-password-123' })).team;
  const agent = (await s.call('POST', '/api/agent-tokens', { name: `${name.split(' ')[0]}'s Claude Code` })).token;
  team[name.split(' ')[0]] = { s, id: (await s.call('GET', '/api/me')).me.id, agent };
}
const { Priya, Marco, Lena } = team;

const mk = (title: string, assignee: string | null, reviewer: string | null, extra: any = {}) =>
  owner.call('POST', '/api/tasks', {
    project: 'WEB', title, assignee_id: assignee, reviewer_id: reviewer, ready: !!(assignee && reviewer),
    description: extra.description ?? `${title}. Users have asked for this repeatedly; it should feel native to the existing UI and be covered by tests.`,
    acceptance_criteria: extra.ac ?? ['Behaviour matches the description end-to-end', 'Unit tests cover the happy path and one failure case'],
    priority: extra.priority ?? 'P2', type: extra.type ?? 'feature', labels: extra.labels ?? [], context: extra.context ?? '',
  }).then((r) => r.task.key as string);

// Agents announce capacity
await tool(Priya.agent, 'report_usage', { remaining_percent: 72, note: '5-hour window' });
await tool(Marco.agent, 'report_usage', { remaining_percent: 40 });
await tool(Lena.agent, 'report_usage', { remaining_percent: 88 });

// Done, verified by an agent
const done = await mk('Add password reset via emailed link', Priya.id, Marco.id, {
  priority: 'P1', labels: ['auth'], ac: ['Reset email is sent for a known address', 'Link expires after 1 hour and is single use'],
  context: 'Auth code: src/auth/*. Mailer: src/lib/mail.ts.',
});
await tool(Priya.agent, 'start_task', { key: done });
await tool(Priya.agent, 'log_progress', { key: done, message: 'Added reset_tokens table + POST /auth/reset. Writing confirm endpoint next.' });
await tool(Priya.agent, 'submit_for_review', {
  key: done, summary: 'Added /auth/reset and /auth/reset/confirm with hashed, single-use, 1h tokens.',
  criteria: [{ id: 'AC1', evidence: 'src/auth/reset.ts sends via mailer; reset.spec.ts "sends email" passes' }, { id: 'AC2', evidence: 'expires_at = now()+1h; confirm sets used_at atomically; spec covers expiry + reuse' }],
  tests: 'npm test — 52 passed; npm run lint clean', artifacts: ['https://github.com/acme/web/pull/118'],
});
await tool(Marco.agent, 'review_task', {
  key: done, verdict: 'approve', summary: 'Checked out PR #118, ran specs, read the diff.',
  criteria: [{ id: 'AC1', passed: true }, { id: 'AC2', passed: true, note: 'Reuse correctly rejected' }],
});

// In review
const review = await mk('Show unread count badge in sidebar', Marco.id, Lena.id, { labels: ['frontend'] });
await tool(Marco.agent, 'start_task', { key: review });
await tool(Marco.agent, 'submit_for_review', {
  key: review, summary: 'Badge reads from /api/notifications/unread and updates every 30s via SWR.',
  criteria: [{ id: 'AC1', evidence: 'Sidebar.tsx renders <UnreadBadge/>; verified manually in preview' }, { id: 'AC2', evidence: 'UnreadBadge.spec.tsx covers count and API error states' }],
  artifacts: ['https://github.com/acme/web/pull/121'],
});

// Rejected once, back in progress
const rework = await mk('Paginate the audit log table', Lena.id, Priya.id, { labels: ['admin'] });
await tool(Lena.agent, 'start_task', { key: rework });
await tool(Lena.agent, 'submit_for_review', {
  key: rework, summary: 'Added cursor pagination to /api/audit and a Load more button.',
  criteria: [{ id: 'AC1', evidence: 'Cursor pagination on id DESC, 50 per page' }, { id: 'AC2', evidence: 'audit.spec.ts covers first page' }],
});
await tool(Priya.agent, 'review_task', {
  key: rework, verdict: 'reject', summary: 'Pagination works but the failure case is missing.',
  criteria: [{ id: 'AC1', passed: true }, { id: 'AC2', passed: false, note: 'No test for an invalid cursor — add one that expects a 400.' }],
});
await tool(Lena.agent, 'log_progress', { key: rework, message: 'Adding invalid-cursor test per review; returning 400 with a clear message.' });

// Handoff: Marco's agent runs low and hands off; Lena's agent picks it up later
const handoff = await mk('Export reports as CSV', Marco.id, Priya.id, { priority: 'P1', labels: ['reports'] });
await tool(Marco.agent, 'start_task', { key: handoff });
await tool(Marco.agent, 'log_progress', { key: handoff, message: 'Export button and endpoint done on feat/csv-export.' });
await tool(Marco.agent, 'report_usage', { remaining_percent: 6, resets_at: new Date(Date.now() + 3 * 3600_000).toISOString(), note: '5-hour window' });
await tool(Marco.agent, 'handoff_task', {
  key: handoff, reason: 'usage limit reached, resets in ~3h',
  notes: 'Done: export button + GET /reports/export.csv on branch feat/csv-export (AC1 basically met).\nLeft: column order must match ReportTable — derive from its column defs (AC1), and write the tests (AC2).\nGotcha: dates must be ISO, finance imports into Excel.',
});

// Blocked
const blocked = await mk('Integrate Stripe billing portal link', Priya.id, Lena.id, { labels: ['billing'], priority: 'P1' });
await tool(Priya.agent, 'start_task', { key: blocked });
await tool(Priya.agent, 'report_blocker', { key: blocked, reason: 'Need a Stripe test-mode API key added to the preview environment.' });

// Ready + backlog
await mk('Dark mode toggle in settings', Lena.id, Marco.id, { labels: ['frontend'], priority: 'P3' });
await mk('Rate-limit the login endpoint', Priya.id, Marco.id, { type: 'chore', labels: ['auth', 'security'] });
await tool(Lena.agent, 'create_task', {
  project: 'WEB', title: 'Flaky test: notifications.spec.ts times out on CI', type: 'bug',
  description: 'Found while working WEB-3: the notifications spec intermittently exceeds the 5s timeout on CI.', acceptance_criteria: ['Spec passes 20 runs in a row on CI'],
});
await mk('Onboarding checklist for new workspaces', null, null, { description: 'Rough idea — needs scoping.', ac: [] });

await tool(Priya.agent, 'add_comment', { key: handoff, body: 'I can review this one once Lena\'s agent picks it up.' });
console.log('Demo data created. Teammates sign in with password demo-password-123.');

// Check-ins: the owner's agent asks Priya; Lena asks the owner from the app.
const ownerAgent = (await owner.call('POST', '/api/agent-tokens', { name: 'My Claude Code' })).token;
await tool(ownerAgent, 'report_usage', { remaining_percent: 64 });
await tool(ownerAgent, 'ask_teammate', { to: 'priya', question: 'Did you get the Stripe test key sorted for the billing portal?' });
const priyaInbox = await tool(Priya.agent, 'check_inbox');
const askId = /id ([0-9a-f-]{36})/.exec(priyaInbox)![1];
await tool(Priya.agent, 'answer_question', { id: askId, answer: 'Not yet — WEB-5 is still blocked waiting on the key in the preview env. I flagged it there.' });
const me = (await owner.call('GET', '/api/me')).me;
await Lena.s.call('POST', '/api/asks', { to_member_id: me.id, question: 'Are we still launching the CSV export this Friday?' });
console.log('Check-ins added.');

// A second, completely separate team. You're invited into it too, so the team switcher has two entries.
const noor = new Session();
noor.team = (await noor.call('POST', '/api/signup', { name: 'Noor Haddad', email: 'noor@example.test', password: 'demo-password-123', team: 'Moonshot Studio', code })).team;
await noor.call('POST', '/api/projects', { key: 'WEB', name: 'Landing site' });
const { link: moonLink } = await noor.call('POST', '/api/invites', { email: process.env.DEMO_EMAIL, role: 'member' });
await owner.call('POST', `/api/join/${moonLink.split('/join/')[1]}`, {});
const myId = (await owner.call('GET', '/api/me')).me.id;
await noor.call('POST', '/api/tasks', {
  project: 'WEB', title: 'Design the Moonshot landing hero', ready: true, assignee_id: myId,
  reviewer_id: (await noor.call('GET', '/api/me')).me.id,
  description: 'Hero section for the launch: headline, sub-copy and one product shot. Same WEB key as your other team, totally separate data.',
  acceptance_criteria: ['Hero renders on mobile and desktop', 'Copy approved by Noor'],
});
console.log(`Second team created: Moonshot Studio (you are a member). Your teams: /t/${signup.team} and /t/${noor.team}`);
