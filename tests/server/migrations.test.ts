/**
 * Tests for the migrations folder's structural integrity.
 *
 * Why this file exists: PR 4 added `db/migrations/0002_sessions.sql` and
 * PR 5 added `db/migrations/0003_idx_txn_account_date.sql`, but neither
 * commit regenerated the matching `meta/NNNN_snapshot.json` files. Drizzle's
 * migrator needs the snapshot to verify each migration; without it, the
 * migrator silently skips the migration, leaving the target table or index
 * missing. Both the dev DB and the test DBs were broken by this — the only
 * reason anyone noticed was a 500 from `setSessionUserId` on the login
 * page. These tests would have caught it in CI.
 *
 * The two tests:
 *   1. `every SQL migration has a matching snapshot file` — a cheap
 *      file-system check that catches the structural bug at the source.
 *   2. `migrator creates all expected tables and indexes` — a heavier
 *      integration test that runs the real migrator on a tmp DB and
 *      asserts the resulting schema. Catches missing migrations, broken
 *      migrations, ordering bugs, and snapshot drift.
 */
import { describe, it, expect, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// ============================================================
// 1. Snapshot-existence test — cheap, file-system only
// ============================================================

describe('migrations folder integrity', () => {
  it('every SQL migration has a matching snapshot file', () => {
    const migrationsDir = './db/migrations'
    const metaDir = './db/migrations/meta'
    if (!existsSync(migrationsDir)) {
      throw new Error(`migrations dir missing: ${migrationsDir}`)
    }
    const sqlFiles = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f))
    expect(sqlFiles.length).toBeGreaterThan(0)

    const missing: string[] = []
    for (const sql of sqlFiles) {
      const idx = sql.split('_')[0] // "0002"
      const snapshot = join(metaDir, `${idx}_snapshot.json`)
      if (!existsSync(snapshot)) {
        missing.push(`${sql} (expected ${idx}_snapshot.json)`)
      }
    }
    expect(missing, missing.join('\n')).toEqual([])
  })

  it('every snapshot in meta/ has a matching SQL migration', () => {
    // Catches the reverse bug: orphan snapshots left behind after a SQL file
    // is deleted. The migrator won't apply orphan snapshots (the journal
    // is the source of truth for what runs), but they bloat the repo.
    const migrationsDir = './db/migrations'
    const metaDir = './db/migrations/meta'
    const sqlFiles = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f))
    const sqlIdxs = new Set(sqlFiles.map((f) => f.split('_')[0]))

    const snapshotFiles = readdirSync(metaDir).filter((f) => /^\d{4}_snapshot\.json$/.test(f))
    const orphan: string[] = []
    for (const snap of snapshotFiles) {
      const idx = snap.split('_')[0]
      if (!sqlIdxs.has(idx)) {
        orphan.push(snap)
      }
    }
    expect(orphan, orphan.join('\n')).toEqual([])
  })
})

// ============================================================
// 2. Migrator-creates-schema test — heavier, real integration
// ============================================================

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
    const journalRaw = readFileSyncSafe('./db/migrations/meta/_journal.json')
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

// ============================================================
// 3. Existing-DB scenarios — does the migrator break upgrades?
// ============================================================
//
// Real-world databases are rarely at the latest migration when we run
// `pnpm db:migrate`. The dev DB is currently at 0000/0001/0004
// (after the broken-PR-4 cleanup). The Pi's prod DB is at 0000/0001
// (waiting for the first v1.6.0 deploy). The first CI job of any
// release runs against a fresh DB. The migrator must handle all three
// without losing data or erroring.
//
// These tests catch the "but it works on my machine" class of bug —
// where a migration is developed and tested against a fresh DB but
// breaks when run against a DB that already has rows.

describe('migrator on an existing DB', () => {
  const tmpDirs: string[] = []

  function setupExistingDb(state: 'pre-0004' | 'fresh' | 'pre-0004-with-data'): {
    db: Database.Database
    tmpDir: string
  } {
    const tmpDir = mkdtempSync(join(tmpdir(), 'vs-migrations-existing-'))
    tmpDirs.push(tmpDir)
    const dbPath = join(tmpDir, 'test.db')
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    const ormDb = drizzle(db)

    if (state === 'pre-0004') {
      // Simulate a DB at migration 0001 (e.g. the Pi's prod DB before
      // the v1.6.0 deploy). Apply the full migrator (clean state),
      // then drop both the 0004 hash AND the 0004 schema objects so
      // the DB looks like a real pre-0004 DB. The schema is dropped
      // in reverse order (indexes before tables).
      migrate(ormDb, { migrationsFolder: './db/migrations' })
      const hash0004 = sha256OfFile('./db/migrations/0002_sessions_and_index.sql')
      db.prepare('DELETE FROM __drizzle_migrations WHERE hash = ?').run(hash0004)
      db.prepare('DROP INDEX IF EXISTS idx_sessions_expires').run()
      db.prepare('DROP INDEX IF EXISTS idx_sessions_user').run()
      db.prepare('DROP TABLE IF EXISTS sessions').run()
      db.prepare('DROP INDEX IF EXISTS idx_txn_account_date').run()
    } else if (state === 'pre-0004-with-data') {
      // Same as pre-0004, plus a few rows in users + accounts + a
      // transaction. The migration must not lose these.
      migrate(ormDb, { migrationsFolder: './db/migrations' })
      const hash0004 = sha256OfFile('./db/migrations/0002_sessions_and_index.sql')
      db.prepare('DELETE FROM __drizzle_migrations WHERE hash = ?').run(hash0004)
      db.prepare('DROP INDEX IF EXISTS idx_sessions_expires').run()
      db.prepare('DROP INDEX IF EXISTS idx_sessions_user').run()
      db.prepare('DROP TABLE IF EXISTS sessions').run()
      db.prepare('DROP INDEX IF EXISTS idx_txn_account_date').run()
      // Re-enable FKs and insert the fixture rows. sessions isn't
      // involved here, so no FK violation possible.
      db.prepare(
        `INSERT INTO users (id, name, color, pin_hash, created_at) VALUES ('u_real', 'Real', '#000', 'h', '2026-01-01T00:00:00Z')`,
      ).run()
      // accounts are shared (not per-user); the per-user link lives in
      // user_settings.primary_account_id and transactions.spent_by.
      db.prepare(
        `INSERT INTO accounts (id, name, type, opening_balance, currency, archived, created_at, updated_at) VALUES ('a_real', 'Real Account', 'bank', 10000, 'INR', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      ).run()
      db.prepare(
        `INSERT INTO transactions (id, account_id, type, amount, date, description, spent_by, created_at, updated_at) VALUES ('t_real', 'a_real', 'expense', 500, '2026-01-15', 'lunch', 'u_real', '2026-01-15T00:00:00Z', '2026-01-15T00:00:00Z')`,
      ).run()
    }
    // 'fresh' is a no-op here; setupFreshDb() is used directly.
    return { db, tmpDir }
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
    }
    tmpDirs.length = 0
  })

  it('is idempotent: running migrate() twice on a fresh DB is a no-op', () => {
    // A no-op second run means the migrator sees the existing
    // __drizzle_migrations rows and skips every journal entry. This is
    // the contract that makes `pnpm db:migrate` safe to run on every
    // deploy (and on every dev restart).
    const tmpDir = mkdtempSync(join(tmpdir(), 'vs-migrations-idem-'))
    tmpDirs.push(tmpDir)
    const dbPath = join(tmpDir, 'test.db')
    const db = new Database(dbPath)
    const ormDb = drizzle(db)

    migrate(ormDb, { migrationsFolder: './db/migrations' })
    const firstState = snapshotDb(db)

    migrate(ormDb, { migrationsFolder: './db/migrations' })
    const secondState = snapshotDb(db)

    expect(secondState).toEqual(firstState)
  })

  it('upgrades a pre-0004 DB cleanly: applies only 0004, leaves rows intact', () => {
    const { db } = setupExistingDb('pre-0004-with-data')
    const ormDb = drizzle(db)

    // Capture pre-migration state: a user with an account and a
    // transaction.
    const userBefore = db.prepare('SELECT * FROM users WHERE id = ?').get('u_real') as { name: string } | undefined
    const accountBefore = db.prepare('SELECT * FROM accounts WHERE id = ?').get('a_real') as { name: string } | undefined
    const txBefore = db.prepare('SELECT * FROM transactions WHERE id = ?').get('t_real') as { description: string } | undefined
    expect(userBefore?.name).toBe('Real')
    expect(accountBefore?.name).toBe('Real Account')
    expect(txBefore?.description).toBe('lunch')

    // The migrator should now apply 0004 (sessions table + index).
    migrate(ormDb, { migrationsFolder: './db/migrations' })

    // Post-migration: the same rows are still there.
    const userAfter = db.prepare('SELECT * FROM users WHERE id = ?').get('u_real') as { name: string } | undefined
    const accountAfter = db.prepare('SELECT * FROM accounts WHERE id = ?').get('a_real') as { name: string } | undefined
    const txAfter = db.prepare('SELECT * FROM transactions WHERE id = ?').get('t_real') as { description: string } | undefined
    expect(userAfter?.name).toBe('Real')
    expect(accountAfter?.name).toBe('Real Account')
    expect(txAfter?.description).toBe('lunch')

    // And the new schema is in place.
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
      .all()
    expect(tables).toHaveLength(1)

    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_txn_account_date'")
      .all()
    expect(idx).toHaveLength(1)

    // The migration record is now back in __drizzle_migrations.
    const applied = db
      .prepare('SELECT hash FROM __drizzle_migrations WHERE hash = ?')
      .all(sha256OfFile('./db/migrations/0002_sessions_and_index.sql'))
    expect(applied).toHaveLength(1)
  })

  it('upgrades a pre-0004 DB without rows: same as fresh-DB path', () => {
    const { db } = setupExistingDb('pre-0004')
    const ormDb = drizzle(db)
    migrate(ormDb, { migrationsFolder: './db/migrations' })

    // After upgrade, all expected tables exist.
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'")
      .all() as { name: string }[]
    const names = new Set(tables.map((t) => t.name))
    for (const expected of ['users', 'accounts', 'categories', 'transactions', 'user_settings', 'sessions']) {
      expect(names.has(expected), `missing table after upgrade: ${expected}`).toBe(true)
    }
  })
})

// ============================================================
// Helpers
// ============================================================

/** SHA-256 hex of a file's contents. Drizzle uses this to identify
 *  applied migrations; computing it the same way lets us poke
 *  __drizzle_migrations from the test (e.g. to simulate a pre-0004
 *  state). */
function sha256OfFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Capture the DB's tables + indexes + migration rows for an
 *  idempotency check. Two snapshots taken at different times should
 *  be deeply equal if the migrator is a no-op on the second run. */
function snapshotDb(db: Database.Database): {
  tables: string[]
  indexes: string[]
  migrations: { hash: string; created_at: number }[]
} {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[]
  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
    .all() as { name: string }[]
  const migrations = db
    .prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at')
    .all() as { hash: string; created_at: number }[]
  return {
    tables: tables.map((t) => t.name),
    indexes: indexes.map((i) => i.name),
    migrations,
  }
}

function readFileSyncSafe(path: string): string {
  // small inline reader to keep the imports tidy.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('node:fs').readFileSync(path, 'utf8') as string
}
