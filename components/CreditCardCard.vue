<script setup lang="ts">
import { computed } from 'vue'
import type { Account } from '~/composables/useAccounts'
import { useAccountBalances } from '~/composables/useAccountBalances'
import { formatPaise, formatPaiseCompact } from '~/utils/money'

const props = defineProps<{ account: Account }>()
const emit = defineEmits<{ pay: [a: Account]; view: [a: Account] }>()

const { balanceFor } = useAccountBalances()

const outstanding = computed(() => Math.max(0, balanceFor(props.account.id)))
const limit = computed(() => props.account.creditLimit || 0)
const available = computed(() => Math.max(0, limit.value - outstanding.value))
const utilization = computed(() => {
  if (!limit.value) return 0
  return Math.min(100, (outstanding.value / limit.value) * 100)
})

const utilColor = computed(() => {
  if (utilization.value > 70) return 'bg-danger-600'
  if (utilization.value > 30) return 'bg-warn-600'
  return 'bg-success-600'
})

const dueDateLabel = computed(() => {
  if (!props.account.dueDay) return null
  return `Due day ${props.account.dueDay} of each month`
})

const statementDateLabel = computed(() => {
  if (!props.account.statementDay) return null
  return `Statement day ${props.account.statementDay}`
})
</script>

<template>
  <div class="card p-5 hover:shadow-lift transition-shadow">
    <!-- Header: name + last4 + badge -->
    <div class="flex items-start justify-between mb-4">
      <div class="flex items-center gap-2.5 min-w-0">
        <div
          class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          :style="{ backgroundColor: (account.color || '#B45309') + '20' }"
        >
          <Icon
            name="lucide:credit-card"
            :style="{ color: account.color || '#B45309' }"
            size="18"
          />
        </div>
        <div class="min-w-0">
          <div class="text-sm font-semibold text-ink-900 truncate">{{ account.name }}</div>
          <div class="text-[11px] text-ink-500">
            Credit card
            <span v-if="account.last4"> · ••{{ account.last4 }}</span>
            <span v-if="account.institution"> · {{ account.institution }}</span>
          </div>
        </div>
      </div>
      <span
        v-if="utilization > 70"
        class="text-[10px] font-semibold bg-danger-50 text-danger-700 px-2 py-0.5 rounded-full uppercase tracking-wider flex-shrink-0"
      >High use</span>
    </div>

    <!-- Outstanding (the headline number) -->
    <div class="mb-3">
      <div class="text-[10px] font-semibold text-ink-500 uppercase tracking-wider">Outstanding</div>
      <div class="num text-3xl font-bold text-warn-700 mt-0.5">
        {{ formatPaise(outstanding, { showDecimal: false }) }}
      </div>
    </div>

    <!-- Utilization bar (prominent) -->
    <div v-if="limit" class="mb-3">
      <div class="flex items-center justify-between text-[11px] text-ink-500 mb-1.5">
        <span>Used <span class="num font-semibold text-ink-700">{{ utilization.toFixed(0) }}%</span></span>
        <span>of <span class="num font-semibold text-ink-700">{{ formatPaiseCompact(limit) }}</span></span>
      </div>
      <div class="h-2 bg-cream-200 rounded-full overflow-hidden">
        <div
          class="h-full rounded-full transition-all"
          :class="utilColor"
          :style="{ width: utilization + '%' }"
        />
      </div>
    </div>

    <!-- Available credit -->
    <div v-if="limit" class="flex items-center justify-between py-3 border-t border-ink-100">
      <div class="text-[10px] font-semibold text-ink-500 uppercase tracking-wider">Available</div>
      <div class="num text-sm font-semibold text-ink-900">{{ formatPaise(available, { showDecimal: false }) }}</div>
    </div>

    <!-- Statement / Due -->
    <div v-if="statementDateLabel || dueDateLabel" class="flex items-center gap-3 text-[11px] text-ink-500 mt-2">
      <span v-if="statementDateLabel">{{ statementDateLabel }}</span>
      <span v-if="statementDateLabel && dueDateLabel" class="text-ink-300">·</span>
      <span v-if="dueDateLabel">{{ dueDateLabel }}</span>
    </div>

    <!-- Actions -->
    <div class="flex items-center gap-2 mt-4 pt-3 border-t border-ink-100">
      <button
        @click="emit('pay', account)"
        class="flex-1 btn-primary text-xs"
        :disabled="available >= limit"
      >
        <Icon name="lucide:credit-card" size="13" />
        Pay card
      </button>
      <button
        @click="emit('view', account)"
        class="btn-ghost text-xs"
        title="View details"
      >
        <Icon name="lucide:arrow-right" size="14" />
      </button>
    </div>
  </div>
</template>
