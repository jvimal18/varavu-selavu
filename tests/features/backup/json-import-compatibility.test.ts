/**
 * Backup & operations — JSON snapshot import compatibility.
 *
 * Capability: `scripts/import.ts` restores every snapshot version the
 * export path can produce. Snapshot versions:
 *   1.0 — 4 tables (users, accounts, categories, transactions)
 *   1.1 — 5 tables (adds userSettings)
 *   1.2 — 6 tables (adds sessions)
 * v1.0/v1.1 snapshots restore with `userSettings` / `sessions` defaulting
 * to `[]` — the backward-compat contract that prevented the pre-v1.6.0
 * silent `user_settings` data loss from becoming a restore failure.
 *
 * Test strategy: the frozen snapshots in `tests/fixtures/snapshots/` are
 * committed and never mutated. Each test copies the fixture to a temp path,
 * imports it into a fresh migrated temp DB via the real `import.ts` child
 * process (driving the typed "YES" confirmation over stdin), then verifies
 * the round-trip with a fresh read-only connection.
 */
import { spawn, execFile } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import Database from 'better-sqlite3'
import { beforeAll, describe, expect, it } from 'vitest'
import { createNuxtTestHarness, type NuxtTestHarness } from '~~/tests/helpers/nuxt-server'

const execFileAsync = promisify(execFile)

const FIXTURE_NAMES = ['export-v1.0.json', 'export-v1.1.json', 'export-v1.2.json'] as const
const FIXTURES_DIR = 'tests/fixtures/snapshots'

/** Expected final table counts for each frozen snapshot. */
const EXPECTED_COUNTS: Record<(typeof FIXTURE_NAMES)[number], {
  users: number
  accounts: number
  categories: number
  transactions: number
  userSettings: number
  sessions: number
}> = {
  'export-v1.0.json': { users: 2, accounts: 2, categories: 4, transactions: 4, userSettings: 0, sessions: 0 },
  'export-v1.1.json': { users: 2, accounts: 2, categories: 4, transactions: 4, userSettings: 1, sessions: 0 },
  'export-v1.2.json': { users: 2, accounts: 2, categories: 4, transactions: 4, userSettings: 2, sessions: 2 },
}

/** Seed insert counts (users + category tree) from server/db/seed.ts. */
const SEED_USER_COUNT = 2
const SEED_CATEGORY_COUNT = 37

interface Snapshot {
  users: Record<string, unknown>[]
  accounts: Record<string, unknown>[]
  categories: Record<string, unknown>[]
  transactions: Record<string, unknown>[]
  userSettings?: Record<string, unknown>[]
  sessions?: Record<string, unknown>[]
}

let harness: NuxtTestHarness
let templateDb: string

// The harness registers its own afterAll internally, so it must be created at
// module collection time (the established pattern in this repo), not in a hook.
harness = await createNuxtTestHarness()

beforeAll(async () => {
  // A cleanly-closed migrated DB is a self-contained template; copying it
  // per test is cheaper and safer than migrating a fresh DB per test while
  // the harness server keeps the app DB open.
  templateDb = join(harness.tempDir, 'import-template.db')
  await runTsx('server/db/migrate.ts', { NUXT_DB_PATH: templateDb })
})

/** A fresh, migrated, empty DB file unique to this test. */
function freshDbPath(): string {
  const dir = mkdtempSync(join(harness.tempDir, 'import-'))
  const dbPath = join(dir, 'test.db')
  copyFileSync(templateDb, dbPath)
  return dbPath
}

/** Copy the committed fixture to a temp path (fixtures are never mutated in place). */
function copyFixture(name: string): string {
  const src = join(harness.rootDir, FIXTURES_DIR, name)
  const dst = join(mkdtempSync(join(harness.tempDir, 'fixture-')), name)
  copyFileSync(src, dst)
  return dst
}

function readFixture(name: string): Snapshot {
  return JSON.parse(readFileSync(join(harness.rootDir, FIXTURES_DIR, name), 'utf8')) as Snapshot
}

async function runTsx(script: string, env: Record<string, string>): Promise<void> {
  await execFileAsync('pnpm', ['exec', 'tsx', script], {
    cwd: harness.rootDir,
    env: { ...process.env, ...env },
    maxBuffer: 2 * 1024 * 1024,
  })
}

/** Run the real import CLI against a DB path, typing "YES" on stdin. */
function runImport(snapshotPath: string, dbPath: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'tsx', 'scripts/import.ts', snapshotPath], {
      cwd: harness.rootDir,
      env: { ...process.env, NUXT_DB_PATH: dbPath },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
    // The script prompts "Type YES to continue:" — a confirmation regression
    // would hang (prompt never answered) or abort; writing YES and asserting
    // the data landed is the contract.
    child.stdin.write('YES\n')
    child.stdin.end()
  })
}

function readCounts(dbPath: string): Record<string, number> {
  const db = new Database(dbPath, { readonly: true })
  try {
    const out: Record<string, number> = {}
    // sqlite table name -> snapshot key (matches EXPECTED_COUNTS).
    const tables: [string, string][] = [
      ['users', 'users'],
      ['accounts', 'accounts'],
      ['categories', 'categories'],
      ['transactions', 'transactions'],
      ['user_settings', 'userSettings'],
      ['sessions', 'sessions'],
    ]
    for (const [sqlTable, key] of tables) {
      out[key] = (db.prepare(`SELECT COUNT(*) AS c FROM ${sqlTable}`).get() as { c: number }).c
    }
    return out
  } finally {
    db.close()
  }
}

function readAll(dbPath: string, table: string): Record<string, unknown>[] {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
  } finally {
    db.close()
  }
}

function readPragma(dbPath: string, name: string): string {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.pragma(name, { simple: true }) as string
  } finally {
    db.close()
  }
}

function readFkViolations(dbPath: string): unknown[] {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.pragma('foreign_key_check') as unknown[]
  } finally {
    db.close()
  }
}

/** The restored DB must be exactly the frozen snapshot (or its [] default). */
function expectRestoredSnapshot(dbPath: string, fixtureName: string): void {
  const snapshot = readFixture(fixtureName)

  expect(readAll(dbPath, 'users'), 'a restore regression would change users instead of reproducing the snapshot').toEqual(snapshot.users)
  expect(readAll(dbPath, 'accounts'), 'a restore regression would change accounts instead of reproducing the snapshot').toEqual(snapshot.accounts)
  expect(readAll(dbPath, 'categories'), 'a restore regression would change categories instead of reproducing the snapshot').toEqual(snapshot.categories)
  expect(readAll(dbPath, 'transactions'), 'a restore regression would change transactions instead of reproducing the snapshot').toEqual(snapshot.transactions)
  expect(readAll(dbPath, 'user_settings'), 'a restore regression would change user_settings instead of reproducing the snapshot (or its [] default)').toEqual(snapshot.userSettings ?? [])
  expect(readAll(dbPath, 'sessions'), 'a restore regression would change sessions instead of reproducing the snapshot (or its [] default)').toEqual(snapshot.sessions ?? [])
}

describe('JSON snapshot import compatibility', () => {
  it.each(FIXTURE_NAMES)('%s imports cleanly with the typed YES confirmation', async (fixtureName) => {
    const dbPath = freshDbPath()
    const fixturePath = copyFixture(fixtureName)

    const result = await runImport(fixturePath, dbPath)

    expect(result.code, 'an import child-process regression would exit non-zero').toBe(0)
    expect(result.stdout, 'an import confirmation regression would abort instead of completing the restore').toContain(`Imported ${EXPECTED_COUNTS[fixtureName].users} users`)
    expect(readCounts(dbPath), 'an import wipe/insert regression would leave row counts that do not match the snapshot').toEqual(EXPECTED_COUNTS[fixtureName])
    expect(readPragma(dbPath, 'integrity_check'), 'an import regression would leave the restored DB failing integrity_check').toBe('ok')
    expectRestoredSnapshot(dbPath, fixtureName)
    expect(readFkViolations(dbPath), 'a restore ordering regression would leave dangling references between restored tables').toEqual([])
    // The restored DB must be openable and queryable outside the import process.
    expect(readAll(dbPath, 'transactions'), 'a restored DB would not be queryable from a fresh connection').toHaveLength(EXPECTED_COUNTS[fixtureName].transactions)
  })

  it('wipes a non-empty DB before restoring (reverse-FK wipe, then forward insert)', async () => {
    const dbPath = freshDbPath()
    // Seed the destination so it is non-empty: 2 users + the full category tree.
    await runTsx('server/db/seed.ts', { NUXT_DB_PATH: dbPath })
    const pre = readCounts(dbPath)
    expect(pre.categories, 'the seed used to build a non-empty destination must have populated categories').toBe(SEED_CATEGORY_COUNT)
    expect(pre.users, 'the seed used to build a non-empty destination must have populated users').toBe(SEED_USER_COUNT)

    const fixturePath = copyFixture('export-v1.2.json')
    const result = await runImport(fixturePath, dbPath)

    expect(result.code, 'an import-into-non-empty regression would reject restoring over existing data').toBe(0)
    expect(readCounts(dbPath), 'a wipe-order regression would leave stale rows from the pre-existing DB alongside the snapshot').toEqual(EXPECTED_COUNTS['export-v1.2.json'])
    // The seeded users share IDs with the snapshot but have different
    // created_at — the restored rows must be the snapshot's, not the seed's.
    expectRestoredSnapshot(dbPath, 'export-v1.2.json')
  })

  it('removes stale rows that reference wiped entities (reverse-FK deletion order)', async () => {
    const dbPath = freshDbPath()
    // Pre-populate every table with rows that do NOT exist in the snapshot and
    // reference only each other. If the wipe missed any table (e.g. sessions
    // after the 1.2 addition), the orphan would survive the restore.
    const db = new Database(dbPath)
    try {
      db.prepare("INSERT INTO users (id, name, color, created_at) VALUES ('u_stale', 'Stale', '#000000', '2020-01-01T00:00:00.000Z')").run()
      db.prepare("INSERT INTO accounts (id, name, type, opening_balance, currency, archived, created_at, updated_at) VALUES ('a_stale', 'Stale', 'bank', 1, 'INR', 0, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')").run()
      db.prepare("INSERT INTO categories (id, name, type, is_essential, sort_order, archived, created_at) VALUES ('c_stale', 'Stale', 'expense', 0, 999, 0, '2020-01-01T00:00:00.000Z')").run()
      db.prepare("INSERT INTO transactions (id, type, amount, date, account_id, category_id, spent_by, created_at, updated_at) VALUES ('t_stale', 'expense', 1, '2020-01-01', 'a_stale', 'c_stale', 'u_stale', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')").run()
      db.prepare("INSERT INTO user_settings (user_id, primary_account_id, monthly_budget_paise, updated_at) VALUES ('u_stale', 'a_stale', 1, 1)").run()
      db.prepare("INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at) VALUES ('d34db33fd34db33fd34db33fd34db33fd34db33fd34db33fd34db33fd34db33f', 'u_stale', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', '2020-02-01T00:00:00.000Z')").run()
    } finally {
      db.close()
    }
    expect(readCounts(dbPath).sessions, 'the stale-session fixture must pre-populate sessions for the wipe to have something to delete').toBe(1)

    const fixturePath = copyFixture('export-v1.2.json')
    const result = await runImport(fixturePath, dbPath)

    expect(result.code, 'an import regression would fail when restoring over rows that reference wiped entities').toBe(0)
    expect(readCounts(dbPath), 'a reverse-FK wipe regression would leave stale rows whose referenced entities were deleted').toEqual(EXPECTED_COUNTS['export-v1.2.json'])
    expect(readFkViolations(dbPath), 'a reverse-FK wipe regression would leave orphan rows referencing deleted users/accounts').toEqual([])
  })
})
