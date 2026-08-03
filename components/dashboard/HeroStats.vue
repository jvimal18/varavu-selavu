<script setup lang="ts">
import { computed } from 'vue'

type AccountSummary = {
  id: string
  name: string
  type: string
  balance: number
  creditLimit: number | null
  color: string | null
  icon: string | null
  last4: string | null
}

const props = defineProps<{
  cashLiquidity: number
  creditLiquidity: number
  savingsLiquidity: number
  accounts: AccountSummary[]
}>()

const cashCount = computed(
  () => props.accounts.filter((a) => a.type === 'bank' || a.type === 'cash' || a.type === 'digital_wallet').length,
)
const creditCount = computed(
  () => props.accounts.filter((a) => a.type === 'credit_card').length,
)
const savingsCount = computed(
  () =>
    props.accounts.filter(
      (a) => a.type === 'mutual_fund' || a.type === 'fixed_deposit' || a.type === 'recurring_deposit',
    ).length,
)
</script>

<template>
  <div class="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
    <div class="card p-4 md:p-5">
      <div class="label">Cash Liquidity</div>
      <div class="num text-[clamp(1.125rem,3vw,1.5rem)] font-bold text-ink-900 mt-2">₹{{ (cashLiquidity / 100).toLocaleString('en-IN') }}</div>
      <div class="text-[11px] text-ink-500 mt-1.5">
        bank · cash · wallet
        <span v-if="cashCount > 0"> · {{ cashCount }}</span>
      </div>
    </div>

    <div class="card p-4 md:p-5">
      <div class="label">Credit Liquidity</div>
      <div class="num text-[clamp(1.125rem,3vw,1.5rem)] font-bold text-ink-900 mt-2">₹{{ (creditLiquidity / 100).toLocaleString('en-IN') }}</div>
      <div class="text-[11px] text-ink-500 mt-1.5">
        available on credit cards
        <span v-if="creditCount > 0"> · {{ creditCount }} card{{ creditCount === 1 ? '' : 's' }}</span>
      </div>
    </div>

    <div class="card p-4 md:p-5">
      <div class="label">Savings</div>
      <div class="num text-[clamp(1.125rem,3vw,1.5rem)] font-bold text-ink-900 mt-2">₹{{ (savingsLiquidity / 100).toLocaleString('en-IN') }}</div>
      <div class="text-[11px] text-ink-500 mt-1.5">
        RD · FD · MF
        <span v-if="savingsCount > 0"> · {{ savingsCount }}</span>
      </div>
    </div>
  </div>
</template>
