/**
 * Auth helpers — session-based PIN auth.
 *
 * Session model (Phase 1 PR 4):
 *   - The cookie holds a 43-character base64url(32-byte) random token.
 *   - The DB holds `SHA-256(token)` as the session row's primary key.
 *   - The DB never sees the raw token. A leaked DB file yields only
 *     hashes, not bearer tokens.
 *   - Legacy cookies (pre-PR-4) held the userId directly (e.g. "u_vimal").
 *     They are no longer valid — every user re-logs in once after upgrade.
 *     See `TOKEN_LENGTH` for the deterministic discriminator.
 *
 * Per-request cost: one PK lookup on `sessions` + one PK lookup on `users`,
 * both O(log n) on a B-tree index. With <100 rows in either table, the
 * combined cost is sub-millisecond. WAL mode serializes writes; the
 * `last_seen_at` debounce keeps the write rate at most 1/session/5min.
 */
import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'
import { getCookie, setCookie, deleteCookie, getRequestProtocol, getRequestHeader, type H3Event, createError } from 'h3'
import { useDb, schema } from '../db/client'
import { and, eq, isNull, ne } from 'drizzle-orm'

const COOKIE_NAME = 'vs_session'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days

/**
 * Length of a base64url-encoded 32-byte token. Legacy cookies held the
 * userId directly (7-10 chars), so any cookie value not exactly this length
 * is rejected without a DB lookup. Deterministic, survives any future
 * userId format change.
 */
export const TOKEN_LENGTH = 43

/**
 * Debounce window for `last_seen_at` updates. With WAL mode, every write
 * serializes; the in-process Map keeps the write rate at most one update
 * per session per window. Lost on server restart (acceptable: the first
 * request after restart always writes).
 */
export const LAST_SEEN_DEBOUNCE_MS = 5 * 60 * 1000

// =====================================================
// PIN HASHING (DECISIONS D50: bcryptjs, pure JS, no native deps)
// =====================================================
export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10)
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash)
}

// =====================================================
// SESSION TOKEN HELPERS
// =====================================================

/** SHA-256 hex digest of a session token. Stable for the token's lifetime. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** A fresh 43-character base64url(32-byte) random token. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

// =====================================================
// last_seen_at DEBOUNCE (in-process Map)
// =====================================================

/** sessionId -> epoch ms of last write. Bounded by active session count. */
const lastSeenWrites = new Map<string, number>()

export function shouldBumpLastSeen(sessionId: string, now: number = Date.now()): boolean {
  const last = lastSeenWrites.get(sessionId)
  if (last === undefined) return true // never written, or lost on restart
  return now - last >= LAST_SEEN_DEBOUNCE_MS
}

export function markLastSeenWritten(sessionId: string, now: number = Date.now()): void {
  lastSeenWrites.set(sessionId, now)
}

// =====================================================
// TIMESTAMPS
// =====================================================

/** ISO 8601 string. Consistent format used across the sessions table. */
export function nowIso(): string {
  return new Date().toISOString()
}

// =====================================================
// SESSION CRUD
// =====================================================

export interface SessionMeta {
  userAgent?: string | null
  ip?: string | null
}

/**
 * Create a new session and set the cookie. Async because the session row
 * must be inserted before the request can be authenticated.
 *
 * Callers MUST `await` this — otherwise the response is sent before the
 * DB write completes, leaving an orphan cookie pointing at a non-existent
 * session row. Current callers: `login.post.ts`, `setup-pin.post.ts`.
 */
export async function setSessionUserId(
  event: H3Event,
  userId: string,
  meta: SessionMeta = {},
): Promise<void> {
  const token = newSessionToken()
  const id = hashSessionToken(token)
  const now = nowIso()
  const expires = new Date(Date.now() + COOKIE_MAX_AGE_SECONDS * 1000).toISOString()

  const db = useDb()
  await db.insert(schema.sessions).values({
    id,
    userId,
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: expires,
    revokedAt: null,
  }).run()

  setCookie(event, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: getRequestProtocol(event) === 'https',
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: '/',
  })
}

/**
 * Revoke the current session (mark `revoked_at = now()`) and delete the
 * cookie. Async because the DB write must complete before the response
 * is sent.
 *
 * Current caller: `logout.post.ts` — handler must be `async` and `await`
 * this.
 */
export async function clearSessionCookie(event: H3Event): Promise<void> {
  const token = getCookie(event, COOKIE_NAME)
  if (token) {
    const id = hashSessionToken(token)
    const db = useDb()
    await db.update(schema.sessions)
      .set({ revokedAt: nowIso() })
      .where(eq(schema.sessions.id, id))
      .run()
  }
  deleteCookie(event, COOKIE_NAME, { path: '/' })
}

/**
 * Revoke every active session for `userId` EXCEPT `currentSessionId`.
 * Used by `setup-pin.post.ts` after a PIN change so a compromised /
 * shared device doesn't keep its session.
 *
 * Pass `null` for `currentSessionId` to revoke ALL sessions (e.g. admin
 * action; not currently used).
 */
export async function revokeAllOtherSessions(
  userId: string,
  currentSessionId: string | null,
): Promise<void> {
  const db = useDb()
  const baseWhere = currentSessionId
    ? and(
        eq(schema.sessions.userId, userId),
        ne(schema.sessions.id, currentSessionId),
        isNull(schema.sessions.revokedAt),
      )
    : and(
        eq(schema.sessions.userId, userId),
        isNull(schema.sessions.revokedAt),
      )
  await db.update(schema.sessions)
    .set({ revokedAt: nowIso() })
    .where(baseWhere)
    .run()
}

/**
 * Read meta (UA, IP) from the current request — convenience for
 * `setSessionUserId`.
 */
export function readSessionMeta(event: H3Event): SessionMeta {
  return {
    userAgent: getRequestHeader(event, 'user-agent')?.slice(0, 256) ?? null,
    ip: getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  }
}

/**
 * Read the raw session token from the cookie, or null if missing or
 * not a valid token format. Used by `setup-pin.post.ts` to capture the
 * current session ID before `setSessionUserId` overwrites the cookie
 * (so it can pass the "keep this one" argument to `revokeAllOtherSessions`).
 */
export function getSessionTokenFromCookie(event: H3Event): string | null {
  const token = getCookie(event, COOKIE_NAME)
  if (!token || token.length !== TOKEN_LENGTH) return null
  return token
}

// =====================================================
// USER LOOKUP
// =====================================================

/**
 * Validate the session cookie and return the user, or null.
 *
 * Returns null (not throws) so callers can decide whether to 401.
 *
 * Important: returns null for any of:
 *   - missing cookie
 *   - wrong-length cookie (legacy userId, malicious input, truncation)
 *   - session row not found
 *   - session revoked
 *   - session expired
 *
 * If valid, bumps `last_seen_at` (debounced to 1 write per 5min per session)
 * and returns the user.
 */
export async function getCurrentUser(event: H3Event) {
  const token = getCookie(event, COOKIE_NAME)
  if (!token) return null

  // Legacy cookies held the userId directly. Fail fast without a DB lookup.
  // After the PR 4 deploy, all pre-existing cookies are invalid; users re-login.
  if (token.length !== TOKEN_LENGTH) return null

  const id = hashSessionToken(token)
  const db = useDb()
  const session = await db.select().from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .get()

  if (!session) return null
  if (session.revokedAt) return null
  if (session.expiresAt < nowIso()) return null

  // Debounced last_seen_at bump. SQLite WAL serializes writes, so even with
  // a 2-user app, batching them at most every 5min per session is cheap insurance.
  if (shouldBumpLastSeen(id)) {
    await db.update(schema.sessions)
      .set({ lastSeenAt: nowIso() })
      .where(eq(schema.sessions.id, id))
      .run()
    markLastSeenWritten(id)
  }

  const user = await db.select().from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .get()
  return user || null
}

export async function requireUser(event: H3Event) {
  const user = await getCurrentUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }
  return user
}

// =====================================================
// VALIDATION
// =====================================================

export function validatePin(pin: string): { valid: boolean; error?: string } {
  if (!pin) return { valid: false, error: 'PIN is required' }
  if (!/^\d{4,6}$/.test(pin)) return { valid: false, error: 'PIN must be 4-6 digits' }
  return { valid: true }
}
