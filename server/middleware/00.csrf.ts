/**
 * Global CSRF middleware — runs first (00 prefix → alphabetical before
 * 01.auth.ts and 99.security-headers.ts).
 *
 * Strategy: check the `Origin` header on state-changing requests
 * (POST/PATCH/PUT/DELETE) to `/api/*`. Auth endpoints (`/api/auth/*`)
 * are exempt so login + setup-pin still work cross-origin during
 * bootstrapping.
 *
 * Skipped: safe methods (GET, HEAD, OPTIONS), non-`/api/*` paths (the
 * dashboard is same-origin so the page itself never carries a custom
 * Origin), and `/api/auth/*` (login + logout + setup-pin + future
 * recover).
 *
 * If you change the skip list or the unsafe-method set, update
 * `tests/server/csrf.test.ts`.
 */
import { defineEventHandler, getRequestURL, getMethod, getRequestHeader, createError } from 'h3'
import { useRuntimeConfig } from '#imports'
import { parseAllowedOrigins, isOriginAllowed } from '../utils/csrf'

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  const method = getMethod(event).toUpperCase()

  // Only protect API routes
  if (!url.pathname.startsWith('/api/')) return

  // Auth endpoints are always exempt
  if (url.pathname.startsWith('/api/auth/')) return

  // Safe methods don't change state — skip
  if (!UNSAFE_METHODS.has(method)) return

  const origin = getRequestHeader(event, 'origin')
  const config = useRuntimeConfig()
  const allowed = parseAllowedOrigins(config.allowedOrigins as string | undefined)

  const check = isOriginAllowed(origin, allowed)
  if (!check.ok) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: check.reason,
    })
  }
})
