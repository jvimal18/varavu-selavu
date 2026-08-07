import { buildCsp } from './csp'

export interface SecurityHeaderOptions {
  isDev: boolean
  enforce: boolean
}

/**
 * The single authoritative response-header policy. The middleware applies
 * this during normal request handling; the Nitro renderer hook and configured
 * error handler reapply it for rendered and thrown error responses.
 */
export function buildSecurityHeaders({ isDev, enforce }: SecurityHeaderOptions): Record<string, string> {
  const csp = buildCsp({ isDev, enforce })
  const cspHeader = csp.mode === 'enforce'
    ? 'Content-Security-Policy'
    : 'Content-Security-Policy-Report-Only'

  return {
    [cspHeader]: csp.policy,
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  }
}

/** Apply the policy to a mutable Nitro render-response header map. */
export function applySecurityHeaders(
  headers: Record<string, string>,
  options: SecurityHeaderOptions,
): void {
  // A response may have been populated by another renderer. Remove owned
  // names case-insensitively so canonical assignment cannot leave logical
  // duplicates such as `referrer-policy` and `Referrer-Policy`.
  const owned = new Set([
    'Content-Security-Policy',
    'Content-Security-Policy-Report-Only',
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Referrer-Policy',
    'Permissions-Policy',
  ].map((name) => name.toLowerCase()))
  for (const name of Object.keys(headers)) {
    if (owned.has(name.toLowerCase())) delete headers[name]
  }
  Object.assign(headers, buildSecurityHeaders(options))
}
