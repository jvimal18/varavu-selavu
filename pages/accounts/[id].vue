<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAccounts, type Account } from '~/composables/useAccounts'
import { useTransactions } from '~/composables/useTransactions'
import { useAccountBalances } from '~/composables/useAccountBalances'
import { useDataVersion } from '~/composables/useDataVersion'
import { useCategories } from '~/composables/useCategories'
import { useUserSettings } from '~/composables/useUserSettings'
import { formatPaise, formatPaiseCompact } from '~/utils/money'
import { displayShortDate } from '~/utils/dates'

const route = useRoute()
const { settings, pending: settingsPending, setPrimaryAccount } = useUserSettings()
const isPrimary = computed(() => settings.value.primaryAccountId === account.value?.id)

async function setPrimary() {
  if (!account.value) return
  await setPrimaryAccount(account.value.id)
}
const { accounts, byId, fetchAll: fetchAccts } = useAccounts()
const { transactions, fetchAll: fetchTxns } = useTransactions()
const { balanceFor } = useAccountBalances()
const { version } = useDataVersion()
const { fetchAll: fetchCategories, roots } = useCategories()

const account = ref<Account | null>(null)
const showForm = ref(false)
const showQuickAdd = ref(false)
const quickAddDefaults = ref<{
  type?: 'expense' | 'income' | 'transfer' | 'interest'
  accountId?: string | null
  toAccountId?: string | null
  categoryId?: string | null
}>({})

async function load() {
  await Promise.all([fetchAccts(), fetchTxns({ limit: 500 }), fetchCategories()])
  account.value = byId(route.params.id as string) || null
}

onMounted(load)
watch(() => route.params.id, load)
watch(version, load)

const accountTxns = computed(() => {
  if (!account.value) return []
  return transactions.value.filter((t) => t.accountId === account.value!.id || t.toAccountId === account.value!.id)
})

// For CC: charges are expenses (outstanding up), payments are transfers in (outstanding down)
const charges = computed(() => {
  if (!account.value) return []
  return accountTxns.value.filter((t) => t.type === 'expense' && t.accountId === account.value!.id)
})
const payments = computed(() => {
  if (!account.value) return []
  return accountTxns.value.filter((t) => t.type === 'transfer' && t.toAccountId === account.value!.id)
})

const INVESTMENT_TYPES: Account['type'][] = ['mutual_fund', 'fixed_deposit', 'recurring_deposit']
const investmentTypeLabels: Record<string, string> = {
  mutual_fund: 'Mutual Fund',
  fixed_deposit: 'Fixed Deposit',
  recurring_deposit: 'Recurring Deposit',
}
const investmentIcons: Record<string, string> = {
  mutual_fund: 'trending-up',
  fixed_deposit: 'piggy-bank',
  recurring_deposit: 'calendar-clock',
}

const currentBalance = computed(() => account.value ? balanceFor(account.value.id) : 0)
const isCreditCard = computed(() => account.value?.type === 'credit_card')
const isInvestment = computed(() => account.value ? INVESTMENT_TYPES.includes(account.value.type) : false)
const investmentLabel = computed(() => isInvestment.value ? investmentTypeLabels[account.value!.type] : '')
const investmentIcon = computed(() => isInvestment.value ? investmentIcons[account.value!.type] : 'trending-up')
const outstanding = computed(() => isCreditCard.value ? Math.max(0, currentBalance.value) : 0)
const available = computed(() => {
  if (!isCreditCard.value || !account.value?.creditLimit) return 0
  return Math.max(0, account.value.creditLimit - outstanding.value)
})
const utilization = computed(() => {
  if (!isCreditCard.value || !account.value?.creditLimit) return 0
  return Math.min(100, (outstanding.value / account.value.creditLimit) * 100)
})
const utilColor = computed(() => {
  if (utilization.value > 70) return 'bg-danger-600'
  if (utilization.value > 30) return 'bg-warn-600'
  return 'bg-success-600'
})

function onSaved() { load() }

function interestCategoryId() {
  const c = roots('income').find((c) => c.name.toLowerCase() === 'investment returns')
  if (c) return c.id
  return roots('income')[0]?.id || null
}

function openQuickAdd(opts: { type?: 'expense' | 'income' | 'transfer' | 'interest'; accountId?: string | null; toAccountId?: string | null; categoryId?: string | null } = {}) {
  quickAddDefaults.value = opts
  showQuickAdd.value = true
}
function onQuickAddSaved() {
  showQuickAdd.value = false
  quickAddDefaults.value = {}
}

function openInterestQuickAdd() {
  if (!account.value) return
  openQuickAdd({
    type: 'interest',
    accountId: account.value.id,
    categoryId: interestCategoryId(),
  })
}
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
      class="rounded-2xl p-6 text-white shadow-card mb-4 relative overflow-hidden"
      :style="{ backgroundColor: isCreditCard ? (account.color || '#B45309') : (account.color || '#C2410C') }"
    >
      <div class="absolute -right-12 -top-12 w-48 h-48 rounded-full bg-white/10" />
      <div class="absolute -right-20 -bottom-20 w-64 h-64 rounded-full bg-white/5" />
      <div class="relative">
        <div class="flex items-center justify-between mb-6">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center">
              <Icon :name="`lucide:${isCreditCard ? 'credit-card' : isInvestment ? investmentIcon : (account.icon || 'building-2')}`" size="22" />
            </div>
              <div class="min-w-0">
                <div class="text-base font-semibold truncate">{{ account.name }}</div>
                <div class="text-xs opacity-80 capitalize">
                {{ isInvestment ? investmentLabel : account.type.replace('_', ' ') }}
                <span v-if="account.last4"> · ••{{ account.last4 }}</span>
                <span v-if="account.institution"> · {{ account.institution }}</span>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span
              v-if="isPrimary"
              class="inline-flex items-center gap-1 text-[10px] font-semibold bg-white/20 text-white px-2 py-0.5 rounded-full uppercase tracking-wider"
            >
              <Icon name="lucide:star" size="10" />
              Primary
            </span>
            <button
              v-else
              type="button"
              :disabled="settingsPending"
              class="text-[10px] font-semibold text-white/90 hover:bg-white/20 px-2 py-0.5 rounded-full transition-colors disabled:opacity-50"
              @click="setPrimary"
            >
              {{ settingsPending ? 'Saving…' : 'Set as primary' }}
            </button>
            <button
              @click="showForm = true"
              class="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Icon name="lucide:pencil" size="12" />
              Edit
            </button>
          </div>
        </div>
        <div class="flex items-baseline min-w-0 mb-1">
          <div class="num flex-1 min-w-0 text-[clamp(1.5rem,5vw,2.25rem)] font-bold">
            ₹{{ (isCreditCard ? outstanding : currentBalance / 100).toLocaleString('en-IN') }}
          </div>
        </div>
        <div class="text-xs opacity-80">
          {{ isCreditCard ? 'Outstanding balance' : isInvestment ? 'Current value' : 'Available balance' }}
        </div>
      </div>
    </div>

    <!-- INVESTMENT: dedicated panel below hero -->
    <div v-if="isInvestment" class="card p-5 mb-5">
      <div class="flex items-center gap-3 mb-4">
        <div
          class="w-11 h-11 rounded-xl flex items-center justify-center"
          :style="{ backgroundColor: (account.color || '#C2410C') + '20' }"
        >
          <Icon :name="`lucide:${investmentIcon}`" size="22" :style="{ color: account.color || '#C2410C' }" />
        </div>
        <div>
          <div class="text-base font-semibold text-ink-900">{{ account.name }}</div>
          <div class="text-xs text-ink-500">{{ investmentLabel }}</div>
        </div>
      </div>

      <div class="flex items-baseline min-w-0 mb-1">
        <div class="num flex-1 min-w-0 text-[clamp(1.25rem,4.5vw,1.875rem)] font-bold text-terra-700">
          ₹{{ (currentBalance / 100).toLocaleString('en-IN') }}
        </div>
      </div>
      <div class="text-xs text-ink-500 mb-4">Current value</div>

      <div class="flex items-center gap-2 pt-3 border-t border-ink-100">
        <button @click="openQuickAdd({ type: 'transfer', toAccountId: account.id })" class="flex-1 btn-primary text-sm">
          <Icon name="lucide:plus" size="14" />
          Invest more
        </button>
        <button @click="openQuickAdd({ type: 'transfer', accountId: account.id })" class="flex-1 btn-secondary text-sm">
          <Icon name="lucide:arrow-down-left" size="14" />
          Redeem
        </button>
        <button @click="openInterestQuickAdd" class="flex-1 btn-secondary text-sm">
          <Icon name="lucide:percent" size="14" />
          Add interest
        </button>
      </div>
    </div>

    <!-- CREDIT CARD: dedicated CC panel below hero -->
    <div v-if="isCreditCard && account.creditLimit" class="card p-5 mb-5">
      <div class="grid grid-cols-3 gap-4 mb-4">
        <div>
          <div class="label">Limit</div>
          <div class="num text-lg font-bold text-ink-900 mt-1">{{ formatPaiseCompact(account.creditLimit) }}</div>
        </div>
        <div>
          <div class="label">Outstanding</div>
          <div class="num text-lg font-bold text-warn-700 mt-1">{{ formatPaiseCompact(outstanding) }}</div>
        </div>
        <div>
          <div class="label">Available</div>
          <div class="num text-lg font-bold text-ink-900 mt-1">{{ formatPaise(available, { showDecimal: false }) }}</div>
        </div>
      </div>

      <!-- Utilization bar -->
      <div class="mb-4">
        <div class="flex items-center justify-between text-[11px] text-ink-500 mb-1.5">
          <span>Utilization <span class="num font-semibold text-ink-700">{{ utilization.toFixed(0) }}%</span></span>
          <span v-if="utilization > 70" class="text-danger-700 font-semibold">High use</span>
        </div>
        <div class="h-2 bg-cream-200 rounded-full overflow-hidden">
          <div class="h-full rounded-full transition-all" :class="utilColor" :style="{ width: utilization + '%' }" />
        </div>
      </div>

      <!-- Statement / Due -->
      <div v-if="account.statementDay || account.dueDay" class="flex items-center gap-4 text-[11px] text-ink-500 mb-4">
        <span v-if="account.statementDay">Statement: day <span class="num font-semibold text-ink-700">{{ account.statementDay }}</span></span>
        <span v-if="account.dueDay">Due: day <span class="num font-semibold text-ink-700">{{ account.dueDay }}</span></span>
      </div>

      <!-- Actions for CC -->
      <div class="flex items-center gap-2 pt-3 border-t border-ink-100">
        <button @click="openQuickAdd({ type: 'transfer', toAccountId: account.id })" class="flex-1 btn-primary text-sm">
          <Icon name="lucide:credit-card" size="14" />
          Pay card
        </button>
        <button @click="openQuickAdd({ type: 'expense', accountId: account.id })" class="flex-1 btn-secondary text-sm">
          <Icon name="lucide:plus" size="14" />
          Add charge
        </button>
      </div>
    </div>

    <!-- NON-CC: simple add button -->
    <div v-if="!isCreditCard && !isInvestment" class="flex items-center gap-2 mb-5">
      <button @click="openQuickAdd({ type: 'expense', accountId: account.id })" class="btn-primary">
        <Icon name="lucide:plus" size="14" />
        Add transaction
      </button>
    </div>

    <!-- Transactions for this account -->
    <h2 class="text-sm font-semibold text-ink-500 uppercase tracking-wider mb-3">
      {{ isCreditCard || isInvestment ? 'All activity' : 'Transactions' }}
    </h2>
    <TransactionList :transactions="accountTxns" />

    <AccountForm v-model="showForm" :account="account" @saved="onSaved" />
    <QuickAddModal
      v-model="showQuickAdd"
      :default-type="quickAddDefaults.type"
      :default-account-id="quickAddDefaults.accountId"
      :default-to-account-id="quickAddDefaults.toAccountId"
      :default-category-id="quickAddDefaults.categoryId"
      @saved="onQuickAddSaved"
    />

  </div>
</template>
