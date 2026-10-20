// Minimal query layer. In production we use Netlify Database (Postgres);
// local dev and tests inject an embedded PGlite driver via setDriver().

export interface Driver {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

let driver: Driver | null = null;

export function setDriver(d: Driver) {
  driver = d;
}

async function getDriver(): Promise<Driver> {
  if (driver) return driver;
  const { getDatabase } = await import('@netlify/database');
  const db = getDatabase();
  driver = { query: (text, params) => db.pool.query(text, params as any[]) as any };
  return driver;
}

export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const d = await getDriver();
  const res = await d.query(text, params);
  return res.rows as T[];
}

export async function one<T = any>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

export const json = (v: unknown) => JSON.stringify(v ?? null);
