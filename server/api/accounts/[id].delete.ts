import { randomBytes } from 'node:crypto'

const _nowISO = () => new Date().toISOString()

import { defineEventHandler, getRouterParam, createError } from 'h3'
import { useDb, schema } from '~~/server/db/client'
import { eq } from 'drizzle-orm'

/** Soft delete: set archived = true. Preserves transaction history. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Account id required' })
  const db = useDb()
  const exists = await db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get()
  if (!exists) throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  await db.update(schema.accounts)
    .set({ archived: true, updatedAt: _nowISO() })
    .where(eq(schema.accounts.id, id))
    .run()
  return { ok: true }
})
