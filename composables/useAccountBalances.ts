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
 */
import type { Account } from '~/composables/useAccounts'
import type { Transaction } from '~/composables/useTransactions'

export function computeAccountBalances(
  accounts: Account[],
  transactions: Transaction[]
): Map<string, number> {
  const map = new Map<string, number>()
  // Seed with opening balances
  for (const a of accounts) map.set(a.id, a.openingBalance)

  for (const t of transactions) {
    const isCC = (id: string) => accounts.find((a) => a.id === id)?.type === 'credit_card'
    const isInvestment = (id: string) => {
      const a = accounts.find((acc) => acc.id === id)
      return a?.type === 'mutual_fund' || a?.type === 'fixed_deposit' || a?.type === 'recurring_deposit'
    }

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

  function balanceFor(id: string | null | undefined): number {
    if (!id) return 0
    return balances.value.get(id) || 0
  }

  return { balances, netWorth, balanceFor, fetchAccounts, fetchTxns, version }
}
