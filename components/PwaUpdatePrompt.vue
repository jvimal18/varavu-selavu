<script setup lang="ts">
/**
 * PWA update prompt.
 *
 * Twitter / Starbucks / Pinterest pattern: the new service worker downloads in
 * the background, then we show a small toast with a "Refresh" button. Clicking
 * Refresh calls `$pwa.updateServiceWorker()`, which posts `SKIP_WAITING` to the
 * waiting SW; the new SW activates and the page reloads automatically via the
 * `controlling` event. Do NOT call `window.location.reload()` yourself — that
 * would reload while the old SW is still in control and serve stale assets.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'

const { $pwa } = useNuxtApp()
const { availableUpdate, isLoading, fetchUpdate, clearAvailableUpdate } = useAppUpdate()

const showToast = computed(() => $pwa?.needRefresh ?? false)
const showSkeleton = computed(() => isLoading.value && availableUpdate.value === null)

const refreshButton = ref<HTMLButtonElement | null>(null)

function plainTextBullet(text: string): string {
  // Strip the inline markdown (`**bold**`, `` `code` ``) used in CHANGELOG.md
  // so the toast stays readable without HTML. The full formatted bullets are
  // on /changelog.
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .trim()
}

async function onRefresh() {
  if (!$pwa) return
  await $pwa.updateServiceWorker()
}

async function onLater() {
  if (!$pwa) return
  await $pwa.cancelPrompt()
  clearAvailableUpdate()
}

function onViewChangelog() {
  navigateTo('/changelog')
}

function onKeydown(e: KeyboardEvent) {
  if (!showToast.value || e.defaultPrevented) return
  if (e.key === 'Escape') {
    e.preventDefault()
    onLater()
  }
}

useEventListener(document, 'keydown', onKeydown)

async function focusRefresh() {
  if (!showToast.value || showSkeleton.value) return
  await nextTick()
  refreshButton.value?.focus()
}

watch(showToast, focusRefresh)
watch(showSkeleton, focusRefresh)
onMounted(() => {
  fetchUpdate()
  focusRefresh()
})
</script>

<template>
  <Transition name="slide-up">
    <div
      v-if="showToast"
      role="alert"
      aria-live="polite"
      class="fixed left-4 right-20 bottom-20 z-[60] sm:left-auto sm:right-4 sm:bottom-4 sm:max-w-sm sm:w-full"
    >
      <div
        class="rounded-2xl border border-stone-200 bg-white p-4 shadow-xl dark:border-stone-700 dark:bg-stone-800"
      >
        <!-- Loading skeleton: keep the shape calm while /version.json is fetched -->
        <div v-if="showSkeleton" class="space-y-3">
          <div class="flex items-center justify-between">
            <div class="h-3 w-24 rounded bg-stone-200 animate-pulse dark:bg-stone-700" />
            <div class="h-6 w-6 rounded bg-stone-200 animate-pulse dark:bg-stone-700" />
          </div>
          <div class="h-6 w-32 rounded bg-stone-200 animate-pulse dark:bg-stone-700" />
          <div class="space-y-2">
            <div class="h-4 w-full rounded bg-stone-200 animate-pulse dark:bg-stone-700" />
            <div class="h-4 w-3/4 rounded bg-stone-200 animate-pulse dark:bg-stone-700" />
          </div>
          <div class="flex gap-2 pt-1">
            <div class="h-9 flex-1 rounded-lg bg-stone-200 animate-pulse dark:bg-stone-700" />
            <div class="h-9 flex-1 rounded-lg bg-stone-200 animate-pulse dark:bg-stone-700" />
          </div>
        </div>

        <!-- Real content: either the version we fetched or a generic fallback -->
        <div v-else class="space-y-3">
          <div class="flex items-start justify-between gap-3">
            <span class="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
              Update available
            </span>
            <button
              type="button"
              class="rounded-lg p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-terra-500 focus-visible:ring-offset-2 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-100 dark:focus-visible:ring-offset-stone-800"
              aria-label="Dismiss update"
              @click="onLater"
            >
              <Icon name="lucide:x" size="16" />
            </button>
          </div>

          <div v-if="availableUpdate" class="space-y-2">
            <p class="font-mono text-xl font-bold text-terra-700 dark:text-terra-500">
              {{ availableUpdate.version }}
            </p>
            <ul v-if="availableUpdate.bullets.length > 0" class="space-y-1.5">
              <li
                v-for="(bullet, i) in availableUpdate.bullets.slice(0, 2)"
                :key="i"
                class="line-clamp-2 text-sm leading-relaxed text-stone-600 dark:text-stone-400"
              >
                {{ plainTextBullet(bullet) }}
              </li>
            </ul>
          </div>

          <div v-else class="space-y-1">
            <p class="text-sm text-stone-600 dark:text-stone-400">
              A new version is ready. Refresh to update.
            </p>
          </div>

          <div class="flex items-center gap-2 pt-1">
            <button
              ref="refreshButton"
              type="button"
              class="flex-1 rounded-lg bg-terra-700 px-4 py-2 text-sm font-semibold text-white hover:bg-terra-800 focus-visible:ring-2 focus-visible:ring-terra-500 focus-visible:ring-offset-2 dark:hover:bg-terra-600 dark:focus-visible:ring-offset-stone-800"
              @click="onRefresh"
            >
              Refresh
            </button>
            <button
              type="button"
              class="flex-1 rounded-lg px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-terra-500 focus-visible:ring-offset-2 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-100 dark:focus-visible:ring-offset-stone-800"
              @click="onLater"
            >
              Later
            </button>
          </div>

          <button
            type="button"
            class="text-xs text-stone-500 underline-offset-2 hover:text-terra-700 hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:ring-terra-500 focus-visible:ring-offset-2 dark:text-stone-400 dark:hover:text-terra-500 dark:focus-visible:ring-offset-stone-800"
            @click="onViewChangelog"
          >
            View full changelog
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 200ms ease-out, opacity 200ms ease-out;
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(1rem);
}
</style>
