<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useTransactions, type Transaction } from '~/composables/useTransactions'
import { useCategories } from '~/composables/useCategories'
import { useAccounts } from '~/composables/useAccounts'
import { useUsers } from '~/composables/useUsers'
import { useAuthStore } from '~/stores/auth'
import { rupeesToPaise } from '~/utils/money'
import { todayISO } from '~/utils/dates'

const route = useRoute()
const auth = useAuthStore()
const { transactions, fetchAll, update, remove } = useTransactions()
const { categories, roots, fetchAll: fetchCats } = useCategories()
const { accounts, fetchAll: fetchAccts } = useAccounts()
const { users, fetchAll: fetchUsers } = useUsers()

const txn = ref<Transaction | null>(null)
const type = ref<'expense' | 'income' | 'transfer'>('expense')
const amountRupees = ref('0')
const date = ref(todayISO())
const accountId = ref<string | null>(null)
const toAccountId = ref<string | null>(null)
const categoryId = ref<string | null>(null)
const description = ref('')
const spentBy = ref<string>(auth.user?.id || '')
const saving = ref(false)
const error = ref<string | null>(null)

onMounted(async () => {
  await Promise.all([fetchAll({ limit: 500 }), fetchCats(), fetchAccts(), fetchUsers()])
  load()
})
watch(() => route.params.id, () => load())

function load() {
  const t = transactions.value.find((x) => x.id === route.params.id)
  if (!t) {
    txn.value = null
    return
  }
  txn.value = t
  type.value = t.type
  amountRupees.value = (t.amount / 100).toString()
  date.value = t.date
  accountId.value = t.accountId
  toAccountId.value = t.toAccountId
  categoryId.value = t.categoryId
  description.value = t.description || ''
  spentBy.value = t.spentBy
  error.value = null
}

const visibleCategories = computed(() => {
  if (type.value === 'transfer') return []
  return roots(type.value)
})

async function save() {
  if (!txn.value) return
  error.value = null
  const amount = rupeesToPaise(parseFloat(amountRupees.value))
  if (amount <= 0) { error.value = 'Amount must be positive'; return }
  saving.value = true
  try {
    const patch: any = {
      type: type.value,
      amount,
      date: date.value,
      accountId: accountId.value,
      description: description.value.trim() || null,
      spentBy: spentBy.value,
    }
    if (type.value === 'transfer') {
      patch.toAccountId = toAccountId.value
      patch.categoryId = null
    } else {
      patch.categoryId = categoryId.value
      patch.toAccountId = null
    }
    await update(txn.value.id, patch)
    await fetchAll({ limit: 500 })
    load()
  } catch (e: any) {
    error.value = e?.statusMessage || e?.message || 'Save failed'
  } finally {
    saving.value = false
  }
}

async function onDelete() {
  if (!txn.value) return
  if (!confirm('Delete this transaction? This cannot be undone.')) return
  await remove(txn.value.id)
  await navigateTo('/transactions')
}
</script>

<template>
  <div v-if="!txn" class="card p-12 text-center">
    <p class="text-ink-500">Transaction not found.</p>
    <NuxtLink to="/transactions" class="text-terra-700 font-semibold mt-2 inline-block">← Back to transactions</NuxtLink>
  </div>
  <div v-else>
    <NuxtLink to="/transactions" class="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-900 mb-3">
      <Icon name="lucide:arrow-left" size="14" />
      All transactions
    </NuxtLink>

    <h1 class="text-2xl font-bold text-ink-900 mb-5">Edit transaction</h1>

    <form @submit.prevent="save" class="card p-5 space-y-4 max-w-xl">
      <div v-if="error" class="px-3 py-2 rounded-lg bg-danger-50 text-danger-700 text-xs font-medium">{{ error }}</div>

      <!-- Type -->
      <div>
        <label class="label">Type</label>
        <div class="flex bg-cream-200 rounded-xl p-1 mt-1.5">
          <button
            v-for="t in (['expense', 'income', 'transfer'] as const)"
            :key="t"
            type="button"
            @click="type = t"
            :class="[
              'flex-1 py-2 text-sm font-semibold rounded-lg transition-colors',
              type === t ? 'bg-white text-ink-900 shadow-soft' : 'text-ink-500'
            ]"
          >{{ t[0].toUpperCase() + t.slice(1) }}</button>
        </div>
      </div>

      <!-- Amount -->
      <div>
        <label class="label">Amount (₹)</label>
        <input v-model="amountRupees" type="number" step="0.01" min="0" class="input mt-1.5 num text-2xl font-bold" />
      </div>

      <!-- Date -->
      <div>
        <label class="label">Date</label>
        <input v-model="date" type="date" class="input mt-1.5" />
      </div>

      <!-- Account / To-account -->
      <div v-if="type !== 'transfer'" class="grid grid-cols-2 gap-3">
        <div>
          <label class="label">Account</label>
          <select v-model="accountId" class="input mt-1.5">
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </div>
        <div>
          <label class="label">Category</label>
          <select v-model="categoryId" class="input mt-1.5">
            <option :value="null" disabled>Select…</option>
            <option v-for="c in visibleCategories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
      </div>
      <div v-else class="space-y-3">
        <div>
          <label class="label">From</label>
          <select v-model="accountId" class="input mt-1.5">
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </div>
        <div>
          <label class="label">To</label>
          <select v-model="toAccountId" class="input mt-1.5">
            <option :value="null" disabled>Choose destination</option>
            <option v-for="a in accounts.filter(x => x.id !== accountId)" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </div>
      </div>

      <!-- Spent by -->
      <div>
        <label class="label">Spent by</label>
        <div class="flex bg-cream-200 rounded-xl p-1 mt-1.5">
          <button
            v-for="u in users"
            :key="u.id"
            type="button"
            @click="spentBy = u.id"
            :class="[
              'flex-1 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors',
              spentBy === u.id ? 'bg-white text-ink-900 shadow-soft' : 'text-ink-500'
            ]"
          >
            <div class="avatar w-5 h-5 rounded-full text-[10px]" :style="{ backgroundColor: u.color }">{{ u.name[0] }}</div>
            {{ u.name }}
          </button>
        </div>
      </div>

      <!-- Description -->
      <div>
        <label class="label">Description</label>
        <input v-model="description" type="text" placeholder="What was it for?" class="input mt-1.5" />
      </div>

      <div class="flex gap-2 pt-2">
        <button type="button" @click="onDelete" class="btn-ghost text-danger-700 hover:bg-danger-50">
          <Icon name="lucide:trash-2" size="14" />
          Delete
        </button>
        <div class="flex-1" />
        <NuxtLink to="/transactions" class="btn-secondary">Cancel</NuxtLink>
        <button type="submit" :disabled="saving" class="btn-primary">
          {{ saving ? 'Saving…' : 'Save changes' }}
        </button>
      </div>
    </form>
  </div>
</template>
