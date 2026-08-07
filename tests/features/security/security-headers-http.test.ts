/**
 * There is no stable application route that deliberately throws an internal
 * error without also testing an unrelated handler invariant. The 500 response
 * header case is therefore documented and skipped below. The 200 case covers
 * normal middleware/plugin handling; 401 and 403 prove the configured Nitro
 * error handler applies the same final policy to early errors.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, exposeContextToEnv, setTestContext } from '@nuxt/test-utils/e2e'
import { buildCsp } from '~~/server/utils/csp'
import { createNuxtTestHarness, type NuxtTestHarness } from '~~/tests/helpers/nuxt-server'

const ALLOWED_ORIGIN = 'http://localhost:3000'
const harness = await createNuxtTestHarness()
exposeContextToEnv()
const reportFetchContext = createTestContext(
  (JSON.parse(process.env.NUXT_TEST_CONTEXT || '{}') as { options: Record<string, unknown> }).options,
)
let enforcingFetchContext: ReturnType<typeof createTestContext> | undefined

// @nuxt/test-utils has one active global context. Register this switch between
// the two harnesses' setup hooks so each built server starts with its own DB
// and runtime configuration. The HTTP tests still use only harness.fetch.
beforeAll(() => {
  if (enforcingFetchContext) setTestContext(enforcingFetchContext)
})

const enforcingHarness = await createNuxtTestHarness({ cspEnforce: true })
exposeContextToEnv()
enforcingFetchContext = createTestContext(
  (JSON.parse(process.env.NUXT_TEST_CONTEXT || '{}') as { options: Record<string, unknown> }).options,
)
setTestContext(reportFetchContext)

function headersFor(harness: NuxtTestHarness, label: string, cookie = '', origin?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Cookie: cookie,
    'x-forwarded-for': harness.clientIp(label),
  }
  if (origin !== undefined) headers.Origin = origin
  return headers
}

function expectedPolicy(enforce: boolean): string {
  // `nuxt test-utils` runs the built Nitro output as a production build, so
  // the HTTP middleware uses the production branch of the policy builder.
  return buildCsp({ isDev: false, enforce }).policy
}

function assertSecurityHeaders(
  response: Response,
  enforce: boolean,
  scenario: string,
): void {
  const cspHeader = enforce ? 'content-security-policy' : 'content-security-policy-report-only'
  const otherCspHeader = enforce ? 'content-security-policy-report-only' : 'content-security-policy'

  expect(response.headers.get('x-content-type-options'), `${scenario} must keep MIME sniffing disabled`).toBe('nosniff')
  expect(response.headers.get('x-frame-options'), `${scenario} must deny framing`).toBe('DENY')
  expect(response.headers.get('referrer-policy'), `${scenario} must keep the privacy referrer policy`).toBe('strict-origin-when-cross-origin')
  expect(response.headers.get('permissions-policy'), `${scenario} must disable unused browser capabilities`).toBe('camera=(), microphone=(), geolocation=(), payment=()')
  expect(response.headers.get('strict-transport-security'), `${scenario} must include the application HSTS protection`).toBe('max-age=31536000; includeSubDomains')
  expect(response.headers.get(cspHeader), `${scenario} must carry the configured CSP header`).toBe(expectedPolicy(enforce))
  expect(response.headers.get(otherCspHeader), `${scenario} must not emit both enforcing and report-only CSP headers`).toBeNull()
}

describe('real HTTP security headers in report-only mode', () => {
  beforeEach(() => {
    setTestContext(reportFetchContext)
  })

  it('sets the complete security header set on a 200 response', async () => {
    const response = await harness.fetch('/api/auth/users', {
      headers: headersFor(harness, 'headers-200'),
    })
    expect(response.status, 'Public auth users must remain a successful HTTP response while headers are added').toBe(200)
    assertSecurityHeaders(response, false, '200 response')
  })

  it('sets the same security headers through the configured Nitro error handler on 401', async () => {
    const response = await harness.fetch('/api/dashboard', {
      headers: headersFor(harness, 'headers-401'),
    })
    expect(response.status, 'Missing session must still produce the auth-gate 401 used to verify error headers').toBe(401)
    expect(response.headers.get('cache-control'), 'Custom Nitro error handling must preserve Nitro\'s non-owned no-cache header while replacing security headers').toBe('no-cache')
    assertSecurityHeaders(response, false, '401 response')
  })

  it('sets the same security headers through the configured Nitro error handler on 403', async () => {
    const response = await harness.fetch('/api/transactions', {
      method: 'POST',
      headers: headersFor(harness, 'headers-403'),
      body: JSON.stringify({}),
    })
    expect(response.status, 'Missing Origin must remain a CSRF 403 used to verify error headers').toBe(403)
    assertSecurityHeaders(response, false, '403 response')
  })

  it('uses Content-Security-Policy-Report-Only by default and emits the real builder policy', async () => {
    const response = await harness.fetch('/api/auth/users', {
      headers: headersFor(harness, 'headers-report-only', '', ALLOWED_ORIGIN),
    })
    const policy = response.headers.get('content-security-policy-report-only')
    expect(policy, 'Default CSP configuration must report violations without breaking the app').toBe(expectedPolicy(false))
    expect(policy, 'The HTTP CSP policy must include the builder-owned default-src self directive').toContain("default-src 'self'")
    expect(response.headers.get('content-security-policy'), 'Report-only mode must not accidentally enforce CSP').toBeNull()
  })

  it.skip('would verify the complete security header set on a 500 response', () => {
    // No production route intentionally throws a clean internal error. Do not
    // synthesize a 500: this skipped case records the remaining HTTP gap.
  })
})

describe('real HTTP security headers in enforcing CSP mode', () => {
  beforeEach(() => {
    if (!enforcingFetchContext) throw new Error('Enforcing Nuxt context was not captured')
    setTestContext(enforcingFetchContext)
  })

  it('uses Content-Security-Policy and not Report-Only when enforcement is enabled', async () => {
    const response = await enforcingHarness.fetch('/api/auth/users', {
      headers: headersFor(enforcingHarness, 'headers-enforce', '', ALLOWED_ORIGIN),
    })
    expect(response.status, 'Enforcing CSP must not change the successful public auth response status').toBe(200)
    assertSecurityHeaders(response, true, 'enforcing 200 response')
    expect(response.headers.get('content-security-policy'), 'Enforcing CSP HTTP policy must include the builder-owned default-src self directive').toContain("default-src 'self'")
  })
})
