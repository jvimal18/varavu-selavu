import { defineEventHandler, getQuery, createError } from 'h3'
import { useDb, schema } from '~~/server/db/client'
import { desc, eq, asc, and, gte, lt } from 'drizzle-orm'
import { requireUser } from '~~/server/utils/auth'
import {
  computeAccountBalances,
  computeCashLiquidity,
  computeCreditLiquidity,
  computeSavingsLiquidity,
} from '~~/composables/useAccountBalances'
import { format, parseISO } from 'date-fns'
import { localISODate, localMonthKey } from '~~/utils/dates'
import { resolvePeriod, type FindSalaryDate } from '~~/server/utils/dashboardPeriods'

/**
 * Dashboard aggregates — liquidity position, period income/expense, daily spends,
 * top categories, recent transactions, account balances, 6-month cash flow.
 *
 * The "period" is a configurable date range (defaults to the last 30 days)
 * rather than a fixed calendar month:
 *   ?period=this_month | last_30 | last_90 | since_last_salary | custom
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD  (required when period=custom)
 *
 * Period resolution lives in `~~/server/utils/dashboardPeriods.ts` so it can
 * be unit-tested. This handler adapts the Drizzle query into the
 * `FindSalaryDate` callback the resolver expects.
 *
 * Liquidity (cashLiquidity / creditLiquidity / savingsLiquidity) and account
 * balances are always all-time; recentTransactions is global recency. The
 * 6-month cash flow is anchored at the period end.
 *
 * NOTE: all "today"-relative math uses the user's local timezone via
 * `new Date()` — never `toISOString()`, which drifts by the UTC offset.
 * Transactions store dates as YYYY-MM-DD strings, so ranges compare as ISO
 * strings (lexicographic === chronological).
 */

const SALARY_CATEGORY_ID = 'c_salary'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const db = useDb()
  const today = new Date()
  const query = getQuery(event)

  // Adapt Drizzle to the FindSalaryDate callback the period resolver expects.
  // One Drizzle query per branch; the resolver's 4-step fallback chain maps
  // directly onto three "filter" values.
  const findSalaryDate: FindSalaryDate = async (filter) => {
    const startOfThisMonth = localISODate(new Date(today.getFullYear(), today.getMonth(), 1))
    const startOfPrevMonth = localISODate(new Date(today.getFullYear(), today.getMonth() - 1, 1))
    let row: { date: string } | undefined
    if (filter === 'in_previous_month') {
      row = await db.select({ date: schema.transactions.date })
        .from(schema.transactions)
        .where(and(
          eq(schema.transactions.categoryId, SALARY_CATEGORY_ID),
          gte(schema.transactions.date, startOfPrevMonth),
          lt(schema.transactions.date, startOfThisMonth),
        ))
        .orderBy(asc(schema.transactions.date), asc(schema.transactions.createdAt))
        .limit(1)
        .get()
    } else if (filter === 'in_current_month') {
      row = await db.select({ date: schema.transactions.date })
        .from(schema.transactions)
        .where(and(
          eq(schema.transactions.categoryId, SALARY_CATEGORY_ID),
          gte(schema.transactions.date, startOfThisMonth),
        ))
        .orderBy(asc(schema.transactions.date), asc(schema.transactions.createdAt))
        .limit(1)
        .get()
    } else { // 'most_recent'
      row = await db.select({ date: schema.transactions.date })
        .from(schema.transactions)
        .where(eq(schema.transactions.categoryId, SALARY_CATEGORY_ID))
        .orderBy(desc(schema.transactions.date), desc(schema.transactions.createdAt))
        .limit(1)
        .get()
    }
    return row?.date ?? null
  }

  // Resolve the period (throws on invalid period / bad custom dates).
  let period
  try {
    period = await resolvePeriod(findSalaryDate, query, today)
  } catch (err) {
    throw createError({
      statusCode: 400,
      statusMessage: err instanceof Error ? err.message : 'Invalid period',
    })
  }
  const { from, to, label: periodLabel } = period

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

  // Daily expense totals for the period, zero-filled and ascending by date.
  // Iterated in local time so the day boundaries match the user's tz.
  const dailySpends: Array<{ date: string; label: string; amount: number }> = []
  {
    const start = parseISO(from)
    const end = parseISO(to)
    const dayMs = 24 * 60 * 60 * 1000
    const days: string[] = []
    for (let t = start.getTime(); t <= end.getTime() + 1; t += dayMs) {
      days.push(localISODate(new Date(t)))
    }
    const spendByDate = new Map<string, number>()
    for (const t of periodTxns) {
      if (t.type !== 'expense') continue
      spendByDate.set(t.date, (spendByDate.get(t.date) || 0) + t.amount)
    }
    for (const d of days) {
      dailySpends.push({
        date: d,
        label: format(parseISO(d), 'MMM d'),
        amount: (spendByDate.get(d) || 0) / 100,
      })
    }
  }

  // Dynamic balances from opening balance + all transactions
  const balances = computeAccountBalances(accounts, transactions)
  const cashLiquidity = computeCashLiquidity(accounts, balances)
  const creditLiquidity = computeCreditLiquidity(accounts, balances)
  const savingsLiquidity = computeSavingsLiquidity(accounts, balances)

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
      cashLiquidity,
      creditLiquidity,
      savingsLiquidity,
      periodIncome,
      periodExpense,
      period: { from, to, label: periodLabel },
      monthBudget,
      monthBudgetSet,
      topCategories,
      recentTransactions,
      accounts: accountCards,
      cashFlow,
      dailySpends,
    },
  }
})
