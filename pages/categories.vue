<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useCategories } from '~/composables/useCategories'

const { categories, roots, children, fetchAll } = useCategories()

onMounted(() => fetchAll())

const expenseRoots = computed(() => roots('expense'))
const incomeCategories = computed(() => roots('income'))
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold text-ink-900 mb-1">Categories</h1>
    <p class="text-sm text-ink-500 mb-6">{{ categories.length }} pre-seeded · read-only in v1</p>

    <!-- Expense categories -->
    <h2 class="text-xs font-semibold text-ink-500 uppercase tracking-wider mb-3">Expense</h2>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
      <div v-for="root in expenseRoots" :key="root.id" class="card p-4">
        <div class="flex items-center gap-2.5 mb-2.5">
          <div
            class="w-9 h-9 rounded-lg flex items-center justify-center"
            :style="{ backgroundColor: (root.color || '#A8A29E') + '20' }"
          >
            <Icon :name="`lucide:${root.icon || 'circle-dot'}`" size="16" :style="{ color: root.color || '#A8A29E' }" />
          </div>
          <div>
            <div class="text-sm font-semibold text-ink-900">{{ root.name }}</div>
            <div v-if="root.isEssential" class="text-[10px] text-success-700 font-semibold uppercase tracking-wider">Essential</div>
          </div>
        </div>
        <div v-if="children(root.id).length > 0" class="flex flex-wrap gap-1.5 mt-3">
          <span
            v-for="child in children(root.id)"
            :key="child.id"
            class="text-[10px] font-medium text-ink-700 bg-cream-100 px-2 py-1 rounded-md"
          >{{ child.name }}</span>
        </div>
      </div>
    </div>

    <!-- Income categories -->
    <h2 class="text-xs font-semibold text-ink-500 uppercase tracking-wider mb-3">Income</h2>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <div v-for="c in incomeCategories" :key="c.id" class="card p-4 flex items-center gap-2.5">
        <div
          class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          :style="{ backgroundColor: (c.color || '#A8A29E') + '20' }"
        >
          <Icon :name="`lucide:${c.icon || 'circle-dot'}`" size="16" :style="{ color: c.color || '#A8A29E' }" />
        </div>
        <div class="text-sm font-semibold text-ink-900">{{ c.name }}</div>
      </div>
    </div>
  </div>
</template>
