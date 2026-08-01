<script lang="ts">
// Re-export the shared period type so consumers can import it from this
// component file: `import type { PeriodKey } from '~/components/dashboard/PeriodSelector.vue'`
export type { PeriodKey } from '~/composables/useDashboard'
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
  { key: 'custom', label: 'Custom' },
]

const model = defineModel<PeriodValue>({ default: () => ({ period: 'last_30' }) })

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
  </div>
</template>
