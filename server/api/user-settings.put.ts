import { z } from 'zod'
import { defineEventHandler, readBody, createError } from 'h3'
import { useDb, schema } from '~~/server/db/client'
import { eq } from 'drizzle-orm'
import { requireUser } from '~~/server/utils/auth'

const Body = z.object({
  primaryAccountId: z.string().min(1).nullable().optional(),
  monthlyBudgetPaise: z.number().int().nonnegative().nullable().optional(),
})

/**
 * Upsert per-user settings. Each field is optional; only provided fields
 * are updated. A null value clears the setting.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const parsed = Body.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid user settings', data: parsed.error.format() })
  }
  const d = parsed.data
  const db = useDb()

  if (d.primaryAccountId != null) {
    const account = await db.select().from(schema.accounts)
      .where(eq(schema.accounts.id, d.primaryAccountId))
      .get()
    if (!account) {
      throw createError({ statusCode: 400, statusMessage: 'Account not found' })
    }
  }

  const existing = await db.select().from(schema.userSettings)
    .where(eq(schema.userSettings.userId, user.id))
    .get()

  if (existing) {
    const update: Record<string, any> = { updatedAt: Date.now() }
    if (d.primaryAccountId !== undefined) update.primaryAccountId = d.primaryAccountId
    if (d.monthlyBudgetPaise !== undefined) update.monthlyBudgetPaise = d.monthlyBudgetPaise
    await db.update(schema.userSettings).set(update).where(eq(schema.userSettings.userId, user.id)).run()
  } else {
    await db.insert(schema.userSettings).values({
      userId: user.id,
      primaryAccountId: d.primaryAccountId ?? null,
      monthlyBudgetPaise: d.monthlyBudgetPaise ?? null,
      updatedAt: Date.now(),
    }).run()
  }

  const row = await db.select().from(schema.userSettings)
    .where(eq(schema.userSettings.userId, user.id))
    .get()
  return {
    primaryAccountId: row?.primaryAccountId ?? null,
    monthlyBudgetPaise: row?.monthlyBudgetPaise ?? null,
  }
})
