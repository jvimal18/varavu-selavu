/**
 * Auth & sessions — `revokeAllOtherSessions` SQL pattern.
 *
 * Capability: the SQL the PIN-change flow runs to revoke every
 * active session for a user except the one currently held.
 *
 * The SQL is inlined here (mirroring what the production helper
 * does) so this test is the canary for that contract. Phase 2
 * will exercise the same SQL through the real `setup-pin` HTTP
 * flow with cookies and a real Nuxt server.
 *
 * Companion files:
 *   token-and-session-lifecycle.test.ts  - pure helpers
 *   session-schema.test.ts               - sessions table contract
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashSessionToken, newSessionToken } from '~~/server/utils/auth'

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
