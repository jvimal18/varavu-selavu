import { randomBytes } from 'node:crypto'

const _nowISO = () => new Date().toISOString()
const _todayISO = () => new Date().toISOString().slice(0, 10)
const _newId = (p: string) => `${p}_${randomBytes(10).toString('hex')}`

import { z } from 'zod'
import { defineEventHandler, readBody, createError } from 'h3'
import { useDb, schema } from '~~/server/db/client'
import { requireUser } from '~~/server/utils/auth'
import { eq } from 'drizzle-orm'

const Body = z.object({
  type: z.enum(['expense', 'income', 'transfer', 'interest']),
  amount: z.number().int().positive(),  // paise
  date: z.string().optional(),           // YYYY-MM-DD; defaults to today
  accountId: z.string().min(1),
  toAccountId: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  description: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
  spentBy: z.string().min(1).optional(),  // defaults to current user
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const parsed = Body.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid transaction data', data: parsed.error.format() })
  }
  const d = parsed.data
  if (d.type === 'transfer') {
    if (!d.toAccountId) throw createError({ statusCode: 400, statusMessage: 'toAccountId required for transfer' })
    if (d.toAccountId === d.accountId) throw createError({ statusCode: 400, statusMessage: 'Cannot transfer to same account' })
    if (d.categoryId) throw createError({ statusCode: 400, statusMessage: 'Transfers cannot have a category' })
  } else if (d.type === 'interest') {
    if (d.toAccountId) throw createError({ statusCode: 400, statusMessage: 'Interest transactions cannot have a toAccountId' })
  } else {
    if (!d.categoryId) throw createError({ statusCode: 400, statusMessage: 'Category required for expense/income' })
  }

  const db = useDb()

  // Verify foreign-key references exist before insert. Without this, an
  // unknown accountId/categoryId/toAccountId would bubble a 500 from the
  // SQLite FK constraint instead of a structured 404.
  const accountExists = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(eq(schema.accounts.id, d.accountId))
    .get()
  if (!accountExists) throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  if (d.toAccountId) {
    const toAccountExists = await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, d.toAccountId))
      .get()
    if (!toAccountExists) throw createError({ statusCode: 404, statusMessage: 'Destination account not found' })
  }
  if (d.categoryId) {
    const categoryExists = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(eq(schema.categories.id, d.categoryId))
      .get()
    if (!categoryExists) throw createError({ statusCode: 404, statusMessage: 'Category not found' })
  }

  const id = _newId('txn')
  const now = _nowISO()
  await db.insert(schema.transactions).values({
    id,
    type: d.type,
    amount: d.amount,
    date: d.date || _todayISO(),
    accountId: d.accountId,
    toAccountId: d.toAccountId ?? null,
    categoryId: d.categoryId ?? null,
    description: d.description ?? null,
    notes: d.notes ?? null,
    spentBy: d.spentBy || user.id,
    createdAt: now,
    updatedAt: now,
  }).run()
  const created = (await db.select().from(schema.transactions)).find((t) => t.id === id)
  return { transaction: created }
})
