<script setup lang="ts">
import { computed } from 'vue'
import type { Account } from '~/composables/useAccounts'
import { useAccountBalances } from '~/composables/useAccountBalances'
import { formatPaise } from '~/utils/money'

const props = defineProps<{ account: Account }>()
const { balanceFor } = useAccountBalances()

const typeLabels: Record<string, string> = {
  mutual_fund: 'Mutual Fund',
  fixed_deposit: 'Fixed Deposit',
  recurring_deposit: 'Recurring Deposit',
}

const iconMap: Record<string, string> = {
  mutual_fund: 'trending-up',
  fixed_deposit: 'piggy-bank',
  recurring_deposit: 'calendar-clock',
}

const typeLabel = computed(() => typeLabels[props.account.type] || 'Investment')
const icon = computed(() => iconMap[props.account.type] || 'trending-up')
const color = computed(() => props.account.color || '#78716C')
const currentValue = computed(() => balanceFor(props.account.id))
</script>

<template>
  <NuxtLink
    :to="`/accounts/${account.id}`"
    class="card p-5 block hover:shadow-lift transition-shadow"
  >
    <div class="flex items-start gap-3">
      <div
        class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
        :style="{ backgroundColor: color + '20' }"
      >
        <Icon
          :name="`lucide:${icon}`"
          :style="{ color }"
          size="18"
        />
      </div>
      <div class="min-w-0 flex-1">
        <div class="text-[10px] font-semibold text-ink-500 uppercase tracking-wider">
          {{ typeLabel }}
        </div>
        <div class="text-sm font-semibold text-ink-900 truncate mt-0.5">
          {{ account.name }}
        </div>
      </div>
    </div>

    <div class="num text-2xl font-bold text-terra-700 mt-4">
      {{ formatPaise(currentValue, { showDecimal: false }) }}
    </div>
    <div class="text-[11px] text-ink-500 mt-0.5">Current value</div>
  </NuxtLink>
</template>
