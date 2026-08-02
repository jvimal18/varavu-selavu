import { defineEventHandler } from 'h3'
import { useDb, schema } from '~~/server/db/client'
import { eq } from 'drizzle-orm'
import { requireUser } from '~~/server/utils/auth'

/**
 * Per-user settings (primary account, monthly budget).
 * Returns nulls when the user has no row yet.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const db = useDb()
  const row = await db.select()
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, user.id))
    .get()
  return {
    primaryAccountId: row?.primaryAccountId ?? null,
    monthlyBudgetPaise: row?.monthlyBudgetPaise ?? null,
  }
})
