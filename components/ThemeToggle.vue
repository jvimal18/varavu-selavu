<script setup lang="ts">
import { useUiStore, type Theme } from '~/stores/ui'

const ui = useUiStore()

const modes = [
  { value: 'light' as Theme, icon: 'lucide:sun', label: 'Light' },
  { value: 'dark' as Theme, icon: 'lucide:moon', label: 'Dark' },
  { value: 'system' as Theme, icon: 'lucide:monitor', label: 'System' },
] as const

function cycle() {
  const order: Theme[] = ['light', 'dark', 'system']
  const next = order[(order.indexOf(ui.theme) + 1) % order.length]
  ui.setTheme(next)
}
</script>

<template>
  <button
    type="button"
    @click="cycle"
    class="inline-flex items-center justify-center w-10 h-10 rounded-full text-ink-700 hover:bg-cream-200 transition-colors dark:text-ink-300 dark:hover:bg-ink-800"
    :aria-label="`Theme: ${ui.theme}`"
    title="Toggle theme"
  >
    <Icon :name="modes.find((m) => m.value === ui.theme)?.icon || 'lucide:sun'" size="20" />
  </button>
</template>
