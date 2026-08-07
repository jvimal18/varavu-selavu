import { send, setResponseHeaders, setResponseStatus } from 'h3'
import { defineNitroErrorHandler } from 'nitropack/runtime'
import { useRuntimeConfig } from '#imports'
import { applySecurityHeaders } from './utils/security-headers'

/**
 * Nitro 2.13.4 supplies `(error, event, { defaultHandler })`. The delegated
 * handler preserves status, status text, body, cache behavior, and the
 * environment-specific default serialization; this wrapper only replaces the
 * application-owned response headers before sending that same result.
 */
export default defineNitroErrorHandler(async (error, event, { defaultHandler }) => {
  const result = await defaultHandler(error, event)
  const config = useRuntimeConfig()
  applySecurityHeaders(result.headers, {
    isDev: process.env.NODE_ENV !== 'production',
    enforce: config.cspEnforce === true,
  })
  setResponseHeaders(event, result.headers)
  setResponseStatus(event, result.status, result.statusText)
  const body = typeof result.body === 'string'
    ? result.body
    : JSON.stringify(result.body, null, 2)
  await send(event, body)
})
