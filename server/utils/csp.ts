/**
 * Content Security Policy builder.
 *
 * Why this exists:
 *   - ECharts uses `new Function()` internally for some formatter features,
 *     so we may need `'unsafe-eval'` in script-src. We ship prod CSP as
 *     `Content-Security-Policy-Report-Only` by default and let the user
 *     flip to enforcing with `NUXT_CSP_ENFORCE=true` once the dashboard
 *     charts (donut, cash-flow, daily-spends) have been verified to load
 *     without violations.
 *   - Vite HMR in dev uses eval, so dev gets `'unsafe-eval'`.
 *   - ECharts (and Vue's scoped styles) inject `<style>` blocks, so
 *     `'unsafe-inline'` on `style-src` is required in both dev and prod.
 *
 * If you change this function, update `tests/server/csp.test.ts` to match
 * the new policy and re-deploy to verify in the browser.
 */
export interface CspOptions {
  /** When true (dev), allow `'unsafe-eval'` for Vite HMR. */
  isDev: boolean
  /**
   * When false (the default for new deploys), the function returns
   * `null` for the `policy` field — the caller should emit the header
   * as `Content-Security-Policy-Report-Only` instead. When true, the
   * caller emits `Content-Security-Policy` (enforcing).
   */
  enforce: boolean
}

export interface BuiltCsp {
  /** The policy string. Null when no CSP is needed (currently never). */
  policy: string
  /**
   * Which header to set:
   *   - `'enforce'` → `Content-Security-Policy`
   *   - `'report-only'` → `Content-Security-Policy-Report-Only`
   */
  mode: 'enforce' | 'report-only'
}

export function buildCsp({ isDev, enforce }: CspOptions): BuiltCsp {
  const scriptSrc = isDev
    ? "'self' 'unsafe-inline' 'unsafe-eval'"
    : "'self' 'unsafe-inline'"

  const policy = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com`,
    `font-src 'self' https://fonts.gstatic.com`,
    // Frame ancestors: deny embedding the app in an iframe. Pairs with the
    // X-Frame-Options: DENY header for older browsers.
    `frame-ancestors 'none'`,
    // Base URI: lock down <base> to prevent base-href injection.
    `base-uri 'self'`,
  ].join('; ')

  return {
    policy,
    mode: enforce ? 'enforce' : 'report-only',
  }
}
