<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatPaiseCompact, rupeesToPaise } from '~/utils/money'
import { useUserSettings } from '~/composables/useUserSettings'

const props = defineProps<{
  netWorth: number
  periodIncome: number
  periodExpense: number
  periodSavingsAmount: number
  monthBudget: number
  monthBudgetSet: boolean
  periodLabel: string
  accountsCount: number
}>()

const { setMonthlyBudget, pending: settingsPending } = useUserSettings()
const editingBudget = ref(false)
const budgetInput = ref('')

const expenseBudgetPct = computed(() => {
  if (!props.monthBudget) return 0
  return Math.round((props.periodExpense / props.monthBudget) * 100)
})

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
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
    <div class="card p-4 md:p-5">
      <div class="label">Net Worth</div>
      <div class="num text-[clamp(1.125rem,3vw,1.5rem)] font-bold text-ink-900 mt-2">₹{{ (netWorth / 100).toLocaleString('en-IN') }}</div>
      <div class="text-[11px] text-ink-500 mt-1.5">{{ accountsCount }} accounts</div>
    </div>
    <div class="card p-4 md:p-5">
      <div class="label">Income · {{ periodLabel }}</div>
      <div class="num text-[clamp(1.125rem,3vw,1.5rem)] font-bold text-ink-900 mt-2">₹{{ (periodIncome / 100).toLocaleString('en-IN') }}</div>
    </div>
    <div class="card p-4 md:p-5">
      <div class="label">Expense · {{ periodLabel }}</div>
      <div class="num text-[clamp(1.125rem,3vw,1.5rem)] font-bold text-ink-900 mt-2">₹{{ (periodExpense / 100).toLocaleString('en-IN') }}</div>
      <div v-if="monthBudgetSet" class="flex items-center gap-1.5 mt-1.5 text-[11px]">
        <span class="text-ink-500">{{ expenseBudgetPct }}% of {{ formatPaiseCompact(monthBudget) }}</span>
        <div class="flex-1 h-1 bg-cream-200 rounded-full overflow-hidden">
          <div
            class="h-full rounded-full"
            :class="expenseBudgetPct > 100 ? 'bg-danger-600' : expenseBudgetPct > 80 ? 'bg-warn-600' : 'bg-terra-700'"
            :style="{ width: Math.min(100, expenseBudgetPct) + '%' }"
          />
        </div>
      </div>
      <div v-else class="mt-1.5">
        <button
          v-if="!editingBudget"
          type="button"
          class="inline-flex items-center gap-1 text-xs font-medium text-terra-700 hover:text-terra-800"
          @click="startEditBudget"
        >
          <Icon name="lucide:plus" size="12" />
          Set budget
        </button>
        <div v-else class="flex items-center gap-2">
          <div class="relative flex-1">
            <span class="absolute left-2 top-1/2 -translate-y-1/2 text-ink-500 text-xs">₹</span>
            <input
              v-model="budgetInput"
              type="number"
              min="0"
              step="1"
              placeholder="Monthly budget"
              class="input pl-6 text-xs py-1.5"
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
    <div class="card p-4 md:p-5">
      <div class="label">Savings · {{ periodLabel }}</div>
      <div class="num text-[clamp(1.125rem,3vw,1.5rem)] font-bold mt-2" :class="periodSavingsAmount >= 0 ? 'text-terra-700' : 'text-danger-600'">
        {{ formatPaiseCompact(periodSavingsAmount) }}
      </div>
      <div class="text-[11px] text-ink-500 mt-1.5">
        {{ periodSavingsAmount >= 0 ? 'Income − expense' : `Overspent by ${formatPaiseCompact(Math.abs(periodSavingsAmount))}` }}
      </div>
    </div>
  </div>
</template>
