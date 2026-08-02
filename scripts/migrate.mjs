#!/usr/bin/env node
// scripts/migrate.mjs — runs drizzle migrations + seed on the Pi using only the
// deployed bundle's modules (better-sqlite3 is bundled in .output/server).
// Idempotent: applied migrations are tracked in __drizzle_migrations and seed
// rows use INSERT OR IGNORE. Seed data mirrors server/db/seed.ts.
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nmDir = resolve(appDir, '.output/server/node_modules')

const Database = require(resolve(nmDir, 'better-sqlite3'))

const dbPath = process.env.NUXT_DB_PATH || resolve(appDir, 'budget.db')
const dbDir = dirname(dbPath)
if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true })

const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

// --- migrations (mirrors drizzle-orm/better-sqlite3/migrator) ---
const journalPath = resolve(appDir, 'db/migrations/meta/_journal.json')
const migrationsDir = resolve(appDir, 'db/migrations')

sqlite.exec(`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash text NOT NULL,
  created_at numeric
)`)

const applied = new Set(
  sqlite.prepare('SELECT hash FROM "__drizzle_migrations"').all().map((r) => r.hash),
)
const insertMigration = sqlite.prepare(
  'INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)',
)

let migrated = 0
if (existsSync(journalPath)) {
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
  for (const entry of journal.entries) {
    const sql = readFileSync(resolve(migrationsDir, `${entry.tag}.sql`), 'utf8')
    const hash = createHash('sha256').update(sql).digest('hex')
    if (applied.has(hash)) continue
    const statements = sql
      .replace(/^--.*$/gm, '')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const statement of statements) sqlite.exec(statement)
    insertMigration.run(hash, Date.now())
    migrated++
  }
}
console.log(`[migrate] applied ${migrated} migration(s)`)

// --- seed (mirrors server/db/seed.ts) ---
const now = new Date().toISOString()

const insertUser = sqlite.prepare(
  'INSERT OR IGNORE INTO users (id, name, color, pin_hash, created_at) VALUES (?, ?, ?, ?, ?)',
)
for (const [id, name, color, pinHash] of [
  ['u_vimal', 'Vimal', '#C2410C', null],
  ['u_pavithra', 'Pavithra', '#B45309', null],
]) {
  insertUser.run(id, name, color, pinHash, now)
}

const insertCategory = sqlite.prepare(
  `INSERT OR IGNORE INTO categories
   (id, name, icon, color, parent_id, type, is_essential, sort_order, archived, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
)
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
  ['c_salary', 'Salary', 'briefcase', '#15803D', null, 'income', 0, 200],
  ['c_freelance', 'Freelance / Side Hustle', 'laptop', '#15803D', null, 'income', 0, 210],
  ['c_investment_returns', 'Investment Returns', 'trending-up', '#15803D', null, 'income', 0, 220],
  ['c_rental_income', 'Rental Income', 'building-2', '#15803D', null, 'income', 0, 230],
  ['c_refunds', 'Refunds', 'rotate-ccw', '#15803D', null, 'income', 0, 240],
  ['c_gifts_in', 'Gifts Received', 'gift', '#15803D', null, 'income', 0, 250],
  ['c_other_income', 'Other Income', 'circle-plus', '#15803D', null, 'income', 0, 260],
]
for (const [id, name, icon, color, parentId, type, isEssential, sortOrder] of categories) {
  insertCategory.run(id, name, icon, color, parentId, type, isEssential, sortOrder, now)
}

console.log('[seed] users + categories ensured')
sqlite.close()
console.log('[migrate] done')
