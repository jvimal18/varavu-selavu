/**
 * Seed script — inserts the two users and the default category tree.
 * Idempotent: skips rows that already exist by id.
 */
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { users, categories } from './schema'
import { eq } from 'drizzle-orm'

const dbPath = process.env.NUXT_DB_PATH || './data/dev.db'
const absPath = resolve(process.cwd(), dbPath)
const dir = dirname(absPath)
if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

const sqlite = new Database(absPath)
sqlite.pragma('foreign_keys = ON')
const db = drizzle(sqlite, { schema: { users, categories } })

const now = new Date().toISOString()

// ---- USERS ----
const seedUsers = [
  { id: 'u_vimal', name: 'Vimal', color: '#C2410C', pinHash: null },
  { id: 'u_pavithra', name: 'Pavithra', color: '#B45309', pinHash: null },
]

for (const u of seedUsers) {
  const exists = db.select().from(users).where(eq(users.id, u.id)).get()
  if (!exists) {
    db.insert(users).values({ ...u, createdAt: now }).run()
    console.log(`[seed] user: ${u.name}`)
  } else {
    console.log(`[seed] user exists: ${u.name}`)
  }
}

// ---- CATEGORIES ----
// (id, name, icon, color, parentId, type, isEssential, sortOrder)
const seedCategories: Array<{
  id: string; name: string; icon: string; color: string
  parentId: string | null; type: 'expense' | 'income' | 'both'
  isEssential: boolean; sortOrder: number
}> = [
  // EXPENSE — parents
  { id: 'c_housing', name: 'Housing', icon: 'home', color: '#78716C', parentId: null, type: 'expense', isEssential: true, sortOrder: 10 },
  { id: 'c_utilities', name: 'Utilities', icon: 'zap', color: '#4D7C5A', parentId: null, type: 'expense', isEssential: true, sortOrder: 20 },
  { id: 'c_groceries', name: 'Groceries', icon: 'shopping-basket', color: '#C2410C', parentId: null, type: 'expense', isEssential: true, sortOrder: 30 },
  { id: 'c_dining', name: 'Food & Dining', icon: 'utensils', color: '#D97706', parentId: null, type: 'expense', isEssential: false, sortOrder: 40 },
  { id: 'c_transport', name: 'Transport', icon: 'car', color: '#57534E', parentId: null, type: 'expense', isEssential: true, sortOrder: 50 },
  { id: 'c_shopping', name: 'Shopping', icon: 'shopping-bag', color: '#BE185D', parentId: null, type: 'expense', isEssential: false, sortOrder: 60 },
  { id: 'c_health', name: 'Health', icon: 'heart-pulse', color: '#0F766E', parentId: null, type: 'expense', isEssential: true, sortOrder: 70 },
  { id: 'c_entertainment', name: 'Entertainment', icon: 'tv-2', color: '#6D28D9', parentId: null, type: 'expense', isEssential: false, sortOrder: 80 },
  { id: 'c_travel', name: 'Travel', icon: 'plane', color: '#0EA5E9', parentId: null, type: 'expense', isEssential: false, sortOrder: 90 },
  { id: 'c_education', name: 'Education', icon: 'graduation-cap', color: '#0F766E', parentId: null, type: 'expense', isEssential: true, sortOrder: 100 },
  { id: 'c_insurance', name: 'Insurance', icon: 'shield', color: '#4D7C5A', parentId: null, type: 'expense', isEssential: true, sortOrder: 110 },
  { id: 'c_personal_care', name: 'Personal Care', icon: 'sparkles', color: '#BE185D', parentId: null, type: 'expense', isEssential: false, sortOrder: 120 },
  { id: 'c_gifts', name: 'Gifts & Donations', icon: 'gift', color: '#D97706', parentId: null, type: 'expense', isEssential: false, sortOrder: 130 },
  { id: 'c_misc', name: 'Miscellaneous', icon: 'more-horizontal', color: '#A8A29E', parentId: null, type: 'expense', isEssential: false, sortOrder: 140 },

  // HOUSING subcategories
  { id: 'c_rent', name: 'Rent / EMI', icon: 'home', color: '#78716C', parentId: 'c_housing', type: 'expense', isEssential: true, sortOrder: 11 },
  { id: 'c_maintenance', name: 'Maintenance', icon: 'wrench', color: '#78716C', parentId: 'c_housing', type: 'expense', isEssential: true, sortOrder: 12 },
  { id: 'c_property_tax', name: 'Property Tax', icon: 'file-text', color: '#78716C', parentId: 'c_housing', type: 'expense', isEssential: true, sortOrder: 13 },

  // UTILITIES subcategories
  { id: 'c_electricity', name: 'Electricity', icon: 'zap', color: '#4D7C5A', parentId: 'c_utilities', type: 'expense', isEssential: true, sortOrder: 21 },
  { id: 'c_water', name: 'Water', icon: 'droplet', color: '#4D7C5A', parentId: 'c_utilities', type: 'expense', isEssential: true, sortOrder: 22 },
  { id: 'c_internet', name: 'Internet', icon: 'wifi', color: '#4D7C5A', parentId: 'c_utilities', type: 'expense', isEssential: true, sortOrder: 23 },
  { id: 'c_mobile', name: 'Mobile', icon: 'smartphone', color: '#4D7C5A', parentId: 'c_utilities', type: 'expense', isEssential: true, sortOrder: 24 },

  // DINING subcategories
  { id: 'c_restaurants', name: 'Restaurants', icon: 'utensils', color: '#D97706', parentId: 'c_dining', type: 'expense', isEssential: false, sortOrder: 41 },
  { id: 'c_delivery', name: 'Delivery', icon: 'bike', color: '#D97706', parentId: 'c_dining', type: 'expense', isEssential: false, sortOrder: 42 },
  { id: 'c_coffee', name: 'Coffee', icon: 'coffee', color: '#D97706', parentId: 'c_dining', type: 'expense', isEssential: false, sortOrder: 43 },

  // TRANSPORT subcategories
  { id: 'c_fuel', name: 'Fuel', icon: 'fuel', color: '#57534E', parentId: 'c_transport', type: 'expense', isEssential: true, sortOrder: 51 },
  { id: 'c_cab', name: 'Cab / Auto', icon: 'car-taxi-front', color: '#57534E', parentId: 'c_transport', type: 'expense', isEssential: false, sortOrder: 52 },
  { id: 'c_public', name: 'Public Transit', icon: 'tram-front', color: '#57534E', parentId: 'c_transport', type: 'expense', isEssential: false, sortOrder: 53 },

  // v1.4.0 — new top-level expense categories
  { id: 'c_loan_repayment', name: 'Loan Repayment', icon: 'banknote', color: '#D97706', parentId: null, type: 'expense', isEssential: false, sortOrder: 150 },
  { id: 'c_plants_gardening', name: 'Plants & Gardening', icon: 'leaf', color: '#16A34A', parentId: null, type: 'expense', isEssential: false, sortOrder: 160 },
  { id: 'c_hobbies', name: 'Hobbies', icon: 'palette', color: '#6366F1', parentId: null, type: 'expense', isEssential: false, sortOrder: 170 },

  // INCOME
  { id: 'c_salary', name: 'Salary', icon: 'briefcase', color: '#15803D', parentId: null, type: 'income', isEssential: false, sortOrder: 200 },
  { id: 'c_freelance', name: 'Freelance / Side Hustle', icon: 'laptop', color: '#15803D', parentId: null, type: 'income', isEssential: false, sortOrder: 210 },
  { id: 'c_investment_returns', name: 'Investment Returns', icon: 'trending-up', color: '#15803D', parentId: null, type: 'income', isEssential: false, sortOrder: 220 },
  { id: 'c_rental_income', name: 'Rental Income', icon: 'building-2', color: '#15803D', parentId: null, type: 'income', isEssential: false, sortOrder: 230 },
  { id: 'c_refunds', name: 'Refunds', icon: 'rotate-ccw', color: '#15803D', parentId: null, type: 'income', isEssential: false, sortOrder: 240 },
  { id: 'c_gifts_in', name: 'Gifts Received', icon: 'gift', color: '#15803D', parentId: null, type: 'income', isEssential: false, sortOrder: 250 },
  { id: 'c_other_income', name: 'Other Income', icon: 'circle-plus', color: '#15803D', parentId: null, type: 'income', isEssential: false, sortOrder: 260 },
]

let inserted = 0, skipped = 0
for (const c of seedCategories) {
  const exists = db.select().from(categories).where(eq(categories.id, c.id)).get()
  if (!exists) {
    db.insert(categories).values({ ...c, archived: false, createdAt: now }).run()
    inserted++
  } else {
    skipped++
  }
}
console.log(`[seed] categories: ${inserted} inserted, ${skipped} already existed`)

sqlite.close()
console.log('[seed] done')
