import { z } from 'zod'
import { defineEventHandler, readBody, createError } from 'h3'
import { useDb, schema } from '~~/server/db/client'
import { eq } from 'drizzle-orm'
import { verifyPin, setSessionUserId, getCurrentUser, validatePin } from '~~/server/utils/auth'

const Body = z.object({
  userId: z.string().min(1),
  pin: z.string(),
})

export default defineEventHandler(async (event) => {
  const parsed = Body.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid request' })
  }

  const { userId, pin } = parsed.data
  const pinCheck = validatePin(pin)
  if (!pinCheck.valid) {
    throw createError({ statusCode: 400, statusMessage: pinCheck.error! })
  }

  const db = useDb()
  const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get()
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }
  if (!user.pinHash) {
    throw createError({ statusCode: 400, statusMessage: 'PIN not set up. Go to setup.' })
  }

  const ok = await verifyPin(pin, user.pinHash)
  if (!ok) {
    throw createError({ statusCode: 401, statusMessage: 'Incorrect PIN' })
  }

  setSessionUserId(event, user.id)
  return { user: { id: user.id, name: user.name, color: user.color } }
})
