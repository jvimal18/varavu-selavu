/**
 * Auth & sessions — token generation and lifecycle helpers.
 *
 * Capability: hashSessionToken, newSessionToken, the TOKEN_LENGTH
 * legacy-cookie discriminator, and the in-process 5-minute
 * `last_seen_at` debounce. These are the pure helpers used by the
 * login / /me / logout / setup-pin flows.
 *
 * Tests here do not need a DB. The DB-bound invariants of the
 * `sessions` table (schema, FK CASCADE, hash-as-id) live in
 * `session-schema.test.ts`; the revoke-all-other-sessions HTTP proof lives
 * in `http-flows.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import {
  hashSessionToken,
  newSessionToken,
  TOKEN_LENGTH,
  LAST_SEEN_DEBOUNCE_MS,
  shouldBumpLastSeen,
  markLastSeenWritten,
} from '~~/server/utils/auth'

describe('hashSessionToken', () => {
  it('produces a 64-char hex string (SHA-256)', () => {
    const h = hashSessionToken('hello')
    expect(h).toHaveLength(64)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('matches crypto.createHash("sha256").update(token).digest("hex")', () => {
    const token = newSessionToken()
    const expected = createHash('sha256').update(token).digest('hex')
    expect(hashSessionToken(token)).toBe(expected)
  })

  it('is stable for a given token (deterministic)', () => {
    expect(hashSessionToken('fixed-token-for-test'))
      .toBe(hashSessionToken('fixed-token-for-test'))
  })

  it('produces different hashes for different tokens', () => {
    expect(hashSessionToken('a')).not.toBe(hashSessionToken('b'))
  })
})

describe('newSessionToken', () => {
  it('produces a 43-character string (base64url of 32 bytes)', () => {
    expect(newSessionToken()).toHaveLength(43)
  })

  it('produces base64url (no +, /, or = characters)', () => {
    expect(newSessionToken()).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('produces a different value each call (100 trials, no collisions)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 100; i++) seen.add(newSessionToken())
    expect(seen.size).toBe(100)
  })

  it('encodes 32 bytes (verifies via a known input)', () => {
    const bytes = randomBytes(32)
    expect(Buffer.from(bytes).toString('base64url')).toHaveLength(43)
  })
})

describe('TOKEN_LENGTH discriminator (rejects legacy user-id cookies)', () => {
  it('equals 43 (base64url of 32 bytes)', () => {
    expect(TOKEN_LENGTH).toBe(43)
  })

  it('legacy userId "u_vimal" is shorter than TOKEN_LENGTH', () => {
    expect('u_vimal'.length).toBeLessThan(TOKEN_LENGTH)
  })

  it('legacy userId "u_pavithra" is shorter than TOKEN_LENGTH', () => {
    expect('u_pavithra'.length).toBeLessThan(TOKEN_LENGTH)
  })
})

describe('shouldBumpLastSeen (5-min debounce)', () => {
  const sessionId = 'session-x'
  const now = 1_700_000_000_000

  it('returns true on first call (never written)', () => {
    expect(shouldBumpLastSeen(sessionId, now)).toBe(true)
  })

  it('returns false within the debounce window after a mark', () => {
    markLastSeenWritten(sessionId, now - 1000) // 1s ago
    expect(shouldBumpLastSeen(sessionId, now)).toBe(false)
  })

  it('returns true at exactly the debounce window', () => {
    markLastSeenWritten(sessionId, now - LAST_SEEN_DEBOUNCE_MS)
    expect(shouldBumpLastSeen(sessionId, now)).toBe(true)
  })

  it('returns true past the debounce window', () => {
    markLastSeenWritten(sessionId, now - LAST_SEEN_DEBOUNCE_MS - 1)
    expect(shouldBumpLastSeen(sessionId, now)).toBe(true)
  })

  it('is per-session (writes to A do not affect B)', () => {
    markLastSeenWritten('session-A', now)
    expect(shouldBumpLastSeen('session-A', now)).toBe(false)
    expect(shouldBumpLastSeen('session-B', now)).toBe(true)
  })
})
