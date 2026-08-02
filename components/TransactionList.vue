<script setup lang="ts">
import { computed } from 'vue'
import { format, parseISO } from 'date-fns'
import type { Transaction } from '~/composables/useTransactions'

const props = defineProps<{ transactions: Transaction[] }>()

interface DayGroup { key: string; label: string; txns: Transaction[]; total: number }

const groups = computed<DayGroup[]>(() => {
  const map = new Map<string, DayGroup>()
  for (const t of props.transactions) {
    const d = parseISO(t.date)
    const key = t.date
    if (!map.has(key)) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const td = new Date(d)
      td.setHours(0, 0, 0, 0)
      const diff = Math.round((today.getTime() - td.getTime()) / 86_400_000)
      let label: string
      if (diff === 0) label = 'Today'
      else if (diff === 1) label = 'Yesterday'
      else if (diff < 7) label = format(d, 'EEEE')   // Mon, Tue, …
      else label = format(d, 'EEE, d MMM')           // Mon, 25 Jul
      map.set(key, { key, label, txns: [], total: 0 })
    }
    const g = map.get(key)!
    g.txns.push(t)
    g.total += t.type === 'income' ? t.amount : (t.type === 'expense' ? -t.amount : 0)
  }
  return Array.from(map.values())
})
</script>

<template>
  <div v-if="transactions.length === 0" class="card p-12 text-center">
    <Icon name="lucide:receipt" size="40" class="text-ink-300 mx-auto mb-3" />
    <h2 class="font-bold text-ink-900 mb-1">No transactions yet</h2>
    <p class="text-sm text-ink-500 max-w-sm mx-auto">
      Press <kbd class="px-1.5 py-0.5 bg-cream-200 border border-ink-200 rounded text-xs">/</kbd>
      or tap the + button to add your first one.
    </p>
  </div>
  <div v-else class="space-y-5">
    <div v-for="g in groups" :key="g.key">
      <div class="flex items-center justify-between mb-2 px-1">
        <div class="text-[10px] font-semibold text-ink-500 uppercase tracking-wider">{{ g.label }}</div>
        <div class="num text-[10px] text-ink-500">
          <span v-if="g.total > 0" class="text-success-700">+{{ (g.total / 100).toLocaleString('en-IN') }}</span>
          <span v-else-if="g.total < 0" class="text-ink-700">−{{ Math.abs(g.total / 100).toLocaleString('en-IN') }}</span>
        </div>
      </div>
      <div class="card divide-y divide-ink-100 dark:divide-ink-700 px-2">
        <TransactionRow v-for="t in g.txns" :key="t.id" :transaction="t" />
      </div>
    </div>
  </div>
</template>
