<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useAccounts, type Account } from '~/composables/useAccounts'
import { useTransactions } from '~/composables/useTransactions'
import { useAccountBalances } from '~/composables/useAccountBalances'
import { useDataVersion } from '~/composables/useDataVersion'
import { formatPaise, formatPaiseCompact } from '~/utils/money'

const { accounts, fetchAll: fetchAccounts, archive } = useAccounts()
const { transactions, fetchAll: fetchTxns } = useTransactions()
const { balances, netWorth, balanceFor } = useAccountBalances()
const { version } = useDataVersion()

const showForm = ref(false)
const editing = ref<Account | null>(null)
const showQuickAdd = ref(false)
const quickAddDefaults = ref<{ toAccountId?: string; accountId?: string; type?: 'expense' | 'income' | 'transfer' }>({})

const INVESTMENT_TYPES: Account['type'][] = ['mutual_fund', 'fixed_deposit', 'recurring_deposit']

async function load() {
  await Promise.all([fetchAccounts(), fetchTxns({ limit: 500 })])
}

onMounted(load)
watch(version, load)

const bankAccounts = computed(() =>
  accounts.value.filter((a) =>
    a.type !== 'credit_card' && !INVESTMENT_TYPES.includes(a.type) && !a.archived
  )
)
const creditCards = computed(() =>
  accounts.value.filter((a) => a.type === 'credit_card' && !a.archived)
)
const investmentAccounts = computed(() =>
  accounts.value.filter((a) => INVESTMENT_TYPES.includes(a.type) && !a.archived)
)
const primary = computed(() =>
  bankAccounts.value.find((a) => a.type === 'bank') || bankAccounts.value[0]
)

const totalBank = computed(() =>
  bankAccounts.value.reduce((s, a) => s + (balances.value.get(a.id) || 0), 0)
)
const totalCreditUsed = computed(() =>
  creditCards.value.reduce((s, a) => s + Math.abs(balances.value.get(a.id) || 0), 0)
)
const totalCreditLimit = computed(() =>
  creditCards.value.reduce((s, a) => s + (a.creditLimit || 0), 0)
)
const totalAvailable = computed(() => totalCreditLimit.value - totalCreditUsed.value)
const totalInvested = computed(() =>
  investmentAccounts.value.reduce((s, a) => s + (balances.value.get(a.id) || 0), 0)
)

function openAdd() { editing.value = null; showForm.value = true }
function openEdit(a: Account) { editing.value = a; showForm.value = true }
function onSaved() { load() }

async function onArchive(a: Account) {
  if (!confirm(`Archive "${a.name}"? Past transactions will be preserved.`)) return
  await archive(a.id)
  await load()
}

function onPayCard(a: Account) {
  quickAddDefaults.value = { type: 'transfer', toAccountId: a.id }
  showQuickAdd.value = true
}
function onAddExpense(a: Account) {
  quickAddDefaults.value = { type: 'expense' }
  showQuickAdd.value = true
}
function onQuickAddSaved() {
  showQuickAdd.value = false
  quickAddDefaults.value = {}
}
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-1">
      <h1 class="text-2xl font-bold text-ink-900">Accounts</h1>
      <button @click="openAdd" class="btn-primary">
        <Icon name="lucide:plus" size="14" />
        <span class="hidden sm:inline">Add account</span>
      </button>
    </div>
    <p class="text-sm text-ink-500 mb-6">Bank accounts, credit cards, cash, wallets, and investments</p>

    <!-- Empty state -->
    <div v-if="accounts.length === 0" class="card p-12 text-center">
      <div class="w-14 h-14 rounded-2xl bg-terra-50 mx-auto mb-3 flex items-center justify-center">
        <Icon name="lucide:wallet-cards" size="28" class="text-terra-700" />
      </div>
      <h2 class="font-bold text-ink-900 mb-1">Add your first account</h2>
      <p class="text-sm text-ink-500 max-w-md mx-auto mb-4">
        Start with your primary bank account. You can add credit cards, cash, and digital wallets too.
      </p>
      <button @click="openAdd" class="btn-primary">
        <Icon name="lucide:plus" size="14" />
        Add account
      </button>
    </div>

    <template v-else>
      <!-- Summary stats -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div class="card p-4">
          <div class="label">Net worth</div>
          <div class="num text-xl font-bold text-ink-900 mt-1">₹{{ (netWorth / 100).toLocaleString('en-IN') }}</div>
          <div class="text-[10px] text-ink-500 mt-0.5">Assets − liabilities</div>
        </div>
        <div class="card p-4">
          <div class="label">Bank & wallets</div>
          <div class="num text-xl font-bold text-ink-900 mt-1">₹{{ (totalBank / 100).toLocaleString('en-IN') }}</div>
          <div class="text-[10px] text-ink-500 mt-0.5">{{ bankAccounts.length }} {{ bankAccounts.length === 1 ? 'account' : 'accounts' }}</div>
        </div>
        <div class="card p-4">
          <div class="label">CC outstanding</div>
          <div class="num text-xl font-bold text-warn-700 mt-1">₹{{ (totalCreditUsed / 100).toLocaleString('en-IN') }}</div>
          <div class="text-[10px] text-ink-500 mt-0.5">{{ creditCards.length }} {{ creditCards.length === 1 ? 'card' : 'cards' }}</div>
        </div>
        <div class="card p-4">
          <div class="label">Total available</div>
          <div class="num text-xl font-bold text-ink-900 mt-1">₹{{ (totalAvailable / 100).toLocaleString('en-IN') }}</div>
          <div class="text-[10px] text-ink-500 mt-0.5">CC headroom</div>
        </div>
      </div>

      <!-- BANK ACCOUNTS SECTION -->
      <section v-if="bankAccounts.length > 0" class="mb-8">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-semibold text-ink-500 uppercase tracking-wider">Bank accounts & wallets</h2>
          <span class="text-[11px] text-ink-400">{{ bankAccounts.length }} {{ bankAccounts.length === 1 ? 'account' : 'accounts' }}</span>
        </div>

        <!-- Primary bank hero -->
        <NuxtLink v-if="primary" :to="`/accounts/${primary.id}`" class="block mb-4 group">
          <div
            class="rounded-2xl p-5 text-white shadow-card transition-shadow group-hover:shadow-lift relative overflow-hidden"
            :style="{ backgroundColor: primary.color || '#C2410C' }"
          >
            <div class="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-white/10" />
            <div class="absolute -right-12 -bottom-12 w-40 h-40 rounded-full bg-white/5" />
            <div class="relative">
              <div class="flex items-center justify-between mb-6">
                <div class="flex items-center gap-2.5">
                  <div class="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center">
                    <Icon :name="`lucide:${primary.icon || 'building-2'}`" size="18" />
                  </div>
                  <div>
                    <div class="text-sm font-semibold">{{ primary.name }}</div>
                    <div class="text-[11px] opacity-80 capitalize">
                      {{ primary.type.replace('_', ' ') }}
                      <span v-if="primary.last4"> · ••{{ primary.last4 }}</span>
                    </div>
                  </div>
                </div>
                <span class="text-[10px] font-semibold bg-white/20 px-2 py-0.5 rounded-full uppercase tracking-wider">Primary</span>
              </div>
              <div class="num text-3xl font-bold">₹{{ (balanceFor(primary.id) / 100).toLocaleString('en-IN') }}</div>
              <div class="text-[11px] opacity-80 mt-1">Available balance</div>
            </div>
          </div>
        </NuxtLink>

        <!-- Other bank accounts grid -->
        <div v-if="bankAccounts.length > 1" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div v-for="a in bankAccounts.filter((x) => x !== primary)" :key="a.id" class="relative group">
            <NuxtLink :to="`/accounts/${a.id}`" class="block">
              <AccountCard :account="a" />
            </NuxtLink>
            <div class="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                @click.stop.prevent="openEdit(a)"
                class="p-1.5 bg-white border border-ink-200 rounded-md text-ink-700 hover:bg-cream-50 shadow-sm"
                title="Edit"
              >
                <Icon name="lucide:pencil" size="12" />
              </button>
              <button
                @click.stop.prevent="onArchive(a)"
                class="p-1.5 bg-white border border-ink-200 rounded-md text-ink-500 hover:bg-cream-50 hover:text-danger-700 shadow-sm"
                title="Archive"
              >
                <Icon name="lucide:archive" size="12" />
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- CREDIT CARDS SECTION -->
      <section v-if="creditCards.length > 0" class="mb-8">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-semibold text-ink-500 uppercase tracking-wider">Credit cards</h2>
            <span class="text-[10px] font-medium text-ink-400 bg-cream-200 px-2 py-0.5 rounded-full">borrowed · has limit</span>
          </div>
          <span class="text-[11px] text-ink-400">{{ creditCards.length }} {{ creditCards.length === 1 ? 'card' : 'cards' }}</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div v-for="a in creditCards" :key="a.id" class="relative group">
            <CreditCardCard
              :account="a"
              @pay="onPayCard"
              @view="(acc) => navigateTo(`/accounts/${acc.id}`)"
            />
            <div class="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                @click.stop.prevent="openEdit(a)"
                class="p-1.5 bg-white border border-ink-200 rounded-md text-ink-700 hover:bg-cream-50 shadow-sm"
                title="Edit"
              >
                <Icon name="lucide:pencil" size="12" />
              </button>
              <button
                @click.stop.prevent="onArchive(a)"
                class="p-1.5 bg-white border border-ink-200 rounded-md text-ink-500 hover:bg-cream-50 hover:text-danger-700 shadow-sm"
                title="Archive"
              >
                <Icon name="lucide:archive" size="12" />
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- INVESTMENTS SECTION -->
      <section class="mt-8">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-semibold text-ink-500 uppercase tracking-wider">Investments</h2>
            <span class="text-[10px] font-medium text-ink-400 bg-cream-200 px-2 py-0.5 rounded-full">principal only</span>
          </div>
          <div class="text-[11px] text-ink-500">
            <span class="num font-semibold">{{ formatPaise(totalInvested) }}</span>
            <span class="ml-1">{{ investmentAccounts.length }} {{ investmentAccounts.length === 1 ? 'account' : 'accounts' }}</span>
          </div>
        </div>

        <div v-if="investmentAccounts.length === 0" class="card p-8 text-center">
          <div class="w-12 h-12 rounded-2xl bg-terra-50 mx-auto mb-3 flex items-center justify-center">
            <Icon name="lucide:trending-up" class="text-terra-700" size="24" />
          </div>
          <h3 class="text-sm font-semibold text-ink-900">No investments yet</h3>
          <p class="text-xs text-ink-500 mt-1 mb-3">Add a mutual fund, FD, or RD to track it here.</p>
          <button @click="openAdd" class="btn-primary text-xs">
            <Icon name="lucide:plus" size="12" />
            Add investment
          </button>
        </div>

        <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div v-for="a in investmentAccounts" :key="a.id" class="relative group">
            <InvestmentCard :account="a" />
            <div class="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                @click.stop.prevent="openEdit(a)"
                class="p-1.5 bg-white border border-ink-200 rounded-md text-ink-700 hover:bg-cream-50 shadow-sm"
                title="Edit"
              >
                <Icon name="lucide:pencil" size="12" />
              </button>
              <button
                @click.stop.prevent="onArchive(a)"
                class="p-1.5 bg-white border border-ink-200 rounded-md text-ink-500 hover:bg-cream-50 hover:text-danger-700 shadow-sm"
                title="Archive"
              >
                <Icon name="lucide:archive" size="12" />
              </button>
            </div>
          </div>
        </div>
      </section>
    </template>

    <AccountForm v-model="showForm" :account="editing" @saved="onSaved" />
    <QuickAddModal
      v-model="showQuickAdd"
      :default-type="quickAddDefaults.type"
      :default-to-account-id="quickAddDefaults.toAccountId"
      @saved="onQuickAddSaved"
    />
  </div>
</template>
