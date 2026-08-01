<script setup lang="ts">
import type { Transaction } from '~/composables/useTransactions'

withDefaults(
  defineProps<{
    transactions: Transaction[]
    limit?: number
  }>(),
  { limit: 6 }
)
</script>

<template>
  <div class="card p-5">
    <div class="flex items-center justify-between mb-3">
      <h2 class="font-bold text-ink-900">Recent</h2>
      <NuxtLink to="/transactions" class="text-xs text-terra-700 font-semibold hover:text-terra-800">View all →</NuxtLink>
    </div>
    <div v-if="transactions.length === 0" class="text-sm text-ink-500 text-center py-6">
      No transactions yet — press <kbd class="px-1 bg-cream-200 border border-ink-200 rounded text-[10px]">/</kbd> to add
    </div>
    <div v-else class="space-y-0.5">
      <TransactionRow
        v-for="t in transactions.slice(0, limit)"
        :key="t.id"
        :transaction="t"
        compact
      />
    </div>
  </div>
</template>
