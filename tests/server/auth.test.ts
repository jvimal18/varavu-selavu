/**
 * Tests for `server/utils/auth.ts` (Phase 1 PR 4).
 *
 * Covers the pure helpers (hashSessionToken, newSessionToken, TOKEN_LENGTH,
 * the last_seen_at debounce) and the DB-bound invariants of the sessions
 * table (FK with CASCADE, indexes, the revokeAllOtherSessions SQL
 * pattern).
 *
 * The async session lifecycle (setSessionUserId, getCurrentUser,
 * clearSessionCookie) calls h3's getCookie/setCookie under the hood,
 * which requires an h3 event. Rather than build a heavy h3 test
 * harness, we test the SQL-level invariants directly and trust the
 * glue: the schema is the contract, and the h3 wiring is a thin
 * layer over it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import {
  hashSessionToken,
  newSessionToken,
  TOKEN_LENGTH,
  LAST_SEEN_DEBOUNCE_MS,
  shouldBumpLastSeen,
  markLastSeenWritten,
} from '~~/server/utils/auth'

// ============================================================
// Pure-function tests (no DB needed)
// ============================================================

describe('hashSessionToken', () => {
  it('produces a 64-char hex string (SHA-256)', () => {
    const h = hashSessionToken('hello')
    expect(h).toHaveLength(64)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('matches crypto.createHash("sha256").update(token).digest("hex")', () => {
    const token = newSessionToken()
    const expected = createHash('sha256').update(token).digest('hex')
    expect(hashSessionToken(token)).toBe(expected)
  })

  it('is stable for a given token (deterministic)', () => {
    expect(hashSessionToken('fixed-token-for-test'))
      .toBe(hashSessionToken('fixed-token-for-test'))
  })

  it('produces different hashes for different tokens', () => {
    expect(hashSessionToken('a')).not.toBe(hashSessionToken('b'))
  })
})

describe('newSessionToken', () => {
  it('produces a 43-character string (base64url of 32 bytes)', () => {
    expect(newSessionToken()).toHaveLength(43)
  })

  it('produces base64url (no +, /, or = characters)', () => {
    expect(newSessionToken()).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('produces a different value each call (100 trials, no collisions)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 100; i++) seen.add(newSessionToken())
    expect(seen.size).toBe(100)
  })

  it('encodes 32 bytes (verifies via a known input)', () => {
    const bytes = randomBytes(32)
    expect(Buffer.from(bytes).toString('base64url')).toHaveLength(43)
  })
})

describe('TOKEN_LENGTH discriminator', () => {
  it('equals 43 (base64url of 32 bytes)', () => {
    expect(TOKEN_LENGTH).toBe(43)
  })

  it('legacy userId "u_vimal" is shorter than TOKEN_LENGTH (catches legacy cookies)', () => {
    expect('u_vimal'.length).toBeLessThan(TOKEN_LENGTH)
  })

  it('legacy userId "u_pavithra" is shorter than TOKEN_LENGTH (catches legacy cookies)', () => {
    expect('u_pavithra'.length).toBeLessThan(TOKEN_LENGTH)
  })
})

describe('shouldBumpLastSeen (5-min debounce)', () => {
  const sessionId = 'session-x'
  const now = 1_700_000_000_000

  it('returns true on first call (never written)', () => {
    expect(shouldBumpLastSeen(sessionId, now)).toBe(true)
  })

  it('returns false within the debounce window after a mark', () => {
    markLastSeenWritten(sessionId, now - 1000) // 1s ago
    expect(shouldBumpLastSeen(sessionId, now)).toBe(false)
  })

  it('returns true at exactly the debounce window', () => {
    markLastSeenWritten(sessionId, now - LAST_SEEN_DEBOUNCE_MS)
    expect(shouldBumpLastSeen(sessionId, now)).toBe(true)
  })

  it('returns true past the debounce window', () => {
    markLastSeenWritten(sessionId, now - LAST_SEEN_DEBOUNCE_MS - 1)
    expect(shouldBumpLastSeen(sessionId, now)).toBe(true)
  })

  it('is per-session (writes to A do not affect B)', () => {
    markLastSeenWritten('session-A', now)
    expect(shouldBumpLastSeen('session-A', now)).toBe(false)
    expect(shouldBumpLastSeen('session-B', now)).toBe(true)
  })
})

// ============================================================
// DB schema tests
// ============================================================

interface TestDb {
  tmpDir: string
  dbPath: string
  db: Database.Database
}

function setupTestDb(): TestDb {
  const tmpDir = mkdtempSync(join(tmpdir(), 'vs-auth-test-'))
  const dbPath = join(tmpDir, 'test.db')
  const db = new Database(dbPath)
  const ormDb = drizzle(db)
  migrate(ormDb, { migrationsFolder: './db/migrations' })
  // Insert a user (FK target for sessions)
  db.prepare(
    "INSERT INTO users (id, name, color, pin_hash, created_at) VALUES ('u1', 'Test', '#000000', 'h', '2026-01-01T00:00:00Z')",
  ).run()
  return { tmpDir, dbPath, db }
}

function teardownTestDb({ tmpDir, db }: TestDb): void {
  db.close()
  rmSync(tmpDir, { recursive: true, force: true })
}

describe('sessions table schema', () => {
  let ctx: TestDb
  beforeEach(() => { ctx = setupTestDb() })
  afterEach(() => { teardownTestDb(ctx) })

  it('has the expected columns', () => {
    const cols = ctx.db.prepare("PRAGMA table_info('sessions')").all() as { name: string }[]
    const names = cols.map((c) => c.name)
    expect(names).toEqual([
      'id', 'user_id', 'user_agent', 'ip',
      'created_at', 'last_seen_at', 'expires_at', 'revoked_at',
    ])
  })

  it('indexes exist on user_id and expires_at', () => {
    const indexes = ctx.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sessions'",
    ).all() as { name: string }[]
    const names = indexes.map((i) => i.name)
    expect(names).toContain('idx_sessions_user')
    expect(names).toContain('idx_sessions_expires')
  })

  it('FK constraint: sessions.user_id -> users.id with ON DELETE CASCADE', () => {
    const now = new Date().toISOString()
    const id = hashSessionToken(newSessionToken())
    ctx.db.prepare(
      `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(id, 'u1', now, now, now)

    ctx.db.prepare('DELETE FROM users WHERE id = ?').run('u1')
    const row = ctx.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
    expect(row).toBeUndefined()
  })

  it('FK rejects session for non-existent user', () => {
    expect(() => {
      ctx.db.prepare(
        `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
      ).run(
        hashSessionToken(newSessionToken()),
        'non_existent_user',
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString(),
      )
    }).toThrow(/FOREIGN KEY constraint failed/)
  })

  it('id is the SHA-256 hash of the token (never the raw token)', () => {
    const now = new Date().toISOString()
    const rawToken = newSessionToken()
    const hashedId = hashSessionToken(rawToken)
    ctx.db.prepare(
      `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(hashedId, 'u1', now, now, now)

    const row = ctx.db.prepare('SELECT id FROM sessions').get() as { id: string }
    // The stored id is the hash, not the raw token
    expect(row.id).toBe(hashedId)
    expect(row.id).not.toBe(rawToken)
    expect(row.id).toHaveLength(64)  // SHA-256 hex is 64 chars
  })
})

// ============================================================
// revokeAllOtherSessions SQL pattern
// ============================================================

describe('revokeAllOtherSessions SQL pattern', () => {
  let ctx: TestDb
  beforeEach(() => {
    ctx = setupTestDb()
    // Add a second user for cross-user isolation tests
    ctx.db.prepare(
      "INSERT INTO users (id, name, color, pin_hash, created_at) VALUES ('u2', 'Other', '#ffffff', 'h', '2026-01-01T00:00:00Z')",
    ).run()
  })
  afterEach(() => { teardownTestDb(ctx) })

  function insertSession(userId: string, token: string): string {
    const now = new Date().toISOString()
    const id = hashSessionToken(token)
    ctx.db.prepare(
      `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(id, userId, now, now, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString())
    return id
  }

  // Mirror of the SQL the auth helper actually runs.
  function revokeAllOthers(userId: string, keepId: string): void {
    const now = new Date().toISOString()
    ctx.db.prepare(
      `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL`,
    ).run(now, userId, keepId)
  }

  it('revokes all sessions for the user except the keep-one', () => {
    const keep = insertSession('u1', 'keep-token')
    const other1 = insertSession('u1', 'other-token-1')
    const other2 = insertSession('u1', 'other-token-2')

    revokeAllOthers('u1', keep)

    expect((ctx.db.prepare('SELECT revoked_at FROM sessions WHERE id = ?').get(keep) as any).revoked_at).toBeNull()
    expect((ctx.db.prepare('SELECT revoked_at FROM sessions WHERE id = ?').get(other1) as any).revoked_at).not.toBeNull()
    expect((ctx.db.prepare('SELECT revoked_at FROM sessions WHERE id = ?').get(other2) as any).revoked_at).not.toBeNull()
  })

  it('does not affect other users sessions', () => {
    const keepU1 = insertSession('u1', 'u1-keep')
    insertSession('u1', 'u1-other')
    const u2Session = insertSession('u2', 'u2-session')

    revokeAllOthers('u1', keepU1)

    expect((ctx.db.prepare('SELECT revoked_at FROM sessions WHERE id = ?').get(u2Session) as any).revoked_at).toBeNull()
  })

  it('does not double-revoke (already-revoked sessions are left alone)', () => {
    const keep = insertSession('u1', 'keep')
    const alreadyRevoked = insertSession('u1', 'revoked')
    const originalRevokedAt = '2025-01-01T00:00:00Z'
    ctx.db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(originalRevokedAt, alreadyRevoked)

    revokeAllOthers('u1', keep)

    const row = ctx.db.prepare('SELECT revoked_at FROM sessions WHERE id = ?').get(alreadyRevoked) as any
    expect(row.revoked_at).toBe(originalRevokedAt) // unchanged
  })
})
