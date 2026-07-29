/**
 * Global client-side route guard.
 * - If not authenticated, redirect to /login (except /login and /setup-pin).
 * - If authenticated but visiting /login, redirect to /.
 */
import { useAuthStore } from '~/stores/auth'

export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useAuthStore()
  // Always fetch the latest user on navigation
  if (auth.user === null) {
    await auth.fetchMe()
  }

  const isPublic = to.path === '/login' || to.path === '/setup-pin'

  if (!auth.isAuthenticated && !isPublic) {
    return navigateTo('/login')
  }
  if (auth.isAuthenticated && to.path === '/login') {
    return navigateTo('/')
  }
})
