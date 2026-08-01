<script setup lang="ts">
import { onMounted, watch, computed } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useDashboard } from '~/composables/useDashboard'
import { useDataVersion } from '~/composables/useDataVersion'
import { greetingForHour } from '~/utils/dates'
import type { PeriodKey } from '~/composables/useDashboard'

const auth = useAuthStore()
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

    <div v-if="loading && !data" class="card p-12 text-center">
      <Icon name="lucide:loader" class="animate-spin text-ink-400 mx-auto" size="24" />
    </div>

    <template v-else-if="data">
      <DashboardPeriodSelector v-model="periodValue" class="mb-4" />

      <DashboardHeroStats
        :net-worth="data.netWorth"
        :period-income="data.periodIncome"
        :period-expense="data.periodExpense"
        :period-savings-rate="data.periodSavingsRate"
        :month-budget="data.monthBudget"
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
