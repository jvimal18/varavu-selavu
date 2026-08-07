/**
 * Migrations — upgrade paths for already-populated databases.
 *
 * Capability: `pnpm db:migrate` is safe to run on the dev DB
 * (already at the current migration), the Pi's prod DB (one
 * migration behind), and a CI fresh DB. Existing rows must
 * survive the upgrade byte-identical; the new schema must be in
 * place; a second migrate() must be a no-op.
 *
 * Phase 2 of TESTING_PLAN.md replaces the "migrate then drop
 * tables" simulation here with a frozen `tests/fixtures/db/
 * v1.5-pre-sessions.sqlite` so the upgrade is exercised against a
 * real historical artifact.
 *
 * Companion files:
 *   snapshot-integrity.test.ts    - file-system parity
 *   fresh-schema.test.ts           - fresh-DB migrator
 */
import { describe, it, expect, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** SHA-256 hex of a file's contents. Drizzle uses this to identify
 *  applied migrations; computing it the same way lets us poke
 *  `__drizzle_migrations` from the test (e.g. to simulate a
 *  pre-current-migration state). */
function sha256OfFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Capture the DB's tables + indexes + migration rows for an
 *  idempotency check. Two snapshots taken at different times
 *  should be deeply equal if the migrator is a no-op on the
 *  second run. */
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

describe('migrator on an existing DB', () => {
  const tmpDirs: string[] = []

  function setupExistingDb(state: 'pre-current' | 'fresh' | 'pre-current-with-data'): {
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

    if (state === 'pre-current') {
      // Simulate a DB at migration 0001 (e.g. the Pi's prod DB before
      // the v1.6.0 deploy). Apply the full migrator (clean state),
      // then drop both the current-migration hash AND the
      // current-migration schema objects so the DB looks like a
      // real pre-current-migration DB. The schema is dropped in
      // reverse order (indexes before tables).
      migrate(ormDb, { migrationsFolder: './db/migrations' })
      const hashCurrent = sha256OfFile('./db/migrations/0002_sessions_and_index.sql')
      db.prepare('DELETE FROM __drizzle_migrations WHERE hash = ?').run(hashCurrent)
      db.prepare('DROP INDEX IF EXISTS idx_sessions_expires').run()
      db.prepare('DROP INDEX IF EXISTS idx_sessions_user').run()
      db.prepare('DROP TABLE IF EXISTS sessions').run()
      db.prepare('DROP INDEX IF EXISTS idx_txn_account_date').run()
    } else if (state === 'pre-current-with-data') {
      // Same as pre-current, plus a few rows in users + accounts + a
      // transaction. The migration must not lose these.
      migrate(ormDb, { migrationsFolder: './db/migrations' })
      const hashCurrent = sha256OfFile('./db/migrations/0002_sessions_and_index.sql')
      db.prepare('DELETE FROM __drizzle_migrations WHERE hash = ?').run(hashCurrent)
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
    // 'fresh' is a no-op here; setupFreshDb() in the companion file
    // is used directly.
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

  it('upgrades a pre-current-migration DB cleanly: applies only the current migration, leaves rows intact', () => {
    const { db } = setupExistingDb('pre-current-with-data')
    const ormDb = drizzle(db)

    // Capture pre-migration state: a user with an account and a
    // transaction.
    const userBefore = db.prepare('SELECT * FROM users WHERE id = ?').get('u_real') as { name: string } | undefined
    const accountBefore = db.prepare('SELECT * FROM accounts WHERE id = ?').get('a_real') as { name: string } | undefined
    const txBefore = db.prepare('SELECT * FROM transactions WHERE id = ?').get('t_real') as { description: string } | undefined
    expect(userBefore?.name).toBe('Real')
    expect(accountBefore?.name).toBe('Real Account')
    expect(txBefore?.description).toBe('lunch')

    // The migrator should now apply the current migration (sessions table + index).
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

  it('upgrades a pre-current-migration DB without rows: same as fresh-DB path', () => {
    const { db } = setupExistingDb('pre-current')
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
