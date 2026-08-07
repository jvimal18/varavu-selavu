import { describe, expect, it } from 'vitest'
import { applySecurityHeaders } from '~~/server/utils/security-headers'

describe('shared security-header policy replacement', () => {
  it('replaces lowercase enforcing CSP with canonical report-only CSP', () => {
    const headers: Record<string, string> = { 'content-security-policy': 'old enforcing policy' }
    applySecurityHeaders(headers, { isDev: false, enforce: false })

    expect(headers['Content-Security-Policy-Report-Only'], 'Report-only mode must replace a lowercase stale enforcing CSP header').toContain("default-src 'self'")
    expect(headers['content-security-policy'], 'Report-only mode must remove the lowercase enforcing CSP key').toBeUndefined()
  })

  it('replaces lowercase report-only CSP with canonical enforcing CSP', () => {
    const headers: Record<string, string> = { 'content-security-policy-report-only': 'old report-only policy' }
    applySecurityHeaders(headers, { isDev: false, enforce: true })

    expect(headers['Content-Security-Policy'], 'Enforcing mode must replace a lowercase stale report-only CSP header').toContain("default-src 'self'")
    expect(headers['content-security-policy-report-only'], 'Enforcing mode must remove the lowercase report-only CSP key').toBeUndefined()
  })

  it('replaces lowercase no-referrer with the canonical referrer policy', () => {
    const headers: Record<string, string> = { 'referrer-policy': 'no-referrer' }
    applySecurityHeaders(headers, { isDev: false, enforce: false })

    expect(headers['Referrer-Policy'], 'The shared policy must replace lowercase no-referrer with the promised referrer policy').toBe('strict-origin-when-cross-origin')
    expect(headers['referrer-policy'], 'The shared policy must remove the lowercase stale referrer key').toBeUndefined()
  })

  it('does not leave duplicate logical application-owned header keys', () => {
    const headers: Record<string, string> = {
      'content-security-policy': 'old enforcing policy',
      'CONTENT-SECURITY-POLICY-REPORT-ONLY': 'old report-only policy',
      'referrer-policy': 'no-referrer',
      'X-FRAME-OPTIONS': 'SAMEORIGIN',
    }
    applySecurityHeaders(headers, { isDev: false, enforce: false })
    const normalizedNames = Object.keys(headers).map((name) => name.toLowerCase())

    expect(new Set(normalizedNames).size, 'Applying the policy must not leave duplicate logical header names').toBe(normalizedNames.length)
    expect(headers['Content-Security-Policy'], 'Report-only application must not leave an enforcing CSP key').toBeUndefined()
    expect(headers['Content-Security-Policy-Report-Only'], 'Report-only application must retain one canonical CSP key').toContain("default-src 'self'")
  })
})
