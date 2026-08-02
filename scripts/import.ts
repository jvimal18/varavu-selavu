/**
 * scripts/import.ts — restore a DB snapshot produced by scripts/export.mjs.
 *
 * Wipes all 4 tables and re-inserts from the JSON file inside a single
 * transaction. Requires interactive confirmation ("YES") before wiping.
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
}

const DB_PATH = process.env.NUXT_DB_PATH || './budget.db'
const snapshot = JSON.parse(readFileSync(jsonPath, 'utf8')) as Snapshot

for (const table of ['users', 'accounts', 'categories', 'transactions'] as const) {
  if (!Array.isArray(snapshot[table])) {
    console.error(`Invalid snapshot: missing "${table}" array`)
    process.exit(1)
  }
}

const db = new Database(DB_PATH)
const count = (table: string): number =>
  (db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c

console.log(`DB:       ${DB_PATH}`)
console.log(`Snapshot: ${jsonPath}`)
console.log(
  `Current:  ${count('users')} users, ${count('accounts')} accounts, ` +
    `${count('categories')} categories, ${count('transactions')} transactions`
)
console.log(
  `Incoming: ${snapshot.users.length} users, ${snapshot.accounts.length} accounts, ` +
    `${snapshot.categories.length} categories, ${snapshot.transactions.length} transactions`
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
  const cols = Object.keys(rows[0])
  const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
  for (const r of rows) stmt.run(cols.map((c) => r[c]))
}

db.exec('PRAGMA foreign_keys = OFF')
db.exec('BEGIN')
try {
  // Wipe in reverse FK order, re-insert in forward FK order.
  db.prepare('DELETE FROM transactions').run()
  db.prepare('DELETE FROM accounts').run()
  db.prepare('DELETE FROM categories').run()
  db.prepare('DELETE FROM users').run()

  insert('users', snapshot.users)
  insert('categories', snapshot.categories)
  insert('accounts', snapshot.accounts)
  insert('transactions', snapshot.transactions)
  db.exec('COMMIT')
} catch (err) {
  db.exec('ROLLBACK')
  console.error(`Import failed — rolled back. ${err instanceof Error ? err.message : err}`)
  process.exit(1)
}
db.exec('PRAGMA foreign_keys = ON')

console.log(
  `Imported ${snapshot.users.length} users, ${snapshot.accounts.length} accounts, ` +
    `${snapshot.categories.length} categories, ${snapshot.transactions.length} transactions`
)
db.close()
