/**
 * Login UI state machine (`pages/login.vue` + `stores/auth.ts`).
 *
 * Coverage strategy — two layers:
 *
 * 1. Store-level contracts that the page drives (`stores/auth.ts`):
 *    the login error envelope (`e.data.message`, never the HTTP reason),
 *    the nested 429 `data.data.retryAfter`, the authenticated-session
 *    state, and the hard-reload logout.
 *
 * 2. Page-level state machine (mount-time `/api/auth/users` fetch +
 *    auto-select, no-PIN setup routing, the cooldown countdown ticking to
 *    zero and re-enabling the input, user-switch reset) by mounting the
 *    REAL `pages/login.vue` under happy-dom. vitest.config.ts registers no
 *    `@vitejs/plugin-vue` (config changes are out of scope), so the SFC is
 *    compiled at test time with `vue/compiler-sfc` and mounted via
 *    `@vue/test-utils` — see `compileSfc` below.
 *
 * Every assertion carries a name-the-break message per tests/README.md.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore, type SessionUser } from '~~/stores/auth'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { parse, compileScript } from 'vue/compiler-sfc'
import type { Component } from 'vue'

// @vitest-environment happy-dom

/**
 * Gate for the mount-based suites. Requires `@vue/test-utils` + a DOM
 * environment (both installed) and the Nuxt app context (stubbed below).
 */
const MOUNT_HARNESS_AVAILABLE = true

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

// ---- Mount machinery (real SFC, no vitest plugin) --------------------------

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const VIMAL_USER = { id: 'u_vimal', name: 'Vimal', color: '#C2410C', hasPin: true }
const PAVITHRA_USER = { id: 'u_pavithra', name: 'Pavithra', color: '#B45309', hasPin: true }
const PAVITHRA_NO_PIN = { id: 'u_pavithra', name: 'Pavithra', color: '#B45309', hasPin: false }

const navigateToMock = vi.fn()

/**
 * Mount the REAL `pages/login.vue` by compiling it with `@vue/compiler-sfc`
 * at test time.
 *
 * vitest.config.ts registers no `@vitejs/plugin-vue`, so `import
 * '~/pages/login.vue'` dies in the transform step (config changes are out of
 * scope for this lane). `vue/compiler-sfc` is a first-class `vue` export; we
 * parse the actual page source, compile its `<script setup>` + template
 * (`inlineTemplate` folds the render into the component), write the result to
 * a transient `.ts` file under the repo root, and dynamic-import it through
 * Vite's pipeline (which strips the TS `interface`, resolves `~` aliases and
 * node_modules, and leaves Nuxt auto-imports like `$fetch` / `navigateTo` /
 * `definePageMeta` as free globals we stub below).
 */
let sfcTempDirs: string[] = []

async function compileSfc(relativePath: string, id: string): Promise<Component> {
  const source = readFileSync(resolve(ROOT, relativePath), 'utf8')
  const { descriptor, errors } = parse(source, { filename: relativePath })
  if (errors.length > 0) throw errors[0]
  const { content } = compileScript(descriptor, {
    id,
    inlineTemplate: true,
    templateOptions: { compilerOptions: {} },
  })
  const dir = mkdtempSync(join(ROOT, '.tmp-sfc-'))
  sfcTempDirs.push(dir)
  const out = join(dir, `${basename(relativePath, '.vue')}.ts`)
  writeFileSync(out, content)
  const mod = (await import(out)) as { default: Component }
  return mod.default
}

interface PublicUserStub { id: string; name: string; color: string; hasPin: boolean }

interface MountLoginOptions {
  users?: PublicUserStub[]
  /** Full `$fetch` replacement; defaults to resolving the users list. */
  fetch?: (url: string) => unknown
}

/** Mount login.vue with a fresh Pinia and the Nuxt auto-import stubs. */
async function mountLoginPage(
  options: MountLoginOptions = {},
): Promise<{ wrapper: VueWrapper; fetchMock: ReturnType<typeof vi.fn> }> {
  setActivePinia(createPinia())
  const fetchImpl = options.fetch ?? (() => ({ users: options.users ?? [VIMAL_USER, PAVITHRA_USER] }))
  const fetchMock = vi.fn(fetchImpl)
  vi.stubGlobal('$fetch', fetchMock)
  vi.stubGlobal('navigateTo', navigateToMock)
  vi.stubGlobal('definePageMeta', vi.fn())
  const wrapper = mount(loginPageComponent)
  await flushPromises()
  return { wrapper, fetchMock }
}

/** Click a numpad digit button (the digit keys render as bare text). */
async function pressDigit(wrapper: VueWrapper, digit: string): Promise<void> {
  const key = wrapper.findAll('button').find((b) => b.text() === digit)
  expect(key, `the numpad must render a ${digit} key for PIN entry`).toBeDefined()
  await key?.trigger('click')
}

/** Count the filled PIN dots (the page renders the PIN as 6 dots). */
function filledPinDots(wrapper: VueWrapper): number {
  return wrapper.findAll('div')
    .filter((d) => (d.attributes('class') ?? '').includes('w-3.5'))
    .filter((d) => (d.attributes('class') ?? '').includes('bg-terra-700')).length
}

let loginPageComponent!: Component

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

// ---- Page-level state machine (mounted UI) ---------------------------------

describe.skipIf(!MOUNT_HARNESS_AVAILABLE)('login page state machine (mounted UI)', () => {
  beforeAll(async () => {
    loginPageComponent = await compileSfc('pages/login.vue', 'login-page-test')
  })

  afterAll(() => {
    for (const dir of sfcTempDirs) rmSync(dir, { recursive: true, force: true })
    sfcTempDirs = []
  })

  beforeEach(() => {
    vi.unstubAllGlobals()
    navigateToMock.mockClear()
  })

  it('[7] on mount, fetches /api/auth/users, shows both seeded users, and auto-selects the first', async () => {
    const { wrapper, fetchMock } = await mountLoginPage({ users: [VIMAL_USER, PAVITHRA_USER] })

    expect(fetchMock, 'a mount regression would not fetch the user list at all').toHaveBeenCalledWith('/api/auth/users')
    expect(wrapper.text(), 'a user-list regression would stop rendering a seeded household member').toContain('Vimal')
    expect(wrapper.text(), 'a user-list regression would stop rendering a seeded household member').toContain('Pavithra')
    expect(wrapper.text(), 'an auto-select regression would leave the PIN pad unbound (no Enter PIN card)').toContain('Enter PIN')
    const vimalCard = wrapper.findAll('button').find((b) => b.text().includes('Vimal'))
    expect(vimalCard?.classes(), 'an auto-select regression would not mark the first user as selected').toContain('border-terra-700')
  })

  it('[8] routes a selected user without a PIN to /setup-pin?userId=<id> on submit', async () => {
    const { wrapper } = await mountLoginPage({ users: [PAVITHRA_NO_PIN] })

    const submit = wrapper.findAll('button').find((b) => b.text().includes('Set up PIN'))
    expect(submit, 'a no-PIN user must still render a submit action').toBeDefined()
    await submit?.trigger('click')
    await flushPromises()

    expect(navigateToMock,
      'a no-PIN submit regression would attempt a PIN login instead of routing to setup').toHaveBeenCalledWith(
      { path: '/setup-pin', query: { userId: 'u_pavithra' } },
    )
  })

  it('[11-page] the 429 cooldown ticks down to 0, clears the error, and re-enables the input', async () => {
    vi.useFakeTimers()
    try {
      const { wrapper } = await mountLoginPage({
        users: [VIMAL_USER],
        fetch: async (url: string) => {
          if (url === '/api/auth/users') return { users: [VIMAL_USER] }
          throw ofetchError({
            statusCode: 429,
            statusMessage: 'Too Many Requests',
            message: 'Too many failed attempts. Try again later.',
            data: { retryAfter: 2 },
          })
        },
      })

      for (const digit of ['1', '2', '3', '4']) await pressDigit(wrapper, digit)
      await flushPromises()

      const submit = wrapper.findAll('button').find((b) => b.text().includes('Unlock'))
      expect(submit, 'a hasPin user must render an Unlock submit action').toBeDefined()
      await submit?.trigger('click')
      await flushPromises()

      // The 429 sets a 2s cooldown: the form locks with the human error text.
      expect(wrapper.text(), 'a cooldown-start regression would not show the countdown lock').toContain('Locked — retry in 2s')
      expect(wrapper.text(), 'a cooldown-start regression would drop the 429 error text').toContain('Too many failed attempts. Try again later.')

      vi.advanceTimersByTime(1000)
      await flushPromises()
      expect(wrapper.text(), 'a countdown regression would not tick from 2s down to 1s').toContain('Locked — retry in 1s')

      vi.advanceTimersByTime(1000)
      await flushPromises()
      expect(wrapper.text(), 'a countdown regression would keep the error visible after reaching zero').not.toContain('Too many failed attempts. Try again later.')
      expect(wrapper.text(), 'a countdown regression would leave the form locked after reaching zero').toContain('Unlock')
      const digitOne = wrapper.findAll('button').find((b) => b.text() === '1')
      expect(digitOne?.attributes('disabled'),
        'a countdown regression would leave the numpad disabled after reaching zero').toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('[12] switching users clears the PIN input and any shown error', async () => {
    const { wrapper } = await mountLoginPage({
      users: [VIMAL_USER, PAVITHRA_USER],
      fetch: async (url: string) => {
        if (url === '/api/auth/users') return { users: [VIMAL_USER, PAVITHRA_USER] }
        throw ofetchError({
          statusCode: 401,
          statusMessage: 'Unauthorized',
          message: 'Incorrect PIN. Please try again.',
        })
      },
    })

    // Enter a wrong 4-digit PIN and submit.
    for (const digit of ['1', '2', '3', '4']) await pressDigit(wrapper, digit)
    await flushPromises()
    const submit = wrapper.findAll('button').find((b) => b.text().includes('Unlock'))
    await submit?.trigger('click')
    await flushPromises()

    expect(wrapper.text(), 'a failed-login regression would not surface the server error').toContain('Incorrect PIN. Please try again.')

    // Switch to the other user: the previous error must clear and no PIN dots
    // may survive (a regression would leak user A's PIN state into user B).
    const pavithraCard = wrapper.findAll('button').find((b) => b.text().includes('Pavithra'))
    expect(pavithraCard, 'the second user must render a selectable card').toBeDefined()
    await pavithraCard?.trigger('click')
    await flushPromises()

    expect(wrapper.text(), 'a user-switch regression would leak the previous user\'s error').not.toContain('Incorrect PIN. Please try again.')
    expect(filledPinDots(wrapper), 'a user-switch regression would keep the previous user\'s PIN dots').toBe(0)
  })
})
