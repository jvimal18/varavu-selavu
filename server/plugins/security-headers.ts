import { defineNitroPlugin } from 'nitropack/runtime'
import { useRuntimeConfig } from '#imports'
import { applySecurityHeaders } from '../utils/security-headers'

/**
 * Finalize headers on responses that pass through Nitro's renderer. Direct
 * H3 errors do not produce a render:response hook; those are owned by the
 * configured Nitro error handler in `server/error-handler.ts`.
 */
export default defineNitroPlugin((nitroApp) => {
  const config = useRuntimeConfig()
  nitroApp.hooks.hook('render:response', (response) => {
    response.headers ||= {}
    applySecurityHeaders(response.headers, {
      isDev: process.env.NODE_ENV !== 'production',
      enforce: config.cspEnforce === true,
    })
  })
})
