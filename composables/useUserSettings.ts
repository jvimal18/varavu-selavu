/**
 * Per-user settings composable — shared state (cached across components via
 * useState), lazy fetch on first call, optimistic set helpers.
 *
 * Settings are "not yet loaded" until the first fetch resolves; both fields
 * then read as null.
 */
export interface UserSettings {
  primaryAccountId: string | null
  monthlyBudgetPaise: number | null
}

export const useUserSettings = () => {
  const settings = useState<UserSettings>('user-settings', () => ({ primaryAccountId: null, monthlyBudgetPaise: null }))
  const pending = useState<boolean>('user-settings:pending', () => false)
  const error = useState<unknown>('user-settings:error', () => null)
  const fetched = useState<boolean>('user-settings:fetched', () => false)

  async function refresh(): Promise<void> {
    pending.value = true
    try {
      const data = await $fetch<UserSettings>('/api/user-settings')
      settings.value = data
      fetched.value = true
    } catch (e) {
      // Store a serializable string; devalue (Nuxt SSR payload serializer)
      // cannot stringify raw Error/FetchError objects.
      error.value = e instanceof Error ? e.message : 'Failed to load settings'
    } finally {
      pending.value = false
    }
  }

  async function setPrimaryAccount(id: string | null): Promise<void> {
    const data = await $fetch<UserSettings>('/api/user-settings', {
      method: 'PUT',
      body: { primaryAccountId: id },
    })
    // Optimistic update, then reconcile with the authoritative response.
    settings.value = { ...settings.value, ...data }
    await refresh()
  }

  async function setMonthlyBudget(paise: number | null): Promise<void> {
    const data = await $fetch<UserSettings>('/api/user-settings', {
      method: 'PUT',
      body: { monthlyBudgetPaise: paise },
    })
    settings.value = { ...settings.value, ...data }
    await refresh()
  }

  // Client-only fetch: SSR's internal $fetch to /api/user-settings 401s
  // (auth cookie isn't forwarded on server-to-self requests), and storing
  // the FetchError would crash SSR payload serialization. The settings
  // aren't needed for SSR rendering; the client fetches after hydration.
  if (import.meta.client && !fetched.value) {
    refresh()
  }

  return { settings, pending, error, refresh, setPrimaryAccount, setMonthlyBudget }
}
