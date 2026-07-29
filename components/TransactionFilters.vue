<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import type { TransactionFilters } from '~/composables/useTransactions'
import { useAccounts } from '~/composables/useAccounts'
import { useCategories } from '~/composables/useCategories'
import { useUsers } from '~/composables/useUsers'

const props = defineProps<{ modelValue: TransactionFilters }>()
const emit = defineEmits<{ 'update:modelValue': [v: TransactionFilters] }>()

const { accounts, fetchAll: fetchAccounts } = useAccounts()
const { categories, fetchAll: fetchCategories } = useCategories()
const { users, fetchAll: fetchUsers } = useUsers()

onMounted(() => Promise.all([fetchAccounts(), fetchCategories(), fetchUsers()]))

const search = ref(props.modelValue.q || '')

watch(search, (v) => {
  emit('update:modelValue', { ...props.modelValue, q: v || undefined })
})

function setFilter<K extends keyof TransactionFilters>(key: K, value: TransactionFilters[K] | undefined) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function setDatePreset(preset: 'this-month' | 'last-month' | 'all') {
  if (preset === 'all') {
    const v = { ...props.modelValue }
    delete v.from
    delete v.to
    emit('update:modelValue', v)
    return
  }
  const now = new Date()
  let from: Date, to: Date
  if (preset === 'this-month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1)
    to = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  } else {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    to = new Date(now.getFullYear(), now.getMonth(), 0)
  }
  emit('update:modelValue', {
    ...props.modelValue,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  })
}

const datePreset = ref<'this-month' | 'last-month' | 'all'>('this-month')
function isThisMonth() {
  const now = new Date()
  const fm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return props.modelValue.from?.startsWith(fm) || (!props.modelValue.from && !props.modelValue.to)
}
watch(() => props.modelValue, () => {
  if (!props.modelValue.from && !props.modelValue.to) datePreset.value = 'all'
  else if (isThisMonth()) datePreset.value = 'this-month'
  else datePreset.value = 'last-month'
}, { immediate: true })

const activeCount = computed(() => {
  let n = 0
  const f = props.modelValue
  if (f.accountId) n++
  if (f.categoryId) n++
  if (f.spentBy) n++
  if (f.type) n++
  if (f.q) n++
  return n
})
</script>

<template>
  <div class="space-y-2.5">
    <!-- Date presets -->
    <div class="flex items-center gap-2 flex-wrap">
      <button
        v-for="p in ['this-month', 'last-month', 'all'] as const"
        :key="p"
        @click="setDatePreset(p); datePreset = p"
        :class="[
          'chip text-xs font-semibold border',
          datePreset === p ? 'border-terra-700 bg-terra-50 text-terra-700' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300'
        ]"
      >
        {{ p === 'this-month' ? 'This month' : p === 'last-month' ? 'Last month' : 'All time' }}
      </button>

      <span v-if="activeCount > 0" class="chip border border-ink-200 bg-white text-ink-500 text-xs font-medium">
        {{ activeCount }} more filter{{ activeCount > 1 ? 's' : '' }}
      </span>
    </div>

    <!-- Dropdowns + search -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
      <select
        :value="modelValue.accountId || ''"
        @change="setFilter('accountId', ($event.target as HTMLSelectElement).value || undefined)"
        class="input text-sm"
      >
        <option value="">All accounts</option>
        <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>

      <select
        :value="modelValue.categoryId || ''"
        @change="setFilter('categoryId', ($event.target as HTMLSelectElement).value || undefined)"
        class="input text-sm"
      >
        <option value="">All categories</option>
        <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>

      <select
        :value="modelValue.spentBy || ''"
        @change="setFilter('spentBy', ($event.target as HTMLSelectElement).value || undefined)"
        class="input text-sm"
      >
        <option value="">Spent by anyone</option>
        <option v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</option>
      </select>

      <div class="relative">
        <Icon name="lucide:search" size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          v-model="search"
          type="text"
          placeholder="Search…"
          class="input pl-9 text-sm"
        />
      </div>
    </div>

    <!-- Type chips -->
    <div class="flex items-center gap-1.5">
      <button
        @click="setFilter('type', undefined)"
        :class="[
          'chip',
          !modelValue.type ? 'border-ink-200 bg-cream-200 text-ink-700' : 'border border-ink-200 bg-white text-ink-500'
        ]"
      >All</button>
      <button
        v-for="t in (['expense', 'income', 'transfer'] as const)"
        :key="t"
        @click="setFilter('type', t)"
        :class="[
          'chip capitalize',
          modelValue.type === t ? 'border-terra-700 bg-terra-50 text-terra-700' : 'border border-ink-200 bg-white text-ink-700 hover:border-ink-300'
        ]"
      >{{ t }}</button>
    </div>
  </div>
</template>

<script lang="ts">
import { computed } from 'vue'
export default { name: 'TransactionFilters' }
</script>
