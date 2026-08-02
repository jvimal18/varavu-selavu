import { defineEventHandler, getRouterParam, createError } from 'h3'
import { useDb, schema } from '~~/server/db/client'
import { eq } from 'drizzle-orm'
import { requireUser } from '~~/server/utils/auth'

/** Hard delete — for v1, transactions can be fully deleted. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Transaction id required' })
  const db = useDb()
  const exists = await db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).get()
  if (!exists) throw createError({ statusCode: 404, statusMessage: 'Transaction not found' })
  await db.delete(schema.transactions).where(eq(schema.transactions.id, id)).run()
  return { ok: true }
})
