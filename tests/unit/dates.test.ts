/**
 * Tests for `utils/dates.ts`.
 *
 * The most important invariant: `localISODate` must NOT use `toISOString` —
 * that drifts by the UTC offset and silently breaks day-bucketing for users
 * east of UTC. These tests assert the function returns the local-calendar
 * date, not the UTC one.
 */
import { describe, it, expect } from 'vitest'
import { localISODate, localMonthKey, displayMonth, greetingForHour } from '~~/utils/dates'

describe('localISODate', () => {
  it('formats a Date as YYYY-MM-DD using local components', () => {
    // Jan 5, 2026 local
    expect(localISODate(new Date(2026, 0, 5))).toBe('2026-01-05')
    // Dec 31, 2026 local
    expect(localISODate(new Date(2026, 11, 31))).toBe('2026-12-31')
  })

  it('pads single-digit months and days', () => {
    expect(localISODate(new Date(2026, 0, 1))).toBe('2026-01-01')
    expect(localISODate(new Date(2026, 8, 9))).toBe('2026-09-09')
  })

  it('handles leap-day', () => {
    expect(localISODate(new Date(2024, 1, 29))).toBe('2024-02-29')
  })

  it('rolls over month boundary correctly', () => {
    // The point of this test: if you compute "today - 1 day" near a month
    // boundary, you get the LAST day of the previous month — not a UTC
    // artifact that lands on a different day.
    const endOfJan = new Date(2026, 0, 31, 23, 59, 59)
    const prev = new Date(endOfJan.getFullYear(), endOfJan.getMonth(), endOfJan.getDate() - 1)
    expect(localISODate(prev)).toBe('2026-01-30')
  })
})

describe('localMonthKey', () => {
  it('returns YYYY-MM for the local month', () => {
    expect(localMonthKey(new Date(2026, 0, 15))).toBe('2026-01')
    expect(localMonthKey(new Date(2026, 11, 31))).toBe('2026-12')
  })

  it('pads single-digit months', () => {
    expect(localMonthKey(new Date(2026, 8, 1))).toBe('2026-09')
  })
})

describe('displayMonth', () => {
  it('returns "Month YYYY"', () => {
    expect(displayMonth(new Date(2026, 6, 15))).toBe('July 2026')
  })

  it('defaults to current date', () => {
    const out = displayMonth()
    expect(out).toMatch(/^[A-Z][a-z]+ \d{4}$/)
  })
})

describe('greetingForHour', () => {
  it('returns the right greeting for each part of the day', () => {
    expect(greetingForHour(0)).toBe('Good night')
    expect(greetingForHour(4)).toBe('Good night')
    expect(greetingForHour(5)).toBe('Good morning')
    expect(greetingForHour(11)).toBe('Good morning')
    expect(greetingForHour(12)).toBe('Good afternoon')
    expect(greetingForHour(16)).toBe('Good afternoon')
    expect(greetingForHour(17)).toBe('Good evening')
    expect(greetingForHour(23)).toBe('Good evening')
  })
})
