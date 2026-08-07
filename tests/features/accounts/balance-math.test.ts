/**
 * Tests for `composables/useAccountBalances.ts`.
 *
 * These are the most important tests in PR 1: the financial math is the
 * highest-risk code in the repo (and the place a refactor could silently
 * break net worth). Golden sums for every account type × transaction type
 * combination.
 *
 * We test the pure functions (computeAccountBalances / computeNetWorth /
 * computeCashLiquidity / computeCreditLiquidity / computeSavingsLiquidity),
 * not the composable wrapper, so we don't need a Nuxt context.
 */
import { describe, it, expect } from 'vitest'
import {
  computeAccountBalances,
  computeNetWorth,
  computeCashLiquidity,
  computeCreditLiquidity,
  computeSavingsLiquidity,
} from '~~/composables/useAccountBalances'
import type { Account } from '~~/composables/useAccounts'
import type { Transaction } from '~~/composables/useTransactions'

// ---- Test fixtures --------------------------------------------------------

const NOW = '2026-08-01T00:00:00.000Z'

const bankAccount: Account = {
  id: 'a_bank',
  name: 'HDFC',
  type: 'bank',
  institution: 'HDFC',
  last4: '1234',
  openingBalance: 1_00_000, // ₹1,000
  creditLimit: null,
  statementDay: null,
  dueDay: null,
  currency: 'INR',
  color: null,
  icon: null,
  archived: false,
  createdAt: NOW,
  updatedAt: NOW,
}

const cashAccount: Account = { ...bankAccount, id: 'a_cash', name: 'Cash', type: 'cash', openingBalance: 0 }
const walletAccount: Account = { ...bankAccount, id: 'a_wallet', name: 'PayTM', type: 'digital_wallet', openingBalance: 0 }

const creditCard: Account = {
  ...bankAccount,
  id: 'a_cc',
  name: 'HDFC Infinia',
  type: 'credit_card',
  openingBalance: 5_000, // initial outstanding ₹50
  creditLimit: 5_00_000, // ₹5,000 limit
  statementDay: 15,
  dueDay: 5,
}

const mfAccount: Account = { ...bankAccount, id: 'a_mf', name: 'Axis MF', type: 'mutual_fund', openingBalance: 0 }
const fdAccount: Account = { ...bankAccount, id: 'a_fd', name: 'SBI FD', type: 'fixed_deposit', openingBalance: 0 }

const otherAccount: Account = { ...bankAccount, id: 'a_other', name: 'Old locker', type: 'other', openingBalance: 0 }
const archivedAccount: Account = { ...bankAccount, id: 'a_archived', name: 'Old bank', archived: true }

function txn(overrides: Partial<Transaction> & Pick<Transaction, 'id' | 'type' | 'amount' | 'accountId'>): Transaction {
  return {
    date: '2026-07-15',
    toAccountId: null,
    categoryId: 'c_food',
    description: null,
    notes: null,
    spentBy: 'u_vimal',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

// ---- computeAccountBalances ----------------------------------------------

describe('computeAccountBalances', () => {
  it('returns an empty map for no accounts', () => {
    const balances = computeAccountBalances([], [])
    expect(balances.size).toBe(0)
  })

  it('seeds each account with its opening balance', () => {
    const balances = computeAccountBalances([bankAccount, creditCard], [])
    expect(balances.get('a_bank')).toBe(1_00_000)
    expect(balances.get('a_cc')).toBe(5_000)
  })

  it('income increases bank balance (excluded for investments)', () => {
    const balances = computeAccountBalances(
      [bankAccount, mfAccount],
      [
        txn({ id: 't1', type: 'income', amount: 50_000, accountId: 'a_bank' }),
        // Income to MF is excluded by the formula (use interest instead)
        txn({ id: 't2', type: 'income', amount: 99_99_99_99_999, accountId: 'a_mf' }),
      ],
    )
    expect(balances.get('a_bank')).toBe(1_50_000)
    expect(balances.get('a_mf')).toBe(0) // unchanged
  })

  it('expense decreases bank balance, increases CC outstanding', () => {
    const balances = computeAccountBalances(
      [bankAccount, creditCard],
      [
        txn({ id: 't1', type: 'expense', amount: 10_000, accountId: 'a_bank' }),
        txn({ id: 't2', type: 'expense', amount: 25_000, accountId: 'a_cc' }),
      ],
    )
    expect(balances.get('a_bank')).toBe(90_000)
    expect(balances.get('a_cc')).toBe(30_000) // outstanding went up
  })

  it('interest increases investment balance', () => {
    const balances = computeAccountBalances(
      [mfAccount, fdAccount],
      [
        txn({ id: 't1', type: 'interest', amount: 500, accountId: 'a_mf' }),
        txn({ id: 't2', type: 'interest', amount: 1_200, accountId: 'a_fd' }),
      ],
    )
    expect(balances.get('a_mf')).toBe(500)
    expect(balances.get('a_fd')).toBe(1_200)
  })

  it('transfer between banks moves money from source to destination', () => {
    const balances = computeAccountBalances(
      [bankAccount, cashAccount],
      [txn({ id: 't1', type: 'transfer', amount: 20_000, accountId: 'a_bank', toAccountId: 'a_cash' })],
    )
    expect(balances.get('a_bank')).toBe(80_000)
    expect(balances.get('a_cash')).toBe(20_000)
  })

  it('transfer from bank to CC counts as a payment (CC outstanding down)', () => {
    const balances = computeAccountBalances(
      [bankAccount, creditCard],
      [txn({ id: 't1', type: 'transfer', amount: 30_000, accountId: 'a_bank', toAccountId: 'a_cc' })],
    )
    expect(balances.get('a_bank')).toBe(70_000)
    expect(balances.get('a_cc')).toBe(-25_000) // outstanding went below opening (overpaid)
  })

  it('multiple transactions sum correctly', () => {
    const balances = computeAccountBalances(
      [bankAccount],
      [
        txn({ id: 't1', type: 'income', amount: 50_000, accountId: 'a_bank' }),
        txn({ id: 't2', type: 'expense', amount: 10_000, accountId: 'a_bank' }),
        txn({ id: 't3', type: 'expense', amount: 5_000, accountId: 'a_bank' }),
        txn({ id: 't4', type: 'transfer', amount: 20_000, accountId: 'a_bank', toAccountId: 'a_cash' }),
      ],
    )
    // 1_00_000 + 50_000 - 10_000 - 5_000 - 20_000 = 1_15_000
    expect(balances.get('a_bank')).toBe(1_15_000)
  })
})

// ---- computeNetWorth ------------------------------------------------------

describe('computeNetWorth', () => {
  it('subtracts CC outstanding from non-CC assets', () => {
    const balances = new Map<string, number>([
      ['a_bank', 1_00_000],     // asset ₹1,000
      ['a_mf', 50_000],         // asset ₹500
      ['a_cc', 20_000],         // liability ₹200 (outstanding)
    ])
    const nw = computeNetWorth([bankAccount, mfAccount, creditCard], balances)
    expect(nw).toBe(1_30_000) // (1_00_000 + 50_000) - 20_000
  })

  it('returns 0 when there are no accounts', () => {
    expect(computeNetWorth([], new Map())).toBe(0)
  })

  it('handles negative bank balance (overdrawn)', () => {
    const balances = new Map<string, number>([['a_bank', -10_000]])
    expect(computeNetWorth([bankAccount], balances)).toBe(-10_000)
  })
})

// ---- Liquidity computations ----------------------------------------------

describe('computeCashLiquidity', () => {
  it('sums bank + cash + digital_wallet only', () => {
    const balances = new Map<string, number>([
      ['a_bank', 1_00_000],
      ['a_cash', 5_000],
      ['a_wallet', 2_000],
      ['a_mf', 50_000],      // excluded
      ['a_cc', 10_000],      // excluded
      ['a_other', 1_000],    // excluded (other is not in CASH_TYPES)
    ])
    const accounts: Account[] = [bankAccount, cashAccount, walletAccount, mfAccount, creditCard, otherAccount]
    expect(computeCashLiquidity(accounts, balances)).toBe(1_07_000)
  })

  it('excludes archived accounts', () => {
    const balances = new Map<string, number>([
      ['a_bank', 1_00_000],
      ['a_archived', 50_000],
    ])
    expect(computeCashLiquidity([bankAccount, archivedAccount], balances)).toBe(1_00_000)
  })
})

describe('computeCreditLiquidity', () => {
  it('sums (creditLimit - outstanding) for each CC', () => {
    const balances = new Map<string, number>([
      ['a_cc', 30_000],      // outstanding ₹300; limit ₹5,000 → headroom ₹4,700
    ])
    expect(computeCreditLiquidity([creditCard], balances)).toBe(4_70_000) // paise
  })

  it('does not go negative (over-limit is floored to 0)', () => {
    const balances = new Map<string, number>([
      ['a_cc', 6_00_000], // outstanding > limit
    ])
    expect(computeCreditLiquidity([creditCard], balances)).toBe(0)
  })

  it('ignores non-CC accounts', () => {
    const balances = new Map<string, number>([
      ['a_bank', 1_00_000],
      ['a_cc', 10_000],
    ])
    expect(computeCreditLiquidity([bankAccount, creditCard], balances)).toBe(4_90_000)
  })
})

describe('computeSavingsLiquidity', () => {
  it('sums mutual_fund + fixed_deposit + recurring_deposit', () => {
    const rdAccount: Account = { ...bankAccount, id: 'a_rd', name: 'SBI RD', type: 'recurring_deposit' }
    const balances = new Map<string, number>([
      ['a_mf', 50_000],
      ['a_fd', 30_000],
      ['a_rd', 20_000],
      ['a_bank', 1_00_000],  // excluded
      ['a_cc', 10_000],      // excluded
    ])
    expect(computeSavingsLiquidity([mfAccount, fdAccount, rdAccount, bankAccount, creditCard], balances)).toBe(1_00_000)
  })

  it('excludes archived investment accounts', () => {
    const archivedMf: Account = { ...mfAccount, archived: true }
    const balances = new Map<string, number>([
      ['a_mf', 50_000],
      ['a_archived', 99_99_99_99_999],
    ])
    expect(computeSavingsLiquidity([mfAccount, archivedMf], balances)).toBe(50_000)
  })
})
