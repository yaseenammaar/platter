import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { setDriver } from './db.ts';

const MIGRATIONS = join(import.meta.dirname, '..', 'netlify', 'database', 'migrations');

/** Open an embedded Postgres (in-memory when dir is undefined) and apply pending migrations. */
export async function openLocalDb(dir?: string) {
  if (dir) await mkdir(dir, { recursive: true });
  const pg = new PGlite(dir);
  await pg.exec('CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY)');
  const applied = new Set((await pg.query<{ name: string }>('SELECT name FROM _local_migrations')).rows.map((r) => r.name));
  for (const file of (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    await pg.exec(await readFile(join(MIGRATIONS, file), 'utf8'));
    await pg.query('INSERT INTO _local_migrations (name) VALUES ($1)', [file]);
  }
  setDriver({ query: (text, params) => pg.query(text, params as any[]) });
  return pg;
}
