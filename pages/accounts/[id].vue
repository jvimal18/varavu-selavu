<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAccounts, type Account } from '~/composables/useAccounts'
import { useTransactions } from '~/composables/useTransactions'
import { useAccountBalances } from '~/composables/useAccountBalances'
import { useDataVersion } from '~/composables/useDataVersion'
import { formatPaise, formatPaiseCompact, rupeesToPaise } from '~/utils/money'
import { displayShortDate } from '~/utils/dates'

const route = useRoute()
const { accounts, byId, fetchAll: fetchAccts, update: updateAccount } = useAccounts()
const { transactions, fetchAll: fetchTxns } = useTransactions()
const { balanceFor } = useAccountBalances()
const { version } = useDataVersion()

const account = ref<Account | null>(null)
const showForm = ref(false)
const showQuickAdd = ref(false)
const quickAddDefaults = ref<{
  type?: 'expense' | 'income' | 'transfer'
  accountId?: string | null
  toAccountId?: string | null
}>({})

async function load() {
  await Promise.all([fetchAccts(), fetchTxns({ limit: 500 })])
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

function openQuickAdd(opts: { type?: 'expense' | 'income' | 'transfer'; accountId?: string; toAccountId?: string } = {}) {
  quickAddDefaults.value = opts
  showQuickAdd.value = true
}
function onQuickAddSaved() {
  showQuickAdd.value = false
  quickAddDefaults.value = {}
}

// --- Add interest (compounding) for investment accounts (D09) ---
const showInterestModal = ref(false)
const interestAmount = ref('')
const interestError = ref<string | null>(null)
const savingInterest = ref(false)
function openInterestModal() {
  interestAmount.value = ''
  interestError.value = null
  showInterestModal.value = true
}
function closeInterestModal() {
  showInterestModal.value = false
  interestAmount.value = ''
  interestError.value = null
}
async function addInterest() {
  if (!account.value) return
  const rupees = parseFloat(interestAmount.value)
  if (isNaN(rupees) || rupees <= 0) {
    interestError.value = 'Enter an amount greater than 0'
    return
  }
  savingInterest.value = true
  interestError.value = null
  try {
    const interestPaise = rupeesToPaise(rupees)
    const newOpening = (account.value.openingBalance || 0) + interestPaise
    await updateAccount(account.value.id, { openingBalance: newOpening })
    closeInterestModal()
  } catch (e: any) {
    interestError.value = e?.statusMessage || e?.message || 'Failed to add interest'
  } finally {
    savingInterest.value = false
  }
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
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center">
              <Icon :name="`lucide:${isCreditCard ? 'credit-card' : isInvestment ? investmentIcon : (account.icon || 'building-2')}`" size="22" />
            </div>
            <div>
              <div class="text-base font-semibold">{{ account.name }}</div>
              <div class="text-xs opacity-80 capitalize">
                {{ isInvestment ? investmentLabel : account.type.replace('_', ' ') }}
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
        <div class="num text-4xl font-bold mb-1">
          ₹{{ (isCreditCard ? outstanding : currentBalance / 100).toLocaleString('en-IN') }}
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

      <div class="num text-3xl font-bold text-terra-700 mb-1">
        ₹{{ (currentBalance / 100).toLocaleString('en-IN') }}
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
        <button @click="openInterestModal" class="flex-1 btn-secondary text-sm">
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
      @saved="onQuickAddSaved"
    />

    <!-- Add interest (compounding) modal -->
    <div
      v-if="showInterestModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/50 p-4"
      @click.self="closeInterestModal"
    >
      <div class="card p-5 w-full max-w-sm shadow-2xl">
        <div class="flex items-center gap-3 mb-3">
          <div
            class="w-10 h-10 rounded-xl flex items-center justify-center"
            :style="{ backgroundColor: (account.color || '#C2410C') + '20' }"
          >
            <Icon name="lucide:percent" size="20" :style="{ color: account.color || '#C2410C' }" />
          </div>
          <div>
            <h3 class="text-base font-semibold text-ink-900">Add interest</h3>
            <div class="text-xs text-ink-500">Compounds into {{ account.name }}</div>
          </div>
        </div>

        <p class="text-xs text-ink-500 mb-4">
          Adds interest to the principal — no bank transaction, no effect on net worth.
        </p>

        <label class="label">Interest amount (₹)</label>
        <input
          v-model="interestAmount"
          type="number"
          step="any"
          min="0"
          inputmode="decimal"
          class="input mt-1.5 num"
          placeholder="0"
          autofocus
          @keyup.enter="addInterest"
        />

        <div v-if="interestError" class="mt-3 px-3 py-2 rounded-lg bg-danger-50 text-danger-700 text-xs font-medium">
          {{ interestError }}
        </div>

        <div class="flex gap-2 mt-4">
          <button @click="closeInterestModal" :disabled="savingInterest" class="btn-secondary flex-1">Cancel</button>
          <button @click="addInterest" :disabled="savingInterest" class="btn-primary flex-1">
            <Icon v-if="savingInterest" name="lucide:loader" size="14" class="animate-spin" />
            {{ savingInterest ? 'Adding…' : 'Add interest' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
