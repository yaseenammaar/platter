// Local development server: same Hono app, backed by an embedded Postgres (PGlite)
// that applies the Netlify Database migrations from netlify/database/migrations.
import { createServer } from 'node:net';
import { serve } from '@hono/node-server';
import { app } from './app.ts';
import { openLocalDb } from './localdb.ts';

process.env.SIGNUP_CODE ??= 'local-dev';
const port = Number(process.env.API_PORT ?? 8787);

// Two dev servers opening the same embedded database corrupts it, so bail out
// *before* touching it if another Platter API already owns the port.
const portFree = await new Promise<boolean>((resolve) => {
  const probe = createServer().once('error', () => resolve(false)).once('listening', () => probe.close(() => resolve(true)));
  probe.listen(port);
});
if (!portFree) {
  console.error(`\nPort ${port} is already in use — Platter is probably already running in another terminal.\nStop that one first (Ctrl-C), then run npm run dev again.\n`);
  process.exit(1);
}

const pg = await openLocalDb(process.env.TASKPILOT_DATA_DIR ?? '.data/pglite-teams');

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`Platter API on http://localhost:${port}  (signup code: ${process.env.SIGNUP_CODE})`);
});

// Close the embedded database cleanly on restart (tsx watch) or Ctrl-C, or its files can get corrupted.
let closing = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    if (closing) return;
    closing = true;
    server.close();
    await pg.close().catch(() => {});
    process.exit(0);
  });
}
