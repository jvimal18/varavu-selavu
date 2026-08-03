/**
 * Pinia auth store — current user, login/logout actions.
 */
import { defineStore } from 'pinia'

export interface SessionUser {
  id: string
  name: string
  color: string
  hasPin: boolean
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as SessionUser | null,
    loading: false as boolean,
  }),
  getters: {
    isAuthenticated: (state) => !!state.user,
    initial: (state) => state.user?.name?.[0]?.toUpperCase() || '?',
  },
  actions: {
    async fetchMe() {
      try {
        // On SSR, $fetch doesn't auto-forward cookies — use useRequestHeaders to pass them
        const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
        const data = await $fetch<{ user: SessionUser | null }>('/api/auth/me', { headers })
        this.user = data.user
      } catch {
        this.user = null
      }
    },
    async login(userId: string, pin: string) {
      this.loading = true
      try {
        const data = await $fetch<{ user: SessionUser }>('/api/auth/login', {
          method: 'POST',
          body: { userId, pin },
        })
        this.user = { ...data.user, hasPin: true }
        return { ok: true as const }
      } catch (e: any) {
        // Server response body shape (from createError in login.post.ts):
        //   { statusCode, statusMessage, message, data?: { retryAfter } }
        // ofetch attaches the parsed body to `e.data`, so the user-friendly
        // text lives at e.data.message and the lockout seconds at
        // e.data.data.retryAfter. We deliberately avoid e.statusMessage
        // and e.message because they expose the internal URL/method or
        // get overridden by intermediaries with the standard reason phrase.
        const message = e?.data?.message
        const retryAfter = Number(e?.data?.data?.retryAfter)
        return {
          ok: false as const,
          error: typeof message === 'string' && message.length > 0
            ? message
            : 'Login failed. Please try again.',
          retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
        }
      } finally {
        this.loading = false
      }
    },
    async setupPin(userId: string, pin: string, currentPin?: string) {
      this.loading = true
      try {
        const data = await $fetch<{ user: SessionUser }>('/api/auth/setup-pin', {
          method: 'POST',
          body: { userId, pin, currentPin },
        })
        this.user = { ...data.user, hasPin: true }
        return { ok: true as const }
      } catch (e: any) {
        return { ok: false as const, error: e?.statusMessage || e?.message || 'Setup failed' }
      } finally {
        this.loading = false
      }
    },
    async logout() {
      await $fetch('/api/auth/logout', { method: 'POST' })
      this.user = null
      await navigateTo('/login')
    },
  },
})
