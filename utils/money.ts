/**
 * Money + display helpers used in both client and server.
 * All money is stored as integer paise (1 INR = 100 paise).
 */

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

const INR_DEC = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const PLAIN = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

/** 1234567 paise -> "₹12,346" (rounded). Pass showDecimal to keep .00 */
export function formatPaise(paise: number, opts: { showDecimal?: boolean; plain?: boolean } = {}): string {
  if (paise == null || isNaN(paise)) return '—'
  if (opts.plain) return PLAIN.format(Math.round(paise / 100))
  const rupees = paise / 100
  if (opts.showDecimal || !Number.isInteger(rupees)) return INR_DEC.format(rupees)
  return INR.format(rupees)
}

/** Rupees (may be decimal) -> integer paise */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100)
}

/** Compact: ₹1.85L / ₹1.85Cr / ₹1.2K */
export function formatPaiseCompact(paise: number): string {
  if (paise == null || isNaN(paise)) return '—'
  const r = paise / 100
  const abs = Math.abs(r)
  if (abs >= 1_00_00_000) return `₹${(r / 1_00_00_000).toFixed(2)}Cr`
  if (abs >= 1_00_000) return `₹${(r / 1_00_000).toFixed(2)}L`
  if (abs >= 1_000) return `₹${(r / 1_000).toFixed(1)}K`
  return `₹${r.toFixed(0)}`
}

/** Signed display: +₹100 / −₹100 / ₹100 (for transfer) */
export function formatSigned(paise: number, type: 'expense' | 'income' | 'transfer'): string {
  const v = formatPaise(Math.abs(paise))
  if (type === 'income') return `+${v}`
  if (type === 'transfer') return v
  return `−${v}`
}
