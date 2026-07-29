/**
 * One-time PIN setup (or PIN change).
 * Body: { userId, pin, currentPin? } — currentPin required if user already has a PIN.
 */
import { z } from 'zod'
import { defineEventHandler, readBody, createError } from 'h3'
import { useDb, schema } from '~~/server/db/client'
import { eq } from 'drizzle-orm'
import { hashPin, verifyPin, setSessionUserId, validatePin, getCurrentUser } from '~~/server/utils/auth'

const Body = z.object({
  userId: z.string().min(1),
  pin: z.string(),
  currentPin: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const parsed = Body.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid request' })
  }

  const { userId, pin, currentPin } = parsed.data
  const pinCheck = validatePin(pin)
  if (!pinCheck.valid) {
    throw createError({ statusCode: 400, statusMessage: pinCheck.error! })
  }

  const db = useDb()
  const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get()
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }

  if (user.pinHash) {
    // Changing existing PIN — require current
    if (!currentPin) {
      throw createError({ statusCode: 400, statusMessage: 'Current PIN required' })
    }
    const ok = await verifyPin(currentPin, user.pinHash)
    if (!ok) {
      throw createError({ statusCode: 401, statusMessage: 'Current PIN incorrect' })
    }
  }

  const hash = await hashPin(pin)
  await db.update(schema.users)
    .set({ pinHash: hash })
    .where(eq(schema.users.id, userId))
    .run()

  setSessionUserId(event, userId)
  return { user: { id: user.id, name: user.name, color: user.color } }
})
