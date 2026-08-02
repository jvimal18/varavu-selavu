#!/usr/bin/env node
/**
 * scripts/export.mjs — full DB snapshot export (pure Node, no TS build step).
 *
 * Reads all 4 tables (users, accounts, categories, transactions) and writes a
 * snapshot file shaped like the API export:
 *   { exportedAt, version, users, accounts, categories, transactions }
 *
 * Usage:
 *   node scripts/export.mjs [output-file]
 *
 * DB path:   $NUXT_DB_PATH, else ./budget.db (relative to cwd)
 * Output:    arg 1 if given, else exports/budget-YYYY-MM-DD.json
 *
 * Exit:      0 on success, 1 on error.
 */
import Database from 'better-sqlite3'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const DB_PATH = process.env.NUXT_DB_PATH || './budget.db'

// Local (not UTC) date so the filename matches `date +%F` used by export.sh.
const now = new Date()
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const OUT_FILE = process.argv[2] || `exports/budget-${today}.json`

try {
  const db = new Database(DB_PATH)
  const snapshot = {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    users: db.prepare('SELECT * FROM users').all(),
    accounts: db.prepare('SELECT * FROM accounts').all(),
    categories: db.prepare('SELECT * FROM categories').all(),
    transactions: db.prepare('SELECT * FROM transactions').all(),
  }
  db.close()

  const outPath = resolve(OUT_FILE)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2))

  console.log(
    `Exported ${snapshot.users.length} users, ${snapshot.accounts.length} accounts, ` +
      `${snapshot.categories.length} categories, ${snapshot.transactions.length} transactions -> ${outPath}`
  )
  process.exit(0)
} catch (err) {
  console.error(`Export failed: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
}
