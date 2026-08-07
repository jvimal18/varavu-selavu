import { defineEventHandler, setHeader } from 'h3'
import { useDb, schema } from '~~/server/db/client'
import { requireUser } from '~~/server/utils/auth'

/**
 * GET /api/export/json — full DB snapshot for backup/restore.
 * Includes archived rows: a snapshot must restore everything.
 *
 * Versioned to match `scripts/export.mjs` (v1.2 / 6 tables) so the public
 * API and the file-backed script produce interchangeable snapshots.
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const db = useDb()

  const [users, accounts, categories, transactions, userSettings, sessions] = await Promise.all([
    db.select().from(schema.users).all(),
    db.select().from(schema.accounts).all(),
    db.select().from(schema.categories).all(),
    db.select().from(schema.transactions).all(),
    db.select().from(schema.userSettings).all(),
    db.select().from(schema.sessions).all(),
  ])

  const snapshot = {
    exportedAt: new Date().toISOString(),
    version: '1.2',
    users,
    accounts,
    categories,
    transactions,
    userSettings,
    sessions,
  }

  setHeader(event, 'Content-Disposition', `attachment; filename="budget-${new Date().toISOString().slice(0, 10)}.json"`)
  return snapshot
})
