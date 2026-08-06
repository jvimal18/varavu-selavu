/**
 * scripts/import.ts — restore a DB snapshot produced by scripts/export.mjs.
 *
 * Wipes all user-facing tables and re-inserts from the JSON file inside a
 * single transaction. Requires interactive confirmation ("YES") before wiping.
 *
 * Snapshot versions (mirrors scripts/export.mjs):
 *   1.0 — 4 tables (users, accounts, categories, transactions)
 *   1.1 — 5 tables (adds user_settings)
 *   1.2 — 6 tables (adds sessions)
 *
 * Backward compat: v1.0 → user_settings and sessions default to [];
 * v1.1 → sessions defaults to []. Missing fields never cause failure.
 *
 * Usage:
 *   pnpm import <snapshot.json>
 *
 * DB path:  $NUXT_DB_PATH, else ./budget.db (relative to cwd)
 */
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import Database from 'better-sqlite3'

const jsonPath = process.argv[2]
if (!jsonPath) {
  console.error('Usage: pnpm import <snapshot.json>')
  process.exit(1)
}

interface Snapshot {
  exportedAt: string
  version: string
  users: Array<Record<string, unknown>>
  accounts: Array<Record<string, unknown>>
  categories: Array<Record<string, unknown>>
  transactions: Array<Record<string, unknown>>
  userSettings?: Array<Record<string, unknown>>  // v1.1+
  sessions?: Array<Record<string, unknown>>      // v1.2+
}

const DB_PATH = process.env.NUXT_DB_PATH || './budget.db'
const snapshot = JSON.parse(readFileSync(jsonPath, 'utf8')) as Snapshot

// Required tables (always present in v1.0+).
for (const table of ['users', 'accounts', 'categories', 'transactions'] as const) {
  if (!Array.isArray(snapshot[table])) {
    console.error(`Invalid snapshot: missing "${table}" array`)
    process.exit(1)
  }
}
const userSettings = snapshot.userSettings ?? []
const sessions = snapshot.sessions ?? []
if (snapshot.userSettings !== undefined && !Array.isArray(snapshot.userSettings)) {
  console.error('Invalid snapshot: "userSettings" must be an array')
  process.exit(1)
}
if (snapshot.sessions !== undefined && !Array.isArray(snapshot.sessions)) {
  console.error('Invalid snapshot: "sessions" must be an array')
  process.exit(1)
}

const db = new Database(DB_PATH)
const count = (table: string): number =>
  (db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c

console.log(`DB:       ${DB_PATH}`)
console.log(`Snapshot: ${jsonPath} (version ${snapshot.version ?? '1.0'})`)
console.log(
  `Current:  ${count('users')} users, ${count('accounts')} accounts, ` +
    `${count('categories')} categories, ${count('transactions')} transactions, ` +
    `${count('user_settings')} user_settings, ${count('sessions')} sessions`,
)
console.log(
  `Incoming: ${snapshot.users.length} users, ${snapshot.accounts.length} accounts, ` +
    `${snapshot.categories.length} categories, ${snapshot.transactions.length} transactions, ` +
    `${userSettings.length} user_settings, ${sessions.length} sessions`,
)

const rl = createInterface({ input: process.stdin, output: process.stdout })
const answer = await new Promise<string>((resolve) => rl.question('This will WIPE all existing data. Type YES to continue: ', resolve))
rl.close()
if (answer !== 'YES') {
  console.log('Aborted — nothing changed.')
  db.close()
  process.exit(0)
}

function insert(table: string, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return
  const cols = Object.keys(rows[0]!)
  const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
  for (const r of rows) stmt.run(cols.map((c) => r[c]))
}

// FK order (Phase 1 PR 4 — adds sessions which depends on users):
//   users (no deps) → accounts (no deps) → categories (self-FK) →
//   user_settings (depends on users + accounts) →
//   transactions (depends on users, accounts, categories) →
//   sessions (depends on users; sessions are listed last so we can re-insert
//   them after their user_id targets exist)
//
// Note: we deliberately drop + re-insert sessions here. The new binary
// will create a new session on the next login anyway, and re-importing
// a stale session_token would be useless (the token is now hashed in the
// DB; the cookie holds the raw value, which we don't have).
db.exec('PRAGMA foreign_keys = OFF')
db.exec('BEGIN')
try {
  // Wipe in reverse FK order
  db.prepare('DELETE FROM sessions').run()
  db.prepare('DELETE FROM transactions').run()
  db.prepare('DELETE FROM user_settings').run()
  db.prepare('DELETE FROM accounts').run()
  db.prepare('DELETE FROM categories').run()
  db.prepare('DELETE FROM users').run()

  // Re-insert in forward FK order
  insert('users', snapshot.users)
  insert('accounts', snapshot.accounts)
  insert('categories', snapshot.categories)
  insert('user_settings', userSettings)
  insert('transactions', snapshot.transactions)
  insert('sessions', sessions)
  db.exec('COMMIT')
} catch (err) {
  db.exec('ROLLBACK')
  console.error(`Import failed — rolled back. ${err instanceof Error ? err.message : err}`)
  process.exit(1)
}
db.exec('PRAGMA foreign_keys = ON')

console.log(
  `Imported ${snapshot.users.length} users, ${snapshot.accounts.length} accounts, ` +
    `${snapshot.categories.length} categories, ${snapshot.transactions.length} transactions, ` +
    `${userSettings.length} user_settings, ${sessions.length} sessions`,
)
db.close()
