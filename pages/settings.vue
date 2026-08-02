<script setup lang="ts">
import { useUiStore, type Theme } from '~/stores/ui'

const ui = useUiStore()

const themes = [
  { value: 'light' as Theme, icon: 'lucide:sun', title: 'Light', desc: 'Always use the light theme' },
  { value: 'dark' as Theme, icon: 'lucide:moon', title: 'Dark', desc: 'Always use the dark theme' },
  { value: 'system' as Theme, icon: 'lucide:monitor', title: 'System', desc: 'Follow your device setting' },
]

const downloading = ref(false)
const downloadError = ref<string | null>(null)

async function downloadBackup() {
  downloading.value = true
  downloadError.value = null
  try {
    const data = await $fetch('/api/export/json')
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const date = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `varavuselavu-backup-${date}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e: any) {
    downloadError.value = e?.message || 'Download failed'
  } finally {
    downloading.value = false
  }
}

const BUILD_DATE = '2026-08-02'
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold text-ink-900 mb-1">Settings</h1>
    <p class="text-sm text-ink-500 mb-6">App preferences, data, and information</p>

    <!-- Appearance -->
    <div class="card p-6 mb-4">
      <div class="text-xs text-ink-500 font-semibold uppercase tracking-wider mb-3">Appearance</div>
      <ClientOnly>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            v-for="t in themes"
            :key="t.value"
            @click="ui.setTheme(t.value)"
            :class="[
              'flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-colors',
              ui.theme === t.value
                ? 'border-terra-700 bg-terra-50'
                : 'border-ink-200 hover:border-ink-300 bg-white'
            ]"
          >
            <div
              class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              :class="ui.theme === t.value ? 'bg-terra-700 text-white' : 'bg-cream-100 text-ink-700'"
            >
              <Icon :name="t.icon" size="20" />
            </div>
            <div class="min-w-0">
              <div class="text-sm font-semibold text-ink-900 truncate">{{ t.title }}</div>
              <div class="text-[11px] text-ink-500 truncate">{{ t.desc }}</div>
            </div>
          </button>
        </div>
        <template #fallback>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div
              v-for="t in themes"
              :key="t.value"
              class="flex items-center gap-3 p-4 rounded-xl border-2 border-ink-200 bg-white text-left"
            >
              <div class="w-10 h-10 rounded-xl bg-cream-100 text-ink-700 flex items-center justify-center shrink-0">
                <Icon :name="t.icon" size="20" />
              </div>
              <div class="min-w-0">
                <div class="text-sm font-semibold text-ink-900 truncate">{{ t.title }}</div>
                <div class="text-[11px] text-ink-500 truncate">{{ t.desc }}</div>
              </div>
            </div>
          </div>
        </template>
      </ClientOnly>
    </div>

    <!-- Currency -->
    <div class="card p-6 mb-4">
      <div class="text-xs text-ink-500 font-semibold uppercase tracking-wider mb-3">Currency display</div>
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-cream-100 text-ink-700 flex items-center justify-center shrink-0">
          <Icon name="lucide:indian-rupee" size="20" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-semibold text-ink-900">Indian lakh grouping</div>
          <div class="text-[11px] text-ink-500">₹1,00,000 format · INR only</div>
        </div>
        <span class="text-[11px] font-semibold text-ink-400">v1</span>
      </div>
    </div>

    <!-- Data -->
    <div class="card p-6 mb-4">
      <div class="text-xs text-ink-500 font-semibold uppercase tracking-wider mb-3">Data</div>
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-cream-100 text-ink-700 flex items-center justify-center shrink-0">
            <Icon name="lucide:download" size="20" />
          </div>
          <div class="min-w-0">
            <div class="text-sm font-semibold text-ink-900">Download backup</div>
            <div class="text-[11px] text-ink-500">Export accounts, categories, transactions, users as JSON</div>
          </div>
        </div>
        <button
          @click="downloadBackup"
          :disabled="downloading"
          class="btn-primary"
        >
          <Icon name="lucide:download" size="14" />
          {{ downloading ? 'Exporting…' : 'Download' }}
        </button>
      </div>
      <div v-if="downloadError" class="mt-3 px-3 py-2 rounded-lg bg-danger-50 text-danger-700 text-xs font-medium">
        {{ downloadError }}
      </div>
    </div>

    <!-- About -->
    <div class="card p-6">
      <div class="text-xs text-ink-500 font-semibold uppercase tracking-wider mb-3">About</div>
      <div class="text-sm text-ink-700">
        <div class="flex items-center justify-between py-1.5">
          <span class="text-ink-500">App</span>
          <span class="font-semibold">VaravuSelavu</span>
        </div>
        <div class="flex items-center justify-between py-1.5">
          <span class="text-ink-500">Version</span>
          <span class="num">0.1</span>
        </div>
        <div class="flex items-center justify-between py-1.5">
          <span class="text-ink-500">Build date</span>
          <span class="num">{{ BUILD_DATE }}</span>
        </div>
      </div>
      <div class="mt-4 pt-4 border-t border-ink-100">
        <NuxtLink to="/profile" class="btn-secondary w-full">
          <Icon name="lucide:user" size="14" />
          Open profile
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
