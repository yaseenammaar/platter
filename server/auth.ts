import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { one, q } from './db.ts';
import { LIMITS, RuleError, type Actor } from './rules.ts';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const SESSION_COOKIE = 'platter_session';
export const AGENT_TOKEN_PREFIX = 'plt_';

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(pw: string, stored: string) {
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(pw, Buffer.from(salt, 'base64url'), expected.length);
  return timingSafeEqual(expected, actual);
}

export function validatePassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < LIMITS.passwordMin) {
    throw new RuleError('weak_password', `Password must be at least ${LIMITS.passwordMin} characters (P6)`);
  }
  return pw;
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newSecret = (prefix = '') => prefix + randomBytes(24).toString('base64url');

export async function createSession(userId: string) {
  const token = newSecret();
  const expires = new Date(Date.now() + LIMITS.sessionTtlDays * 86400_000);
  await q('INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)', [
    randomUUID(), userId, sha256(token), expires,
  ]);
  return { token, expires };
}

export async function destroySession(token: string) {
  await q('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

export interface User { id: string; name: string; email: string }

/** The signed-in person (team-independent). */
export async function resolveUser(sessionToken: string | null): Promise<User | null> {
  if (!sessionToken) return null;
  return one<User>(
    `SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(sessionToken)],
  );
}

/** Teams this person can open (active memberships only). */
export async function listTeams(userId: string) {
  return q<{ slug: string; name: string; role: string }>(
    `SELECT w.slug, w.name, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = $1 AND m.status = 'active' ORDER BY w.created_at`,
    [userId],
  );
}

/**
 * Resolve who is calling and in which team:
 *  - an agent (Bearer token) — the token itself belongs to one team;
 *  - a signed-in person (session cookie) working in the team named by `teamSlug`.
 * Returns null if they have no active membership there (P0/P4).
 */
export async function resolveActor(bearer: string | null, sessionToken: string | null, teamSlug: string | null): Promise<Actor | null> {
  if (bearer) {
    const row = await one(
      `SELECT u.id, u.name, u.email, m.role, t.id AS agent_id, t.name AS agent_name, t.last_used_at,
              w.id AS ws_id, w.slug AS ws_slug, w.name AS ws_name
         FROM agent_tokens t
         JOIN users u ON u.id = t.member_id
         JOIN memberships m ON m.user_id = t.member_id AND m.workspace_id = t.workspace_id
         JOIN workspaces w ON w.id = t.workspace_id
        WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND m.status = 'active'`,
      [sha256(bearer)],
    );
    if (!row) return null;
    if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 60_000) {
      await q('UPDATE agent_tokens SET last_used_at = now() WHERE id = $1', [row.agent_id]);
    }
    return {
      kind: 'agent',
      member: { id: row.id, name: row.name, email: row.email, role: row.role },
      agent: { id: row.agent_id, name: row.agent_name },
      workspace: { id: row.ws_id, slug: row.ws_slug, name: row.ws_name },
    };
  }
  const user = await resolveUser(sessionToken);
  if (!user || !teamSlug) return null;
  const m = await one(
    `SELECT m.role, w.id, w.slug, w.name FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
      WHERE w.slug = $1 AND m.user_id = $2 AND m.status = 'active'`,
    [teamSlug.toLowerCase(), user.id],
  );
  if (!m) return null;
  return { kind: 'human', member: { ...user, role: m.role }, workspace: { id: m.id, slug: m.slug, name: m.name } };
}

export function requireUser(user: User | null): User {
  if (!user) throw new RuleError('unauthorized', 'Sign in required', 401);
  return user;
}
