/**
 * One-time PIN setup (or PIN change).
 * Body: { userId, pin, currentPin? } — currentPin required if user already has a PIN.
 *
 * Phase 1 PR 4 change: on PIN change, revoke all OTHER active sessions
 * for this user (a shared/compromised device shouldn't keep its session
 * after the PIN rotates). The current session is preserved.
 */
import { z } from 'zod'
import { defineEventHandler, readBody, createError } from 'h3'
import { useDb, schema } from '~~/server/db/client'
import { eq } from 'drizzle-orm'
import {
  hashPin, verifyPin, setSessionUserId, readSessionMeta, validatePin,
  hashSessionToken, getSessionTokenFromCookie, revokeAllOtherSessions,
} from '~~/server/utils/auth'

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

  const isPinChange = !!user.pinHash
  if (isPinChange) {
    if (!currentPin) {
      throw createError({ statusCode: 400, statusMessage: 'Current PIN required' })
    }
    const ok = await verifyPin(currentPin, user.pinHash!)
    if (!ok) {
      throw createError({ statusCode: 401, statusMessage: 'Current PIN incorrect' })
    }
  }

  const hash = await hashPin(pin)
  await db.update(schema.users)
    .set({ pinHash: hash })
    .where(eq(schema.users.id, userId))
    .run()

  // Capture the current session ID (if any) BEFORE setSessionUserId overwrites
  // the cookie. This is the session we KEEP; everything else for this user
  // gets revoked. On a PIN change, this naturally revokes every other device.
  const currentToken = getSessionTokenFromCookie(event)
  const currentSessionId = currentToken ? hashSessionToken(currentToken) : null

  if (isPinChange && currentSessionId) {
    // Revoke first, then create the new session. Reverse order would miss
    // the old session (the new session ID would be passed as the "keep"
    // argument, leaving the old session untouched).
    await revokeAllOtherSessions(userId, currentSessionId)
  }

  // setSessionUserId is async (writes the session row + sets the cookie).
  // Must await.
  await setSessionUserId(event, userId, readSessionMeta(event))
  return { user: { id: user.id, name: user.name, color: user.color } }
})
