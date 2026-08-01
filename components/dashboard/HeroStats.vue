<script setup lang="ts">
import { computed } from 'vue'
import { formatPaiseCompact } from '~/utils/money'

const props = defineProps<{
  netWorth: number
  periodIncome: number
  periodExpense: number
  periodSavingsRate: number
  monthBudget: number | null
  periodLabel: string
  accountsCount: number
}>()

const expenseBudgetPct = computed(() => {
  if (!props.monthBudget) return 0
  return Math.round((props.periodExpense / props.monthBudget) * 100)
})
</script>

<template>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
    <div class="card p-4 md:p-5">
      <div class="label">Net Worth</div>
      <div class="num text-2xl md:text-3xl font-bold text-ink-900 mt-2">₹{{ (netWorth / 100).toLocaleString('en-IN') }}</div>
      <div class="text-[11px] text-ink-500 mt-1.5">{{ accountsCount }} accounts</div>
    </div>
    <div class="card p-4 md:p-5">
      <div class="label">Income · {{ periodLabel }}</div>
      <div class="num text-2xl md:text-3xl font-bold text-ink-900 mt-2">₹{{ (periodIncome / 100).toLocaleString('en-IN') }}</div>
    </div>
    <div class="card p-4 md:p-5">
      <div class="label">Expense · {{ periodLabel }}</div>
      <div class="num text-2xl md:text-3xl font-bold text-ink-900 mt-2">₹{{ (periodExpense / 100).toLocaleString('en-IN') }}</div>
      <div v-if="monthBudget" class="flex items-center gap-1.5 mt-1.5 text-[11px]">
        <span class="text-ink-500">{{ expenseBudgetPct }}% of {{ formatPaiseCompact(monthBudget) }}</span>
        <div class="flex-1 h-1 bg-cream-200 rounded-full overflow-hidden">
          <div
            class="h-full rounded-full"
            :class="expenseBudgetPct > 100 ? 'bg-danger-600' : expenseBudgetPct > 80 ? 'bg-warn-600' : 'bg-terra-700'"
            :style="{ width: Math.min(100, expenseBudgetPct) + '%' }"
          />
        </div>
      </div>
    </div>
    <div class="card p-4 md:p-5">
      <div class="label">Savings Rate</div>
      <div class="num text-2xl md:text-3xl font-bold text-terra-700 mt-2">
        {{ periodSavingsRate.toFixed(1) }}<span class="text-base text-ink-500">%</span>
      </div>
      <div class="text-[11px] text-ink-500 mt-1.5">
        {{ periodSavingsRate >= 30 ? 'Excellent' : periodSavingsRate >= 15 ? 'Good' : 'Needs work' }}
      </div>
    </div>
  </div>
</template>
