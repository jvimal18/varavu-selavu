/**
 * Tests for `server/utils/dashboardPeriods.ts`.
 *
 * The `since_last_salary` fallback chain has 4 branches and is the kind of
 * thing that silently breaks in a refactor. These tests pin each branch
 * down. We mock the DB via the `FindSalaryDate` callback.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveStaticPeriod,
  resolveSinceLastSalary,
  resolvePeriod,
  type FindSalaryDate,
} from '~~/server/utils/dashboardPeriods'

const TODAY = new Date(2026, 6, 15) // 15 July 2026 (local)

function mockSalary(rows: Partial<Record<'in_previous_month' | 'in_current_month' | 'most_recent', string | null>>): FindSalaryDate {
  return async (filter) => rows[filter] ?? null
}

// ---- resolveStaticPeriod --------------------------------------------------

describe('resolveStaticPeriod', () => {
  it('this_month: 1st of the current month → today', () => {
    const r = resolveStaticPeriod('this_month', TODAY)
    expect(r).toEqual({ from: '2026-07-01', to: '2026-07-15' })
  })

  it('last_30: 30 days back → today', () => {
    const r = resolveStaticPeriod('last_30', TODAY)
    expect(r).toEqual({ from: '2026-06-15', to: '2026-07-15' })
  })

  it('last_90: 90 days back → today', () => {
    const r = resolveStaticPeriod('last_90', TODAY)
    expect(r).toEqual({ from: '2026-04-16', to: '2026-07-15' })
  })

  it('handles month boundary (today = 1st)', () => {
    const r = resolveStaticPeriod('this_month', new Date(2026, 6, 1))
    expect(r).toEqual({ from: '2026-07-01', to: '2026-07-01' })
  })

  it('handles year boundary (January)', () => {
    const r = resolveStaticPeriod('this_month', new Date(2026, 0, 5))
    expect(r).toEqual({ from: '2026-01-01', to: '2026-01-05' })
  })
})

// ---- resolveSinceLastSalary ----------------------------------------------

describe('resolveSinceLastSalary', () => {
  it('uses the previous-month salary when present', async () => {
    const find = mockSalary({ in_previous_month: '2026-06-28' })
    const r = await resolveSinceLastSalary(find, TODAY)
    expect(r).toEqual({ from: '2026-06-28', to: '2026-07-15' })
  })

  it('falls back to current-month salary when previous-month is missing', async () => {
    const find = mockSalary({ in_current_month: '2026-07-02' })
    const r = await resolveSinceLastSalary(find, TODAY)
    expect(r).toEqual({ from: '2026-07-02', to: '2026-07-15' })
  })

  it('falls back to most-recent salary when current + previous are missing', async () => {
    const find = mockSalary({ most_recent: '2026-05-25' })
    const r = await resolveSinceLastSalary(find, TODAY)
    expect(r).toEqual({ from: '2026-05-25', to: '2026-07-15' })
  })

  it('falls back to start of current month when no salary at all', async () => {
    const find = mockSalary({})
    const r = await resolveSinceLastSalary(find, TODAY)
    expect(r).toEqual({ from: '2026-07-01', to: '2026-07-15' })
  })

  it('prefers previous-month over current-month when both exist', async () => {
    // The whole point of the chain: salary typically lands in the last week
    // of the previous month, and we want THAT to anchor the cycle, not the
    // (rarer) early-current-month case.
    const find = mockSalary({ in_previous_month: '2026-06-28', in_current_month: '2026-07-02' })
    const r = await resolveSinceLastSalary(find, TODAY)
    expect(r.from).toBe('2026-06-28')
  })
})

// ---- resolvePeriod (top-level) -------------------------------------------

describe('resolvePeriod', () => {
  it('defaults to since_last_salary when no period is given', async () => {
    const find = mockSalary({ in_previous_month: '2026-06-28' })
    const r = await resolvePeriod(find, {}, TODAY)
    expect(r).toEqual({ from: '2026-06-28', to: '2026-07-15', label: 'Since Jun 28' })
  })

  it('this_month returns a "Month YYYY" label', async () => {
    const find = mockSalary({})
    const r = await resolvePeriod(find, { period: 'this_month' }, TODAY)
    expect(r.label).toBe('July 2026')
  })

  it('last_30 returns "Last 30 days"', async () => {
    const find = mockSalary({})
    const r = await resolvePeriod(find, { period: 'last_30' }, TODAY)
    expect(r.label).toBe('Last 30 days')
  })

  it('last_90 returns "Last 90 days"', async () => {
    const find = mockSalary({})
    const r = await resolvePeriod(find, { period: 'last_90' }, TODAY)
    expect(r.label).toBe('Last 90 days')
  })

  it('since_last_salary returns "Since MMM d"', async () => {
    const find = mockSalary({ in_previous_month: '2026-06-28' })
    const r = await resolvePeriod(find, { period: 'since_last_salary' }, TODAY)
    expect(r.label).toBe('Since Jun 28')
  })

  it('custom returns a date range label', async () => {
    const find = mockSalary({})
    const r = await resolvePeriod(
      find,
      { period: 'custom', from: '2026-06-01', to: '2026-06-30' },
      TODAY,
    )
    expect(r.from).toBe('2026-06-01')
    expect(r.to).toBe('2026-06-30')
    expect(r.label).toBe('Jun 1 – Jun 30')
  })

  it('throws on invalid period', async () => {
    const find = mockSalary({})
    await expect(resolvePeriod(find, { period: 'last_year' }, TODAY)).rejects.toThrow('Invalid period')
  })

  it('throws when custom is missing from/to', async () => {
    const find = mockSalary({})
    await expect(resolvePeriod(find, { period: 'custom' }, TODAY)).rejects.toThrow('YYYY-MM-DD')
  })

  it('throws when custom from > to', async () => {
    const find = mockSalary({})
    await expect(
      resolvePeriod(find, { period: 'custom', from: '2026-12-01', to: '2026-11-01' }, TODAY),
    ).rejects.toThrow('from must be on or before to')
  })
})
