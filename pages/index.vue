<script setup lang="ts">
import { onMounted, watch, computed } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useDashboard } from '~/composables/useDashboard'
import { useDataVersion } from '~/composables/useDataVersion'
import { greetingForHour } from '~/utils/dates'
import type { PeriodKey } from '~/composables/useDashboard'

const auth = useAuthStore()
const { open: openQuickAdd } = useQuickAddModal()
const { data, loading, period, customRange, fetch } = useDashboard()
const { version } = useDataVersion()
const now = new Date()

onMounted(() => fetch())
watch(version, () => fetch())

// PeriodSelector uses v-model on a { period, from?, to? } object.
// Bridge it to the composable's reactive period + customRange refs,
// which auto-trigger a refetch via the composable's watchDebounced.
const periodValue = computed({
  get: () => ({
    period: period.value,
    from: customRange.value.from || undefined,
    to: customRange.value.to || undefined,
  }),
  set: (v) => {
    period.value = v.period
    if (v.period === 'custom' && v.from && v.to) {
      customRange.value = { from: v.from, to: v.to }
    }
  },
})

// SpendingDonut expects [{ name, value, color }]; topCategories has { categoryId, name, color, amount }.
const donutData = computed(() =>
  (data.value?.topCategories || []).map((c) => ({
    name: c.name,
    value: c.amount,
    color: c.color,
  })),
)

const periodKey = computed<PeriodKey>(() => period.value)
const periodLabel = computed(() => data.value?.period.label ?? '')
</script>

<template>
  <div>
    <div class="mb-6">
      <div class="text-xs text-ink-500 font-medium uppercase tracking-wider">{{ periodLabel }}</div>
      <h1 class="text-2xl md:text-3xl font-bold text-ink-900 mt-1">
        {{ greetingForHour(now.getHours()) }}, {{ auth.user?.name || 'there' }}
      </h1>
    </div>

    <div class="card p-5 mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h2 class="text-base font-semibold text-ink-900">Log your next transaction</h2>
        <p class="text-sm text-ink-500 mt-0.5">Record income, expense, transfer, or interest</p>
      </div>
      <button @click="openQuickAdd" class="btn-primary px-6 py-3 text-base">
        <Icon name="lucide:plus" size="18" />
        Add transaction
        <kbd class="ml-2 hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono bg-white/20 rounded">/</kbd>
      </button>
    </div>

    <div v-if="loading && !data" class="card p-12 text-center">
      <Icon name="lucide:loader" class="animate-spin text-ink-400 mx-auto" size="24" />
    </div>

    <template v-else-if="data">
      <DashboardPeriodSelector v-model="periodValue" class="mb-4" />

      <DashboardHeroStats
        :net-worth="data.netWorth"
        :period-income="data.periodIncome"
        :period-expense="data.periodExpense"
        :month-budget="data.monthBudget"
        :month-budget-set="data.monthBudgetSet"
        :period-label="data.period.label"
        :accounts-count="data.accounts.length"
        class="mb-5"
      />

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <ClientOnly>
          <DashboardSpendingDonut :data="donutData" height="320px" />
        </ClientOnly>
        <ClientOnly>
          <DashboardCashFlowChart :data="data.cashFlow" height="320px" />
        </ClientOnly>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <DashboardTopCategories :categories="data.topCategories" :month="data.period.label" />
        <DashboardRecentTransactions :transactions="data.recentTransactions" />
        <DashboardAccountCards :accounts="data.accounts" />
      </div>
    </template>
  </div>
</template>
