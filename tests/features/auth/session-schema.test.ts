/**
 * Auth & sessions — `sessions` table schema contract.
 *
 * Capability: the on-disk shape every auth code path depends on.
 * If any of these columns, indexes, or FK constraints is missing,
 * the first call to `setSessionUserId` / `getCurrentUser` crashes
 * (e.g. the PR-4 missing-snapshot bug surfaced as
 * `no such table: sessions`).
 *
 * Companion files:
 *   token-and-session-lifecycle.test.ts  - pure helpers
 *   http-flows.test.ts                    - setup-PIN revocation HTTP proof
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
