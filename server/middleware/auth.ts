/**
 * Global server middleware: enforce auth on /api/* except /api/auth/*.
 * Page-level auth is handled in layouts/middleware.
 */
import { defineEventHandler, getRequestURL, getMethod } from 'h3'
import { getCurrentUser } from '../utils/auth'

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  const method = getMethod(event)

  // Only protect API routes (and only mutating + read routes that need auth)
  if (!url.pathname.startsWith('/api/')) return

  // Auth endpoints are always public
  if (url.pathname.startsWith('/api/auth/')) return

  // GET /api/export/* protected; POST etc handled by individual routes
  // For now: all non-auth API routes require a session
  const user = await getCurrentUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }
})
