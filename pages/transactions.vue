<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useTransactions, type TransactionFilters } from '~/composables/useTransactions'
import { useDataVersion } from '~/composables/useDataVersion'
import { formatPaise } from '~/utils/money'

const { transactions, fetchAll } = useTransactions()
const { version } = useDataVersion()
const filters = ref<TransactionFilters>({ limit: 200 })

const showQuickAdd = ref(false)

async function load() {
  await fetchAll(filters.value)
}

onMounted(load)
watch(filters, () => load(), { deep: true })
// Refetch when any mutation happens (create/update/delete via modal or edit page)
watch(version, () => load())

const totals = computed(() => {
  let income = 0, expense = 0
  for (const t of transactions.value) {
    if (t.type === 'income') income += t.amount
    if (t.type === 'expense') expense += t.amount
  }
  return { income, expense, net: income - expense }
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-1">
      <h1 class="text-2xl font-bold text-ink-900">Transactions</h1>
      <button @click="showQuickAdd = true" class="btn-primary">
        <Icon name="lucide:plus" size="14" />
        <span class="hidden sm:inline">Add</span>
      </button>
    </div>
    <p class="text-sm text-ink-500 mb-6">
      {{ transactions.length }} shown · Income
      <span class="num font-semibold text-success-700">+{{ formatPaise(totals.income) }}</span>
      · Expense
      <span class="num font-semibold text-ink-900">−{{ formatPaise(totals.expense) }}</span>
    </p>

    <div class="card p-4 mb-5">
      <TransactionFilters v-model="filters" />
    </div>

    <TransactionList :transactions="transactions" />

    <QuickAddModal v-model="showQuickAdd" />
  </div>
</template>
