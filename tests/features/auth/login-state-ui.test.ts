/**
 * Login UI state machine (`pages/login.vue` + `stores/auth.ts`).
 *
 * Coverage strategy — two layers:
 *
 * 1. Store-level contracts that the page drives (`stores/auth.ts`):
 *    the login error envelope (`e.data.message`, never the HTTP reason),
 *    the nested 429 `data.data.retryAfter`, the authenticated-session
 *    state, and the hard-reload logout. These run here and now with only
 *    the installed toolchain (vitest + pinia, node environment).
 *
 * 2. Page-level state machine (mount-time `/api/auth/users` fetch +
 *    auto-select, no-PIN setup routing, the cooldown countdown ticking to
 *    zero and re-enabling the input, user-switch reset) requires mounting
 *    `pages/login.vue` with `@vue/test-utils` under a DOM environment.
 *    That harness is NOT installed (`@vue/test-utils`, `happy-dom` and
 *    `jsdom` are absent from the dependency set, and this lane must not
 *    touch package.json or vitest.config.ts). Those scenarios are declared
 *    as skipped suites below — each with the exact assertion it will make —
 *    so they stay visible in the matrix instead of silently vanishing.
 *
 * Every assertion carries a name-the-break message per tests/README.md.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore, type SessionUser } from '~~/stores/auth'

/**
 * Gate for the mount-based suites. Flip to `true` together with adding
 * `@vue/test-utils` + a DOM environment to the dependency set.
 */
const MOUNT_HARNESS_AVAILABLE = false

// ---- Helpers ---------------------------------------------------------------

const VIMAL: SessionUser = { id: 'u_vimal', name: 'Vimal', color: '#C2410C', hasPin: true }

/**
 * The server error envelope `login.post.ts` produces via `createError`:
 * `{ statusCode, statusMessage, message, data?: { retryAfter } }`. ofetch
 * attaches the parsed body to the thrown error's `data`, and the store
 * deliberately reads `e.data.message` / `e.data.data.retryAfter` — never
 * `e.statusMessage` / `e.message`.
 */
function ofetchError(envelope: {
  statusCode: number
  statusMessage: string
  message: string
  data?: { retryAfter?: number }
}): Error {
  const err = new Error('ofetch request failed') as Error & { data?: unknown }
  err.data = envelope
  return err
}

// ---- Store-level contracts (runnable today) -------------------------------

describe('auth store login/logout contracts', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.unstubAllGlobals()
  })

  it('stores the authenticated user and returns ok for a successful PIN login', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({
      user: { id: VIMAL.id, name: VIMAL.name, color: VIMAL.color },
    })))
    const auth = useAuthStore()

    const result = await auth.login('u_vimal', '1234')

    expect(result.ok, 'a successful login regression would not return ok: true').toBe(true)
    expect(auth.user?.id, 'the store must hold the authenticated user after a successful login').toBe('u_vimal')
    expect(auth.user?.hasPin, 'a successful login must set hasPin so the UI stops offering PIN setup').toBe(true)
    expect(auth.loading, 'the store must clear the loading flag when login settles').toBe(false)
  })

  it('surfaces the user-facing message from the error envelope, not the HTTP status reason', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => {
      throw ofetchError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
        message: 'Incorrect PIN. Please try again.',
      })
    }))
    const auth = useAuthStore()

    const result = await auth.login('u_vimal', '0000')
    expect(result.ok, 'a wrong-PIN login regression would not return ok: false').toBe(false)
    expect(result.error, 'the page must show e.data.message, never the "Unauthorized" reason phrase').toBe('Incorrect PIN. Please try again.')
    expect(result.retryAfter, 'a plain 401 must not carry a retryAfter').toBeUndefined()
    expect(auth.user, 'a failed login must not leave a session user behind').toBeNull()
    expect(auth.loading, 'the store must clear the loading flag after a failed login').toBe(false)
  })

  it('parses the nested retryAfter from a 429 login so the page can start its cooldown', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => {
      throw ofetchError({
        statusCode: 429,
        statusMessage: 'Too Many Requests',
        message: 'Too many failed attempts. Try again later.',
        data: { retryAfter: 300 },
      })
    }))
    const auth = useAuthStore()

    const result = await auth.login('u_vimal', '0000')
    expect(result.ok, 'a rate-limited login regression would not return ok: false').toBe(false)
    expect(result.retryAfter, 'the page countdown can only start from the nested data.data.retryAfter').toBe(300)
    expect(result.error, 'a 429 must still surface the human-readable message').toBe('Too many failed attempts. Try again later.')
  })

  it('logs out by hard-navigating to /login so every useState and Pinia store resets in one step', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => undefined))
    const windowStub = { location: { href: 'http://localhost:3000/' } }
    vi.stubGlobal('window', windowStub)
    const auth = useAuthStore()
    auth.user = { ...VIMAL }

    await auth.logout()

    expect(auth.user, 'logout must clear the session user').toBeNull()
    expect(windowStub.location.href, 'logout must hard-reload to /login rather than only resetting the store (no $reset())').toBe('/login')
  })
})

// ---- Page-level state machine (mount-gated, documented gap) ----------------

/**
 * The scenarios below are the pure page-state-machine transitions. They are
 * skipped because mounting `pages/login.vue` needs `@vue/test-utils` + a
 * DOM environment that is not installed and cannot be added by this lane.
 * Each test title names the production break it will catch; the body
 * documents the exact mount-based assertion.
 */
describe.skipIf(!MOUNT_HARNESS_AVAILABLE)('login page state machine (mounted UI)', () => {
  it.skip('[7] on mount, fetches /api/auth/users, shows both seeded users, and auto-selects the first', () => {
    // Mount pages/login.vue with $fetch stubbed to resolve
    //   { users: [{ id: 'u_vimal', ... }, { id: 'u_pavithra', ... }] }.
    // Assert both user names render and the first user (u_vimal) is selected
    // — i.e. a regression that stops auto-selecting or drops a user would
    // leave the PIN pad unbound.
  })

  it.skip('[8] routes a selected user without a PIN to /setup-pin?userId=<id> on submit', () => {
    // Stub /api/auth/users with a hasPin:false user first; press submit.
    // Assert navigateTo was called with { path: '/setup-pin', query: { userId } }
    // — a regression would attempt a PIN login against a user who has no PIN.
  })

  it.skip('[11-page] the 429 cooldown ticks down to 0, clears the error, and re-enables the input', () => {
    // Drive a 429 login (retryAfter: 2), advance the useIntervalFn ticker,
    // assert the submit/numpad disable until 0 and that the error clears —
    // a regression would leave the form locked forever.
  })

  it.skip('[12] switching users clears the PIN input and any shown error', () => {
    // Enter a wrong PIN (error shown), click the other user button, assert
    // pin is empty and error is null — a regression would leak the previous
    // user's PIN state into the next attempt.
  })
})
