import { defineEventHandler, getQuery, createError } from 'h3'
import { useDb, schema } from '~~/server/db/client'
import { desc, eq } from 'drizzle-orm'
import { requireUser } from '~~/server/utils/auth'
import { computeAccountBalances, computeNetWorth } from '~~/composables/useAccountBalances'
import { format, parseISO } from 'date-fns'
import { displayMonth } from '~~/utils/dates'

/**
 * Dashboard aggregates — net worth, period income/expense/savings amount,
 * top categories, recent transactions, account balances, 6-month cash flow.
 *
 * The "period" is a configurable date range (defaults to the last 30 days)
 * rather than a fixed calendar month:
 *   ?period=this_month | last_30 | last_90 | custom
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD  (required when period=custom)
 *
 * Net worth and account balances are always all-time; recentTransactions is
 * global recency. The 6-month cash flow is anchored at the period end.
 *
 * NOTE: all "today"-relative math uses the user's local timezone via
 * `new Date()` — never `toISOString()`, which drifts by the UTC offset.
 * Transactions store dates as YYYY-MM-DD strings, so ranges compare as ISO
 * strings (lexicographic === chronological).
 */

/** Format a local Date as YYYY-MM-DD (avoids toISOString UTC drift). */
function localISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Local YYYY-MM key for a Date (for month bucketing). */
function localMonthKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

const PERIODS = ['this_month', 'last_30', 'last_90', 'custom'] as const
type PeriodKey = (typeof PERIODS)[number]
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const db = useDb()

  const query = getQuery(event)
  const period = (query.period ?? 'last_30') as string
  if (!PERIODS.includes(period as PeriodKey)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid period: ${period}` })
  }

  // ---- Resolve the date range in local time ----
  const today = new Date()
  let from: string
  let to: string

  if (period === 'custom') {
    from = typeof query.from === 'string' ? query.from : ''
    to = typeof query.to === 'string' ? query.to : ''
    if (!ISO_DATE_RE.test(from) || !ISO_DATE_RE.test(to)) {
      throw createError({ statusCode: 400, statusMessage: 'from and to must be YYYY-MM-DD when period=custom' })
    }
    if (from > to) {
      throw createError({ statusCode: 400, statusMessage: 'from must be on or before to' })
    }
  } else {
    to = localISODate(today)
    if (period === 'this_month') {
      from = localISODate(new Date(today.getFullYear(), today.getMonth(), 1))
    } else {
      const days = period === 'last_30' ? 30 : 90
      from = localISODate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - days))
    }
  }

  const periodLabel =
    period === 'this_month'
      ? displayMonth()
      : period === 'last_30'
        ? 'Last 30 days'
        : period === 'last_90'
          ? 'Last 90 days'
          : `${format(parseISO(from), 'MMM d')} – ${format(parseISO(to), 'MMM d')}`

  const accounts = (await db.select().from(schema.accounts).all()).filter((a) => !a.archived)
  // Transactions are hard-deleted (no soft-delete field); all rows are live.
  const transactions = await db.select().from(schema.transactions)
    .orderBy(desc(schema.transactions.date), desc(schema.transactions.createdAt))
    .all()
  const categories = (await db.select().from(schema.categories).all()).filter((c) => !c.archived)

  const catById = new Map(categories.map((c) => [c.id, c]))

  // ---- Period-bounded aggregates ----
  const inRange = (t: { date: string }) => t.date >= from && t.date <= to
  const periodTxns = transactions.filter(inRange)
  const periodIncome = periodTxns.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const periodExpense = periodTxns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  // Top 5 categories by period expense
  const catTotals = new Map<string, number>()
  for (const t of periodTxns.filter((t) => t.type === 'expense')) {
    if (!t.categoryId) continue
    catTotals.set(t.categoryId, (catTotals.get(t.categoryId) || 0) + t.amount)
  }
  const topCategories = Array.from(catTotals.entries())
    .map(([id, amount]) => ({
      categoryId: id,
      name: catById.get(id)?.name || 'Unknown',
      color: catById.get(id)?.color || '#A8A29E',
      amount,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)

  // Recent transactions — global recency, no period filter
  const recentTransactions = transactions.slice(0, 10)

  // Dynamic balances from opening balance + all transactions
  const balances = computeAccountBalances(accounts, transactions)
  const netWorth = computeNetWorth(accounts, balances)

  // Account cards with dynamic balance
  const accountCards = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    balance: balances.get(a.id) || 0,
    creditLimit: a.creditLimit,
    color: a.color,
    icon: a.icon,
    last4: a.last4,
  }))

  // 6-month cash flow (income/expense in rupees, divided by 100 from paise),
  // anchored at the period end rather than "today".
  const anchor = parseISO(to)
  const cashFlow: Array<{ month: string; income: number; expense: number }> = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1)
    const key = localMonthKey(d)
    const monthLabel = d.toLocaleString('en-US', { month: 'short' })
    const mTxns = transactions.filter((t) => t.date.startsWith(key))
    const income = mTxns.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
    const expense = mTxns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
    cashFlow.push({ month: monthLabel, income: income / 100, expense: expense / 100 })
  }

  // Per-user monthly budget (paise); 0 when unset. UI gates display on monthBudgetSet.
  const userSetting = await db.select().from(schema.userSettings)
    .where(eq(schema.userSettings.userId, user.id))
    .get()
  const monthBudget = userSetting?.monthlyBudgetPaise ?? 0
  const monthBudgetSet = monthBudget > 0

  return {
    data: {
      netWorth,
      periodIncome,
      periodExpense,
      period: { from, to, label: periodLabel },
      monthBudget,
      monthBudgetSet,
      topCategories,
      recentTransactions,
      accounts: accountCards,
      cashFlow,
    },
  }
})
