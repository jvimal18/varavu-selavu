/**
 * Transactions composable — list with filters, CRUD.
 */
export interface Transaction {
  id: string
  type: 'expense' | 'income' | 'transfer' | 'interest'
  amount: number
  date: string
  accountId: string
  toAccountId: string | null
  categoryId: string | null
  description: string | null
  notes: string | null
  spentBy: string
  createdAt: string
  updatedAt: string
}

export interface TransactionFilters {
  from?: string
  to?: string
  accountId?: string
  categoryId?: string
  spentBy?: string
  type?: 'expense' | 'income' | 'transfer' | 'interest'
  q?: string
  limit?: number
  offset?: number
}

export const useTransactions = () => {
  const transactions = useState<Transaction[]>('transactions', () => [])
  const loading = useState<boolean>('transactions:loading', () => false)

  async function fetchAll(filters: TransactionFilters = {}) {
    loading.value = true
    try {
      const data = await $fetch<{ transactions: Transaction[] }>('/api/transactions', { query: filters })
      transactions.value = data.transactions
      return data.transactions
    } finally {
      loading.value = false
    }
  }

  async function create(input: {
    type: 'expense' | 'income' | 'transfer' | 'interest'
    amount: number
    accountId: string
    toAccountId?: string
    categoryId?: string
    description?: string
    notes?: string
    spentBy?: string
    date?: string
  }) {
    const { transaction } = await $fetch<{ transaction: Transaction }>('/api/transactions', { method: 'POST', body: input })
    transactions.value = [transaction, ...transactions.value]
    // Bump shared version so pages that filtered this out still refresh
    const { bump } = useDataVersion()
    bump()
    return transaction
  }

  async function update(id: string, patch: Partial<Transaction>) {
    const { transaction } = await $fetch<{ transaction: Transaction }>(`/api/transactions/${id}`, { method: 'PATCH', body: patch })
    transactions.value = transactions.value.map((t) => (t.id === id ? transaction : t))
    const { bump } = useDataVersion()
    bump()
    return transaction
  }

  async function remove(id: string) {
    await $fetch(`/api/transactions/${id}`, { method: 'DELETE' })
    transactions.value = transactions.value.filter((t) => t.id !== id)
    const { bump } = useDataVersion()
    bump()
  }

  function byId(id: string | null | undefined): Transaction | undefined {
    if (!id) return undefined
    return transactions.value.find((t) => t.id === id)
  }

  return { transactions, loading, fetchAll, create, update, remove, byId }
}
