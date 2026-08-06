/**
 * Security headers middleware — runs LAST (99 prefix → after 00.csrf.ts
 * and 01.auth.ts). Sets headers on every response, including error
 * responses, so 401/403/500 all carry the same protections.
 *
 * If you change any of these headers, update `tests/server/csp.test.ts`
 * (for the CSP policy) and re-verify in the browser before deploying.
 */
import { defineEventHandler, setResponseHeader, getRequestURL } from 'h3'
import { useRuntimeConfig } from '#imports'
import { buildCsp } from '../utils/csp'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const isDev = process.env.NODE_ENV !== 'production'
  const enforce = config.cspEnforce === true

  // Content-Security-Policy / -Report-Only.
  // Default is Report-Only so we can verify ECharts + Vue scoped styles
  // work without violations on the dashboard. Flip to enforcing with
  // NUXT_CSP_ENFORCE=true once verified.
  const csp = buildCsp({ isDev, enforce })
  const cspHeader = csp.mode === 'enforce'
    ? 'Content-Security-Policy'
    : 'Content-Security-Policy-Report-Only'
  setResponseHeader(event, cspHeader, csp.policy)

  // HSTS — Tailscale Funnel already does this, but the app-level header
  // is belt-and-suspenders for direct LAN access.
  setResponseHeader(event, 'Strict-Transport-Security', 'max-age=31536000; includeSubDomains')

  // Prevent MIME-type sniffing. CSP also covers this, but old browsers
  // don't honor CSP's `default-src` for MIME sniffing.
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')

  // Deny framing entirely. Combined with CSP `frame-ancestors 'none'`.
  setResponseHeader(event, 'X-Frame-Options', 'DENY')

  // Referer policy: only send origin for cross-origin requests, full URL
  // for same-origin. Privacy-friendly default.
  setResponseHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin')

  // Permissions policy: explicitly disable the features we don't use.
  setResponseHeader(event, 'Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')

  // Suppress the URL in the Referer header (cosmetic; Referrer-Policy
  // above already handles this). Kept for explicitness.
  void getRequestURL // keep the import live if we add per-path tweaks later
})
