#!/usr/bin/env node
/**
 * scripts/backup-binary.mjs — full binary backup using better-sqlite3's
 * online backup API.
 *
 * Captures everything in the live DB: user data, schema, WAL state, and
 * `__drizzle_migrations`. Faster and smaller than the JSON export, and
 * survives schema changes (the JSON export drops anything not in its
 * hardcoded table list).
 *
 * The script is wrapped as a module: it exports `runBackup()` for tests
 * and only does CLI argv parsing / process.exit at the top level.
 *
 * Usage (CLI):
 *   node scripts/backup-binary.mjs [output-file]
 *
 * DB path:   $NUXT_DB_PATH, else ./budget.db (relative to cwd)
 * Output:    arg 1 if given, else /var/lib/budget-tracker/exports/budget-${TODAY}.db.bak
 *
 * Exit:      0 on success, 1 on any error (including integrity check failure).
 */
import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * User-facing tables the backup must contain. Sorted alphabetically to match
 * the on-disk order. If you add a new table, add it here AND in
 * scripts/export.mjs AND in scripts/import.ts AND in
 * tests/server/backup.test.ts.
 *
 * v1.6.0 (PR 4): added 'sessions'. The backup captures active session
 * rows (id is the SHA-256 hash, so the raw tokens are not exposed).
 * Restoring this backup re-inserts the session rows verbatim; users
 * with a matching cookie will continue to be authenticated without
 * re-login.
 */
const EXPECTED_TABLES = ['accounts', 'categories', 'sessions', 'transactions', 'user_settings', 'users']

/**
 * Run a binary backup. Throws on any error (callers handle the message and
 * exit code — keeps the function testable from Vitest).
 */
export async function runBackup({ dbPath, outPath }) {
  if (!existsSync(dbPath)) {
    throw new Error(`Source DB not found at ${dbPath}`)
  }

  mkdirSync(dirname(outPath), { recursive: true })

  // Open the live DB in read-only mode for the backup. db.backup() holds a
  // shared lock for the copy duration; on a small household DB this is
  // sub-second, but we still go read-only to be safe.
  const sourceDb = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    await sourceDb.backup(outPath)
  } finally {
    sourceDb.close()
  }

  // Verify the backup: open the copy in a separate Database instance and run
  // PRAGMA integrity_check. Fail loudly if it's not 'ok'. Also assert the
  // expected user-facing tables are present — catches the pre-existing bug
  // where the JSON export silently dropped `user_settings`.
  const verifyDb = new Database(outPath, { readonly: true, fileMustExist: true })
  try {
    // db.pragma() returns [{ pragma_name: value, ... }]; for integrity_check
    // the value is in result[0].integrity_check.
    const integrity = verifyDb.pragma('integrity_check')
    const integrityOk = Array.isArray(integrity) && integrity.length === 1 && integrity[0]?.integrity_check === 'ok'
    if (!integrityOk) {
      throw new Error(`integrity_check failed: ${JSON.stringify(integrity)}`)
    }

    const tables = verifyDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'",
    ).all().map((r) => r.name).sort()
    if (JSON.stringify(tables) !== JSON.stringify(EXPECTED_TABLES)) {
      throw new Error(
        `table list mismatch: expected ${JSON.stringify(EXPECTED_TABLES)}, got ${JSON.stringify(tables)}`,
      )
    }
  } finally {
    verifyDb.close()
  }

  return { outPath, tables: EXPECTED_TABLES }
}

// ---- CLI entry point ----

const isMainModule = import.meta.url === `file://${process.argv[1]}`

if (isMainModule) {
  const DB_PATH = process.env.NUXT_DB_PATH || './budget.db'
  // Local (not UTC) date so the filename matches `date +%F` used by export.sh.
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const OUT_FILE = process.argv[2] || `/var/lib/budget-tracker/exports/budget-${today}.db.bak`

  try {
    const result = await runBackup({ dbPath: DB_PATH, outPath: resolve(OUT_FILE) })
    console.log(`Backup ✓  ${result.outPath} (${result.tables.length} user-facing tables verified)`)
    process.exit(0)
  } catch (err) {
    console.error(`Backup failed: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}
