/**
 * Tests for `server/utils/csp.ts`.
 *
 * The security-headers middleware (`server/middleware/99.security-headers.ts`)
 * is glue: it calls `buildCsp()` and sets the appropriate header. The
 * actual policy is decided by this function. Test it here.
 *
 * The dev policy and the prod policy differ in one place: dev allows
 * `'unsafe-eval'` for Vite HMR. ECharts uses `new Function()` for some
 * formatter features; if you discover a chart that needs it in prod
 * too, add `'unsafe-eval'` to the prod branch and update this test.
 */
import { describe, it, expect } from 'vitest'
import { buildCsp } from '~~/server/utils/csp'

describe('buildCsp', () => {
  it('returns enforce mode when enforce=true', () => {
    const r = buildCsp({ isDev: false, enforce: true })
    expect(r.mode).toBe('enforce')
  })

  it('returns report-only mode when enforce=false', () => {
    const r = buildCsp({ isDev: false, enforce: false })
    expect(r.mode).toBe('report-only')
  })

  it('dev policy allows unsafe-eval (for Vite HMR)', () => {
    const r = buildCsp({ isDev: true, enforce: false })
    expect(r.policy).toContain("'unsafe-eval'")
  })

  it('prod policy does NOT include unsafe-eval', () => {
    const r = buildCsp({ isDev: false, enforce: false })
    expect(r.policy).not.toContain("'unsafe-eval'")
  })

  it('both policies include unsafe-inline on style-src (ECharts + Vue scoped styles)', () => {
    const dev = buildCsp({ isDev: true, enforce: false })
    const prod = buildCsp({ isDev: false, enforce: false })
    expect(dev.policy).toContain("style-src 'self' 'unsafe-inline'")
    expect(prod.policy).toContain("style-src 'self' 'unsafe-inline'")
  })

  it('policy includes default-src self', () => {
    const r = buildCsp({ isDev: false, enforce: true })
    expect(r.policy).toContain("default-src 'self'")
  })

  it('policy includes frame-ancestors none (pairs with X-Frame-Options: DENY)', () => {
    const r = buildCsp({ isDev: false, enforce: true })
    expect(r.policy).toContain("frame-ancestors 'none'")
  })

  it('policy allows Google Fonts (Inter + JetBrains Mono)', () => {
    const r = buildCsp({ isDev: false, enforce: true })
    expect(r.policy).toContain('https://fonts.googleapis.com')
    expect(r.policy).toContain('https://fonts.gstatic.com')
  })

  it('policy allows data: URIs in img-src (small inline UI icons)', () => {
    const r = buildCsp({ isDev: false, enforce: true })
    expect(r.policy).toContain("img-src 'self' data:")
  })

  it('policy locks down base-uri to self (prevents base-href injection)', () => {
    const r = buildCsp({ isDev: false, enforce: true })
    expect(r.policy).toContain("base-uri 'self'")
  })

  it('the policy ends without a trailing semicolon (clean header value)', () => {
    const r = buildCsp({ isDev: false, enforce: true })
    expect(r.policy.endsWith(';')).toBe(false)
  })
})
