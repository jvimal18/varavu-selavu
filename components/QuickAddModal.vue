<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useAccounts } from '~/composables/useAccounts'
import { useCategories } from '~/composables/useCategories'
import { useTransactions, type Transaction } from '~/composables/useTransactions'
import { useUsers } from '~/composables/useUsers'
import { useUserSettings } from '~/composables/useUserSettings'
import { rupeesToPaise } from '~/utils/money'
import { todayISO } from '~/utils/dates'

interface Props {
  modelValue: boolean
  defaultAccountId?: string | null
  defaultToAccountId?: string | null
  defaultCategoryId?: string | null
  defaultType?: 'expense' | 'income' | 'transfer' | 'interest'
}
const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  saved: [t: Transaction]
}>()

const auth = useAuthStore()
const { accounts, fetchAll: fetchAccounts } = useAccounts()
const { categories, roots, fetchAll: fetchCategories } = useCategories()
const { create, initQuickAddForm, quickAddForm } = useTransactions()
const { users, fetchAll: fetchUsers } = useUsers()
const { settings: userSettings } = useUserSettings()

const primaryAccountId = computed(() => userSettings.value.primaryAccountId)

const type = ref<'expense' | 'income' | 'transfer' | 'interest'>(props.defaultType || 'expense')
const amountStr = ref('')               // raw user-typed string
const amountPaise = computed(() => {
  const v = parseFloat(amountStr.value)
  return isNaN(v) ? 0 : rupeesToPaise(v)
})
const date = ref(todayISO())
const accountId = ref<string | null>(props.defaultAccountId || null)
const toAccountId = ref<string | null>(null)
const categoryId = ref<string | null>(props.defaultCategoryId || null)
const description = ref('')
const spentBy = ref<string>(auth.user?.id || '')
const saving = ref(false)
const error = ref<string | null>(null)
const showCategoryPicker = ref(false)

const INVESTMENT_TYPES = new Set(['mutual_fund', 'fixed_deposit', 'recurring_deposit'])

// Account types that should never be a source (you don't spend from a CC;
// investments/FD/RD are not liquid in v1 unless you explicitly redeem them).
const NON_SOURCE_TYPES = new Set(['credit_card', 'mutual_fund', 'fixed_deposit', 'recurring_deposit'])

// Strict picker: used for expense / income and for the default "from" pre-fill
const sourceAccounts = computed(() => accounts.value.filter((a) => !NON_SOURCE_TYPES.has(a.type)))

// Interest can only be credited to an investment account
const interestAccounts = computed(() => accounts.value.filter((a) => INVESTMENT_TYPES.has(a.type)))

// For the transfer "From" select: sourceAccounts + the currently-selected account
// if it's a non-source type (so a pre-filled "Redeem from MF" still shows up).
const transferFromAccounts = computed(() => {
  const base = sourceAccounts.value
  if (type.value !== 'transfer' || !accountId.value) return base
  if (base.some((a) => a.id === accountId.value)) return base
  const extra = accounts.value.find((a) => a.id === accountId.value)
  return extra ? [...base, extra] : base
})

onMounted(async () => {
  await Promise.all([fetchAccounts(), fetchCategories(), fetchUsers()])
  if (!accountId.value && sourceAccounts.value.length > 0) {
    accountId.value = sourceAccounts.value[0].id
  }
  if (!spentBy.value && auth.user) spentBy.value = auth.user.id
})

// Reset when modal opens
watch(() => props.modelValue, async (open) => {
  if (!open) return
  // Clear stale state from a previous open; then apply any provided defaults.
  type.value = props.defaultType || 'expense'
  accountId.value = props.defaultAccountId || null
  toAccountId.value = props.defaultToAccountId || null
  categoryId.value = props.defaultCategoryId || null
  amountStr.value = ''
  date.value = todayISO()
  description.value = ''
  error.value = null
  showCategoryPicker.value = false
  await Promise.all([fetchAccounts(), fetchCategories(), fetchUsers()])
  initQuickAddForm()

  // Interest defaults
  if (type.value === 'interest') {
    if (!categoryId.value) {
      categoryId.value = defaultInterestCategory()
    }
    if (!interestAccounts.value.some((a) => a.id === accountId.value)) {
      accountId.value = interestAccounts.value[0]?.id || null
    }
    if (!spentBy.value && auth.user) spentBy.value = auth.user.id
    return
  }

  if (props.defaultCategoryId) {
    const c = categories.value.find((c) => c.id === props.defaultCategoryId)
    if (c?.type === 'income') type.value = 'income'
  }
  // For "pay card" / "invest" flows: pre-fill fromAccount to a source-able account
  if (type.value === 'transfer' && toAccountId.value) {
    const fromCandidates = accounts.value.filter(
      (a) => a.id !== toAccountId.value && !NON_SOURCE_TYPES.has(a.type),
    )
    if (fromCandidates.length > 0) {
      accountId.value = fromCandidates[0].id
    }
  }
  // For non-transfer flows, pre-fill the primary account if no default was provided
  if (type.value !== 'transfer' && !accountId.value) {
    accountId.value = quickAddForm.value.accountId
  }
  if (!accountId.value && sourceAccounts.value.length > 0) {
    accountId.value = sourceAccounts.value[0].id
  }
  if (!spentBy.value && auth.user) spentBy.value = auth.user.id
})

const NUM_KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'del'],
]

function pressKey(k: string) {
  if (k === 'del') {
    amountStr.value = amountStr.value.slice(0, -1)
    return
  }
  if (k === '.') {
    if (amountStr.value.includes('.')) return
    if (amountStr.value === '') amountStr.value = '0.'
    else amountStr.value += '.'
    return
  }
  // digit
  if (amountStr.value === '0') amountStr.value = k
  else if (amountStr.value.length >= 10) return
  else amountStr.value += k
}

function defaultInterestCategory(): string | null {
  const c = categories.value.find((c) => c.name.toLowerCase() === 'investment returns')
  if (c) return c.id
  const incomeRoots = roots('income')
  return incomeRoots[0]?.id || null
}

const currentAccount = computed(() => accounts.value.find((a) => a.id === accountId.value))
const currentToAccount = computed(() => accounts.value.find((a) => a.id === toAccountId.value))
const currentSpentBy = computed(() => users.value.find((u) => u.id === spentBy.value) || auth.user)

const accountOptions = computed(() => {
  if (type.value === 'interest') return interestAccounts.value
  if (type.value === 'transfer') return transferFromAccounts.value
  return sourceAccounts.value
})

const visibleCategories = computed(() => {
  if (type.value === 'transfer') return []
  const t: 'expense' | 'income' = type.value === 'interest' ? 'income' : type.value === 'expense' ? 'expense' : 'income'
  return roots(t)
})

function selectCategory(id: string) {
  categoryId.value = id
  showCategoryPicker.value = false
}

// When switching to interest, ensure the account is an investment account
watch(type, (t) => {
  if (t === 'interest') {
    if (!interestAccounts.value.some((a) => a.id === accountId.value)) {
      accountId.value = interestAccounts.value[0]?.id || null
    }
    if (!categoryId.value) {
      categoryId.value = defaultInterestCategory()
    }
  } else if (t !== 'transfer') {
    // expense / income cannot use an investment account as the source
    if (!sourceAccounts.value.some((a) => a.id === accountId.value)) {
      accountId.value = sourceAccounts.value[0]?.id || null
    }
  }
})

const selectedCategory = computed(() => categories.value.find((c) => c.id === categoryId.value))

function close() { emit('update:modelValue', false) }

async function save() {
  error.value = null
  if (amountPaise.value <= 0) { error.value = 'Enter an amount'; return }
  if (!accountId.value) { error.value = 'Select an account'; return }
  if (type.value === 'transfer') {
    if (!toAccountId.value) { error.value = 'Select destination account'; return }
    if (toAccountId.value === accountId.value) { error.value = 'Same account'; return }
  } else if (type.value !== 'interest') {
    if (!categoryId.value) { error.value = 'Select a category'; return }
  }
  saving.value = true
  try {
    const payload: any = {
      type: type.value,
      amount: amountPaise.value,
      accountId: accountId.value,
      date: date.value,
      description: description.value.trim() || undefined,
      spentBy: spentBy.value,
    }
    if (type.value === 'transfer') {
      payload.toAccountId = toAccountId.value
    } else {
      payload.categoryId = categoryId.value
    }
    const t = await create(payload)
    emit('saved', t)
    close()
  } catch (e: any) {
    error.value = e?.statusMessage || e?.message || 'Failed to save'
  } finally {
    saving.value = false
  }
}

// Keyboard: Esc to close, Cmd/Ctrl+Enter to save, digits/./Backspace to enter amount
function onKeydown(e: KeyboardEvent) {
  if (!props.modelValue) return
  // Don't intercept while the user is typing in a form field (description, date, select)
  const t = e.target as HTMLElement
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return

  if (e.key === 'Escape') { e.preventDefault(); close(); return }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); return }
  if (/^[0-9]$/.test(e.key)) { e.preventDefault(); pressKey(e.key); return }
  if (e.key === '.') { e.preventDefault(); pressKey('.'); return }
  if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); pressKey('del'); return }
  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); save(); return }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

const amountDisplay = computed(() => {
  if (!amountStr.value) return '0'
  return amountStr.value
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="modelValue" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center" @click.self="close">
        <div class="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" />
        <div class="relative bg-cream-100 w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-lift max-h-[95vh] flex flex-col overflow-hidden">
          <!-- Drag handle (mobile) -->
          <div class="sm:hidden flex justify-center pt-2.5 pb-1">
            <div class="w-10 h-1 rounded-full bg-ink-300" />
          </div>

          <!-- Type toggle + close -->
          <div class="px-5 pt-3 pb-3 flex items-center gap-2">
            <div class="flex bg-cream-200 rounded-xl p-1 flex-1">
              <button
                v-for="t in ['expense', 'income', 'transfer', 'interest'] as const"
                :key="t"
                type="button"
                @click="type = t; categoryId = null"
                :class="[
                  'flex-1 py-2 text-sm font-semibold rounded-lg transition-colors inline-flex items-center justify-center gap-1.5',
                  type === t ? 'bg-white text-ink-900 shadow-soft' : 'text-ink-500'
                ]"
              >
                <Icon v-if="t === 'interest'" name="lucide:percent" size="14" />
                {{ t[0].toUpperCase() + t.slice(1) }}
              </button>
            </div>
            <button @click="close" class="p-2 text-ink-500 hover:text-ink-900 hover:bg-cream-200 rounded-lg">
              <Icon name="lucide:x" size="20" />
            </button>
          </div>

          <!-- Amount display -->
          <div class="px-5 pt-2 pb-3 text-center border-b border-ink-100">
            <div class="text-[10px] text-ink-500 uppercase tracking-wider font-semibold">
              {{ type === 'transfer' ? 'Transfer amount' : type === 'interest' ? 'Interest amount' : 'Amount' }}
            </div>
            <div class="num text-5xl font-bold mt-1" :class="type === 'income' || type === 'interest' ? 'text-success-700' : type === 'transfer' ? 'text-warn-700' : 'text-terra-700'">
              ₹{{ amountDisplay }}
            </div>
          </div>

          <!-- Form fields -->
          <div class="flex-1 overflow-y-auto px-5 py-4 space-y-3.5">
            <div v-if="error" class="px-3 py-2 rounded-lg bg-danger-50 text-danger-700 text-xs font-medium">
              {{ error }}
            </div>

            <!-- Date + Account (or From/To for transfer) -->
            <div v-if="type !== 'transfer'" class="grid grid-cols-2 gap-2.5">
              <div>
                <label class="label">Date</label>
                <input v-model="date" type="date" class="input mt-1.5" />
              </div>
              <div>
                <label class="label">{{ type === 'interest' ? 'Investment' : 'Account' }}</label>
                <select v-model="accountId" class="input mt-1.5">
                  <option v-for="a in accountOptions" :key="a.id" :value="a.id">
                    {{ a.name }}<template v-if="a.id === primaryAccountId"> · Primary</template>
                  </option>
                </select>
              </div>
            </div>

            <div v-else class="space-y-2.5">
              <div>
                <label class="label">From</label>
                <select v-model="accountId" class="input mt-1.5">
                  <option v-for="a in transferFromAccounts" :key="a.id" :value="a.id">
                    {{ a.name }}<template v-if="a.id === primaryAccountId"> · Primary</template>
                  </option>
                </select>
              </div>
              <div>
                <label class="label">To</label>
                <select v-model="toAccountId" class="input mt-1.5">
                  <option :value="null" disabled>Choose destination</option>
                  <option v-for="a in accounts.filter(x => x.id !== accountId)" :key="a.id" :value="a.id">
                    {{ a.name }}<template v-if="a.id === primaryAccountId"> · Primary</template>
                  </option>
                </select>
              </div>
            </div>

            <!-- Category (expense / income / interest) -->
            <div v-if="type !== 'transfer'">
              <label class="label">Category</label>
              <button
                v-if="selectedCategory && !showCategoryPicker"
                type="button"
                @click="showCategoryPicker = true"
                class="w-full mt-1.5 flex items-center gap-2.5 px-3 py-2.5 bg-white border border-ink-200 rounded-lg hover:border-ink-300 text-left"
              >
                <div
                  class="w-7 h-7 rounded-lg flex items-center justify-center"
                  :style="{ backgroundColor: (selectedCategory.color || '#A8A29E') + '20' }"
                >
                  <Icon :name="`lucide:${selectedCategory.icon || 'circle-dot'}`" size="14" :style="{ color: selectedCategory.color || '#A8A29E' }" />
                </div>
                <span class="text-sm font-medium text-ink-900 flex-1">{{ selectedCategory.name }}</span>
                <Icon name="lucide:chevron-down" size="16" class="text-ink-400" />
              </button>
              <button
                v-else
                type="button"
                @click="showCategoryPicker = true"
                class="w-full mt-1.5 flex items-center gap-2.5 px-3 py-2.5 bg-cream-50 border border-dashed border-ink-300 rounded-lg text-left text-ink-500 text-sm"
              >
                <Icon name="lucide:plus" size="16" />
                Select category
              </button>

              <!-- Category grid (expandable) -->
              <div v-if="showCategoryPicker" class="mt-2 p-3 bg-cream-50 rounded-xl border border-ink-200 max-h-64 overflow-y-auto">
                <div class="grid grid-cols-4 gap-2">
                  <button
                    v-for="c in visibleCategories"
                    :key="c.id"
                    type="button"
                    @click="selectCategory(c.id)"
                    :class="[
                      'flex flex-col items-center gap-1 p-2 rounded-lg transition-colors',
                      categoryId === c.id ? 'bg-terra-50 ring-1 ring-terra-700' : 'hover:bg-white'
                    ]"
                  >
                    <div
                      class="w-9 h-9 rounded-lg flex items-center justify-center"
                      :style="{ backgroundColor: (c.color || '#A8A29E') + '20' }"
                    >
                      <Icon :name="`lucide:${c.icon || 'circle-dot'}`" size="16" :style="{ color: c.color || '#A8A29E' }" />
                    </div>
                    <span class="text-[10px] font-medium text-ink-700 text-center leading-tight">{{ c.name }}</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- Spent by / Received by (hidden for transfers and interest) -->
            <div v-if="type !== 'transfer' && type !== 'interest'">
              <label class="label">{{ type === 'income' ? 'Received by' : 'Spent by' }}</label>
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
                  <div
                    class="avatar w-5 h-5 rounded-full text-[10px]"
                    :style="{ backgroundColor: u.color }"
                  >{{ u.name[0] }}</div>
                  {{ u.name }}
                </button>
              </div>
            </div>

            <!-- Description -->
            <div>
              <label class="label">Description <span class="text-ink-400 normal-case font-normal">(optional)</span></label>
              <input v-model="description" type="text" placeholder="What was it for?" class="input mt-1.5" />
            </div>
          </div>

          <!-- Numeric pad + Save -->
          <div class="bg-white border-t border-ink-200 px-3 py-3 pb-5 sm:pb-3">
            <div class="grid grid-cols-3 gap-2 mb-3">
              <template v-for="(row, ri) in NUM_KEYS" :key="ri">
                <button
                  v-for="k in row"
                  :key="k"
                  type="button"
                  @click="pressKey(k)"
                  :class="[
                    'h-12 rounded-xl text-lg font-semibold transition-colors inline-flex items-center justify-center',
                    k === 'del' ? 'bg-cream-100 text-ink-700 hover:bg-cream-200' : 'bg-cream-100 text-ink-900 hover:bg-cream-200 num'
                  ]"
                >
                  <template v-if="k === 'del'">
                    <Icon name="lucide:delete" size="20" />
                  </template>
                  <template v-else>{{ k }}</template>
                </button>
              </template>
            </div>
            <button
              type="button"
              @click="save"
              :disabled="saving"
              class="w-full py-3 rounded-xl text-sm font-semibold transition-colors"
              :class="[
                type === 'income' || type === 'interest' ? 'bg-success-700 hover:bg-success-600' : type === 'transfer' ? 'bg-warn-700 hover:bg-warn-600' : 'bg-terra-700 hover:bg-terra-800',
                'text-white disabled:opacity-50'
              ]"
            >
              {{ saving ? 'Saving…' : (type === 'interest' ? 'Add interest' : type === 'income' ? 'Add income' : type === 'transfer' ? 'Transfer' : 'Save expense') }}
            </button>
            <p class="text-[10px] text-ink-400 text-center mt-1.5 hidden sm:block">
              Press <kbd class="px-1 bg-cream-100 border border-ink-200 rounded">⌘ Enter</kbd> to save · <kbd class="px-1 bg-cream-100 border border-ink-200 rounded">Esc</kbd> to close
            </p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 150ms ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
