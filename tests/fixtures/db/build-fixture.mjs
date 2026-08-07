#!/usr/bin/env node
/**
 * Build the frozen v1.5 database used by historical-upgrade.test.ts.
 *
 * The v1.5.0 artifact boundary is tag v1.5.0 at commit
 * ec9e39d2408c2d182681a8c51761eadafe9f92fb. The 0000/0001 migration files
 * and seed data below are byte-equivalent at that boundary, immediately
 * before the sessions migration introduced after that release. We copy only
 * those two SQL files and their journal entries into a temporary migrations
 * directory, then run Drizzle's real migrator against a file-backed output
 * database. This avoids changing the working tree while ensuring the fixture
 * has the same migration journal format as a production database.
 */
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const defaultOutput = resolve(repoRoot, 'tests/fixtures/db/v1.5-pre-sessions.sqlite')
const outputPath = resolve(repoRoot, process.argv[2] || defaultOutput)
const migrationsRoot = resolve(repoRoot, 'db/migrations')
const migrationFiles = [
  '0000_goofy_nicolaos.sql',
  '0001_nostalgic_shinobi_shaw.sql',
]
const expectedMigrationHashes = {
  '0000_goofy_nicolaos.sql': '47382539e995e1030b1e20951aa98ca746f7145b35dfb99cc0888aaa6b32f738',
  '0001_nostalgic_shinobi_shaw.sql': '964469d971b361479c71bd4e3fa6fb8b7db213df0041d45331fac1a58100a19d',
}
const fixedNow = '2026-08-01T00:00:00.000Z'

function assertHistoricalMigrationHashes() {
  for (const filename of migrationFiles) {
    const actualHash = createHash('sha256')
      .update(readFileSync(resolve(migrationsRoot, filename)))
      .digest('hex')
    if (actualHash !== expectedMigrationHashes[filename]) {
      throw new Error(`historical migration hash mismatch for ${filename}: expected ${expectedMigrationHashes[filename]}, got ${actualHash}`)
    }
  }
}

// This is the default category tree from server/db/seed.ts, kept explicit so
// the binary is reproducible without depending on the current wall clock.
const categories = [
  ['c_housing', 'Housing', 'home', '#78716C', null, 'expense', 1, 10],
  ['c_utilities', 'Utilities', 'zap', '#4D7C5A', null, 'expense', 1, 20],
  ['c_groceries', 'Groceries', 'shopping-basket', '#C2410C', null, 'expense', 1, 30],
  ['c_dining', 'Food & Dining', 'utensils', '#D97706', null, 'expense', 0, 40],
  ['c_transport', 'Transport', 'car', '#57534E', null, 'expense', 1, 50],
  ['c_shopping', 'Shopping', 'shopping-bag', '#BE185D', null, 'expense', 0, 60],
  ['c_health', 'Health', 'heart-pulse', '#0F766E', null, 'expense', 1, 70],
  ['c_entertainment', 'Entertainment', 'tv-2', '#6D28D9', null, 'expense', 0, 80],
  ['c_travel', 'Travel', 'plane', '#0EA5E9', null, 'expense', 0, 90],
  ['c_education', 'Education', 'graduation-cap', '#0F766E', null, 'expense', 1, 100],
  ['c_insurance', 'Insurance', 'shield', '#4D7C5A', null, 'expense', 1, 110],
  ['c_personal_care', 'Personal Care', 'sparkles', '#BE185D', null, 'expense', 0, 120],
  ['c_gifts', 'Gifts & Donations', 'gift', '#D97706', null, 'expense', 0, 130],
  ['c_misc', 'Miscellaneous', 'more-horizontal', '#A8A29E', null, 'expense', 0, 140],
  ['c_rent', 'Rent / EMI', 'home', '#78716C', 'c_housing', 'expense', 1, 11],
  ['c_maintenance', 'Maintenance', 'wrench', '#78716C', 'c_housing', 'expense', 1, 12],
  ['c_property_tax', 'Property Tax', 'file-text', '#78716C', 'c_housing', 'expense', 1, 13],
  ['c_electricity', 'Electricity', 'zap', '#4D7C5A', 'c_utilities', 'expense', 1, 21],
  ['c_water', 'Water', 'droplet', '#4D7C5A', 'c_utilities', 'expense', 1, 22],
  ['c_internet', 'Internet', 'wifi', '#4D7C5A', 'c_utilities', 'expense', 1, 23],
  ['c_mobile', 'Mobile', 'smartphone', '#4D7C5A', 'c_utilities', 'expense', 1, 24],
  ['c_restaurants', 'Restaurants', 'utensils', '#D97706', 'c_dining', 'expense', 0, 41],
  ['c_delivery', 'Delivery', 'bike', '#D97706', 'c_dining', 'expense', 0, 42],
  ['c_coffee', 'Coffee', 'coffee', '#D97706', 'c_dining', 'expense', 0, 43],
  ['c_fuel', 'Fuel', 'fuel', '#57534E', 'c_transport', 'expense', 1, 51],
  ['c_cab', 'Cab / Auto', 'car-taxi-front', '#57534E', 'c_transport', 'expense', 0, 52],
  ['c_public', 'Public Transit', 'tram-front', '#57534E', 'c_transport', 'expense', 0, 53],
  ['c_loan_repayment', 'Loan Repayment', 'banknote', '#D97706', null, 'expense', 0, 150],
  ['c_plants_gardening', 'Plants & Gardening', 'leaf', '#16A34A', null, 'expense', 0, 160],
  ['c_hobbies', 'Hobbies', 'palette', '#6366F1', null, 'expense', 0, 170],
  ['c_salary', 'Salary', 'briefcase', '#15803D', null, 'income', 0, 200],
  ['c_freelance', 'Freelance / Side Hustle', 'laptop', '#15803D', null, 'income', 0, 210],
  ['c_investment_returns', 'Investment Returns', 'trending-up', '#15803D', null, 'income', 0, 220],
  ['c_rental_income', 'Rental Income', 'building-2', '#15803D', null, 'income', 0, 230],
  ['c_refunds', 'Refunds', 'rotate-ccw', '#15803D', null, 'income', 0, 240],
  ['c_gifts_in', 'Gifts Received', 'gift', '#15803D', null, 'income', 0, 250],
  ['c_other_income', 'Other Income', 'circle-plus', '#15803D', null, 'income', 0, 260],
]

function buildHistoricalMigrationDirectory() {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'vs-v15-migrations-'))
  const metaDir = resolve(tempDir, 'meta')
  mkdirSync(metaDir, { recursive: true })

  for (const filename of migrationFiles) {
    cpSync(resolve(migrationsRoot, filename), resolve(tempDir, filename))
  }

  const currentJournal = JSON.parse(
    readFileSync(resolve(migrationsRoot, 'meta/_journal.json'), 'utf8'),
  )
  const historicalTags = new Set(
    migrationFiles.map((filename) => filename.replace(/\.sql$/, '')),
  )
  const journal = {
    ...currentJournal,
    entries: currentJournal.entries.filter((entry) => historicalTags.has(entry.tag)),
  }
  writeFileSync(resolve(metaDir, '_journal.json'), `${JSON.stringify(journal, null, 2)}\n`)
  return tempDir
}

function seed(db) {
  const insertUser = db.prepare(
    'INSERT INTO users (id, name, color, pin_hash, created_at) VALUES (?, ?, ?, ?, ?)',
  )
  insertUser.run('u_vimal', 'Vimal', '#C2410C', null, fixedNow)
  insertUser.run('u_pavithra', 'Pavithra', '#B45309', null, fixedNow)

  const insertCategory = db.prepare(
    `INSERT INTO categories
      (id, name, icon, color, parent_id, type, is_essential, sort_order, archived, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  )
  for (const category of categories) insertCategory.run(...category, fixedNow)

  const insertAccount = db.prepare(
    `INSERT INTO accounts
      (id, name, type, institution, last4, opening_balance, credit_limit, statement_day,
       due_day, currency, color, icon, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  insertAccount.run(
    'a_vimal_bank', 'Vimal Bank', 'bank', 'Fixture Bank', '1234', 1000000,
    null, null, null, 'INR', '#2563EB', 'landmark', 0, fixedNow, fixedNow,
  )
  insertAccount.run(
    'a_pavithra_cash', 'Pavithra Cash', 'cash', null, null, 250000,
    null, null, null, 'INR', '#16A34A', 'wallet', 0, fixedNow, fixedNow,
  )

  const insertSettings = db.prepare(
    'INSERT INTO user_settings (user_id, primary_account_id, monthly_budget_paise, updated_at) VALUES (?, ?, ?, ?)',
  )
  insertSettings.run('u_vimal', 'a_vimal_bank', 5000000, 1754006400000)
  insertSettings.run('u_pavithra', 'a_pavithra_cash', 3000000, 1754006400000)

  const insertTransaction = db.prepare(
    `INSERT INTO transactions
      (id, type, amount, date, account_id, to_account_id, category_id, description, notes,
       spent_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  insertTransaction.run(
    't_groceries', 'expense', 12345, '2026-07-01', 'a_vimal_bank', null,
    'c_groceries', 'Monthly groceries', 'v1.5 fixture', 'u_vimal', fixedNow, fixedNow,
  )
  insertTransaction.run(
    't_dining', 'expense', 6789, '2026-07-02', 'a_pavithra_cash', null,
    'c_dining', 'Family dinner', null, 'u_pavithra', fixedNow, fixedNow,
  )
  insertTransaction.run(
    't_transport', 'expense', 2500, '2026-07-03', 'a_vimal_bank', null,
    'c_transport', 'Auto fare', null, 'u_vimal', fixedNow, fixedNow,
  )
}

function main() {
  assertHistoricalMigrationHashes()
  const migrationsDir = buildHistoricalMigrationDirectory()
  let db
  try {
    mkdirSync(dirname(outputPath), { recursive: true })
    rmSync(outputPath, { force: true })
    rmSync(`${outputPath}-wal`, { force: true })
    rmSync(`${outputPath}-shm`, { force: true })

    db = new Database(outputPath)
    db.pragma('foreign_keys = ON')
    migrate(drizzle(db), { migrationsFolder: migrationsDir })

    seed(db)

    const integrity = db.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') {
      throw new Error(`fixture integrity_check failed: ${integrity}`)
    }

    const sessions = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'")
      .all()
    const compoundIndex = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_txn_account_date'")
      .all()
    if (sessions.length !== 0 || compoundIndex.length !== 0) {
      throw new Error('v1.5 fixture accidentally contains the v1.6 sessions schema')
    }
    db.close()
    db = undefined
    console.log(`built ${outputPath}`)
  } finally {
    if (db) db.close()
    rmSync(migrationsDir, { recursive: true, force: true })
  }
}

main()
