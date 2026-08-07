/**
 * Migrations — upgrade the immutable v1.5 database artifact.
 *
 * Capability: a populated pre-sessions database can be upgraded in place by
 * the real Drizzle migrator without losing data, and a second migration run is
 * a no-op. The fixture is copied before every run; the committed binary is
 * never opened for writing or modified by this test.
 */
import { describe, it, expect, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const fixturePath = join(repoRoot, 'tests/fixtures/db/v1.5-pre-sessions.sqlite')
const migrationsPath = join(repoRoot, 'db/migrations')

type Row = Record<string, unknown>
type DataSnapshot = {
  users: Row[]
  accounts: Row[]
  categories: Row[]
  userSettings: Row[]
  transactions: Row[]
}

function migrationHash(filename: string): string {
  return createHash('sha256')
    .update(readFileSync(join(migrationsPath, filename)))
    .digest('hex')
}

function runRealMigrator(dbPath: string): void {
  // This is the same Drizzle migrator call used by server/db/migrate.ts. The
  // connection is writable because applying a migration must update both the
  // schema and __drizzle_migrations.
  const db = new Database(dbPath)
  try {
    db.pragma('foreign_keys = ON')
    migrate(drizzle(db), { migrationsFolder: migrationsPath })
  } finally {
    db.close()
  }
}

function historicalDataSnapshot(db: Database.Database): DataSnapshot {
  return {
    users: db
      .prepare('SELECT id, name, color, pin_hash, created_at FROM users ORDER BY id')
      .all() as Row[],
    accounts: db
      .prepare(
        `SELECT id, name, type, institution, last4, opening_balance, credit_limit,
                statement_day, due_day, currency, color, icon, archived, created_at, updated_at
         FROM accounts
         ORDER BY id`,
      )
      .all() as Row[],
    categories: db
      .prepare(
        `SELECT id, name, icon, color, parent_id, type, is_essential, sort_order,
                archived, created_at
         FROM categories
         ORDER BY id`,
      )
      .all() as Row[],
    userSettings: db
      .prepare(
        `SELECT user_id, primary_account_id, monthly_budget_paise, updated_at
         FROM user_settings
         ORDER BY user_id`,
      )
      .all() as Row[],
    transactions: db
      .prepare(
        `SELECT id, type, amount, date, account_id, to_account_id, category_id,
                description, notes, spent_by, created_at, updated_at
         FROM transactions
         ORDER BY id`,
      )
      .all() as Row[],
  }
}

function schemaSnapshot(db: Database.Database): Row[] {
  return db
    .prepare(
      `SELECT type, name, tbl_name, sql
       FROM sqlite_master
       WHERE type IN ('table', 'index')
       ORDER BY type, name`,
    )
    .all() as Row[]
}

function migrationRows(db: Database.Database): Row[] {
  return db
    .prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at')
    .all() as Row[]
}

describe('historical database upgrade', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
    tempDirs.length = 0
  })

  it('upgrades a populated v1.5 fixture and remains idempotent', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'vs-historical-upgrade-'))
    tempDirs.push(tempDir)
    const dbPath = join(tempDir, 'upgrade.sqlite')
    // cpSync copies the immutable binary artifact; all migration writes below
    // target this unique temporary copy instead of the fixture.
    cpSync(fixturePath, dbPath)

    const beforeDb = new Database(dbPath, { readonly: true })
    let beforeData: DataSnapshot
    try {
      const sessionsBefore = beforeDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'")
        .all()
      const compoundIndexBefore = beforeDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_txn_account_date'")
        .all()
      expect(sessionsBefore, 'the frozen v1.5 artifact must not already contain sessions; otherwise this test would miss a no-op upgrade').toHaveLength(0)
      expect(compoundIndexBefore, 'the frozen v1.5 artifact must not already contain the new compound index; otherwise its migration is untested').toHaveLength(0)
      beforeData = historicalDataSnapshot(beforeDb)
    } finally {
      beforeDb.close()
    }

    runRealMigrator(dbPath)

    // Use a read-only connection for post-upgrade assertions: it proves that
    // the assertions themselves cannot accidentally repair or mutate the DB.
    const upgradedDb = new Database(dbPath, { readonly: true })
    let firstSchema: Row[]
    let firstMigrations: Row[]
    let firstData: DataSnapshot
    try {
      const sessionTable = upgradedDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'")
        .all()
      expect(sessionTable, 'the v1.6 upgrade must add the sessions table; the migrator no-op\'d').toHaveLength(1)

      const sessionColumns = upgradedDb
        .prepare("PRAGMA table_info('sessions')")
        .all() as Array<{ name: string; type: string; notnull: number; pk: number }>
      expect(
        sessionColumns.map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk })),
        'the v1.6 upgrade must create the complete sessions column contract; a partial table breaks session persistence',
      ).toEqual([
        { name: 'id', type: 'TEXT', notnull: 1, pk: 1 },
        { name: 'user_id', type: 'TEXT', notnull: 1, pk: 0 },
        { name: 'user_agent', type: 'TEXT', notnull: 0, pk: 0 },
        { name: 'ip', type: 'TEXT', notnull: 0, pk: 0 },
        { name: 'created_at', type: 'TEXT', notnull: 1, pk: 0 },
        { name: 'last_seen_at', type: 'TEXT', notnull: 1, pk: 0 },
        { name: 'expires_at', type: 'TEXT', notnull: 1, pk: 0 },
        { name: 'revoked_at', type: 'TEXT', notnull: 0, pk: 0 },
      ])

      const sessionForeignKeys = upgradedDb
        .prepare("PRAGMA foreign_key_list('sessions')")
        .all() as Array<{ table: string; from: string; to: string; on_delete: string }>
      expect(
        sessionForeignKeys.some(
          (foreignKey) => foreignKey.table === 'users'
            && foreignKey.from === 'user_id'
            && foreignKey.to === 'id'
            && foreignKey.on_delete === 'CASCADE',
        ),
        'the v1.6 upgrade must protect sessions with a cascading user foreign key; deleting a user otherwise leaves invalid auth state',
      ).toBe(true)

      const sessionIndexes = upgradedDb
        .prepare("PRAGMA index_list('sessions')")
        .all() as Array<{ name: string; unique: number }>
      expect(
        ['idx_sessions_user', 'idx_sessions_expires'].every(
          (expected) => sessionIndexes.some((index) => index.name === expected),
        ),
        'the v1.6 upgrade must add both session lookup indexes; missing one makes auth lookups scan the table',
      ).toBe(true)
      expect(
        sessionColumns.find((column) => column.name === 'id')?.pk,
        'the v1.6 upgrade must keep sessions.id as the primary key; duplicate session hashes must be rejected',
      ).toBe(1)

      const compoundIndex = upgradedDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_txn_account_date'")
        .all()
      expect(compoundIndex, 'the v1.6 upgrade must add idx_txn_account_date; account detail pages otherwise lose their query-plan optimization').toHaveLength(1)

      const expectedMigrationHashes = [
        migrationHash('0000_goofy_nicolaos.sql'),
        migrationHash('0001_nostalgic_shinobi_shaw.sql'),
        migrationHash('0002_sessions_and_index.sql'),
      ]
      firstMigrations = migrationRows(upgradedDb)
      expect(
        firstMigrations.map((row) => row.hash),
        'the upgrade journal must retain v1.5 migrations and append the sessions/index migration in order; otherwise deploy state diverges from schema state',
      ).toEqual(expectedMigrationHashes)
      expect(
        firstMigrations.length,
        'the historical upgrade must record exactly three migrations; missing journal rows cause future deploys to re-run SQL',
      ).toBe(3)

      firstData = historicalDataSnapshot(upgradedDb)
      const dataTables: Array<keyof DataSnapshot> = [
        'users',
        'accounts',
        'categories',
        'userSettings',
        'transactions',
      ]
      for (const table of dataTables) {
        expect(
          firstData[table].length,
          `the v1.6 upgrade must preserve the ${table} row count; destructive migration would lose household data`,
        ).toBe(beforeData[table].length)
        expect(
          firstData[table],
          `the v1.6 upgrade must preserve ${table} ids and fields byte-for-byte; schema application must not rewrite existing data`,
        ).toEqual(beforeData[table])
      }

      const transactionAmounts = new Map(
        firstData.transactions.map((transaction) => [transaction.id, transaction.amount]),
      )
      expect(transactionAmounts.get('t_groceries'), 'the migration must preserve t_groceries as 12345 paise; changing integer money loses currency precision').toBe(12345)
      expect(transactionAmounts.get('t_dining'), 'the migration must preserve t_dining as 6789 paise; changing integer money loses currency precision').toBe(6789)
      expect(transactionAmounts.get('t_transport'), 'the migration must preserve t_transport as 2500 paise; changing integer money loses currency precision').toBe(2500)

      const orphanSettingsUsers = upgradedDb
        .prepare(
          `SELECT s.user_id FROM user_settings s
           LEFT JOIN users u ON u.id = s.user_id
           WHERE u.id IS NULL`,
        )
        .all()
      // Accounts are intentionally shared in this schema and therefore have
      // no accounts.user_id column. user_settings is the schema's account
      // ownership link; validate both sides of that actual FK relationship.
      expect(orphanSettingsUsers, 'every user_settings.user_id must resolve after upgrade; orphaned ownership rows corrupt per-user account selection').toEqual([])

      const orphanPrimaryAccounts = upgradedDb
        .prepare(
          `SELECT s.user_id FROM user_settings s
           LEFT JOIN accounts a ON a.id = s.primary_account_id
           WHERE s.primary_account_id IS NOT NULL AND a.id IS NULL`,
        )
        .all()
      expect(orphanPrimaryAccounts, 'every user_settings.primary_account_id must resolve after upgrade; orphaned primary accounts break dashboard loading').toEqual([])

      const orphanTransactionAccounts = upgradedDb
        .prepare(
          `SELECT t.id FROM transactions t
           LEFT JOIN accounts a ON a.id = t.account_id
           WHERE a.id IS NULL`,
        )
        .all()
      expect(orphanTransactionAccounts, 'every transaction.account_id must resolve after upgrade; orphaned transactions cannot be rendered or balanced').toEqual([])

      const orphanTransactionCategories = upgradedDb
        .prepare(
          `SELECT t.id FROM transactions t
           LEFT JOIN categories c ON c.id = t.category_id
           WHERE t.category_id IS NOT NULL AND c.id IS NULL`,
        )
        .all()
      expect(orphanTransactionCategories, 'every non-transfer transaction.category_id must resolve after upgrade; orphan categories misclassify spending').toEqual([])

      const orphanTransactionUsers = upgradedDb
        .prepare(
          `SELECT t.id FROM transactions t
           LEFT JOIN users u ON u.id = t.spent_by
           WHERE u.id IS NULL`,
        )
        .all()
      expect(orphanTransactionUsers, 'every transaction.spent_by must resolve after upgrade; orphan attribution breaks household spending totals').toEqual([])

      firstSchema = schemaSnapshot(upgradedDb)
    } finally {
      upgradedDb.close()
    }

    runRealMigrator(dbPath)

    const secondDb = new Database(dbPath, { readonly: true })
    try {
      const secondMigrations = migrationRows(secondDb)
      expect(secondMigrations, 'the second migration run must add no journal rows; non-idempotence would make every deploy unsafe').toEqual(firstMigrations)
      expect(schemaSnapshot(secondDb), 'the second migration run must make no schema changes; repeated deploys must be safe').toEqual(firstSchema)
      expect(
        historicalDataSnapshot(secondDb),
        'the second migration run must preserve the complete logical data snapshot; repeated deploys must not rewrite household data',
      ).toEqual(firstData)
      expect(secondDb.pragma('integrity_check', { simple: true }), 'the upgraded database must pass SQLite integrity_check after an idempotent rerun; corruption would make the deploy unsafe').toBe('ok')
    } finally {
      secondDb.close()
    }
  })
})
