/**
 * Money helpers — all money is stored as integer paise (1 INR = 100 paise).
 * Never use floats for money.
 */

const INR_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

const INR_FORMATTER_DECIMAL = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const PLAIN_FORMATTER = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

/** Convert paise (integer) to a formatted ₹ string: 1234567 -> "₹12,346" (rounds) */
export function formatPaise(paise: number, options: { showDecimal?: boolean; plain?: boolean } = {}): string {
  if (paise == null) return '—'
  if (options.plain) {
    const rupees = Math.round(paise / 100)
    return PLAIN_FORMATTER.format(rupees)
  }
  const rupees = paise / 100
  if (options.showDecimal || !Number.isInteger(rupees)) {
    return INR_FORMATTER_DECIMAL.format(rupees)
  }
  return INR_FORMATTER.format(rupees)
}

/** Convert rupees (number, may be decimal) to integer paise */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100)
}

/** Compact display: 185000000 paise -> "₹1.85L" / "₹1.85Cr" */
export function formatPaiseCompact(paise: number): string {
  if (paise == null) return '—'
  const rupees = paise / 100
  if (Math.abs(rupees) >= 1_00_00_000) {
    return `₹${(rupees / 1_00_00_000).toFixed(2)}Cr`
  }
  if (Math.abs(rupees) >= 1_00_000) {
    return `₹${(rupees / 1_00_000).toFixed(2)}L`
  }
  if (Math.abs(rupees) >= 1_000) {
    return `₹${(rupees / 1_000).toFixed(1)}K`
  }
  return `₹${rupees.toFixed(0)}`
}

/** Signed display: income green (+), expense ink (-), transfer amber */
export function formatSigned(paise: number, type: 'expense' | 'income' | 'transfer'): string {
  const formatted = formatPaise(Math.abs(paise))
  if (type === 'income') return `+${formatted}`
  if (type === 'transfer') return formatted
  return `−${formatted}`
}
