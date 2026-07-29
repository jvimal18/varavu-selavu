import { randomBytes } from 'node:crypto'

const _nowISO = () => new Date().toISOString()
const _todayISO = () => new Date().toISOString().slice(0, 10)
const _newId = (p: string) => `${p}_${randomBytes(10).toString('hex')}`

import { z } from 'zod'
import { defineEventHandler, readBody, createError } from 'h3'
import { eq } from 'drizzle-orm'
import { useDb, schema } from '~~/server/db/client'

const Body = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(['bank', 'credit_card', 'cash', 'digital_wallet', 'other']),
  institution: z.string().max(80).optional().nullable(),
  last4: z.string().max(4).optional().nullable(),
  openingBalance: z.number().int().nonnegative(),  // paise
  creditLimit: z.number().int().nonnegative().optional().nullable(),
  statementDay: z.number().int().min(1).max(31).optional().nullable(),
  dueDay: z.number().int().min(1).max(31).optional().nullable(),
  color: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
})

export default defineEventHandler(async (event) => {
  const parsed = Body.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid account data', data: parsed.error.format() })
  }
  const d = parsed.data
  if (d.type === 'credit_card') {
    if (d.creditLimit == null) {
      throw createError({ statusCode: 400, statusMessage: 'Credit limit required for credit card' })
    }
  }
  const db = useDb()
  const id = _newId('acc')
  const now = _nowISO()
  await db.insert(schema.accounts).values({
    id,
    name: d.name,
    type: d.type,
    institution: d.institution ?? null,
    last4: d.last4 ?? null,
    openingBalance: d.openingBalance,
    creditLimit: d.creditLimit ?? null,
    statementDay: d.statementDay ?? null,
    dueDay: d.dueDay ?? null,
    currency: 'INR',
    color: d.color ?? null,
    icon: d.icon ?? null,
    archived: false,
    createdAt: now,
    updatedAt: now,
  }).run()
  const account = await db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get()
  return { account }
})
