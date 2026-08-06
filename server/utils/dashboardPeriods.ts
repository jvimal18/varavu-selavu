/**
 * Dashboard period resolution.
 *
 * Pulled out of `server/api/dashboard.get.ts` so it can be unit-tested without
 * spinning up the whole Nuxt server. The dashboard endpoint adapts the Drizzle
 * query into the `FindSalaryDate` callback shape and calls `resolvePeriod`.
 *
 * Periods:
 *   - 'this_month'         1st of the current month → today
 *   - 'last_30'            today − 30d → today
 *   - 'last_90'            today − 90d → today
 *   - 'since_last_salary'  first Salary-category transaction in the prior
 *                          pay cycle (or current/most-recent as fallbacks) → today
 *   - 'custom'             explicit from/to (YYYY-MM-DD)
 */
import { format, parseISO } from 'date-fns'
import { displayMonth, localISODate } from '~~/utils/dates'

export const PERIODS = ['this_month', 'last_30', 'last_90', 'since_last_salary', 'custom'] as const
export type PeriodKey = (typeof PERIODS)[number]

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface ResolvedPeriod {
  from: string
  to: string
  label: string
}

/**
 * Callback shape that the dashboard period resolver needs from the DB layer.
 * The dashboard endpoint wraps a Drizzle query; tests inject a mock.
 */
export type FindSalaryDate = (
  filter: 'in_previous_month' | 'in_current_month' | 'most_recent'
) => Promise<string | null>

/**
 * Pure date math for the simple periods. Split out so the since_last_salary
 * branch can be tested independently of the local-clock math.
 */
export function resolveStaticPeriod(period: Exclude<PeriodKey, 'since_last_salary' | 'custom'>, today: Date): { from: string; to: string } {
  const to = localISODate(today)
  if (period === 'this_month') {
    return { from: localISODate(new Date(today.getFullYear(), today.getMonth(), 1)), to }
  }
  const days = period === 'last_30' ? 30 : 90
  return {
    from: localISODate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - days)),
    to,
  }
}

/**
 * since_last_salary fallback chain (in order):
 *   1. First Salary-category transaction in the previous month
 *      (normal case: current-month salary lands in the last week of the
 *      previous month)
 *   2. First Salary-category transaction in the current month
 *      (edge case: salary lands in the first week of the current month, not
 *      the previous one)
 *   3. Most recent Salary-category transaction overall
 *      (edge case: no salary this month or last month yet — keep the previous
 *      pay cycle visible)
 *   4. Start of the current month
 *      (last-resort fallback — no salary transactions in the system)
 */
export async function resolveSinceLastSalary(
  findSalaryDate: FindSalaryDate,
  today: Date,
): Promise<{ from: string; to: string }> {
  const to = localISODate(today)
  const startOfThisMonth = localISODate(new Date(today.getFullYear(), today.getMonth(), 1))

  const inPrevious = await findSalaryDate('in_previous_month')
  if (inPrevious) return { from: inPrevious, to }

  const inCurrent = await findSalaryDate('in_current_month')
  if (inCurrent) return { from: inCurrent, to }

  const mostRecent = await findSalaryDate('most_recent')
  if (mostRecent) return { from: mostRecent, to }

  return { from: startOfThisMonth, to }
}

function resolveCustom(query: Record<string, unknown>): { from: string; to: string } {
  const from = typeof query.from === 'string' ? query.from : ''
  const to = typeof query.to === 'string' ? query.to : ''
  if (!ISO_DATE_RE.test(from) || !ISO_DATE_RE.test(to)) {
    throw new Error('from and to must be YYYY-MM-DD when period=custom')
  }
  if (from > to) {
    throw new Error('from must be on or before to')
  }
  return { from, to }
}

function periodLabel(period: PeriodKey, from: string, to: string): string {
  if (period === 'this_month') return displayMonth(parseISO(from))
  if (period === 'last_30') return 'Last 30 days'
  if (period === 'last_90') return 'Last 90 days'
  if (period === 'since_last_salary') return `Since ${format(parseISO(from), 'MMM d')}`
  return `${format(parseISO(from), 'MMM d')} – ${format(parseISO(to), 'MMM d')}`
}

/**
 * Top-level entry point. Throws on invalid period / bad custom dates. The
 * dashboard endpoint should map these Errors to HTTP 400s.
 */
export async function resolvePeriod(
  findSalaryDate: FindSalaryDate,
  query: Record<string, unknown>,
  today: Date = new Date(),
): Promise<ResolvedPeriod> {
  const periodRaw = (query.period ?? 'since_last_salary') as string
  if (!PERIODS.includes(periodRaw as PeriodKey)) {
    throw new Error(`Invalid period: ${periodRaw}`)
  }
  // After the includes() check, narrow to the union.
  const period = periodRaw as PeriodKey

  let range: { from: string; to: string }
  if (period === 'custom') {
    range = resolveCustom(query)
  } else if (period === 'since_last_salary') {
    range = await resolveSinceLastSalary(findSalaryDate, today)
  } else {
    range = resolveStaticPeriod(period, today)
  }

  return { ...range, label: periodLabel(period, range.from, range.to) }
}
