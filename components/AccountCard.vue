<script setup lang="ts">
import type { Account } from '~/composables/useAccounts'
import { formatPaise, formatPaiseCompact } from '~/utils/money'
import { computed } from 'vue'

const props = defineProps<{ account: Account }>()

const isCreditCard = computed(() => props.account.type === 'credit_card')

const utilization = computed(() => {
  if (!isCreditCard.value || !props.account.creditLimit) return 0
  return Math.min(100, (Math.abs(props.account.openingBalance) / props.account.creditLimit) * 100)
})

const dueDateLabel = computed(() => {
  if (!isCreditCard.value || !props.account.dueDay) return null
  return `Due day ${props.account.dueDay} of each month`
})
</script>

<template>
  <div class="card p-5 hover:shadow-lift transition-shadow">
    <div class="flex items-start justify-between mb-3">
      <div class="flex items-center gap-2.5 min-w-0">
        <div
          class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          :style="{ backgroundColor: (account.color || '#78716C') + '20' }"
        >
          <Icon
            :name="`lucide:${account.icon || 'circle-dot'}`"
            :style="{ color: account.color || '#78716C' }"
            size="18"
          />
        </div>
        <div class="min-w-0">
          <div class="text-sm font-semibold text-ink-900 truncate">{{ account.name }}</div>
          <div class="text-[11px] text-ink-500 capitalize">
            {{ account.type.replace('_', ' ') }}
            <span v-if="account.last4"> · ••{{ account.last4 }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="num text-2xl font-bold" :class="isCreditCard ? 'text-warn-700' : 'text-ink-900'">
      {{ formatPaise(account.openingBalance, { showDecimal: false }) }}
    </div>
    <div class="text-[11px] text-ink-500 mt-0.5">
      {{ isCreditCard ? 'Outstanding' : 'Available balance' }}
    </div>

    <!-- Credit card utilization bar -->
    <div v-if="isCreditCard && account.creditLimit" class="mt-3">
      <div class="flex items-center justify-between text-[11px] text-ink-500 mb-1">
        <span>Used</span>
        <span>of {{ formatPaiseCompact(account.creditLimit) }}</span>
      </div>
      <div class="h-1.5 bg-cream-200 rounded-full overflow-hidden">
        <div
          class="h-full rounded-full"
          :class="utilization > 80 ? 'bg-danger-600' : 'bg-warn-600'"
          :style="{ width: utilization + '%' }"
        />
      </div>
      <div v-if="dueDateLabel" class="text-[11px] text-ink-500 mt-1.5">{{ dueDateLabel }}</div>
    </div>
  </div>
</template>
