#!/usr/bin/env node
/**
 * scripts/export.mjs — full DB snapshot export (pure Node, no TS build step).
 *
 * Reads all 5 user-facing tables and writes a JSON snapshot:
 *   { exportedAt, version, users, accounts, categories, transactions, userSettings }
 *
 * Note: user_settings was added in v1.1.0 but the original v1.0 export
 * silently dropped it. The `version` field on the snapshot is bumped to
 * "1.1" so older snapshots still restore correctly while the bug is fixed
 * for everything going forward.
 *
 * The script is wrapped as a module: it exports `runExport()` for tests
 * and only does CLI argv parsing / process.exit at the top level.
 *
 * Usage (CLI):
 *   node scripts/export.mjs [output-file]
 *
 * DB path:   $NUXT_DB_PATH, else ./budget.db (relative to cwd)
 * Output:    arg 1 if given, else exports/budget-YYYY-MM-DD.json
 *
 * Exit:      0 on success, 1 on any error.
 */
import Database from 'better-sqlite3'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * Run a JSON export. Throws on any error (callers handle the message and
 * exit code — keeps the function testable from Vitest).
 */
export function runExport({ dbPath, outPath }) {
  const db = new Database(dbPath)
  let snapshot
  try {
    // Verify the source DB is healthy before we write a snapshot of it.
    // The JSON output isn't a SQLite file, so we can't integrity_check the
    // output; but we CAN check the source we're copying from.
    // db.pragma() returns [{ pragma_name: value, ... }]; for integrity_check
    // the value is in result[0].integrity_check.
    const integrity = db.pragma('integrity_check')
    const integrityOk = Array.isArray(integrity) && integrity.length === 1 && integrity[0]?.integrity_check === 'ok'
    if (!integrityOk) {
      throw new Error(`source DB integrity_check failed: ${JSON.stringify(integrity)}`)
    }

    snapshot = {
      exportedAt: new Date().toISOString(),
      // Bumped from 1.0 → 1.1 to mark the user_settings addition. Used by
      // import.ts to decide whether to expect the new field.
      version: '1.1',
      users: db.prepare('SELECT * FROM users').all(),
      accounts: db.prepare('SELECT * FROM accounts').all(),
      categories: db.prepare('SELECT * FROM categories').all(),
      transactions: db.prepare('SELECT * FROM transactions').all(),
      userSettings: db.prepare('SELECT * FROM user_settings').all(),
    }
  } finally {
    db.close()
  }

  const resolvedOut = resolve(outPath)
  mkdirSync(dirname(resolvedOut), { recursive: true })
  writeFileSync(resolvedOut, JSON.stringify(snapshot, null, 2))

  return {
    outPath: resolvedOut,
    counts: {
      users: snapshot.users.length,
      accounts: snapshot.accounts.length,
      categories: snapshot.categories.length,
      transactions: snapshot.transactions.length,
      userSettings: snapshot.userSettings.length,
    },
  }
}

// ---- CLI entry point ----

const isMainModule = import.meta.url === `file://${process.argv[1]}`

if (isMainModule) {
  const DB_PATH = process.env.NUXT_DB_PATH || './budget.db'
  // Local (not UTC) date so the filename matches `date +%F` used by export.sh.
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const OUT_FILE = process.argv[2] || `exports/budget-${today}.json`

  try {
    const result = runExport({ dbPath: DB_PATH, outPath: OUT_FILE })
    const c = result.counts
    console.log(
      `Exported ${c.users} users, ${c.accounts} accounts, ` +
        `${c.categories} categories, ${c.transactions} transactions, ` +
        `${c.userSettings} user_settings -> ${result.outPath}`,
    )
    process.exit(0)
  } catch (err) {
    console.error(`Export failed: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}
