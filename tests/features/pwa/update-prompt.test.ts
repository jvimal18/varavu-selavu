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
 *    version + first two bullets, Escape dismissal) by mounting the REAL
 *    `PwaUpdatePrompt.vue` under happy-dom. vitest.config.ts registers no
 *    `@vitejs/plugin-vue` (config changes are out of scope), so the SFC is
 *    compiled at test time with `vue/compiler-sfc` and mounted via
 *    `@vue/test-utils` with `$pwa` / `useAppUpdate` stubbed — see
 *    `compileSfc` / `mountToast` below.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_VERSION } from '~~/composables/useAppVersion'
import { useAppUpdate, type VersionInfo } from '~~/composables/useAppUpdate'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { parse, compileScript } from 'vue/compiler-sfc'
import { reactive, ref, type Component } from 'vue'

// @vitest-environment happy-dom

/**
 * Gate for the mount-based suites. Requires `@vue/test-utils` + a DOM
 * environment (both installed) and the `$pwa` plugin + `useEventListener`
 * (stubbed below).
 */
const MOUNT_HARNESS_AVAILABLE = true

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

// ---- Mount machinery (real SFC, no vitest plugin) ---------------------------

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

/**
 * Mount the REAL `components/PwaUpdatePrompt.vue` by compiling it with
 * `@vue/compiler-sfc` at test time. vitest.config.ts registers no
 * `@vitejs/plugin-vue`, so `import '~/components/PwaUpdatePrompt.vue'` dies
 * in the transform step (config changes are out of scope for this lane).
 * `vue/compiler-sfc` is a first-class `vue` export; we parse the actual
 * component source, compile its `<script setup>` + template
 * (`inlineTemplate` folds the render in), write the result to a transient
 * `.ts` file under the repo root, and dynamic-import it through Vite's
 * pipeline. Nuxt auto-imports (`useNuxtApp`, `useAppUpdate`) remain free
 * globals and are stubbed per test.
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

interface MountToastOptions {
  /** Drives `$pwa.needRefresh` → the toast's `v-if` gate. */
  needRefresh: boolean
  /** The update `useAppUpdate` hands the toast; null = generic fallback. */
  availableUpdate?: VersionInfo | null
}

/**
 * Mount the toast with a reactive `$pwa` (so `cancelPrompt` flipping
 * `needRefresh` actually hides the toast) and a `useAppUpdate` stub. The
 * Transition + Icon are stubbed so leave-animation timing and the unresolved
 * global component cannot make the assertions flaky.
 */
async function mountToast(options: MountToastOptions): Promise<{
  wrapper: VueWrapper
  cancelPrompt: ReturnType<typeof vi.fn>
  clearAvailableUpdate: ReturnType<typeof vi.fn>
  fetchUpdate: ReturnType<typeof vi.fn>
}> {
  const pwa = reactive<{ needRefresh: boolean }>({ needRefresh: options.needRefresh })
  const cancelPrompt = vi.fn(() => { pwa.needRefresh = false })
  const updateServiceWorker = vi.fn(async () => {})
  pwa.needRefresh = options.needRefresh
  ;(pwa as { cancelPrompt?: () => void }).cancelPrompt = cancelPrompt
  ;(pwa as { updateServiceWorker?: () => Promise<void> }).updateServiceWorker = updateServiceWorker

  const clearAvailableUpdate = vi.fn()
  const fetchUpdate = vi.fn()

  vi.stubGlobal('useNuxtApp', () => ({ $pwa: pwa }))
  vi.stubGlobal('useAppUpdate', () => ({
    availableUpdate: ref(options.availableUpdate ?? null),
    isLoading: ref(false),
    error: ref(null),
    lastChecked: ref(null),
    fetchUpdate,
    clearAvailableUpdate,
  }))
  vi.stubGlobal('navigateTo', vi.fn())

  const wrapper = mount(toastComponent, {
    global: { stubs: { transition: true, Icon: true } },
  })
  await flushPromises()
  return { wrapper, cancelPrompt, clearAvailableUpdate, fetchUpdate }
}

let toastComponent!: Component

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

// ---- Toast state machine (mounted UI) --------------------------------------

describe.skipIf(!MOUNT_HARNESS_AVAILABLE)('PwaUpdatePrompt toast behavior (mounted UI)', () => {
  beforeAll(async () => {
    toastComponent = await compileSfc('components/PwaUpdatePrompt.vue', 'update-prompt-test')
  })

  afterAll(() => {
    for (const dir of sfcTempDirs) rmSync(dir, { recursive: true, force: true })
    sfcTempDirs = []
  })

  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('[14] hides the toast when $pwa.needRefresh is false', async () => {
    const { wrapper } = await mountToast({ needRefresh: false })

    expect(wrapper.find('[role="alert"]').exists(),
      'a toast regression would render the update prompt when no update is waiting').toBe(false)
    wrapper.unmount()
  })

  it('[15] shows the availableUpdate.version plus the first two bullets when an update is waiting', async () => {
    const { wrapper } = await mountToast({
      needRefresh: true,
      availableUpdate: { version: 'v9.9.9', date: '2099-01-01', bullets: ['b1 **bold**', 'b2 `code`', 'b3'] },
    })

    const toast = wrapper.find('[role="alert"]')
    expect(toast.exists(), 'a toast regression would not render the alert when an update is waiting').toBe(true)
    expect(toast.text(), 'a toast regression would not announce the fetched version').toContain('v9.9.9')
    expect(toast.text(), 'a bullet regression would leak markdown asterisks into the toast').toContain('b1 bold')
    expect(toast.text(), 'a bullet regression would leak markdown backticks into the toast').toContain('b2 code')
    expect(toast.text(), 'a bullet regression would render more than the first two bullets').not.toContain('b3')
    expect(toast.text(), 'a bullet regression would leak raw markdown into the toast').not.toContain('**')
    expect(toast.text(), 'a bullet regression would leak raw backticks into the toast').not.toContain('`')
    wrapper.unmount()
  })

  it('[16] dismisses on Escape and clears the available update', async () => {
    const { wrapper, cancelPrompt, clearAvailableUpdate } = await mountToast({
      needRefresh: true,
      availableUpdate: { version: 'v9.9.9', date: '2099-01-01', bullets: ['b1', 'b2'] },
    })

    expect(wrapper.find('[role="alert"]').exists(), 'a precondition regression would start without the toast').toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(cancelPrompt, 'an Escape dismissal regression would not call $pwa.cancelPrompt').toHaveBeenCalled()
    expect(clearAvailableUpdate, 'an Escape dismissal regression would not clear the announced update').toHaveBeenCalled()
    expect(wrapper.find('[role="alert"]').exists(),
      'an Escape dismissal regression would leave the toast on screen').toBe(false)
    wrapper.unmount()
  })
})
