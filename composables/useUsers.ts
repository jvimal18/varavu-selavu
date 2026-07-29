/**
 * Users composable — for "spent by" filters and switcher.
 * Auth current user is in stores/auth.ts.
 */
export interface PublicUser { id: string; name: string; color: string }

export const useUsers = () => {
  const users = useState<PublicUser[]>('users', () => [])

  async function fetchAll() {
    if (users.value.length > 0) return
    const data = await $fetch<{ users: PublicUser[] }>('/api/users')
    users.value = data.users
  }

  function byId(id: string | null | undefined): PublicUser | undefined {
    if (!id) return undefined
    return users.value.find((u) => u.id === id)
  }

  return { users, fetchAll, byId }
}
