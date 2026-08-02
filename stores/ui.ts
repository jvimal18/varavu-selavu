/**
 * UI store — theme + device-level preferences.
 */
import { defineStore } from 'pinia'

export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'ui-theme'

function prefersDark(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export const useUiStore = defineStore('ui', {
  state: () => ({
    theme: 'system' as Theme,
  }),
  getters: {
    effectiveTheme: (state): 'light' | 'dark' => {
      if (state.theme !== 'system') return state.theme
      return prefersDark() ? 'dark' : 'light'
    },
    isDark: (state): boolean => {
      if (state.theme !== 'system') return state.theme === 'dark'
      return prefersDark()
    },
  },
  actions: {
    apply() {
      if (typeof document === 'undefined') return
      const dark = this.effectiveTheme === 'dark'
      document.documentElement.classList.toggle('dark', dark)
    },
    setTheme(theme: Theme) {
      this.theme = theme
      this.apply()
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, theme)
      }
    },
    init() {
      if (typeof window === 'undefined') return
      const saved = window.localStorage.getItem(STORAGE_KEY) as Theme | null
      if (saved) this.theme = saved
      this.apply()
      const mql = window.matchMedia('(prefers-color-scheme: dark)')
      const onChange = () => {
        if (this.theme === 'system') this.apply()
      }
      mql.addEventListener('change', onChange)
    },
  },
})
