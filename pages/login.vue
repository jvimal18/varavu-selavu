<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import { useAuthStore } from '~/stores/auth'

definePageMeta({ layout: 'auth' })

interface PublicUser { id: string; name: string; color: string; hasPin: boolean }

const auth = useAuthStore()
const users = ref<PublicUser[]>([])
const selectedUserId = ref<string | null>(null)
const pin = ref('')
const error = ref<string | null>(null)
const loading = ref(false)
const cooldownSeconds = ref(0) // > 0 means a 429 cooldown is active

const { resume: startTicker, pause: stopTicker } = useIntervalFn(
  () => {
    if (cooldownSeconds.value > 0) {
      cooldownSeconds.value -= 1
    }
    if (cooldownSeconds.value <= 0) {
      stopTicker()
    }
  },
  1000,
  { immediate: false }
)

onMounted(async () => {
  const data = await $fetch<{ users: PublicUser[] }>('/api/auth/users')
  users.value = data.users
  // Auto-select first user
  if (users.value.length > 0) selectedUserId.value = users.value[0].id
})

const selectedUser = computed(() => users.value.find((u) => u.id === selectedUserId.value) || null)

function pressKey(digit: string) {
  if (cooldownSeconds.value > 0) return
  if (pin.value.length >= 6) return
  if (digit === 'del') { pin.value = pin.value.slice(0, -1); return }
  pin.value += digit
}

async function submit() {
  if (!selectedUserId.value) return
  if (cooldownSeconds.value > 0) return
  if (selectedUser.value && !selectedUser.value.hasPin) {
    // Send to setup-pin with prefilled user
    return navigateTo({ path: '/setup-pin', query: { userId: selectedUserId.value } })
  }
  if (pin.value.length < 4) {
    error.value = 'Enter at least 4 digits'
    return
  }
  error.value = null
  loading.value = true
  const result = await auth.login(selectedUserId.value, pin.value)
  loading.value = false
  if (result.ok) {
    await navigateTo('/')
  } else {
    error.value = result.error
    pin.value = ''
    if (result.retryAfter) {
      cooldownSeconds.value = result.retryAfter
      startTicker()
    }
  }
}

// When the countdown finishes, clear the error so the form is fully usable again.
watch(cooldownSeconds, (s) => {
  if (s <= 0) {
    stopTicker()
    error.value = null
  }
})

onUnmounted(() => {
  stopTicker()
})

const keys = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'del'],
]

function handleKeydown(e: KeyboardEvent) {
  if (cooldownSeconds.value > 0) return
  if (e.key >= '0' && e.key <= '9') pressKey(e.key)
  else if (e.key === 'Backspace') pressKey('del')
  else if (e.key === 'Enter') submit()
}

/**
 * Live countdown formatter. Shows M:SS for >= 60s, "Ns" for < 60s.
 * Updates every second via the existing useIntervalFn ticker above.
 */
function formatCountdown(s: number): string {
  if (s >= 60) {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }
  return `${s}s`
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center px-4 py-8">
    <div class="w-full max-w-sm">
      <!-- Logo -->
      <div class="flex flex-col items-center mb-8">
        <div class="w-14 h-14 rounded-2xl bg-terra-700 flex items-center justify-center mb-4 shadow-lift">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 3v18h18" />
            <path d="M7 14l4-4 4 4 6-6" />
          </svg>
        </div>
        <h1 class="text-2xl font-bold text-ink-900">VaravuSelavu</h1>
        <p class="text-sm text-ink-500 mt-1">Budget tracker for the household</p>
      </div>

      <!-- User picker -->
      <div class="bg-white rounded-2xl border border-ink-100 shadow-card p-5 mb-4">
        <div class="label mb-2">Who's logging in?</div>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="u in users"
            :key="u.id"
            type="button"
            @click="selectedUserId = u.id; pin = ''; error = null"
            :class="[
              'flex items-center gap-2.5 p-3 rounded-xl border-2 transition-colors text-left',
              selectedUserId === u.id
                ? 'border-terra-700 bg-terra-50'
                : 'border-ink-200 hover:border-ink-300 bg-white'
            ]"
          >
            <div
              class="avatar w-9 h-9 rounded-full text-sm"
              :style="{ backgroundColor: u.color }"
            >{{ u.name[0] }}</div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-semibold text-ink-900 truncate">{{ u.name }}</div>
              <div class="text-[10px] text-ink-500">{{ u.hasPin ? 'PIN set' : 'Setup needed' }}</div>
            </div>
          </button>
        </div>
      </div>

      <!-- PIN entry -->
      <div v-if="selectedUser" class="bg-white rounded-2xl border border-ink-100 shadow-card p-5">
        <div class="text-center mb-4">
          <div class="label mb-2">Enter PIN</div>
          <div class="flex items-center justify-center gap-2.5 h-10">
            <div
              v-for="i in 6"
              :key="i"
              :class="[
                'w-3.5 h-3.5 rounded-full border-2 transition-colors',
                pin.length >= i
                  ? i <= (selectedUser.hasPin ? 4 : 4) ? 'bg-terra-700 border-terra-700' : 'bg-ink-700 border-ink-700'
                  : 'bg-transparent border-ink-300'
              ]"
            />
          </div>
        </div>

        <div v-if="error" class="mb-3 px-3 py-2 rounded-lg bg-danger-50 text-danger-700 text-xs text-center font-medium">
          <div>{{ error }}</div>
          <div v-if="cooldownSeconds > 0" class="mt-1.5 num font-semibold text-danger-800">
            Try again in {{ formatCountdown(cooldownSeconds) }}
          </div>
        </div>

        <!-- Numpad -->
        <div class="grid grid-cols-3 gap-2 mb-3">
          <template v-for="(row, ri) in keys" :key="ri">
            <button
              v-for="(k, ki) in row"
              :key="ki"
              type="button"
              @click="pressKey(k)"
              :disabled="!k || cooldownSeconds > 0"
              :class="[
                'h-14 rounded-xl text-xl font-semibold transition-colors inline-flex items-center justify-center',
                k === 'del'
                  ? 'bg-cream-100 text-ink-700 hover:bg-cream-200 active:scale-95'
                  : k
                  ? 'bg-cream-100 text-ink-900 hover:bg-cream-200 active:scale-95 num'
                  : 'invisible'
              ]"
            >
              <template v-if="k === 'del'">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" />
                  <line x1="18" y1="9" x2="12" y2="15" />
                  <line x1="12" y1="9" x2="18" y2="15" />
                </svg>
              </template>
              <template v-else>{{ k }}</template>
            </button>
          </template>
        </div>

        <button
          type="button"
          @click="submit"
          :disabled="loading || cooldownSeconds > 0"
          class="w-full py-3 rounded-xl bg-terra-700 text-white font-semibold text-sm hover:bg-terra-800 active:translate-y-px transition-colors disabled:opacity-50"
        >
          <span v-if="cooldownSeconds > 0">Locked — retry in {{ cooldownSeconds }}s</span>
          <span v-else-if="loading">Checking…</span>
          <span v-else>{{ selectedUser.hasPin ? 'Unlock' : 'Set up PIN →' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
