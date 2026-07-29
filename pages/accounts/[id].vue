<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAccounts, type Account } from '~/composables/useAccounts'
import { useTransactions } from '~/composables/useTransactions'
import { useDataVersion } from '~/composables/useDataVersion'
import { formatPaise, formatPaiseCompact } from '~/utils/money'

const route = useRoute()
const router = useRouter()
const { accounts, byId, fetchAll } = useAccounts()
const { transactions, fetchAll: fetchTxns } = useTransactions()
const { version } = useDataVersion()

const account = ref<Account | null>(null)
const showForm = ref(false)
const showQuickAdd = ref(false)

async function load() {
  await fetchAll()
  account.value = byId(route.params.id as string) || null
  await fetchTxns({ limit: 500 })
}

onMounted(load)
watch(() => route.params.id, load)
watch(version, () => load())

const accountTxns = computed(() => {
  if (!account.value) return []
  return transactions.value.filter((t) => t.accountId === account.value!.id || t.toAccountId === account.value!.id)
})

const isCreditCard = computed(() => account.value?.type === 'credit_card')
const utilization = computed(() => {
  if (!isCreditCard.value || !account.value?.creditLimit) return 0
  return Math.min(100, (Math.abs(account.value.openingBalance) / account.value.creditLimit) * 100)
})

function onSaved() { load() }
</script>

<template>
  <div v-if="!account" class="card p-12 text-center">
    <p class="text-ink-500">Account not found.</p>
    <NuxtLink to="/accounts" class="text-terra-700 font-semibold mt-2 inline-block">← Back to accounts</NuxtLink>
  </div>
  <div v-else>
    <NuxtLink to="/accounts" class="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-900 mb-3">
      <Icon name="lucide:arrow-left" size="14" />
      All accounts
    </NuxtLink>

    <!-- Hero card -->
    <div
      class="rounded-2xl p-6 text-white shadow-card mb-5 relative overflow-hidden"
      :style="{ backgroundColor: account.color || '#C2410C' }"
    >
      <div class="absolute -right-12 -top-12 w-48 h-48 rounded-full bg-white/10" />
      <div class="absolute -right-20 -bottom-20 w-64 h-64 rounded-full bg-white/5" />
      <div class="relative">
        <div class="flex items-center justify-between mb-6">
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center">
              <Icon :name="`lucide:${account.icon || 'building-2'}`" size="22" />
            </div>
            <div>
              <div class="text-base font-semibold">{{ account.name }}</div>
              <div class="text-xs opacity-80 capitalize">
                {{ account.type.replace('_', ' ') }}
                <span v-if="account.last4"> · ••{{ account.last4 }}</span>
                <span v-if="account.institution"> · {{ account.institution }}</span>
              </div>
            </div>
          </div>
          <button
            @click="showForm = true"
            class="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Icon name="lucide:pencil" size="12" />
            Edit
          </button>
        </div>
        <div class="num text-4xl font-bold mb-1">₹{{ (account.openingBalance / 100).toLocaleString('en-IN') }}</div>
        <div class="text-xs opacity-80">
          {{ isCreditCard ? 'Outstanding balance' : 'Available balance' }}
        </div>

        <!-- Credit card extra info -->
        <div v-if="isCreditCard && account.creditLimit" class="mt-5 pt-5 border-t border-white/20">
          <div class="flex items-center justify-between text-xs mb-2">
            <span class="opacity-80">Used</span>
            <span class="opacity-80">of {{ formatPaiseCompact(account.creditLimit) }}</span>
          </div>
          <div class="h-1.5 bg-white/20 rounded-full overflow-hidden">
            <div
              class="h-full bg-white rounded-full"
              :class="utilization > 80 ? 'opacity-90' : 'opacity-80'"
              :style="{ width: utilization + '%' }"
            />
          </div>
          <div class="flex items-center justify-between mt-3 text-xs opacity-90">
            <span v-if="account.statementDay">Statement: day {{ account.statementDay }}</span>
            <span v-if="account.dueDay">Due: day {{ account.dueDay }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Quick add button -->
    <div class="flex items-center gap-2 mb-5">
      <button @click="showQuickAdd = true" class="btn-primary">
        <Icon name="lucide:plus" size="14" />
        Add transaction
      </button>
    </div>

    <!-- Transactions for this account -->
    <h2 class="text-sm font-semibold text-ink-500 uppercase tracking-wider mb-3">Transactions</h2>
    <TransactionList :transactions="accountTxns" />

    <AccountForm v-model="showForm" :account="account" @saved="onSaved" />
    <QuickAddModal v-model="showQuickAdd" :default-account-id="account.id" />
  </div>
</template>
