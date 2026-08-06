/**
 * Account balances — derived from opening balance + all transactions.
 *
 * Convention:
 * - Non-CC (bank/cash/wallet): currentBalance = money you HAVE (can be negative if overdrawn)
 *   = opening + income_in + transfer_in - expense_out - transfer_out
 *
 * - Credit card: currentBalance = outstanding (money you OWE, always >= 0 in practice)
 *   = opening + expense_in + transfer_out_from_CC - transfer_in_to_CC
 *   (charges add, payments subtract)
 *
 * - Investment (mutual_fund / fixed_deposit / recurring_deposit): principal-only
 *   = opening + interest_credits + transfer_in - transfer_out
 *   Regular income/expense don't apply to investments; the 'interest' type is
 *   the supported growth path.
 *
 * For net worth: sum of non-CC balances minus sum of CC outstanding.
 *
 * Liquidity buckets (v1.4.0) — exclusive type filters, no `other`:
 * - Cash liquidity:    bank | cash | digital_wallet  (money available to spend)
 * - Credit liquidity:  credit_card                    (sum of creditLimit - outstanding)
 * - Savings liquidity: mutual_fund | fixed_deposit | recurring_deposit (RD/FD/MF)
 */
import type { Account } from '~/composables/useAccounts'
import type { Transaction } from '~/composables/useTransactions'

const CASH_TYPES = new Set<Account['type']>(['bank', 'cash', 'digital_wallet'])
const SAVINGS_TYPES = new Set<Account['type']>(['mutual_fund', 'fixed_deposit', 'recurring_deposit'])

export function computeAccountBalances(
  accounts: Account[],
  transactions: Transaction[]
): Map<string, number> {
  const map = new Map<string, number>()
  // Seed with opening balances
  for (const a of accounts) map.set(a.id, a.openingBalance)

  // Build account lookup map for O(1) type checks (replaces the per-iteration
  // `accounts.find` that used to be O(n) per transaction).
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const isCC = (id: string) => accountById.get(id)?.type === 'credit_card'
  const isInvestment = (id: string) => {
    const t = accountById.get(id)?.type
    return t === 'mutual_fund' || t === 'fixed_deposit' || t === 'recurring_deposit'
  }

  for (const t of transactions) {
    if (t.type === 'income') {
      // Money comes into the account (not for investments; they use 'interest')
      if (!isInvestment(t.accountId)) {
        map.set(t.accountId, (map.get(t.accountId) || 0) + t.amount)
      }
    } else if (t.type === 'expense') {
      // Money leaves the account (or outstanding increases if CC)
      const acc = isCC(t.accountId)
      if (acc) {
        map.set(t.accountId, (map.get(t.accountId) || 0) + t.amount)
      } else if (!isInvestment(t.accountId)) {
        map.set(t.accountId, (map.get(t.accountId) || 0) - t.amount)
      }
    } else if (t.type === 'interest') {
      // Compounding interest credited to the account (investments)
      map.set(t.accountId, (map.get(t.accountId) || 0) + t.amount)
    } else if (t.type === 'transfer' && t.toAccountId) {
      // From: money leaves (or outstanding decreases if CC)
      const fromCC = isCC(t.accountId)
      if (fromCC) {
        map.set(t.accountId, (map.get(t.accountId) || 0) - t.amount)
      } else {
        map.set(t.accountId, (map.get(t.accountId) || 0) - t.amount)
      }
      // To: money arrives (or outstanding increases if CC)
      const toCC = isCC(t.toAccountId)
      if (toCC) {
        map.set(t.toAccountId, (map.get(t.toAccountId) || 0) - t.amount)
      } else {
        map.set(t.toAccountId, (map.get(t.toAccountId) || 0) + t.amount)
      }
    }
  }

  return map
}

export function computeNetWorth(
  accounts: Account[],
  balances: Map<string, number>
): number {
  let net = 0
  for (const a of accounts) {
    const bal = balances.get(a.id) || 0
    if (a.type === 'credit_card') net -= Math.abs(bal)
    else net += bal
  }
  return net
}

/** Cash liquidity: sum of balances across bank | cash | digital_wallet accounts. */
export function computeCashLiquidity(
  accounts: Account[],
  balances: Map<string, number>
): number {
  let total = 0
  for (const a of accounts) {
    if (a.archived) continue
    if (CASH_TYPES.has(a.type)) total += balances.get(a.id) || 0
  }
  return total
}

/** Credit liquidity: total headroom across credit cards (creditLimit - outstanding). */
export function computeCreditLiquidity(
  accounts: Account[],
  balances: Map<string, number>
): number {
  let total = 0
  for (const a of accounts) {
    if (a.archived) continue
    if (a.type !== 'credit_card') continue
    const outstanding = balances.get(a.id) || 0
    const limit = a.creditLimit || 0
    total += Math.max(0, limit - outstanding)
  }
  return total
}

/** Savings liquidity: sum of balances across mutual_fund | fixed_deposit | recurring_deposit. */
export function computeSavingsLiquidity(
  accounts: Account[],
  balances: Map<string, number>
): number {
  let total = 0
  for (const a of accounts) {
    if (a.archived) continue
    if (SAVINGS_TYPES.has(a.type)) total += balances.get(a.id) || 0
  }
  return total
}

export const useAccountBalances = () => {
  const { accounts, fetchAll: fetchAccounts } = useAccounts()
  const { transactions, fetchAll: fetchTxns } = useTransactions()
  const { version } = useDataVersion()

  const balances = computed(() => {
    return computeAccountBalances(accounts.value, transactions.value)
  })

  const netWorth = computed(() => {
    return computeNetWorth(accounts.value, balances.value)
  })

  const cashLiquidity = computed(() => {
    return computeCashLiquidity(accounts.value, balances.value)
  })

  const creditLiquidity = computed(() => {
    return computeCreditLiquidity(accounts.value, balances.value)
  })

  const savingsLiquidity = computed(() => {
    return computeSavingsLiquidity(accounts.value, balances.value)
  })

  function balanceFor(id: string | null | undefined): number {
    if (!id) return 0
    return balances.value.get(id) || 0
  }

  return {
    balances,
    netWorth,
    cashLiquidity,
    creditLiquidity,
    savingsLiquidity,
    balanceFor,
    fetchAccounts,
    fetchTxns,
    version,
  }
}
