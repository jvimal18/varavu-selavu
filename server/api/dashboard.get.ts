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
import { displayMonth } from '~~/utils/dates'

/**
 * Dashboard aggregates — liquidity position, period income/expense, daily spends,
 * top categories, recent transactions, account balances, 6-month cash flow.
 *
 * The "period" is a configurable date range (defaults to the last 30 days)
 * rather than a fixed calendar month:
 *   ?period=this_month | last_30 | last_90 | custom
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD  (required when period=custom)
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

const PERIODS = ['this_month', 'last_30', 'last_90', 'since_last_salary', 'custom'] as const
type PeriodKey = (typeof PERIODS)[number]
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const db = useDb()

  const query = getQuery(event)
  const period = (query.period ?? 'since_last_salary') as string
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
    } else if (period === 'since_last_salary') {
      // Household-wide: the period starts from the FIRST salary credit of the
      // current pay cycle. Since the current month's salary is typically
      // credited in the last week of the previous month, we look for the
      // first "Salary"-category transaction in the previous month. If Vimal
      // got paid on Jul 24 and Pavithra on Jul 31, the period starts from
      // Jul 24 — the earlier one — so both users' spending in the August pay
      // cycle is included.
      //
      // We filter by the "Salary" category (c_salary) rather than the broad
      // "income" type so that other income (interest, gifts, refunds) does
      // not accidentally start a pay cycle.
      //
      // Fallback chain:
      //   1. First Salary-category transaction in the previous month (normal
      //      case: current-month salary lands in the last week of the
      //      previous month)
      //   2. First Salary-category transaction in the current month (edge
      //      case: salary lands in the first week of the current month, not
      //      the previous one)
      //   3. Most recent Salary-category transaction overall (edge case: no
      //      salary this month or last month yet — keep the previous pay
      //      cycle visible)
      //   4. Start of the current month (last-resort fallback)
      const SALARY_CATEGORY_ID = 'c_salary'
      const startOfThisMonth = localISODate(new Date(today.getFullYear(), today.getMonth(), 1))
      const startOfPrevMonth = localISODate(new Date(today.getFullYear(), today.getMonth() - 1, 1))

      const firstSalaryPrevMonth = await db.select({ date: schema.transactions.date })
        .from(schema.transactions)
        .where(and(
          eq(schema.transactions.categoryId, SALARY_CATEGORY_ID),
          gte(schema.transactions.date, startOfPrevMonth),
          lt(schema.transactions.date, startOfThisMonth),
        ))
        .orderBy(asc(schema.transactions.date), asc(schema.transactions.createdAt))
        .limit(1)
        .get()

      if (firstSalaryPrevMonth) {
        from = firstSalaryPrevMonth.date
      } else {
        const firstSalaryThisMonth = await db.select({ date: schema.transactions.date })
          .from(schema.transactions)
          .where(and(
            eq(schema.transactions.categoryId, SALARY_CATEGORY_ID),
            gte(schema.transactions.date, startOfThisMonth),
          ))
          .orderBy(asc(schema.transactions.date), asc(schema.transactions.createdAt))
          .limit(1)
          .get()
        if (firstSalaryThisMonth) {
          from = firstSalaryThisMonth.date
        } else {
          const lastSalary = await db.select({ date: schema.transactions.date })
            .from(schema.transactions)
            .where(eq(schema.transactions.categoryId, SALARY_CATEGORY_ID))
            .orderBy(desc(schema.transactions.date), desc(schema.transactions.createdAt))
            .limit(1)
            .get()
          from = lastSalary?.date ?? startOfThisMonth
        }
      }
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
          : period === 'since_last_salary'
            ? `Since ${format(parseISO(from), 'MMM d')}`
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
