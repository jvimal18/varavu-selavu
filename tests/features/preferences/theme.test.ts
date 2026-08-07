/**
 * Theme preference (`stores/ui.ts`).
 *
 * Theme is a DEVICE-level preference, deliberately independent of user
 * login state: it is persisted to `localStorage['ui-theme']`, re-applied on
 * reload, and deliberately NOT cleared on logout (the auth store's logout
 * hard-navigates to /login and touches nothing but its own session state).
 *
 * These are store-level tests over a real Pinia instance with a minimal
 * `window` / `document` / `matchMedia` stub, so they run in the node
 * environment without a DOM harness.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUiStore } from '~~/stores/ui'
import { useAuthStore } from '~~/stores/auth'

// ---- Minimal DOM stub ------------------------------------------------------

interface DomStub {
  storage: Map<string, string>
  classToggles: Array<{ cls: string; force: boolean }>
}

/**
 * A hand-rolled window/document for the store's browser touch points:
 * `localStorage`, `matchMedia`, `document.documentElement.classList`, and
 * `location` (used by the auth store's logout navigation).
 */
function stubDom(prefersDark = false): DomStub {
  const storage = new Map<string, string>()
  const classToggles: Array<{ cls: string; force: boolean }> = []

  const documentStub = {
    documentElement: {
      classList: {
        toggle(cls: string, force: boolean) {
          classToggles.push({ cls, force })
        },
      },
    },
  }
  const windowStub = {
    location: { href: 'http://localhost:3000/' },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
    },
    matchMedia: () => ({
      matches: prefersDark,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  }

  vi.stubGlobal('document', documentStub)
  vi.stubGlobal('window', windowStub)
  return { storage, classToggles }
}

// ---- Theme behavior --------------------------------------------------------

describe('theme preference', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.unstubAllGlobals()
  })

  it('defaults to theme system so the device preference rules until the user chooses', () => {
    stubDom(false)
    const ui = useUiStore()

    expect(ui.theme, 'a hardcoded default theme would ignore the device preference').toBe('system')
  })

  it('follows prefers-color-scheme while theme is system', () => {
    stubDom(true)
    const ui = useUiStore()

    expect(ui.effectiveTheme, 'effectiveTheme under system must track the media query').toBe('dark')
    expect(ui.isDark, 'isDark under system must track the media query').toBe(true)
  })

  it('persists setTheme("dark") to localStorage and applies the dark class to <html>', () => {
    const { storage, classToggles } = stubDom(false)
    const ui = useUiStore()

    ui.setTheme('dark')

    expect(ui.theme, 'setTheme must update the store state').toBe('dark')
    expect(storage.get('ui-theme'), 'the explicit choice must be persisted so it survives reload').toBe('dark')
    expect(
      classToggles,
      'applying dark must toggle the dark class on documentElement so Tailwind dark: variants activate',
    ).toContainEqual({ cls: 'dark', force: true })
  })

  it('keeps the device-level theme across logout and reload, because theme is not user data', async () => {
    const { storage } = stubDom(false)
    const ui = useUiStore()
    ui.setTheme('dark')

    vi.stubGlobal('$fetch', vi.fn(async () => undefined))
    const auth = useAuthStore()
    await auth.logout()

    expect(storage.get('ui-theme'), 'logout must not wipe the persisted device theme').toBe('dark')
    expect(ui.theme, 'logout must not reset the in-memory theme choice').toBe('dark')

    // A fresh page load (new Pinia instance) re-reads the persisted choice.
    setActivePinia(createPinia())
    const reloaded = useUiStore()
    reloaded.init()

    expect(reloaded.theme, 'a reload must re-apply the persisted theme instead of falling back to system').toBe('dark')
  })
})
