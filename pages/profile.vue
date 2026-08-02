<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '~/stores/auth'

const auth = useAuthStore()

const users = ref<{ id: string; name: string; color: string; hasPin: boolean }[]>([])
const switching = ref<string | null>(null)
const switchingError = ref<string | null>(null)
const showPinDialog = ref(false)
const pinInput = ref('')
const pinError = ref<string | null>(null)

// Change PIN dialog state
const showChangePinDialog = ref(false)
const changeStage = ref<'current' | 'new' | 'confirm'>('current')
const currentPinInput = ref('')
const newPinInput = ref('')
const confirmPinInput = ref('')
const changePinError = ref<string | null>(null)
const changePinSaving = ref(false)

onMounted(async () => {
  const data = await $fetch<{ users: typeof users.value }>('/api/auth/users')
  users.value = data.users
  window.addEventListener('keydown', onSwitchKeydown)
  window.addEventListener('keydown', onChangePinKeydown)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onSwitchKeydown)
  window.removeEventListener('keydown', onChangePinKeydown)
})

async function switchTo(userId: string) {
  const u = users.value.find((x) => x.id === userId)
  if (!u) return
  switchingError.value = null

  if (u.id === auth.user?.id) return

  if (!u.hasPin) {
    await auth.logout()
    await navigateTo({ path: '/setup-pin', query: { userId: u.id } })
    return
  }

  switching.value = userId
  showPinDialog.value = true
  pinInput.value = ''
  pinError.value = null
}

async function confirmSwitch() {
  if (!switching.value) return
  if (pinInput.value.length < 4) {
    pinError.value = 'Enter at least 4 digits'
    return
  }
  const result = await auth.login(switching.value, pinInput.value)
  if (result.ok) {
    showPinDialog.value = false
    switching.value = null
    pinInput.value = ''
  } else {
    pinError.value = result.error
    pinInput.value = ''
  }
}

function pressKey(digit: string) {
  if (digit === 'del') { pinInput.value = pinInput.value.slice(0, -1); return }
  if (pinInput.value.length >= 6) return
  pinInput.value += digit
}

// Keyboard support for the switch-user PIN numpad
function onSwitchKeydown(e: KeyboardEvent) {
  if (!showPinDialog.value) return
  const t = e.target as HTMLElement
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (e.key === 'Escape') { e.preventDefault(); showPinDialog.value = false; return }
  if (/^[0-9]$/.test(e.key)) { e.preventDefault(); pressKey(e.key); return }
  if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); pressKey('del'); return }
  if (e.key === 'Enter') { e.preventDefault(); confirmSwitch(); return }
}

// =====================================================
// Change PIN
// =====================================================
function openChangePin() {
  showChangePinDialog.value = true
  changeStage.value = 'current'
  currentPinInput.value = ''
  newPinInput.value = ''
  confirmPinInput.value = ''
  changePinError.value = null
  changePinSaving.value = false
}

function closeChangePin() {
  showChangePinDialog.value = false
  changePinError.value = null
}

const activeChangePin = () => {
  if (changeStage.value === 'current') return currentPinInput
  if (changeStage.value === 'new') return newPinInput
  return confirmPinInput
}

function pressChangePinKey(digit: string) {
  if (changePinSaving.value) return
  const target = activeChangePin()
  if (digit === 'del') {
    target.value = target.value.slice(0, -1)
    return
  }
  if (target.value.length >= 6) return
  target.value += digit
}

async function submitChangePin() {
  if (changePinSaving.value) return
  if (!auth.user) return

  if (changeStage.value === 'current') {
    if (currentPinInput.value.length < 4) {
      changePinError.value = 'Enter at least 4 digits'
      return
    }
    changeStage.value = 'new'
    changePinError.value = null
    return
  }

  if (changeStage.value === 'new') {
    if (newPinInput.value.length < 4) {
      changePinError.value = 'New PIN must be 4-6 digits'
      return
    }
    changeStage.value = 'confirm'
    changePinError.value = null
    return
  }

  // confirm
  if (newPinInput.value !== confirmPinInput.value) {
    changePinError.value = "PINs don't match. Try again."
    confirmPinInput.value = ''
    return
  }

  changePinError.value = null
  changePinSaving.value = true
  const result = await auth.setupPin(auth.user.id, newPinInput.value, currentPinInput.value)
  changePinSaving.value = false

  if (result.ok) {
    showChangePinDialog.value = false
  } else {
    // If current PIN was wrong, go back to that stage; otherwise stay on confirm
    if (result.error.toLowerCase().includes('current')) {
      changeStage.value = 'current'
      currentPinInput.value = ''
    } else {
      confirmPinInput.value = ''
    }
    changePinError.value = result.error
  }
}

function onChangePinKeydown(e: KeyboardEvent) {
  if (!showChangePinDialog.value) return
  const t = e.target as HTMLElement
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (e.key === 'Escape') { e.preventDefault(); closeChangePin(); return }
  if (/^[0-9]$/.test(e.key)) { e.preventDefault(); pressChangePinKey(e.key); return }
  if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); pressChangePinKey('del'); return }
  if (e.key === 'Enter') { e.preventDefault(); submitChangePin(); return }
}

const changeStageLabel = () => {
  if (changeStage.value === 'current') return 'Enter your current PIN'
  if (changeStage.value === 'new') return 'Choose a new PIN'
  return 'Confirm your new PIN'
}

const changeStageFilled = () => activeChangePin().value

const changeStageIndex = () => {
  if (changeStage.value === 'current') return 1
  if (changeStage.value === 'new') return 2
  return 3
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold text-ink-900 mb-1">Profile</h1>
    <p class="text-sm text-ink-500 mb-6">Manage your account and switch between users</p>

    <!-- Current user card -->
    <div class="card p-6 mb-4">
      <div class="text-xs text-ink-500 font-semibold uppercase tracking-wider mb-3">Active user</div>
      <div class="flex items-center gap-4">
        <div
          v-if="auth.user"
          class="avatar w-16 h-16 rounded-full text-2xl"
          :style="{ backgroundColor: auth.user.color }"
        >{{ auth.initial }}</div>
        <div class="flex-1">
          <div class="text-lg font-bold text-ink-900">{{ auth.user?.name }}</div>
          <div class="text-xs text-ink-500">PIN protected</div>
        </div>
        <button
          @click="auth.logout"
          class="btn-secondary"
        >
          <Icon name="lucide:log-out" size="14" />
          Sign out
        </button>
      </div>
    </div>

    <!-- Switch user -->
    <div class="card p-6 mb-4">
      <div class="text-xs text-ink-500 font-semibold uppercase tracking-wider mb-3">Switch user</div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          v-for="u in users"
          :key="u.id"
          @click="switchTo(u.id)"
          :class="[
            'flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-colors',
            u.id === auth.user?.id
              ? 'border-terra-700 bg-terra-50'
              : 'border-ink-200 hover:border-ink-300 bg-white'
          ]"
        >
          <div
            class="avatar w-12 h-12 rounded-full text-base"
            :style="{ backgroundColor: u.color }"
          >{{ u.name[0] }}</div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold text-ink-900 truncate">{{ u.name }}</div>
            <div class="text-[10px] text-ink-500">
              {{ u.id === auth.user?.id ? 'Active' : (u.hasPin ? 'Click to switch' : 'Setup needed') }}
            </div>
          </div>
          <Icon
            v-if="u.id === auth.user?.id"
            name="lucide:check"
            class="text-terra-700"
            size="20"
          />
          <Icon
            v-else
            name="lucide:chevron-right"
            class="text-ink-400"
            size="20"
          />
        </button>
      </div>
    </div>

    <!-- Security -->
    <div class="card p-6 mb-4">
      <div class="text-xs text-ink-500 font-semibold uppercase tracking-wider mb-3">Security</div>
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-terra-50 text-terra-700 flex items-center justify-center shrink-0">
            <Icon name="lucide:key-round" size="20" />
          </div>
          <div class="min-w-0">
            <div class="text-sm font-semibold text-ink-900">PIN</div>
            <div class="text-[11px] text-ink-500">4-6 digits · numbers only</div>
          </div>
        </div>
        <button
          v-if="auth.user?.hasPin"
          @click="openChangePin"
          class="btn-secondary"
        >
          <Icon name="lucide:lock" size="14" />
          Change PIN
        </button>
        <button
          v-else
          @click="auth.logout().then(() => { navigateTo({ path: '/setup-pin', query: { userId: auth.user?.id } }) })"
          class="btn-primary"
        >
          <Icon name="lucide:plus" size="14" />
          Set up PIN
        </button>
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
          <span class="num">0.1.0</span>
        </div>
        <div class="flex items-center justify-between py-1.5">
          <span class="text-ink-500">Storage</span>
          <span class="num text-xs">SQLite</span>
        </div>
      </div>
    </div>

    <!-- PIN dialog for switching -->
    <div v-if="showPinDialog" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div class="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" @click="showPinDialog = false" />
      <div class="relative bg-cream-100 rounded-3xl shadow-lift w-full max-w-sm p-5">
        <div class="text-center mb-4">
          <div class="label mb-2">Enter PIN to switch</div>
          <div class="flex items-center justify-center gap-2.5 h-10">
            <div
              v-for="i in 6"
              :key="i"
              :class="[
                'w-3.5 h-3.5 rounded-full border-2 transition-colors',
                pinInput.length >= i ? 'bg-terra-700 border-terra-700' : 'bg-transparent border-ink-300'
              ]"
            />
          </div>
        </div>
        <div v-if="pinError" class="mb-3 px-3 py-2 rounded-lg bg-danger-50 text-danger-700 text-xs text-center font-medium">
          {{ pinError }}
        </div>
        <div class="grid grid-cols-3 gap-2 mb-3">
          <button
            v-for="k in ['1','2','3','4','5','6','7','8','9','','0','del']"
            :key="k"
            @click="pressKey(k)"
            :disabled="!k"
            :class="[
              'h-12 rounded-xl text-lg font-semibold transition-colors inline-flex items-center justify-center',
              k === 'del' ? 'bg-cream-100 text-ink-700 hover:bg-cream-200' : k ? 'bg-cream-100 text-ink-900 hover:bg-cream-200 num' : 'invisible'
            ]"
          >
            <template v-if="k === 'del'">
              <Icon name="lucide:delete" size="22" />
            </template>
            <template v-else>{{ k }}</template>
          </button>
        </div>
        <div class="flex gap-2">
          <button @click="showPinDialog = false" class="flex-1 btn-secondary">Cancel</button>
          <button @click="confirmSwitch" class="flex-1 btn-primary">Switch</button>
        </div>
      </div>
    </div>

    <!-- Change PIN dialog -->
    <div v-if="showChangePinDialog" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div class="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" @click="closeChangePin" />
      <div class="relative bg-cream-100 rounded-3xl shadow-lift w-full max-w-sm p-5">
        <div class="flex items-center justify-between mb-3">
          <div class="text-sm font-semibold text-ink-900">Change PIN</div>
          <div class="text-[10px] text-ink-500 font-semibold uppercase tracking-wider">
            Step {{ changeStageIndex() }} of 3
          </div>
        </div>

        <!-- Stage progress dots -->
        <div class="flex items-center justify-center gap-1.5 mb-3">
          <div
            v-for="i in 3"
            :key="i"
            :class="[
              'h-1 rounded-full transition-all',
              i < changeStageIndex() ? 'w-6 bg-terra-700' :
              i === changeStageIndex() ? 'w-8 bg-terra-700' : 'w-6 bg-ink-200'
            ]"
          />
        </div>

        <div class="text-center mb-4">
          <div class="label mb-2">{{ changeStageLabel() }}</div>
          <div class="flex items-center justify-center gap-2.5 h-10">
            <div
              v-for="i in 6"
              :key="i"
              :class="[
                'w-3.5 h-3.5 rounded-full border-2 transition-colors',
                changeStageFilled().length >= i ? 'bg-terra-700 border-terra-700' : 'bg-transparent border-ink-300'
              ]"
            />
          </div>
        </div>

        <div v-if="changePinError" class="mb-3 px-3 py-2 rounded-lg bg-danger-50 text-danger-700 text-xs text-center font-medium">
          {{ changePinError }}
        </div>

        <div class="grid grid-cols-3 gap-2 mb-3">
          <button
            v-for="k in ['1','2','3','4','5','6','7','8','9','','0','del']"
            :key="k"
            @click="pressChangePinKey(k)"
            :disabled="!k || changePinSaving"
            :class="[
              'h-12 rounded-xl text-lg font-semibold transition-colors inline-flex items-center justify-center',
              k === 'del' ? 'bg-cream-100 text-ink-700 hover:bg-cream-200' : k ? 'bg-cream-100 text-ink-900 hover:bg-cream-200 num' : 'invisible',
              changePinSaving ? 'opacity-50' : ''
            ]"
          >
            <template v-if="k === 'del'">
              <Icon name="lucide:delete" size="22" />
            </template>
            <template v-else>{{ k }}</template>
          </button>
        </div>

        <div class="flex gap-2">
          <button @click="closeChangePin" :disabled="changePinSaving" class="flex-1 btn-secondary">Cancel</button>
          <button @click="submitChangePin" :disabled="changePinSaving" class="flex-1 btn-primary">
            {{ changePinSaving ? 'Saving…' : (changeStage === 'confirm' ? 'Save' : 'Continue') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
