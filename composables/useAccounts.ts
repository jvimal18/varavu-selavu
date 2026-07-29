/**
 * Accounts composable — shared state, CRUD wrappers.
 */
export interface Account {
  id: string
  name: string
  type: 'bank' | 'credit_card' | 'cash' | 'digital_wallet' | 'other'
  institution: string | null
  last4: string | null
  openingBalance: number
  creditLimit: number | null
  statementDay: number | null
  dueDay: number | null
  currency: string
  color: string | null
  icon: string | null
  archived: boolean
  createdAt: string
  updatedAt: string
}

export const useAccounts = () => {
  const accounts = useState<Account[]>('accounts', () => [])
  const loading = useState<boolean>('accounts:loading', () => false)

  async function fetchAll() {
    loading.value = true
    try {
      const data = await $fetch<{ accounts: Account[] }>('/api/accounts')
      accounts.value = data.accounts
    } finally {
      loading.value = false
    }
  }

  async function create(input: Partial<Account> & { name: string; type: Account['type']; openingBalance: number }) {
    const { account } = await $fetch<{ account: Account }>('/api/accounts', { method: 'POST', body: input })
    accounts.value = [account, ...accounts.value]
    const { bump } = useDataVersion()
    bump()
    return account
  }

  async function update(id: string, patch: Partial<Account>) {
    const { account } = await $fetch<{ account: Account }>(`/api/accounts/${id}`, { method: 'PATCH', body: patch })
    accounts.value = accounts.value.map((a) => (a.id === id ? account : a))
    const { bump } = useDataVersion()
    bump()
    return account
  }

  async function archive(id: string) {
    await $fetch(`/api/accounts/${id}`, { method: 'DELETE' })
    accounts.value = accounts.value.filter((a) => a.id !== id)
    const { bump } = useDataVersion()
    bump()
  }

  function byId(id: string | null | undefined): Account | undefined {
    if (!id) return undefined
    return accounts.value.find((a) => a.id === id)
  }

  return { accounts, loading, fetchAll, create, update, archive, byId }
}
