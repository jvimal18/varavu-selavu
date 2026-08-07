/**
 * Backup & operations — periodic session cleanup cutoffs.
 *
 * Capability: `scripts/cleanup-sessions.mjs` (`runCleanup`) prunes the
 * sessions table monthly. The contract is cutoffs, not exact ages:
 *   - sessions expired MORE than 30 days ago are deleted
 *   - sessions revoked MORE than 7 days ago are deleted
 *   - rows exactly AT a cutoff are retained (strict `<` comparison)
 *   - active sessions are never deleted regardless of age
 *
 * The comparison is string-wise on ISO-8601 UTC timestamps (both the stored
 * `expires_at`/`revoked_at` and the computed cutoffs are `toISOString()`
 * output), so tests compute boundary timestamps from the same `now` the
 * script receives.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCleanup } from '~~/scripts/cleanup-sessions.mjs'

const DAY_MS = 24 * 60 * 60 * 1000
const EXPIRED_RETENTION_MS = 30 * DAY_MS
const REVOKED_RETENTION_MS = 7 * DAY_MS

/** A fixed `now` keeps the boundary arithmetic fully deterministic. */
const NOW = new Date('2026-07-01T00:00:00.000Z')
const EXPIRED_CUTOFF = new Date(NOW.getTime() - EXPIRED_RETENTION_MS).toISOString()
const REVOKED_CUTOFF = new Date(NOW.getTime() - REVOKED_RETENTION_MS).toISOString()

interface TestCtx {
  tmpDir: string
  dbPath: string
}

function setupDb(): TestCtx {
  const tmpDir = mkdtempSync(join(tmpdir(), 'vs-cleanup-test-'))
  const dbPath = join(tmpDir, 'test.db')
  const db = new Database(dbPath)
  // Real migrations so the sessions schema (FKs, indexes) matches prod.
  const ormDb = drizzle(db)
  migrate(ormDb, { migrationsFolder: './db/migrations' })
  // sessions.user_id is a NOT NULL FK — every session needs a real user.
  db.prepare("INSERT INTO users (id, name, color, created_at) VALUES ('u1', 'Test', '#000000', '2026-01-01T00:00:00.000Z')").run()
  db.close()
  return { tmpDir, dbPath }
}

function teardownDb({ tmpDir }: TestCtx): void {
  rmSync(tmpDir, { recursive: true, force: true })
}

function insertSession(dbPath: string, id: string, { expiresAt, revokedAt }: { expiresAt: string; revokedAt: string | null }): void {
  const db = new Database(dbPath)
  try {
    db.prepare(
      `INSERT INTO sessions (id, user_id, user_agent, ip, created_at, last_seen_at, expires_at, revoked_at)
       VALUES (?, 'u1', NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?, ?)`,
    ).run(id, expiresAt, revokedAt)
  } finally {
    db.close()
  }
}

function sessionIds(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true })
  try {
    return (db.prepare('SELECT id FROM sessions ORDER BY id').all() as { id: string }[]).map((r) => r.id)
  } finally {
    db.close()
  }
}

describe('runCleanup session retention cutoffs', () => {
  it('retains a session expired exactly 30 days ago and deletes one expired 30 days + 1 second ago', () => {
    const ctx = setupDb()
    try {
      const exactly30d = new Date(NOW.getTime() - EXPIRED_RETENTION_MS).toISOString()
      const past30d = new Date(NOW.getTime() - EXPIRED_RETENTION_MS - 1000).toISOString()
      expect(exactly30d, 'the boundary fixture must compute the same string the script compares against').toBe(EXPIRED_CUTOFF)

      insertSession(ctx.dbPath, 's_expired_exact', { expiresAt: exactly30d, revokedAt: null })
      insertSession(ctx.dbPath, 's_expired_past', { expiresAt: past30d, revokedAt: null })

      const result = runCleanup({ dbPath: ctx.dbPath, now: NOW })

      expect(result.deleted, 'a cutoff regression would delete the exactly-30-day-old session or keep the older one').toBe(1)
      expect(sessionIds(ctx.dbPath), 'a cutoff regression would delete a session at exactly the 30-day boundary').toEqual(['s_expired_exact'])
    } finally {
      teardownDb(ctx)
    }
  })

  it('retains a session revoked exactly 7 days ago and deletes one revoked 7 days + 1 second ago', () => {
    const ctx = setupDb()
    try {
      const exactly7d = new Date(NOW.getTime() - REVOKED_RETENTION_MS).toISOString()
      const past7d = new Date(NOW.getTime() - REVOKED_RETENTION_MS - 1000).toISOString()
      expect(exactly7d, 'the boundary fixture must compute the same string the script compares against').toBe(REVOKED_CUTOFF)

      // Not yet expired (expires far in the future) so only the revoked branch applies.
      insertSession(ctx.dbPath, 's_revoked_exact', { expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: exactly7d })
      insertSession(ctx.dbPath, 's_revoked_past', { expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: past7d })

      const result = runCleanup({ dbPath: ctx.dbPath, now: NOW })

      expect(result.deleted, 'a revoked-cutoff regression would delete the exactly-7-day-old session or keep the older one').toBe(1)
      expect(sessionIds(ctx.dbPath), 'a revoked-cutoff regression would delete a session at exactly the 7-day boundary').toEqual(['s_revoked_exact'])
    } finally {
      teardownDb(ctx)
    }
  })

  it('never deletes active (non-expired, non-revoked) sessions regardless of age', () => {
    const ctx = setupDb()
    try {
      // None of these have passed a cutoff: far-future expiry (created long
      // ago), expires tomorrow, expired recently (inside the 30-day window),
      // revoked recently (inside the 7-day window).
      insertSession(ctx.dbPath, 's_active_ancient', { expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: null })
      insertSession(ctx.dbPath, 's_active_expires_tomorrow', { expiresAt: new Date(NOW.getTime() + DAY_MS).toISOString(), revokedAt: null })
      insertSession(ctx.dbPath, 's_expired_recently', { expiresAt: new Date(NOW.getTime() - 5 * DAY_MS).toISOString(), revokedAt: null })
      insertSession(ctx.dbPath, 's_revoked_recently', { expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: new Date(NOW.getTime() - 5 * DAY_MS).toISOString() })

      const result = runCleanup({ dbPath: ctx.dbPath, now: NOW })

      expect(result.deleted, 'an active-session regression would delete sessions that have not passed a cutoff').toBe(0)
      expect(sessionIds(ctx.dbPath), 'an active-session regression would remove valid sessions').toEqual([
        's_active_ancient',
        's_active_expires_tomorrow',
        's_expired_recently',
        's_revoked_recently',
      ])
    } finally {
      teardownDb(ctx)
    }
  })

  it('applies the 7-day revoked cutoff, not the 30-day expired cutoff, when a session is both', () => {
    const ctx = setupDb()
    try {
      // Long-revoked (past the 7-day cutoff) but only recently expired (inside
      // the 30-day window): if a regression used the 30-day expired cutoff for
      // revoked sessions, this row would survive — it must be deleted.
      insertSession(ctx.dbPath, 's_revoked_long_ago', {
        expiresAt: new Date(NOW.getTime() - 5 * DAY_MS).toISOString(),
        revokedAt: new Date(NOW.getTime() - 40 * DAY_MS).toISOString(),
      })
      // Recently revoked (inside the 7-day window) and recently expired (inside
      // the 30-day window): neither cutoff has passed — must survive.
      insertSession(ctx.dbPath, 's_revoked_recent', {
        expiresAt: new Date(NOW.getTime() - 5 * DAY_MS).toISOString(),
        revokedAt: new Date(NOW.getTime() - 5 * DAY_MS).toISOString(),
      })

      const result = runCleanup({ dbPath: ctx.dbPath, now: NOW })

      expect(result.deleted, 'a revoked-vs-expired cutoff regression would keep a session revoked beyond the 7-day window').toBe(1)
      expect(sessionIds(ctx.dbPath), 'a revoked-vs-expired cutoff regression would delete a session revoked within the 7-day window').toEqual(['s_revoked_recent'])
    } finally {
      teardownDb(ctx)
    }
  })
})
