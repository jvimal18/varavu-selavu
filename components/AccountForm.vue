<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useAccounts, type Account } from '~/composables/useAccounts'
import { rupeesToPaise } from '~/utils/money'

interface Props {
  modelValue: boolean
  account?: Account | null
}
const props = defineProps<Props>()
const emit = defineEmits<{ 'update:modelValue': [v: boolean]; saved: [a: Account] }>()

const { create, update } = useAccounts()

const TYPE_OPTIONS: Array<{ value: Account['type']; label: string; icon: string; defaultColor: string; defaultIcon: string }> = [
  { value: 'bank', label: 'Bank', icon: 'building-2', defaultColor: '#C2410C', defaultIcon: 'building-2' },
  { value: 'credit_card', label: 'Credit card', icon: 'credit-card', defaultColor: '#B45309', defaultIcon: 'credit-card' },
  { value: 'cash', label: 'Cash', icon: 'banknote', defaultColor: '#15803D', defaultIcon: 'banknote' },
  { value: 'digital_wallet', label: 'Wallet', icon: 'smartphone', defaultColor: '#6D28D9', defaultIcon: 'smartphone' },
  { value: 'other', label: 'Other', icon: 'circle-dot', defaultColor: '#78716C', defaultIcon: 'circle-dot' },
]

const COLOR_OPTIONS = ['#C2410C', '#B45309', '#15803D', '#0F766E', '#6D28D9', '#BE185D', '#0EA5E9', '#78716C', '#A8A29E']

const isEdit = computed(() => !!props.account)
const name = ref('')
const type = ref<Account['type']>('bank')
const institution = ref('')
const last4 = ref('')
const openingRupees = ref('0')
const creditLimitRupees = ref('')
const statementDay = ref<number | null>(null)
const dueDay = ref<number | null>(null)
const color = ref('#C2410C')
const saving = ref(false)
const error = ref<string | null>(null)

watch(() => props.modelValue, (open) => {
  if (!open) return
  error.value = null
  if (props.account) {
    name.value = props.account.name
    type.value = props.account.type
    institution.value = props.account.institution || ''
    last4.value = props.account.last4 || ''
    openingRupees.value = (props.account.openingBalance / 100).toString()
    creditLimitRupees.value = props.account.creditLimit ? (props.account.creditLimit / 100).toString() : ''
    statementDay.value = props.account.statementDay
    dueDay.value = props.account.dueDay
    color.value = props.account.color || '#C2410C'
  } else {
    name.value = ''
    type.value = 'bank'
    institution.value = ''
    last4.value = ''
    openingRupees.value = '0'
    creditLimitRupees.value = ''
    statementDay.value = null
    dueDay.value = null
    color.value = '#C2410C'
  }
})

watch(type, (t) => {
  const opt = TYPE_OPTIONS.find((o) => o.value === t)
  if (opt) color.value = opt.defaultColor
})

function close() { emit('update:modelValue', false) }

async function submit() {
  error.value = null
  if (!name.value.trim()) { error.value = 'Name is required'; return }
  const opening = parseFloat(openingRupees.value)
  if (isNaN(opening)) { error.value = 'Opening balance must be a number'; return }
  const payload: any = {
    name: name.value.trim(),
    type: type.value,
    institution: institution.value || null,
    last4: last4.value || null,
    openingBalance: rupeesToPaise(opening),
    color: color.value,
    icon: TYPE_OPTIONS.find((o) => o.value === type.value)?.defaultIcon || 'circle-dot',
  }
  if (type.value === 'credit_card') {
    const limit = parseFloat(creditLimitRupees.value)
    if (isNaN(limit) || limit <= 0) { error.value = 'Credit limit is required for credit cards'; return }
    payload.creditLimit = rupeesToPaise(limit)
    payload.statementDay = statementDay.value
    payload.dueDay = dueDay.value
  }
  saving.value = true
  try {
    const result = isEdit.value && props.account
      ? await update(props.account.id, payload)
      : await create(payload)
    emit('saved', result)
    close()
  } catch (e: any) {
    error.value = e?.statusMessage || e?.message || 'Failed to save account'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="modelValue" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" @click.self="close">
        <div class="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" />
        <div class="relative bg-cream-100 rounded-t-3xl sm:rounded-3xl shadow-lift w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
          <div class="sticky top-0 bg-cream-100 z-10 px-5 pt-4 pb-3 border-b border-ink-100 flex items-center justify-between">
            <h2 class="text-lg font-bold text-ink-900">{{ isEdit ? 'Edit account' : 'Add account' }}</h2>
            <button @click="close" class="p-1 text-ink-500 hover:text-ink-900 hover:bg-cream-200 rounded-lg">
              <Icon name="lucide:x" size="20" />
            </button>
          </div>

          <form @submit.prevent="submit" class="p-5 space-y-4">
            <div v-if="error" class="px-3 py-2 rounded-lg bg-danger-50 text-danger-700 text-xs font-medium">
              {{ error }}
            </div>

            <!-- Type -->
            <div>
              <label class="label">Type</label>
              <div class="grid grid-cols-5 gap-1.5 mt-1.5">
                <button
                  v-for="opt in TYPE_OPTIONS"
                  :key="opt.value"
                  type="button"
                  @click="type = opt.value"
                  :class="[
                    'flex flex-col items-center gap-1 py-2.5 rounded-xl border-2 transition-colors',
                    type === opt.value ? 'border-terra-700 bg-terra-50' : 'border-ink-200 hover:border-ink-300 bg-white'
                  ]"
                >
                  <Icon :name="`lucide:${opt.icon}`" size="18" :class="type === opt.value ? 'text-terra-700' : 'text-ink-700'" />
                  <span class="text-[10px] font-medium" :class="type === opt.value ? 'text-terra-700' : 'text-ink-700'">{{ opt.label }}</span>
                </button>
              </div>
            </div>

            <!-- Name -->
            <div>
              <label class="label">Name</label>
              <input v-model="name" type="text" placeholder="e.g. HDFC Savings" class="input mt-1.5" autofocus />
            </div>

            <!-- Institution + last4 -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label">Bank / issuer <span class="text-ink-400 normal-case font-normal">(optional)</span></label>
                <input v-model="institution" type="text" placeholder="HDFC, ICICI, SBI…" class="input mt-1.5" />
              </div>
              <div v-if="type === 'credit_card'">
                <label class="label">Last 4 digits</label>
                <input v-model="last4" type="text" inputmode="numeric" maxlength="4" placeholder="7842" class="input mt-1.5 num" />
              </div>
            </div>

            <!-- Opening balance -->
            <div>
              <label class="label">
                {{ type === 'credit_card' ? 'Current outstanding (₹)' : 'Opening balance (₹)' }}
              </label>
              <input v-model="openingRupees" type="number" step="0.01" min="0" class="input mt-1.5 num" />
              <p class="text-[11px] text-ink-500 mt-1">
                {{ type === 'credit_card' ? 'Amount you currently owe on this card.' : 'Balance when you started tracking.' }}
              </p>
            </div>

            <!-- Credit card fields -->
            <template v-if="type === 'credit_card'">
              <div>
                <label class="label">Credit limit (₹)</label>
                <input v-model="creditLimitRupees" type="number" step="0.01" min="0" class="input mt-1.5 num" />
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="label">Statement day (1-31)</label>
                  <input v-model.number="statementDay" type="number" min="1" max="31" class="input mt-1.5 num" placeholder="15" />
                </div>
                <div>
                  <label class="label">Payment due day (1-31)</label>
                  <input v-model.number="dueDay" type="number" min="1" max="31" class="input mt-1.5 num" placeholder="5" />
                </div>
              </div>
            </template>

            <!-- Color -->
            <div>
              <label class="label">Color</label>
              <div class="flex items-center gap-2 mt-1.5">
                <button
                  v-for="c in COLOR_OPTIONS"
                  :key="c"
                  type="button"
                  @click="color = c"
                  :class="[
                    'w-7 h-7 rounded-lg transition-all',
                    color === c ? 'ring-2 ring-ink-900 ring-offset-2 ring-offset-cream-100 scale-110' : ''
                  ]"
                  :style="{ backgroundColor: c }"
                />
              </div>
            </div>

            <div class="flex gap-2 pt-2">
              <button type="button" @click="close" class="flex-1 btn-secondary">Cancel</button>
              <button type="submit" :disabled="saving" class="flex-1 btn-primary">
                {{ saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Add account') }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 150ms ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
