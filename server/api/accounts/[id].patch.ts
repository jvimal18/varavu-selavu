import { randomBytes } from 'node:crypto'

const _nowISO = () => new Date().toISOString()

import { z } from 'zod'
import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { useDb, schema } from '~~/server/db/client'
import { eq } from 'drizzle-orm'

const Body = z.object({
  name: z.string().min(1).max(80).optional(),
  institution: z.string().max(80).optional().nullable(),
  last4: z.string().max(4).optional().nullable(),
  openingBalance: z.number().int().optional(),
  creditLimit: z.number().int().nonnegative().optional().nullable(),
  statementDay: z.number().int().min(1).max(31).optional().nullable(),
  dueDay: z.number().int().min(1).max(31).optional().nullable(),
  color: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
  archived: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Account id required' })
  const parsed = Body.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid account data' })
  }
  const db = useDb()
  const exists = await db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get()
  if (!exists) throw createError({ statusCode: 404, statusMessage: 'Account not found' })

  const update: Record<string, any> = { updatedAt: _nowISO() }
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) update[k] = v
  }
  await db.update(schema.accounts).set(update).where(eq(schema.accounts.id, id)).run()
  const account = await db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get()
  return { account }
})
