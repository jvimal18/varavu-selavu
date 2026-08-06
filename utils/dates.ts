/**
 * Date helpers — dates are stored as ISO date strings (YYYY-MM-DD).
 */
import { format, formatDistanceToNow, parseISO, isToday, isYesterday } from 'date-fns'

/**
 * Format a local Date as YYYY-MM-DD.
 *
 * IMPORTANT: never use `d.toISOString().slice(0, 10)` for "today" math — it
 * drifts by the UTC offset and silently breaks day-bucketing for users east
 * of UTC. This is the only way the rest of the app should produce an ISO
 * date from a Date.
 */
export function localISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Local YYYY-MM key for a Date (for month bucketing). */
export function localMonthKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function nowISO(): string {
  return new Date().toISOString()
}

/** Display "Today" / "Yesterday" / "Mon, 25 Jul" / "25 Jul" */
export function displayDate(iso: string): string {
  const d = parseISO(iso)
  if (isToday(d)) return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'd MMM')
}

/** Display for transaction list rows: "Today" / "Yesterday" / "25 Jul" */
export function displayShortDate(iso: string): string {
  const d = parseISO(iso)
  if (isToday(d)) return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'd MMM')
}

/** Display for "Good evening, Vimal" header */
export function greetingForHour(hour: number): string {
  if (hour < 5) return 'Good night'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

/** Display current month/year: "July 2026" */
export function displayMonth(date = new Date()): string {
  return format(date, 'MMMM yyyy')
}

export function relativeTime(iso: string): string {
  return formatDistanceToNow(parseISO(iso), { addSuffix: true })
}
