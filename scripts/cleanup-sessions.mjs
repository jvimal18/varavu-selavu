#!/usr/bin/env node
/**
 * scripts/cleanup-sessions.mjs — periodic session table cleanup.
 *
 * Deletes:
 *   - sessions whose expires_at is more than 30 days ago (long-expired)
 *   - sessions that were revoked more than 7 days ago (stale audit trail)
 *
 * Run monthly by a systemd timer (budget-tracker-session-cleanup.timer).
 * Wrapped as a module that exports `runCleanup()` for testability.
 *
 * DB path: $NUXT_DB_PATH, else ./budget.db (relative to cwd)
 * Exit:    0 on success, 1 on any error.
 */
import Database from 'better-sqlite3'

const EXPIRED_RETENTION_DAYS = 30
const REVOKED_RETENTION_DAYS = 7

/**
 * Run the cleanup. Throws on any error (callers handle the message and
 * exit code — keeps the function testable from Vitest).
 *
 * @param {object} opts
 * @param {string} opts.dbPath
 * @param {Date}   [opts.now=new Date()]  — injectable for tests
 * @returns {{ deleted: number, scanned: number }}
 */
export function runCleanup({ dbPath, now = new Date() } = {}) {
  const dbPathResolved = dbPath || process.env.NUXT_DB_PATH || './budget.db'
  const expiredCutoff = new Date(now.getTime() - EXPIRED_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const revokedCutoff = new Date(now.getTime() - REVOKED_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const db = new Database(dbPathResolved)
  try {
    const result = db.prepare(
      `DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`,
    ).run(expiredCutoff, revokedCutoff)
    return { deleted: result.changes, expiredCutoff, revokedCutoff }
  } finally {
    db.close()
  }
}

// ---- CLI entry point ----

const isMainModule = import.meta.url === `file://${process.argv[1]}`

if (isMainModule) {
  try {
    const result = runCleanup()
    console.log(`Cleanup ✓  removed ${result.deleted} sessions (expired < ${result.expiredCutoff.slice(0, 10)}, revoked < ${result.revokedCutoff.slice(0, 10)})`)
    process.exit(0)
  } catch (err) {
    console.error(`Cleanup failed: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}
