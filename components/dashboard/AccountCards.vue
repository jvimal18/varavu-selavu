<script setup lang="ts">
interface AccountCardItem {
  id: string
  name: string
  type: string
  balance: number
  creditLimit: number | null
  color: string | null
  icon: string | null
  last4: string | null
}

withDefaults(
  defineProps<{
    accounts: AccountCardItem[]
    showAdd?: boolean
  }>(),
  { showAdd: true }
)
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <h2 class="font-bold text-ink-900">Accounts</h2>
      <NuxtLink to="/accounts" class="text-xs text-terra-700 font-semibold hover:text-terra-800">All →</NuxtLink>
    </div>
    <div v-if="accounts.length === 0" class="card p-5 text-center">
      <p class="text-sm text-ink-500 mb-3">No accounts yet</p>
      <NuxtLink v-if="showAdd" to="/accounts" class="btn-primary text-xs">
        <Icon name="lucide:plus" size="12" />
        Add account
      </NuxtLink>
    </div>
    <template v-else>
      <div
        v-for="a in accounts.slice(0, 4)"
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
</template>
