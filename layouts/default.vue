<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '~/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const { opened: showQuickAdd } = useQuickAddModal()

const navItems = [
  { to: '/', label: 'Dashboard', icon: 'layout-dashboard' },
  { to: '/transactions', label: 'Transactions', icon: 'list' },
  { to: '/accounts', label: 'Accounts', icon: 'wallet-cards' },
]

const upcomingItems = [
  { to: '/categories', label: 'Categories', icon: 'layout-grid' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

function onKeydown(e: KeyboardEvent) {
  // Don't open with / if user is typing in a form field
  const t = e.target as HTMLElement
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
  if (e.key === '/') {
    e.preventDefault()
    showQuickAdd.value = true
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="min-h-screen md:flex">
    <!-- Sidebar (desktop) -->
    <aside class="hidden md:flex md:h-screen md:w-60 md:flex-col md:border-r md:border-ink-200 md:bg-cream-50 md:sticky md:top-0">
      <div class="px-5 py-5 flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-xl bg-terra-700 flex items-center justify-center">
          <Icon name="lucide:trending-up" class="text-white" size="16" />
        </div>
        <div>
          <div class="font-bold text-ink-900 leading-tight">VaravuSelavu</div>
          <div class="text-[10px] text-ink-500 uppercase tracking-wider leading-tight">Budget Tracker</div>
        </div>
      </div>

      <nav class="flex-1 min-h-0 overflow-y-auto px-3 space-y-0.5">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          :class="[
            'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
            route.path === item.to
              ? 'bg-terra-50 text-terra-700'
              : 'text-ink-700 hover:bg-cream-200'
          ]"
        >
          <Icon :name="`lucide:${item.icon}`" size="16" />
          {{ item.label }}
        </NuxtLink>
        <div class="pt-4 pb-1.5 px-3 text-[10px] font-semibold text-ink-400 uppercase tracking-wider">Manage</div>
        <NuxtLink
          v-for="item in upcomingItems"
          :key="item.to"
          :to="item.to"
          :class="[
            'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
            route.path === item.to
              ? 'bg-terra-50 text-terra-700'
              : 'text-ink-700 hover:bg-cream-200'
          ]"
        >
          <Icon :name="`lucide:${item.icon}`" size="16" />
          {{ item.label }}
        </NuxtLink>
      </nav>

      <div class="flex-shrink-0 p-3 border-t border-ink-200 bg-cream-50">
        <NuxtLink
          to="/profile"
          class="mb-2 p-2.5 rounded-xl border border-ink-200 bg-white flex items-center gap-2.5 hover:border-ink-300 transition-colors"
        >
          <div
            v-if="auth.user"
            class="avatar w-8 h-8 rounded-full text-sm"
            :style="{ backgroundColor: auth.user.color }"
          >{{ auth.initial }}</div>
          <div v-else class="w-8 h-8 rounded-full bg-ink-200" />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold text-ink-900 leading-tight truncate">{{ auth.user?.name || 'Loading…' }}</div>
            <div class="text-[11px] text-ink-500">Active</div>
          </div>
          <ClientOnly>
            <ThemeToggle class="flex-shrink-0" />
            <template #fallback>
              <span class="w-9 h-9 flex-shrink-0" />
            </template>
          </ClientOnly>
          <Icon name="lucide:chevron-right" class="text-ink-400" size="14" />
        </NuxtLink>
        <button
          @click="auth.logout"
          class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-ink-700 hover:bg-cream-200 transition-colors"
        >
          <Icon name="lucide:log-out" size="16" />
          Sign out
        </button>
      </div>
    </aside>

    <!-- Main -->
    <div class="flex-1 flex flex-col min-w-0">
      <main class="flex-1 px-5 md:px-8 py-6 max-w-[1400px] w-full mx-auto pb-28 md:pb-8">
        <slot />
      </main>

      <!-- Mobile FAB -->
      <button
        @click="showQuickAdd = true"
        class="md:hidden fixed right-4 bottom-20 w-14 h-14 rounded-2xl bg-terra-700 text-white shadow-lift z-20 flex items-center justify-center"
      >
        <Icon name="lucide:plus" size="26" />
      </button>

      <!-- Mobile bottom nav -->
      <nav class="md:hidden fixed bottom-0 left-0 right-0 bg-cream-50 border-t border-ink-200 px-2 pt-1.5 pb-5 flex items-center justify-around z-20">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          :class="[
            'flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] font-semibold transition-colors',
            route.path === item.to ? 'text-terra-700' : 'text-ink-500'
          ]"
        >
          <Icon :name="`lucide:${item.icon}`" size="20" />
          <span>{{ item.label }}</span>
        </NuxtLink>
        <NuxtLink
          to="/settings"
          aria-label="Open settings"
          title="Settings"
          :class="[
            'flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] font-semibold transition-colors',
            route.path === '/settings' ? 'text-terra-700' : 'text-ink-500'
          ]"
        >
          <Icon name="lucide:settings" size="20" />
          <span>Settings</span>
        </NuxtLink>
      </nav>
    </div>

    <QuickAddModal v-model="showQuickAdd" />
  </div>
</template>
