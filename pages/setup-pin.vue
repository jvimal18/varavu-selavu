<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '~/stores/auth'

definePageMeta({ layout: 'auth' })

interface PublicUser { id: string; name: string; color: string; hasPin: boolean }

const route = useRoute()
const auth = useAuthStore()
const users = ref<PublicUser[]>([])
const userId = ref<string>(route.query.userId as string || '')
const pin = ref('')
const confirmPin = ref('')
const stage = ref<'enter' | 'confirm'>('enter')
const error = ref<string | null>(null)
const loading = ref(false)

onMounted(async () => {
  const data = await $fetch<{ users: PublicUser[] }>('/api/auth/users')
  users.value = data.users
  if (!userId.value && users.value.length > 0) userId.value = users.value[0].id
})

const selectedUser = computed(() => users.value.find((u) => u.id === userId.value) || null)

function pressKey(digit: string) {
  const target = stage.value === 'enter' ? pin : confirmPin
  if (target.value.length >= 6) return
  if (digit === 'del') {
    if (stage.value === 'enter') pin.value = pin.value.slice(0, -1)
    else confirmPin.value = confirmPin.value.slice(0, -1)
    return
  }
  if (stage.value === 'enter') pin.value += digit
  else confirmPin.value += digit
}

async function submit() {
  if (pin.value.length < 4) {
    error.value = 'PIN must be at least 4 digits'
    return
  }
  if (stage.value === 'enter') {
    stage.value = 'confirm'
    error.value = null
    return
  }
  if (pin.value !== confirmPin.value) {
    error.value = 'PINs don\'t match. Try again.'
    confirmPin.value = ''
    return
  }
  error.value = null
  loading.value = true
  const result = await auth.setupPin(userId.value, pin.value)
  loading.value = false
  if (result.ok) {
    await navigateTo('/')
  } else {
    error.value = result.error
    stage.value = 'enter'
    pin.value = ''
    confirmPin.value = ''
  }
}

const keys = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'del'],
]

function handleKeydown(e: KeyboardEvent) {
  if (e.key >= '0' && e.key <= '9') pressKey(e.key)
  else if (e.key === 'Backspace') pressKey('del')
  else if (e.key === 'Enter') submit()
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center px-4 py-8">
    <div class="w-full max-w-sm">
      <div class="flex flex-col items-center mb-8">
        <div class="w-14 h-14 rounded-2xl bg-terra-700 flex items-center justify-center mb-4 shadow-lift">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 3v18h18" />
            <path d="M7 14l4-4 4 4 6-6" />
          </svg>
        </div>
        <h1 class="text-2xl font-bold text-ink-900">Set up your PIN</h1>
        <p class="text-sm text-ink-500 mt-1 text-center">This keeps your entries private on shared devices.</p>
      </div>

      <div v-if="selectedUser" class="bg-white rounded-2xl border border-ink-100 shadow-card p-5">
        <div class="flex items-center gap-2.5 mb-5 pb-5 border-b border-ink-100">
          <div class="avatar w-10 h-10 rounded-full text-sm" :style="{ backgroundColor: selectedUser.color }">
            {{ selectedUser.name[0] }}
          </div>
          <div>
            <div class="text-sm font-semibold text-ink-900">{{ selectedUser.name }}</div>
            <div class="text-[10px] text-ink-500">4-6 digits · numbers only</div>
          </div>
        </div>

        <div class="text-center mb-4">
          <div class="label mb-2">
            {{ stage === 'enter' ? 'Choose a PIN' : 'Confirm your PIN' }}
          </div>
          <div class="flex items-center justify-center gap-2.5 h-10">
            <div
              v-for="i in 6"
              :key="i"
              :class="[
                'w-3.5 h-3.5 rounded-full border-2 transition-colors',
                (stage === 'enter' ? pin : confirmPin).length >= i
                  ? 'bg-terra-700 border-terra-700'
                  : 'bg-transparent border-ink-300'
              ]"
            />
          </div>
        </div>

        <div v-if="error" class="mb-3 px-3 py-2 rounded-lg bg-danger-50 text-danger-700 text-xs text-center font-medium">
          {{ error }}
        </div>

        <div class="grid grid-cols-3 gap-2 mb-3">
          <template v-for="(row, ri) in keys" :key="ri">
            <button
              v-for="(k, ki) in row"
              :key="ki"
              type="button"
              @click="pressKey(k)"
              :disabled="!k"
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
          :disabled="loading"
          class="w-full py-3 rounded-xl bg-terra-700 text-white font-semibold text-sm hover:bg-terra-800 active:translate-y-px transition-colors disabled:opacity-50"
        >
          {{ loading ? 'Saving…' : (stage === 'enter' ? 'Continue' : 'Confirm PIN') }}
        </button>
      </div>
    </div>
  </div>
</template>
