/**
 * Dashboard composable — aggregates served by /api/dashboard.
 */
import { watchDebounced } from '@vueuse/core'
import type { Transaction } from '~/composables/useTransactions'

/** Dashboard period presets; re-exported from PeriodSelector.vue for UI use. */
export type PeriodKey = 'this_month' | 'last_30' | 'last_90' | 'custom'

export interface DashboardPeriod {
  from: string
  to: string
  label: string
}

export interface DashboardData {
  netWorth: number
  periodIncome: number
  periodExpense: number
  periodSavingsAmount: number
  period: DashboardPeriod
  monthBudget: number
  monthBudgetSet: boolean
  topCategories: Array<{ categoryId: string; name: string; color: string; amount: number }>
  recentTransactions: Transaction[]
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
  const period = useState<PeriodKey>('dashboard:period', () => 'last_30')
  const customRange = useState<{ from: string; to: string }>('dashboard:customRange', () => ({ from: '', to: '' }))

  async function fetch(opts?: { period?: PeriodKey; from?: string; to?: string }) {
    const query: Record<string, string> = {}
    if (opts?.period) query.period = opts.period
    if (opts?.from) query.from = opts.from
    if (opts?.to) query.to = opts.to

    loading.value = true
    try {
      const result = await $fetch<{ data: DashboardData }>('/api/dashboard', { query })
      data.value = result.data
    } finally {
      loading.value = false
    }
  }

  // Auto-refetch when the selected period or custom range changes (~200ms debounce).
  watchDebounced(
    () => [period.value, customRange.value] as const,
    ([p, range]) => {
      if (p === 'custom') {
        // Only fetch once the user has applied a full custom range.
        if (range.from && range.to) fetch({ period: p, from: range.from, to: range.to })
      } else {
        fetch({ period: p })
      }
    },
    { debounce: 200, deep: true }
  )

  return { data, loading, period, customRange, fetch }
}
