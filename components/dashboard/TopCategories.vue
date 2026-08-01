<script setup lang="ts">
import { computed } from 'vue'

interface CategoryStat {
  categoryId: string
  name: string
  color: string
  amount: number
}

const props = defineProps<{
  categories: CategoryStat[]
  month: string
}>()

const maxCategoryAmount = computed(() => {
  if (!props.categories.length) return 1
  return props.categories[0].amount
})
</script>

<template>
  <div class="card p-5">
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-bold text-ink-900">Top categories</h2>
      <span class="text-xs text-ink-500">{{ month }}</span>
    </div>
    <div v-if="categories.length === 0" class="text-sm text-ink-500 text-center py-6">
      No expenses yet
    </div>
    <div v-else class="space-y-3.5">
      <div v-for="c in categories" :key="c.categoryId">
        <div class="flex items-center justify-between text-sm mb-1.5">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full" :style="{ backgroundColor: c.color }"></span>
            <span class="font-medium text-ink-900">{{ c.name }}</span>
          </div>
          <span class="num font-semibold text-ink-900">₹{{ (c.amount / 100).toLocaleString('en-IN') }}</span>
        </div>
        <div class="h-1.5 bg-cream-200 rounded-full overflow-hidden">
          <div class="h-full rounded-full" :style="{ backgroundColor: c.color, width: ((c.amount / maxCategoryAmount) * 100) + '%' }" />
        </div>
      </div>
    </div>
  </div>
</template>
