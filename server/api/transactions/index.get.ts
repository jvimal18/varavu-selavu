import { z } from 'zod'
import { defineEventHandler, getQuery } from 'h3'
import { useDb, schema } from '~~/server/db/client'
import { and, eq, gte, lte, like, desc, sql, inArray } from 'drizzle-orm'

const Query = z.object({
  from: z.string().optional(),         // YYYY-MM-DD
  to: z.string().optional(),
  accountId: z.string().optional(),
  categoryId: z.string().optional(),
  spentBy: z.string().optional(),
  type: z.enum(['expense', 'income', 'transfer']).optional(),
  q: z.string().optional(),             // text search on description
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
})

/**
 * List transactions with filters.
 * Joins: account (for name), category (for name/icon/color), spentBy user.
 */
export default defineEventHandler(async (event) => {
  const parsed = Query.safeParse(getQuery(event))
  if (!parsed.success) {
    return { error: 'Invalid query', issues: parsed.error.format() }
  }
  const q = parsed.data
  const db = useDb()

  const whereParts: any[] = []
  if (q.from) whereParts.push(gte(schema.transactions.date, q.from))
  if (q.to) whereParts.push(lte(schema.transactions.date, q.to))
  if (q.accountId) {
    // Include both sides of a transfer
    whereParts.push(sql`(${schema.transactions.accountId} = ${q.accountId} OR ${schema.transactions.toAccountId} = ${q.accountId})`)
  }
  if (q.categoryId) whereParts.push(eq(schema.transactions.categoryId, q.categoryId))
  if (q.spentBy) whereParts.push(eq(schema.transactions.spentBy, q.spentBy))
  if (q.type) whereParts.push(eq(schema.transactions.type, q.type))
  if (q.q) whereParts.push(like(schema.transactions.description, `%${q.q}%`))

  const whereClause = whereParts.length ? and(...whereParts) : undefined

  const rows = await db
    .select({
      id: schema.transactions.id,
      type: schema.transactions.type,
      amount: schema.transactions.amount,
      date: schema.transactions.date,
      accountId: schema.transactions.accountId,
      toAccountId: schema.transactions.toAccountId,
      categoryId: schema.transactions.categoryId,
      description: schema.transactions.description,
      notes: schema.transactions.notes,
      spentBy: schema.transactions.spentBy,
      createdAt: schema.transactions.createdAt,
      updatedAt: schema.transactions.updatedAt,
    })
    .from(schema.transactions)
    .where(whereClause)
    .orderBy(desc(schema.transactions.date), desc(schema.transactions.createdAt))
    .limit(q.limit)
    .offset(q.offset)
    .all()

  return { transactions: rows, limit: q.limit, offset: q.offset }
})
