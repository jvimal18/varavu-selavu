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
  const exists = await db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).get()
  if (!exists) throw createError({ statusCode: 404, statusMessage: 'Transaction not found' })

  const update: Record<string, any> = { updatedAt: _nowISO() }
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) update[k] = v
  }
  await db.update(schema.transactions).set(update).where(eq(schema.transactions.id, id)).run()
  const txn = (await db.select().from(schema.transactions)).find((t) => t.id === id)
  return { transaction: txn }
})
