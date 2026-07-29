/**
 * Dashboard composable — aggregates for the dashboard.
 */
export interface DashboardData {
  netWorth: number
  monthIncome: number
  monthExpense: number
  monthSavingsRate: number
  monthBudget: number | null
  topCategories: Array<{ categoryId: string; name: string; color: string; amount: number }>
  recentTransactions: any[]
  accounts: Array<{
    id: string
    name: string
    type: string
    balance: number
    creditLimit: number | null
    color: string | null
    icon: string | null
    last4: string | null
  }>
  cashFlow: Array<{ month: string; income: number; expense: number }>
}

export const useDashboard = () => {
  const data = useState<DashboardData | null>('dashboard', () => null)
  const loading = useState<boolean>('dashboard:loading', () => false)

  async function fetch() {
    loading.value = true
    try {
      // TODO: build /api/dashboard in Sprint 3; for now compute client-side
      data.value = await computeClientSide()
    } finally {
      loading.value = false
    }
  }

  async function computeClientSide(): Promise<DashboardData> {
    const { accounts, fetchAll: fetchAccounts } = useAccounts()
    const { transactions, fetchAll: fetchTxns } = useTransactions()
    await fetchAccounts()
    await fetchTxns({ limit: 500 })

    const now = new Date()
    const thisMonth = now.toISOString().slice(0, 7)
    const thisMonthTxns = transactions.value.filter((t) => t.date.startsWith(thisMonth))
    const monthIncome = thisMonthTxns.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
    const monthExpense = thisMonthTxns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
    const monthSavingsRate = monthIncome > 0 ? ((monthIncome - monthExpense) / monthIncome) * 100 : 0

    // Net worth: bank/cash/wallet positive, credit card subtracted
    let netWorth = 0
    for (const a of accounts.value) {
      // For v1: treat openingBalance as current balance
      // TODO: compute from transactions in Sprint 3
      const bal = a.openingBalance
      if (a.type === 'credit_card') netWorth -= Math.abs(bal)
      else netWorth += bal
    }

    // Top categories
    const catTotals = new Map<string, number>()
    for (const t of thisMonthTxns.filter((t) => t.type === 'expense')) {
      if (!t.categoryId) continue
      catTotals.set(t.categoryId, (catTotals.get(t.categoryId) || 0) + t.amount)
    }
    const { byId: catById } = useCategories()
    const topCategories = Array.from(catTotals.entries())
      .map(([id, amount]) => ({
        categoryId: id,
        name: catById(id)?.name || 'Unknown',
        color: catById(id)?.color || '#A8A29E',
        amount,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)

    // Recent transactions
    const recentTransactions = transactions.value.slice(0, 10)

    // Account cards
    const accountCards = accounts.value.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      balance: a.openingBalance,
      creditLimit: a.creditLimit,
      color: a.color,
      icon: a.icon,
      last4: a.last4,
    }))

    // 6-month cash flow
    const cashFlow: Array<{ month: string; income: number; expense: number }> = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = d.toISOString().slice(0, 7)
      const monthLabel = d.toLocaleString('en-US', { month: 'short' })
      const mTxns = transactions.value.filter((t) => t.date.startsWith(key))
      const income = mTxns.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
      const expense = mTxns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
      cashFlow.push({ month: monthLabel, income: income / 100, expense: expense / 100 })
    }

    return {
      netWorth,
      monthIncome,
      monthExpense,
      monthSavingsRate,
      monthBudget: 12000000, // ₹1.2L placeholder; v2 will make it configurable
      topCategories,
      recentTransactions,
      accounts: accountCards,
      cashFlow,
    }
  }

  return { data, loading, fetch }
}
