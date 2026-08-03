import { z } from 'zod'
import { defineEventHandler, readBody, createError } from 'h3'
import { useDb, schema } from '~~/server/db/client'
import { eq } from 'drizzle-orm'
import { verifyPin, setSessionUserId, validatePin } from '~~/server/utils/auth'
import { checkLoginAllowed, recordLoginResult, logAuthFailure, getClientIp } from '~~/server/utils/rateLimit'

const Body = z.object({
  userId: z.string().min(1),
  pin: z.string(),
})

/**
 * Login endpoint error envelope (for client consumption):
 *   {
 *     statusCode: 401 | 404 | 429,
 *     message:    "<user-friendly text>",
 *     data:       { retryAfter: <seconds> }  // only on 429
 *   }
 *
 * `message` is the user-facing string (read by the client as e.data.message).
 * `statusMessage` is the standard HTTP reason phrase for the status line
 * (e.g. "Too Many Requests", "Unauthorized") and is NOT what the client
 * should display — it gets overridden by intermediaries.
 */
export default defineEventHandler(async (event) => {
  const parsed = Body.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'Invalid request. Please try again.' })
  }

  const { userId, pin } = parsed.data
  const pinCheck = validatePin(pin)
  if (!pinCheck.valid) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: pinCheck.error! })
  }

  // Rate-limit gate (per-IP throttle, per-IP failure block, per-account cooldown).
  const check = checkLoginAllowed(event, userId)
  if (!check.ok) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
      message: check.message,
      data: { retryAfter: check.retryAfter },
    })
  }

  const db = useDb()
  const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get()
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'Account not found.' })
  }
  if (!user.pinHash) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'PIN not set up. Please set up your PIN first.' })
  }

  const ok = await verifyPin(pin, user.pinHash)
  if (!ok) {
    const ip = getClientIp(event)
    recordLoginResult(event, userId, false)
    logAuthFailure(ip, userId, 'incorrect-pin')
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized', message: 'Incorrect PIN. Please try again.' })
  }

  recordLoginResult(event, userId, true)
  setSessionUserId(event, user.id)
  return { user: { id: user.id, name: user.name, color: user.color } }
})
