<script setup lang="ts">
import { computed } from 'vue'
import type { Transaction } from '~/composables/useTransactions'
import { useCategories } from '~/composables/useCategories'
import { useAccounts } from '~/composables/useAccounts'
import { useUsers } from '~/composables/useUsers'
import { formatSigned } from '~/utils/money'
import { displayShortDate } from '~/utils/dates'

const props = defineProps<{ transaction: Transaction; compact?: boolean }>()

const { byId: catById } = useCategories()
const { byId: acctById } = useAccounts()
const { byId: userById } = useUsers()

const category = computed(() => catById(props.transaction.categoryId))
const account = computed(() => acctById(props.transaction.accountId))
const toAccount = computed(() => acctById(props.transaction.toAccountId))
const user = computed(() => userById(props.transaction.spentBy))

const accountLabel = computed(() => {
  if (props.transaction.type === 'transfer') {
    return `${account.value?.name || '—'} → ${toAccount.value?.name || '—'}`
  }
  return account.value?.name || '—'
})

const isInterest = computed(() => (props.transaction.type as any) === 'interest')

const amountClass = computed(() => {
  if (props.transaction.type === 'income' || isInterest.value) return 'text-success-700'
  if (props.transaction.type === 'transfer') return 'text-warn-700'
  return 'text-ink-900'
})

function editTransaction(e: MouseEvent) {
  e.stopPropagation()
  e.preventDefault()
  navigateTo(`/transactions/${props.transaction.id}`)
}
</script>

<template>
  <NuxtLink
    :to="`/transactions/${transaction.id}`"
    class="row-hover -mx-2 px-2 py-2 rounded-lg flex items-center gap-3 group"
  >
    <!-- Category / transfer icon -->
    <div
      class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
      :class="isInterest ? 'bg-success-50' : transaction.type === 'income' ? 'bg-success-50' : transaction.type === 'transfer' ? 'bg-warn-50' : 'bg-cream-200'"
    >
      <Icon
        v-if="isInterest"
        name="lucide:percent"
        :class="amountClass"
        size="16"
      />
      <Icon
        v-else-if="transaction.type === 'transfer'"
        name="lucide:arrow-right-left"
        :class="amountClass"
        size="16"
      />
      <Icon
        v-else-if="category"
        :name="`lucide:${category.icon || 'circle-dot'}`"
        :style="{ color: category.color || '#78716C' }"
        size="16"
      />
      <Icon
        v-else
        name="lucide:circle-dot"
        class="text-ink-500"
        size="16"
      />
    </div>

    <!-- Description + meta -->
    <div class="flex-1 min-w-0">
      <div class="text-sm font-medium text-ink-900 truncate">
        {{ transaction.description || (category?.name || (isInterest ? 'Interest' : 'Transfer')) }}
      </div>
      <div class="text-[11px] text-ink-500 flex items-center gap-1.5 mt-0.5">
        <span v-if="!compact">{{ category?.name || (isInterest ? 'Interest' : 'Transfer') }}</span>
        <span v-if="!compact" class="text-ink-300">·</span>
        <span class="truncate">{{ accountLabel }}</span>
        <template v-if="!compact">
          <span class="text-ink-300 sm:hidden">·</span>
          <span class="sm:hidden">{{ displayShortDate(transaction.date) }}</span>
        </template>
      </div>
    </div>

    <div v-if="!compact" class="hidden sm:block w-20 flex-shrink-0 text-right text-[11px] text-ink-500">
      {{ displayShortDate(transaction.date) }}
    </div>

    <div class="flex items-center justify-end gap-2.5 flex-shrink-0">
      <div v-if="user && !compact" class="hidden sm:flex w-24 min-w-0 items-center gap-1.5">
        <div
          class="avatar w-5 h-5 rounded-full text-[10px]"
          :style="{ backgroundColor: user.color }"
        >{{ user.name[0] }}</div>
        <span class="text-[10px] text-ink-500 truncate">{{ user.name }}</span>
      </div>
      <div class="num w-20 text-right text-sm font-semibold tabular-nums whitespace-nowrap" :class="amountClass">
        {{ formatSigned(transaction.amount, transaction.type) }}
      </div>
    </div>

    <button
      type="button"
      title="Edit transaction"
      class="flex-shrink-0 p-1.5 rounded-md text-ink-500 hover:text-ink-900 hover:bg-cream-200 transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
      @click="editTransaction"
    >
      <Icon name="lucide:pencil" size="18" />
    </button>
  </NuxtLink>
</template>
