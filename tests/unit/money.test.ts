/**
 * Tests for `utils/money.ts` — paise conversions and display formatting.
 *
 * Money is stored as integer paise (1 INR = 100 paise). All conversion
 * functions must round-trip cleanly. Display functions use `Intl.NumberFormat`
 * with `en-IN` for lakh grouping.
 */
import { describe, it, expect } from 'vitest'
import { formatPaise, rupeesToPaise, formatPaiseCompact, formatSigned } from '~~/utils/money'

describe('rupeesToPaise', () => {
  it('converts whole rupees to paise', () => {
    expect(rupeesToPaise(1)).toBe(100)
    expect(rupeesToPaise(0)).toBe(0)
    expect(rupeesToPaise(1000)).toBe(100000)
  })

  it('rounds to nearest paise (1.555 → 156, not 155)', () => {
    expect(rupeesToPaise(1.555)).toBe(156)
    expect(rupeesToPaise(1.554)).toBe(155)
  })

  it('handles negative values', () => {
    expect(rupeesToPaise(-1)).toBe(-100)
    expect(rupeesToPaise(-1.5)).toBe(-150)
  })
})

describe('formatPaise', () => {
  it('renders whole-rupee amounts without trailing decimals', () => {
    expect(formatPaise(100)).toBe('₹1')
    expect(formatPaise(500)).toBe('₹5')
  })

  it('shows decimals for fractional rupee amounts', () => {
    // 150 paise = 1.5 rupees — not a whole rupee, so the .50 is shown.
    expect(formatPaise(150)).toBe('₹1.50')
    expect(formatPaise(199)).toBe('₹1.99')
  })

  it('renders lakh grouping for large amounts', () => {
    // 1_23_45_600 paise = 1,23,456 rupees (1 lakh + 23k + 456)
    expect(formatPaise(1_23_45_600)).toBe('₹1,23,456')
    // 1_00_00_000 paise = 1,00,000 rupees = ₹1 lakh
    expect(formatPaise(1_00_00_000)).toBe('₹1,00,000')
  })

  it('handles null and NaN as em-dash', () => {
    expect(formatPaise(null as unknown as number)).toBe('—')
    expect(formatPaise(NaN)).toBe('—')
  })

  it('shows decimals when requested', () => {
    expect(formatPaise(150, { showDecimal: true })).toBe('₹1.50')
    expect(formatPaise(0, { showDecimal: true })).toBe('₹0.00')
  })

  it('omits the rupee symbol when plain', () => {
    expect(formatPaise(100, { plain: true })).toBe('1')
    expect(formatPaise(1_23_45_600, { plain: true })).toBe('1,23,456')
  })

  it('handles negative values', () => {
    expect(formatPaise(-100)).toBe('-₹1')
  })
})

describe('formatPaiseCompact', () => {
  it('uses K for thousands of rupees', () => {
    expect(formatPaiseCompact(1_00_000)).toBe('₹1.0K') // 1K rupees
    expect(formatPaiseCompact(12_34_500)).toBe('₹12.3K') // ~12.3K
  })

  it('uses L for lakhs', () => {
    expect(formatPaiseCompact(1_00_00_000)).toBe('₹1.00L') // 1L rupees
    expect(formatPaiseCompact(1_85_00_000)).toBe('₹1.85L')
  })

  it('uses Cr for crores', () => {
    expect(formatPaiseCompact(1_00_00_00_000)).toBe('₹1.00Cr') // 1Cr rupees
  })

  it('falls back to plain rupees for small amounts', () => {
    // 0 rupees → '₹0'. 0.99 rupees rounds to '₹1' via toFixed(0).
    expect(formatPaiseCompact(0)).toBe('₹0')
    expect(formatPaiseCompact(99)).toBe('₹1')
  })

  it('handles null and NaN as em-dash', () => {
    expect(formatPaiseCompact(null as unknown as number)).toBe('—')
    expect(formatPaiseCompact(NaN)).toBe('—')
  })
})

describe('formatSigned', () => {
  it('prefixes income and interest with +', () => {
    expect(formatSigned(100, 'income')).toBe('+₹1')
    expect(formatSigned(100, 'interest')).toBe('+₹1')
  })

  it('prefixes expense with −', () => {
    expect(formatSigned(100, 'expense')).toBe('−₹1')
  })

  it('leaves transfer unsigned', () => {
    expect(formatSigned(100, 'transfer')).toBe('₹1')
  })
})
