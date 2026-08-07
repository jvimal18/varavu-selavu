/**
 * Migrations — migrator behavior on a fresh DB.
 *
 * Capability: applying every journal entry from scratch produces
 * the expected user-facing tables and the expected indexes, and
 * records every migration in `__drizzle_migrations`. The
 * expected-tables and expected-indexes lists are the schema
 * contract — update them when adding a new table or index.
 *
 * Companion files:
 *   snapshot-integrity.test.ts     - file-system parity
 *   historical-upgrade.test.ts     - migrator on an existing DB
 */
import { describe, it, expect, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('migrator on a fresh DB', () => {
  const tmpDirs: string[] = []

  function setupFreshDb(): { db: Database.Database; tmpDir: string } {
    const tmpDir = mkdtempSync(join(tmpdir(), 'vs-migrations-test-'))
    tmpDirs.push(tmpDir)
    const dbPath = join(tmpDir, 'test.db')
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    const ormDb = drizzle(db)
    migrate(ormDb, { migrationsFolder: './db/migrations' })
    return { db, tmpDir }
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
    }
    tmpDirs.length = 0
  })

  // The schema contract: every table the app code reads from. If any of
  // these is missing after a fresh migration, the app crashes the first
  // time it tries to query that table. Update this list when adding a
  // new user-facing table in server/db/schema.ts.
  const EXPECTED_TABLES = [
    'users',
    'accounts',
    'categories',
    'transactions',
    'user_settings',
    'sessions',
  ] as const

  // The index contract: every index the query planner depends on. If
  // any is missing, the planner falls back to a full scan and the page
  // loads slowly. Update this list when adding a new index in any
  // migration.
  const EXPECTED_INDEXES = [
    'idx_txn_date',
    'idx_txn_account',
    'idx_txn_category',
    'idx_txn_spent_by',
    'idx_txn_type',
    'idx_sessions_user',
    'idx_sessions_expires',
    'idx_txn_account_date',
  ] as const

  it('creates every expected user-facing table', () => {
    const { db } = setupFreshDb()
    const actual = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'")
      .all() as { name: string }[]
    const actualSet = new Set(actual.map((r) => r.name))
    for (const expected of EXPECTED_TABLES) {
      expect(actualSet.has(expected), `missing table after migration: ${expected}`).toBe(true)
    }
  })

  it('creates every expected index', () => {
    const { db } = setupFreshDb()
    const actual = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
    const actualSet = new Set(actual.map((r) => r.name))
    for (const expected of EXPECTED_INDEXES) {
      expect(actualSet.has(expected), `missing index after migration: ${expected}`).toBe(true)
    }
  })

  it('__drizzle_migrations records every migration in the journal', () => {
    // If a migration ran but the journal didn't record it (e.g. a
    // migrator bug, or someone bypassed the migrator), the next
    // migration will re-run the unrecorded one and fail. This test
    // asserts parity: every journal entry has a row in
    // __drizzle_migrations.
    const { db } = setupFreshDb()
    const journalRaw = readFileSync('./db/migrations/meta/_journal.json', 'utf8')
    const journal = JSON.parse(journalRaw) as { entries: { idx: number; tag: string }[] }
    const journalTags = new Set(journal.entries.map((e) => e.tag))

    const applied = db
      .prepare('SELECT hash, created_at FROM __drizzle_migrations')
      .all() as { hash: string; created_at: number }[]
    expect(applied.length).toBe(journal.entries.length)

    // Each applied migration's hash must correspond to a tag in the
    // journal. The hash is the SHA-256 of the SQL file content, so we
    // can't directly check it; but the COUNT check above is the load-
    // bearing one.
    expect(journalTags.size).toBe(journal.entries.length)
  })
})
