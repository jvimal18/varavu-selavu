<script lang="ts">
// Re-export the shared period type so consumers can import it from this
// component file: `import type { PeriodKey } from '~/components/dashboard/PeriodSelector.vue'`
export type { PeriodKey } from '~/composables/useDashboard'
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useUserSettings } from '~/composables/useUserSettings'
import { formatPaiseCompact, rupeesToPaise } from '~/utils/money'
import type { PeriodKey } from '~/composables/useDashboard'

export interface PeriodValue {
  period: PeriodKey
  from?: string
  to?: string
}

const PRESETS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_30', label: 'Last 30 days' },
  { key: 'last_90', label: 'Last 90 days' },
  { key: 'since_last_salary', label: 'Since salary' },
  { key: 'custom', label: 'Custom' },
]

const model = defineModel<PeriodValue>({ default: () => ({ period: 'last_30' }) })

const props = defineProps<{
  periodIncome: number
  periodExpense: number
  monthBudget: number
  monthBudgetSet: boolean
  periodLabel: string
}>()

const { setMonthlyBudget, pending: settingsPending } = useUserSettings()
const editingBudget = ref(false)
const budgetInput = ref('')

const from = ref(model.value.from ?? '')
const to = ref(model.value.to ?? '')
const error = ref('')

// Keep the draft date inputs in sync when the model is set externally
// (e.g. initial load or a parent restoring a saved custom range).
watch(
  model,
  (v) => {
    if (v.period === 'custom') {
      if (v.from !== undefined) from.value = v.from
      if (v.to !== undefined) to.value = v.to
    }
  },
  { deep: true }
)

const isCustom = computed(() => model.value.period === 'custom')

const expenseBudgetPct = computed(() => {
  if (!props.monthBudget) return 0
  return Math.round((props.periodExpense / props.monthBudget) * 100)
})

function select(key: PeriodKey) {
  if (key === model.value.period) return
  error.value = ''
  model.value = { ...model.value, period: key }
}

function apply() {
  if (!from.value || !to.value) {
    error.value = 'Select both dates'
    return
  }
  if (from.value > to.value) {
    error.value = 'To must be on or after From'
    return
  }
  error.value = ''
  model.value = { period: 'custom', from: from.value, to: to.value }
}

function startEditBudget() {
  editingBudget.value = true
  budgetInput.value = props.monthBudget ? String(props.monthBudget / 100) : ''
}

async function saveBudget() {
  const rupees = parseFloat(budgetInput.value)
  if (isNaN(rupees) || rupees < 0) return
  await setMonthlyBudget(rupeesToPaise(rupees))
  editingBudget.value = false
  budgetInput.value = ''
}

function cancelBudget() {
  editingBudget.value = false
  budgetInput.value = ''
}
</script>

<template>
  <div class="card p-3 flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-1.5">
      <button
        v-for="p in PRESETS"
        :key="p.key"
        type="button"
        class="px-3.5 py-1.5 rounded-full text-sm font-semibold transition-colors"
        :class="model.period === p.key
          ? 'bg-terra-700 text-white'
          : 'bg-cream-100 text-ink-700 hover:bg-cream-200'"
        @click="select(p.key)"
      >
        <span v-if="p.key === 'custom'" class="inline-flex items-center gap-1.5">
          <Icon name="lucide:calendar" size="14" />
          {{ p.label }}
        </span>
        <template v-else>{{ p.label }}</template>
      </button>
    </div>

    <div v-if="isCustom" class="flex flex-wrap items-end gap-2">
      <label class="flex flex-col gap-1">
        <span class="label">From</span>
        <input
          v-model="from"
          type="date"
          class="px-3 py-2 bg-white border border-ink-200 rounded-lg text-sm text-ink-900 focus:border-terra-700 focus:outline-none"
          @keydown.enter="apply"
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="label">To</span>
        <input
          v-model="to"
          type="date"
          class="px-3 py-2 bg-white border border-ink-200 rounded-lg text-sm text-ink-900 focus:border-terra-700 focus:outline-none"
          @keydown.enter="apply"
        />
      </label>
      <button type="button" class="btn-primary" @click="apply">Apply</button>
      <span v-if="error" class="text-xs text-danger-600 pb-2">{{ error }}</span>
    </div>

    <!-- Period secondary stats: Income / Expense + monthly budget widget.
         On mobile (<sm) the periodLabel is dropped from the labels (it's
         already shown by the chips above) to keep the row inside the card;
         the periodLabel returns from sm up. The budget editor wraps to a
         new line on narrow viewports. -->
    <div class="border-t border-ink-100 pt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div class="flex items-baseline gap-2 min-w-0 flex-shrink">
        <span class="label">Income<span class="hidden sm:inline"> · {{ periodLabel }}</span></span>
        <span class="num text-sm font-bold text-ink-900 whitespace-nowrap">₹{{ Math.round(periodIncome / 100).toLocaleString('en-IN') }}</span>
      </div>

      <div class="flex flex-col gap-1 min-w-0 flex-1 basis-full sm:basis-auto">
        <div class="flex items-baseline gap-2 flex-wrap">
          <span class="label">Expense<span class="hidden sm:inline"> · {{ periodLabel }}</span></span>
          <span class="num text-sm font-bold text-ink-900 whitespace-nowrap">₹{{ Math.round(periodExpense / 100).toLocaleString('en-IN') }}</span>
        </div>
        <div v-if="monthBudgetSet" class="flex items-center gap-1.5 text-[11px] flex-wrap">
          <span class="text-ink-500">{{ expenseBudgetPct }}% of {{ formatPaiseCompact(monthBudget) }} budget</span>
          <div class="flex-1 h-1 bg-cream-200 rounded-full overflow-hidden min-w-[4rem]">
            <div
              class="h-full rounded-full"
              :class="expenseBudgetPct > 100 ? 'bg-danger-600' : expenseBudgetPct > 80 ? 'bg-warn-600' : 'bg-terra-700'"
              :style="{ width: Math.min(100, expenseBudgetPct) + '%' }"
            />
          </div>
        </div>
        <div v-else class="flex flex-wrap items-center gap-2">
          <button
            v-if="!editingBudget"
            type="button"
            class="inline-flex items-center gap-1 text-xs font-medium text-terra-700 hover:text-terra-800"
            @click="startEditBudget"
          >
            <Icon name="lucide:plus" size="12" />
            Set budget
          </button>
          <div v-else class="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <div class="relative flex-1 sm:flex-initial min-w-0">
              <span class="absolute left-2 top-1/2 -translate-y-1/2 text-ink-500 text-xs">₹</span>
              <input
                v-model="budgetInput"
                type="number"
                min="0"
                step="1"
                placeholder="Monthly budget"
                class="input pl-6 text-xs py-1.5 w-full sm:w-36"
              />
            </div>
            <button
              type="button"
              :disabled="settingsPending"
              class="btn-primary text-xs py-1.5 px-2.5"
              @click="saveBudget"
            >
              {{ settingsPending ? 'Saving…' : 'Save' }}
            </button>
            <button
              type="button"
              class="btn-ghost text-xs py-1.5 px-2.5"
              @click="cancelBudget"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
