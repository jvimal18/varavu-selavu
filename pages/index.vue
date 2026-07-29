<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useDashboard } from '~/composables/useDashboard'
import { displayMonth, greetingForHour } from '~/utils/dates'
import { formatPaise, formatPaiseCompact } from '~/utils/money'

const auth = useAuthStore()
const { data, loading, fetch } = useDashboard()
const now = new Date()

onMounted(() => fetch())

const expenseBudgetPct = computed(() => {
  if (!data.value?.monthBudget) return 0
  return Math.round((data.value.monthExpense / data.value.monthBudget) * 100)
})

const maxCategoryAmount = computed(() => {
  if (!data.value?.topCategories.length) return 1
  return data.value.topCategories[0].amount
})
</script>

<template>
  <div>
    <div class="mb-6">
      <div class="text-xs text-ink-500 font-medium uppercase tracking-wider">{{ displayMonth(now) }}</div>
      <h1 class="text-2xl md:text-3xl font-bold text-ink-900 mt-1">
        {{ greetingForHour(now.getHours()) }}, {{ auth.user?.name || 'there' }}
      </h1>
    </div>

    <div v-if="loading && !data" class="card p-12 text-center">
      <Icon name="lucide:loader" class="animate-spin text-ink-400 mx-auto" size="24" />
    </div>

    <template v-else-if="data">
      <!-- Hero stats -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <div class="card p-4 md:p-5">
          <div class="label">Net Worth</div>
          <div class="num text-2xl md:text-3xl font-bold text-ink-900 mt-2">₹{{ (data.netWorth / 100).toLocaleString('en-IN') }}</div>
          <div class="text-[11px] text-ink-500 mt-1.5">{{ data.accounts.length }} accounts</div>
        </div>
        <div class="card p-4 md:p-5">
          <div class="label">Income · {{ displayMonth(now) }}</div>
          <div class="num text-2xl md:text-3xl font-bold text-ink-900 mt-2">₹{{ (data.monthIncome / 100).toLocaleString('en-IN') }}</div>
        </div>
        <div class="card p-4 md:p-5">
          <div class="label">Expense · {{ displayMonth(now) }}</div>
          <div class="num text-2xl md:text-3xl font-bold text-ink-900 mt-2">₹{{ (data.monthExpense / 100).toLocaleString('en-IN') }}</div>
          <div v-if="data.monthBudget" class="flex items-center gap-1.5 mt-1.5 text-[11px]">
            <span class="text-ink-500">{{ expenseBudgetPct }}% of {{ formatPaiseCompact(data.monthBudget) }}</span>
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
            {{ data.monthSavingsRate.toFixed(1) }}<span class="text-base text-ink-500">%</span>
          </div>
          <div class="text-[11px] text-ink-500 mt-1.5">
            {{ data.monthSavingsRate >= 30 ? 'Excellent' : data.monthSavingsRate >= 15 ? 'Good' : 'Needs work' }}
          </div>
        </div>
      </div>

      <!-- Main row: top categories + recent + accounts -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-5">
        <!-- Top categories -->
        <div class="card p-5">
          <div class="flex items-center justify-between mb-4">
            <h2 class="font-bold text-ink-900">Top categories</h2>
            <span class="text-xs text-ink-500">{{ displayMonth(now) }}</span>
          </div>
          <div v-if="data.topCategories.length === 0" class="text-sm text-ink-500 text-center py-6">
            No expenses yet
          </div>
          <div v-else class="space-y-3.5">
            <div v-for="c in data.topCategories" :key="c.categoryId">
              <div class="flex items-center justify-between text-sm mb-1.5">
                <div class="flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full" :style="{ backgroundColor: c.color }"></span>
                  <span class="font-medium text-ink-900">{{ c.name }}</span>
                </div>
                <span class="num font-semibold text-ink-900">₹{{ (c.amount / 100).toLocaleString('en-IN') }}</span>
              </div>
              <div class="h-1.5 bg-cream-200 rounded-full overflow-hidden">
                <div class="h-full rounded-full" :style="{ backgroundColor: c.color, width: ((c.amount / maxCategoryAmount) * 100) + '%' }" />
              </div>
            </div>
          </div>
        </div>

        <!-- Recent transactions -->
        <div class="card p-5">
          <div class="flex items-center justify-between mb-3">
            <h2 class="font-bold text-ink-900">Recent</h2>
            <NuxtLink to="/transactions" class="text-xs text-terra-700 font-semibold hover:text-terra-800">View all →</NuxtLink>
          </div>
          <div v-if="data.recentTransactions.length === 0" class="text-sm text-ink-500 text-center py-6">
            No transactions yet — press <kbd class="px-1 bg-cream-200 border border-ink-200 rounded text-[10px]">/</kbd> to add
          </div>
          <div v-else class="space-y-0.5">
            <TransactionRow
              v-for="t in data.recentTransactions.slice(0, 6)"
              :key="t.id"
              :transaction="t"
              compact
            />
          </div>
        </div>

        <!-- Accounts summary -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="font-bold text-ink-900">Accounts</h2>
            <NuxtLink to="/accounts" class="text-xs text-terra-700 font-semibold hover:text-terra-800">All →</NuxtLink>
          </div>
          <div v-if="data.accounts.length === 0" class="card p-5 text-center">
            <p class="text-sm text-ink-500 mb-3">No accounts yet</p>
            <NuxtLink to="/accounts" class="btn-primary text-xs">
              <Icon name="lucide:plus" size="12" />
              Add account
            </NuxtLink>
          </div>
          <template v-else>
            <div
              v-for="a in data.accounts.slice(0, 4)"
              :key="a.id"
              class="card p-4 flex items-center gap-3"
            >
              <div
                class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                :style="{ backgroundColor: (a.color || '#78716C') + '20' }"
              >
                <Icon
                  :name="`lucide:${a.type === 'credit_card' ? 'credit-card' : a.type === 'cash' ? 'banknote' : a.type === 'digital_wallet' ? 'smartphone' : 'building-2'}`"
                  :style="{ color: a.color || '#78716C' }"
                  size="16"
                />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-semibold text-ink-900 truncate">{{ a.name }}</div>
                <div class="text-[10px] text-ink-500 capitalize">{{ a.type.replace('_', ' ') }}</div>
              </div>
              <div class="num text-sm font-semibold" :class="a.type === 'credit_card' ? 'text-warn-700' : 'text-ink-900'">
                ₹{{ (a.balance / 100).toLocaleString('en-IN') }}
              </div>
            </div>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>
