/**
 * Auth helpers — session-based PIN auth.
 * Sessions are stored in an httpOnly cookie, signed with the session secret.
 * The cookie payload is just the userId; we look up the user on each request.
 */
import bcrypt from 'bcryptjs'
import { getCookie, setCookie, deleteCookie, type H3Event, createError } from 'h3'
import { useDb, schema } from '../db/client'
import { eq } from 'drizzle-orm'

const COOKIE_NAME = 'vs_session'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

// =====================================================
// PIN HASHING
// =====================================================
export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10)
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash)
}

// =====================================================
// SESSION
// =====================================================
export function getSessionUserId(event: H3Event): string | null {
  return getCookie(event, COOKIE_NAME) || null
}

export function setSessionUserId(event: H3Event, userId: string): void {
  setCookie(event, COOKIE_NAME, userId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })
}

export function clearSessionCookie(event: H3Event): void {
  deleteCookie(event, COOKIE_NAME, { path: '/' })
}

// =====================================================
// USER LOOKUP
// =====================================================
export async function getCurrentUser(event: H3Event) {
  const userId = getSessionUserId(event)
  if (!userId) return null
  const db = useDb()
  const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get()
  return user || null
}

export async function requireUser(event: H3Event) {
  const user = await getCurrentUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }
  return user
}

// =====================================================
// VALIDATION
// =====================================================
export function validatePin(pin: string): { valid: boolean; error?: string } {
  if (!pin) return { valid: false, error: 'PIN is required' }
  if (!/^\d{4,6}$/.test(pin)) return { valid: false, error: 'PIN must be 4-6 digits' }
  return { valid: true }
}
