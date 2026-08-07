/**
 * PWA update prompt (`components/PwaUpdatePrompt.vue` + `composables/useAppUpdate.ts`).
 *
 * Coverage strategy:
 *
 * 1. The version-discovery contract (`useAppUpdate.fetchUpdate`) is pure
 *    enough to exercise directly: it must fetch `/version.json` with
 *    `cache: 'no-store'` + no-cache headers (so the OLD app shell never
 *    reads a precached copy), treat a differing version as the available
 *    update, and clear the update when versions match. Nuxt auto-imports
 *    (`useState`, `readonly`, `$fetch`) are stubbed on `globalThis` before
 *    the composable is exercised.
 *
 * 2. The toast state machine (shown only when `$pwa.needRefresh`, renders
 *    version + first two bullets, Escape dismissal) requires mounting
 *    `PwaUpdatePrompt.vue` with `@vue/test-utils` under a DOM environment.
 *    That harness is NOT installed and cannot be added by this lane, so
 *    those scenarios are declared as skipped suites with the exact assertion
 *    each will make (documented gap, per tests/README.md browser-test
 *    policy).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_VERSION } from '~~/composables/useAppVersion'
import { useAppUpdate, type VersionInfo } from '~~/composables/useAppUpdate'

/**
 * Gate for the mount-based suites. Flip to `true` together with adding
 * `@vue/test-utils` + a DOM environment to the dependency set.
 */
const MOUNT_HARNESS_AVAILABLE = false

// ---- Minimal Nuxt auto-import environment ---------------------------------

/**
 * `useAppUpdate` calls the Nuxt auto-imports `useState`, `readonly` and
 * `$fetch` as globals. In the vitest node environment they are undefined,
 * so each test installs minimal working stubs before calling the composable.
 */
function stubNuxtGlobals(): void {
  const state = new Map<string, { value: unknown }>()
  vi.stubGlobal('useState', (key: string, init?: unknown) => {
    if (!state.has(key)) {
      state.set(key, { value: typeof init === 'function' ? (init as () => unknown)() : init })
    }
    return state.get(key)
  })
  vi.stubGlobal('readonly', (value: unknown) => value)
}

// ---- Version discovery contract (runnable today) ---------------------------

describe('useAppUpdate version discovery', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    stubNuxtGlobals()
  })

  it('fetches /version.json with cache no-store and no-cache headers so the old shell never reads a stale precached copy', async () => {
    const fetchSpy = vi.fn(async (_url: string, _options?: { headers?: Record<string, string> }) => ({
      version: APP_VERSION,
      date: '2026-08-07',
      bullets: [],
    }))
    vi.stubGlobal('$fetch', fetchSpy)

    const { fetchUpdate } = useAppUpdate()
    await fetchUpdate()

    expect(fetchSpy, 'fetchUpdate must hit the network for /version.json').toHaveBeenCalledWith(
      '/version.json',
      expect.objectContaining({ cache: 'no-store' }),
    )
    const requestOptions = fetchSpy.mock.calls[0]?.[1]
    expect(requestOptions?.headers, 'no-store must be paired with explicit no-cache request headers').toEqual({
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    })
  })

  it('treats a /version.json that differs from APP_VERSION as the available update', async () => {
    const newer: VersionInfo = { version: 'v9.9.9', date: '2099-01-01', bullets: ['First bullet', 'Second bullet'] }
    vi.stubGlobal('$fetch', vi.fn(async () => newer))

    const { availableUpdate, fetchUpdate } = useAppUpdate()
    await fetchUpdate()

    expect(availableUpdate.value?.version, 'a newer deployed version must surface to the toast').toBe('v9.9.9')
    expect(availableUpdate.value?.bullets, 'the toast renders the fetched release bullets').toEqual(['First bullet', 'Second bullet'])
  })

  it('clears the available update when /version.json matches APP_VERSION', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({ version: APP_VERSION, date: '2026-08-07', bullets: ['same version'] })))

    const { availableUpdate, fetchUpdate } = useAppUpdate()
    await fetchUpdate()

    expect(availableUpdate.value, 'an up-to-date shell must not show an update prompt').toBeNull()
  })

  it('keeps availableUpdate null and records the failure when the version fetch errors', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => { throw new Error('network down') }))

    const { availableUpdate, error, fetchUpdate } = useAppUpdate()
    await fetchUpdate()

    expect(availableUpdate.value, 'a failed metadata fetch must not fabricate an update').toBeNull()
    expect(error.value, 'the failure must be recorded for diagnostics').toBe('network down')
  })
})

// ---- Toast state machine (mount-gated, documented gap) ---------------------

/**
 * The toast behavior depends on the `$pwa` plugin (via `useNuxtApp`) and
 * on `useEventListener(document, ...)`, which requires a DOM and mounting
 * the component. Each test title names the production break it will catch;
 * the body documents the exact mounted assertion.
 */
describe.skipIf(!MOUNT_HARNESS_AVAILABLE)('PwaUpdatePrompt toast behavior (mounted UI)', () => {
  it.skip('[14] hides the toast when $pwa.needRefresh is false', () => {
    // Mount PwaUpdatePrompt with $pwa stub { needRefresh: false } and
    // useAppUpdate stubbed to a no-op. Assert the role="alert" wrapper is
    // not rendered — a regression would nag users on every page load.
  })

  it.skip('[15] shows the availableUpdate.version plus the first two bullets when an update is waiting', () => {
    // Mount with $pwa.needRefresh = true and availableUpdate =
    // { version: 'v9.9.9', bullets: ['b1 **bold**', 'b2 `code`', 'b3'] }.
    // Assert the toast renders v9.9.9 and exactly b1 + b2 with inline
    // markdown stripped (plainTextBullet) and never b3 — a regression would
    // leak markdown asterisks or render the whole list.
  })

  it.skip('[16] dismisses on Escape and clears the available update', () => {
    // Mount with the toast visible, dispatch a keydown Escape on document,
    // assert $pwa.cancelPrompt was called and the available update is
    // cleared (toast unmounts) — a regression would leave the prompt
    // stubbornly on screen.
  })
})
