/**
 * Tests for `server/utils/csrf.ts`.
 *
 * The CSRF middleware (`server/middleware/00.csrf.ts`) is glue: it
 * calls `parseAllowedOrigins()` on the runtime config, then
 * `isOriginAllowed()` on the request's Origin header. These two
 * pure functions are the actual logic — the middleware just wires
 * them to h3. Test the logic here.
 */
import { describe, it, expect } from 'vitest'
import { parseAllowedOrigins, isOriginAllowed } from '~~/server/utils/csrf'

describe('parseAllowedOrigins', () => {
  it('parses a single origin', () => {
    expect(parseAllowedOrigins('https://a.com')).toEqual(['https://a.com'])
  })

  it('parses comma-separated origins', () => {
    expect(parseAllowedOrigins('https://a.com,https://b.com,https://c.com'))
      .toEqual(['https://a.com', 'https://b.com', 'https://c.com'])
  })

  it('trims whitespace around each origin', () => {
    expect(parseAllowedOrigins(' https://a.com ,   https://b.com  '))
      .toEqual(['https://a.com', 'https://b.com'])
  })

  it('drops empty entries from double commas', () => {
    expect(parseAllowedOrigins('https://a.com,,https://b.com,'))
      .toEqual(['https://a.com', 'https://b.com'])
  })

  it('returns [] for null', () => {
    expect(parseAllowedOrigins(null)).toEqual([])
  })

  it('returns [] for undefined', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([])
  })

  it('returns [] for empty string', () => {
    expect(parseAllowedOrigins('')).toEqual([])
  })

  it('returns [] for a string that is only whitespace and commas', () => {
    expect(parseAllowedOrigins('  ,  ,  ')).toEqual([])
  })
})

describe('isOriginAllowed', () => {
  const allowed = ['https://a.com', 'https://b.com', 'http://localhost:3000']

  it('rejects when Origin is missing', () => {
    const r = isOriginAllowed(undefined, allowed)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Missing Origin/i)
  })

  it('rejects when Origin is null', () => {
    const r = isOriginAllowed(null, allowed)
    expect(r.ok).toBe(false)
  })

  it('rejects when the allowlist is empty (misconfiguration)', () => {
    const r = isOriginAllowed('https://a.com', [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/No origins configured/i)
  })

  it('rejects an origin not in the allowlist', () => {
    const r = isOriginAllowed('https://evil.com', allowed)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('evil.com')
  })

  it('rejects a partial match (no subdomain trickery)', () => {
    // https://a.com.evil.com must NOT match https://a.com
    const r = isOriginAllowed('https://a.com.evil.com', ['https://a.com'])
    expect(r.ok).toBe(false)
  })

  it('accepts an origin exactly in the allowlist', () => {
    const r = isOriginAllowed('https://a.com', allowed)
    expect(r.ok).toBe(true)
  })

  it('is case-sensitive (origins are normalized by the browser; this is defense-in-depth)', () => {
    const r = isOriginAllowed('https://A.com', ['https://a.com'])
    expect(r.ok).toBe(false)
  })

  it('does not strip the path (full Origin string must match exactly)', () => {
    // Browsers never include the path in Origin, but if a malformed client
    // did, we should not silently allow it.
    const r = isOriginAllowed('https://a.com/login', ['https://a.com'])
    expect(r.ok).toBe(false)
  })

  it('treats http and https as distinct', () => {
    const r = isOriginAllowed('http://a.com', ['https://a.com'])
    expect(r.ok).toBe(false)
  })
})
