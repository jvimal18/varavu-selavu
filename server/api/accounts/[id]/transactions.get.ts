import { defineEventHandler, getRouterParam, createError } from 'h3'
import { useDb, schema } from '~~/server/db/client'
import { eq, desc } from 'drizzle-orm'

/** All transactions for one account (used by /accounts/[id] detail). */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Account id required' })
  const db = useDb()
  const account = await db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get()
  if (!account) throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  const txns = await db.select().from(schema.transactions)
    .orderBy(desc(schema.transactions.date), desc(schema.transactions.createdAt))
    .all()
  const filtered = txns.filter((t) => t.accountId === id || t.toAccountId === id)
  return { account, transactions: filtered }
})
