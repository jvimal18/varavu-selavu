import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

// =====================================================
// USERS
// =====================================================
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  pinHash: text('pin_hash'),                       // bcrypt; null = no PIN yet
  createdAt: text('created_at').notNull(),
})

// =====================================================
// ACCOUNTS
// =====================================================
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type', {
    enum: ['bank', 'credit_card', 'cash', 'digital_wallet', 'mutual_fund', 'fixed_deposit', 'recurring_deposit', 'other'],
  }).notNull(),
  institution: text('institution'),
  last4: text('last4'),
  openingBalance: integer('opening_balance').notNull(),     // paise
  creditLimit: integer('credit_limit'),                    // paise; only for credit_card
  statementDay: integer('statement_day'),                  // 1-31; only for credit_card
  dueDay: integer('due_day'),                              // 1-31; only for credit_card
  currency: text('currency').notNull().default('INR'),
  color: text('color'),
  icon: text('icon'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// =====================================================
// CATEGORIES
// =====================================================
export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon'),
  color: text('color'),
  parentId: text('parent_id'),                            // FK categories.id
  type: text('type', { enum: ['expense', 'income', 'both'] }).notNull(),
  isEssential: integer('is_essential', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
})

// =====================================================
// TRANSACTIONS
// =====================================================
export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    type: text('type', { enum: ['expense', 'income', 'transfer'] }).notNull(),
    amount: integer('amount').notNull(),                  // paise, always positive
    date: text('date').notNull(),                         // YYYY-MM-DD
    accountId: text('account_id').notNull(),              // FK accounts.id
    toAccountId: text('to_account_id'),                   // FK accounts.id; only for transfer
    categoryId: text('category_id'),                      // FK categories.id; null for transfer
    description: text('description'),
    notes: text('notes'),
    spentBy: text('spent_by').notNull(),                  // FK users.id
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    dateIdx: index('idx_txn_date').on(t.date),
    accountIdx: index('idx_txn_account').on(t.accountId),
    categoryIdx: index('idx_txn_category').on(t.categoryId),
    spentByIdx: index('idx_txn_spent_by').on(t.spentBy),
    typeIdx: index('idx_txn_type').on(t.type),
  })
)

// =====================================================
// INFERRED TYPES
// =====================================================
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Account = typeof accounts.$inferSelect
export type NewAccount = typeof accounts.$inferInsert
export type Category = typeof categories.$inferSelect
export type NewCategory = typeof categories.$inferInsert
export type Transaction = typeof transactions.$inferSelect
export type NewTransaction = typeof transactions.$inferInsert
