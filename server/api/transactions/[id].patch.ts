import { randomBytes } from 'node:crypto'

const _nowISO = () => new Date().toISOString()

import { z } from 'zod'
import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { useDb, schema } from '~~/server/db/client'
import { eq } from 'drizzle-orm'
import { requireUser } from '~~/server/utils/auth'

const Body = z.object({
  type: z.enum(['expense', 'income', 'transfer', 'interest']).optional(),
  amount: z.number().int().positive().optional(),
  date: z.string().optional(),
  accountId: z.string().min(1).optional(),
  toAccountId: z.string().min(1).optional().nullable(),
  categoryId: z.string().min(1).optional().nullable(),
  description: z.string().max(200).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  spentBy: z.string().min(1).optional(),
})

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Transaction id required' })
  const parsed = Body.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid transaction data' })
  }
  const db = useDb()
  const existing = await db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).get()
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Transaction not found' })

  // Merge patch with existing row to re-validate type-compat invariants
  // after the update. Without this, a PATCH could turn an expense into a
  // transfer without a toAccountId, or strip a required category.
  const merged: Record<string, any> = { ...existing, ...parsed.data }
  if (merged.type === 'transfer') {
    if (!merged.toAccountId) throw createError({ statusCode: 400, statusMessage: 'toAccountId required for transfer' })
    if (merged.toAccountId === merged.accountId) throw createError({ statusCode: 400, statusMessage: 'Cannot transfer to same account' })
    if (merged.categoryId) throw createError({ statusCode: 400, statusMessage: 'Transfers cannot have a category' })
  } else if (merged.type === 'interest') {
    if (merged.toAccountId) throw createError({ statusCode: 400, statusMessage: 'Interest transactions cannot have a toAccountId' })
  } else {
    if (!merged.categoryId) throw createError({ statusCode: 400, statusMessage: 'Category required for expense/income' })
  }

  // Verify foreign-key references exist before update.
  if (parsed.data.accountId !== undefined) {
    const accountExists = await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, parsed.data.accountId))
      .get()
    if (!accountExists) throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  }
  if (parsed.data.toAccountId) {
    const toAccountExists = await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, parsed.data.toAccountId))
      .get()
    if (!toAccountExists) throw createError({ statusCode: 404, statusMessage: 'Destination account not found' })
  }
  if (parsed.data.categoryId) {
    const categoryExists = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(eq(schema.categories.id, parsed.data.categoryId))
      .get()
    if (!categoryExists) throw createError({ statusCode: 404, statusMessage: 'Category not found' })
  }

  const update: Record<string, any> = { updatedAt: _nowISO() }
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) update[k] = v
  }
  await db.update(schema.transactions).set(update).where(eq(schema.transactions.id, id)).run()
  const txn = (await db.select().from(schema.transactions)).find((t) => t.id === id)
  return { transaction: txn }
})
