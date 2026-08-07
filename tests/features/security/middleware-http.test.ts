import { beforeAll, describe, expect, it } from 'vitest'
import { createNuxtTestHarness, type NuxtTestHarness } from '~~/tests/helpers/nuxt-server'

const ALLOWED_ORIGIN = 'http://localhost:3000'
const harness = await createNuxtTestHarness()

type JsonObject = Record<string, unknown>

function jsonHeaders(
  harness: NuxtTestHarness,
  label: string,
  cookie = '',
  origin?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    Cookie: cookie,
    'x-forwarded-for': harness.clientIp(label),
  }
  if (origin !== undefined) headers.Origin = origin
  return headers
}

function requestHeaders(
  harness: NuxtTestHarness,
  label: string,
  cookie = '',
  origin?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Cookie: cookie,
    'x-forwarded-for': harness.clientIp(label),
  }
  if (origin !== undefined) headers.Origin = origin
  return headers
}

async function createSession(harness: NuxtTestHarness): Promise<string> {
  const response = await harness.fetch('/api/auth/setup-pin', {
    method: 'POST',
    headers: jsonHeaders(harness, 'bootstrap-session'),
    body: JSON.stringify({ userId: 'u_vimal', pin: '1234' }),
  })
  expect(response.status, 'PIN bootstrap must create a real session for middleware HTTP coverage').toBe(200)
  return harness.cookieFromResponse(response)
}

async function transactionCount(harness: NuxtTestHarness): Promise<number> {
  const row = harness.inspectDbOne<{ count: number }>('SELECT COUNT(*) AS count FROM transactions')
  return row?.count ?? 0
}

describe('real HTTP CSRF and auth-gate middleware', () => {
  let sessionCookie!: string

  beforeAll(async () => {
    sessionCookie = await createSession(harness)
  })

  it('rejects a missing-Origin write before the transaction handler can change the database', async () => {
    const accountResponse = await harness.fetch('/api/accounts', {
      method: 'POST',
      headers: jsonHeaders(harness, 'csrf-write-account', sessionCookie, ALLOWED_ORIGIN),
      body: JSON.stringify({
        name: 'CSRF coverage account',
        type: 'bank',
        openingBalance: 0,
      }),
    })
    expect(accountResponse.status, 'CSRF write proof needs a valid account created through the allowed origin').toBe(200)
    const accountBody = await accountResponse.json() as { account?: { id?: string } }
    const accountId = accountBody.account?.id
    expect(accountId, 'CSRF write proof must use a real account so the otherwise-valid transaction would succeed').toEqual(expect.any(String))

    const before = await transactionCount(harness)
    const response = await harness.fetch('/api/transactions', {
      method: 'POST',
      headers: jsonHeaders(harness, 'csrf-write-missing-origin', sessionCookie),
      body: JSON.stringify({
        type: 'expense',
        amount: 100,
        date: '2026-08-07',
        accountId,
        categoryId: 'c_groceries',
        description: 'must not be inserted',
      }),
    })
    expect(response.status, 'CSRF middleware must reject missing Origin before a valid transaction reaches the database').toBe(403)
    const afterRejectedWrite = await transactionCount(harness)
    expect(afterRejectedWrite, 'CSRF rejection must leave the protected transaction row count unchanged').toBe(before)

    const allowedResponse = await harness.fetch('/api/transactions', {
      method: 'POST',
      headers: jsonHeaders(harness, 'csrf-write-allowed-origin', sessionCookie, ALLOWED_ORIGIN),
      body: JSON.stringify({
        type: 'expense',
        amount: 100,
        date: '2026-08-07',
        accountId,
        categoryId: 'c_groceries',
        description: 'allowed transaction',
      }),
    })
    expect(allowedResponse.status, 'Exact allowed Origin must let the otherwise-valid transaction write proceed').toBe(200)
    expect(await transactionCount(harness), 'Allowed CSRF origin must permit exactly the intended transaction write').toBe(before + 1)
  })

  it.each([
    ['foreign origin', 'http://evil.example'],
    ['host suffix trick', 'http://localhost:3000.evil.example'],
    ['subdomain trick', 'http://sub.localhost:3000'],
    ['scheme mismatch', 'https://localhost:3000'],
  ])('rejects %s instead of accepting a partial, wildcard, or scheme-mismatched origin', async (label, origin) => {
    const response = await harness.fetch('/api/user-settings', {
      method: 'PUT',
      headers: jsonHeaders(harness, `csrf-foreign-${label}`, sessionCookie, origin),
      body: JSON.stringify({ monthlyBudgetPaise: 12345 }),
    })
    expect(response.status, `CSRF exact matching must reject ${label} before protected state changes`).toBe(403)
  })

  it('passes the exact allowed Origin to the auth gate, producing 401 rather than a false CSRF 403', async () => {
    const response = await harness.fetch('/api/transactions', {
      method: 'POST',
      headers: jsonHeaders(harness, 'csrf-then-auth', '', ALLOWED_ORIGIN),
      body: JSON.stringify({}),
    })
    expect(response.status, 'Exact allowed Origin must pass CSRF so the missing-session auth gate returns 401').toBe(401)
  })

  it.each([
    ['GET', 'GET'],
    ['HEAD', 'HEAD'],
    ['OPTIONS', 'OPTIONS'],
  ])('skips Origin enforcement for %s but still protects the protected path with 401', async (_label, method) => {
    const response = await harness.fetch('/api/dashboard', {
      method,
      headers: requestHeaders(harness, `csrf-safe-${method}`),
    })
    expect(response.status, `${method} must skip CSRF without accidentally bypassing the protected-route auth gate`).toBe(401)
  })

  it('keeps auth bootstrap usable without Origin by exempting POST /api/auth/login from CSRF', async () => {
    const response = await harness.fetch('/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders(harness, 'csrf-login-bootstrap'),
      body: JSON.stringify({ userId: 'u_vimal', pin: '1234' }),
    })
    expect(response.status, 'CSRF must not block cross-origin-capable login bootstrap when Origin is absent').toBe(200)
  })

  it('does not apply API CSRF rules to a non-API page POST', async () => {
    const response = await harness.fetch('/login', {
      method: 'POST',
      headers: requestHeaders(harness, 'csrf-page-post'),
    })
    expect(response.status, 'CSRF middleware must leave non-/api/* page routes unaffected').not.toBe(403)
  })

  const unsafeRoutes = [
    { method: 'POST', path: '/api/transactions', body: {} },
    { method: 'PATCH', path: '/api/transactions/does-not-exist', body: {} },
    { method: 'PUT', path: '/api/user-settings', body: {} },
    { method: 'DELETE', path: '/api/transactions/does-not-exist', body: undefined },
  ] as const
  const rejectedOrigins = [
    ['missing Origin', undefined],
    ['foreign Origin', 'http://evil.example'],
  ] as const

  it.each(unsafeRoutes.flatMap((route) => rejectedOrigins.map(([originLabel, origin]) => ({ route, originLabel, origin }))))(
    'rejects $route.method $originLabel with 403 before any protected handler runs',
    async ({ route, originLabel, origin }) => {
      const init: RequestInit = {
        method: route.method,
        headers: jsonHeaders(harness, `csrf-${route.method}-${originLabel}`, sessionCookie, origin),
      }
      if (route.body !== undefined) init.body = JSON.stringify(route.body)
      const response = await harness.fetch(route.path, init)
      expect(response.status, `${route.method} must reject ${originLabel} before auth or database work`).toBe(403)
    },
  )

  it.each([
    ['valid session', 'valid', 200],
    ['missing session', 'missing', 401],
    ['legacy user-id cookie', 'legacy', 401],
    ['unknown token', 'unknown', 401],
  ] as const)('auth gate handles %s on GET /api/dashboard without a 500', async (label, cookieKind, expectedStatus) => {
    const cookie = cookieKind === 'valid'
      ? sessionCookie
      : cookieKind === 'legacy'
        ? 'vs_session=u_vimal'
        : cookieKind === 'unknown'
          ? `vs_session=${'x'.repeat(43)}`
          : ''
    const response = await harness.fetch('/api/dashboard', {
      headers: requestHeaders(harness, `auth-gate-${label}`, cookie, ALLOWED_ORIGIN),
    })
    expect(response.status, `Auth gate must return ${expectedStatus} for ${label}, not crash while validating the cookie`).toBe(expectedStatus)
  })

  it('leaves GET /api/auth/users public without a session', async () => {
    const response = await harness.fetch('/api/auth/users', {
      headers: requestHeaders(harness, 'auth-public-users'),
    })
    expect(response.status, 'Auth middleware must allow the public auth user-picker endpoint without a session').toBe(200)
  })

  it('returns a null user from GET /api/auth/me without a session', async () => {
    const response = await harness.fetch('/api/auth/me', {
      headers: requestHeaders(harness, 'auth-public-me'),
    })
    expect(response.status, 'Auth middleware must allow the public auth-me endpoint without a session').toBe(200)
    const body = await response.json() as JsonObject
    expect(body, 'Auth-me must report no authenticated user instead of rejecting or throwing').toEqual({ user: null })
  })
})
