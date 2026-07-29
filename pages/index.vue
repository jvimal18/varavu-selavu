<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'
import { displayMonth, greetingForHour } from '~/utils/dates'

const auth = useAuthStore()
const now = new Date()
</script>

<template>
  <div>
    <div class="mb-6">
      <div class="text-xs text-ink-500 font-medium uppercase tracking-wider">{{ displayMonth(now) }}</div>
      <h1 class="text-2xl md:text-3xl font-bold text-ink-900 mt-1">
        {{ greetingForHour(now.getHours()) }}, {{ auth.user?.name || 'there' }}
      </h1>
    </div>

    <!-- Placeholder dashboard — Sprint 3 will fill this in -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="card p-6">
        <div class="label">Net Worth</div>
        <div class="num text-3xl font-bold text-ink-900 mt-2">—</div>
        <div class="text-xs text-ink-500 mt-2">Coming in Sprint 3</div>
      </div>
      <div class="card p-6">
        <div class="label">This Month · Spent</div>
        <div class="num text-3xl font-bold text-ink-900 mt-2">—</div>
        <div class="text-xs text-ink-500 mt-2">Add transactions in Sprint 2</div>
      </div>
      <div class="card p-6">
        <div class="label">Accounts</div>
        <div class="num text-3xl font-bold text-ink-900 mt-2">0</div>
        <NuxtLink to="/accounts" class="text-xs text-terra-700 font-semibold mt-2 inline-block hover:text-terra-800">
          Add your first account →
        </NuxtLink>
      </div>
    </div>

    <div class="card p-6 mt-4">
      <h2 class="font-bold text-ink-900 mb-1">Sprint 1 complete ✓</h2>
      <p class="text-sm text-ink-500 mb-4">Foundation is in place. You're logged in as <strong class="text-ink-900">{{ auth.user?.name }}</strong>.</p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="p-3 rounded-xl bg-cream-50 border border-ink-100">
          <div class="text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1">Sprint 2 next</div>
          <div class="text-sm text-ink-900">Add accounts, transactions, quick add modal</div>
        </div>
        <div class="p-3 rounded-xl bg-cream-50 border border-ink-100">
          <div class="text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1">Then Sprint 3</div>
          <div class="text-sm text-ink-900">Dashboard charts, filters, polish</div>
        </div>
      </div>
    </div>
  </div>
</template>
