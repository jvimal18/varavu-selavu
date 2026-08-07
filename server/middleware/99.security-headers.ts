/**
 * Security headers middleware — runs LAST (99 prefix → after 00.csrf.ts
 * and 01.auth.ts) for normal request handling. Direct errors are finalized
 * by the configured Nitro error handler because earlier middleware can throw
 * before this handler runs.
 *
 * If you change any of these headers, update the security HTTP tests and
 * re-verify in the browser before deploying.
 */
import { defineEventHandler, setResponseHeader } from 'h3'
import { useRuntimeConfig } from '#imports'
import { applySecurityHeaders } from '../utils/security-headers'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const headers: Record<string, string> = {}
  applySecurityHeaders(headers, {
    isDev: process.env.NODE_ENV !== 'production',
    enforce: config.cspEnforce === true,
  })
  for (const [name, value] of Object.entries(headers)) {
    setResponseHeader(event, name, value)
  }
})
