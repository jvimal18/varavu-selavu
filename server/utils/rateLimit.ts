/**
 * In-memory login rate limiter.
 *
 * The app binds 127.0.0.1:3000 behind Tailscale Funnel. Only the proxy can
 * connect, so the first entry of `x-forwarded-for` is the real client IP and
 * is safe to trust. All state is in-process — it resets on server restart,
 * which is acceptable for a single-node Pi deployment.
 *
 * Rules:
 *   - Per-IP login endpoint throttle: 20 requests/min (counts every attempt).
 *   - Per-IP failed-login block: 5 FAILED attempts per 15 minutes → blocked
 *     until the oldest failure in the window ages out.
 *   - Per-account progressive cooldown on consecutive failures: 5 → 30s,
 *     10 → 60s, 15+ → 300s. Reset on a successful login.
 */
import type { H3Event } from 'h3'

const THROTTLE_LIMIT = 20
const THROTTLE_WINDOW_MS = 60_000
const IP_FAIL_LIMIT = 5
const IP_FAIL_WINDOW_MS = 15 * 60_000

// Cooldown ladder: indexed by floor(consecutiveFailures / 5) - 1
//   5 failures → index 0 → 30s
//  10 failures → index 1 → 60s
//  15 failures → index 2 → 300s
//  20+        → index 3+ → 300s (capped)
const COOLDOWN_LADDER_MS = [30_000, 60_000, 300_000, 300_000]

type Bucket = number[] // event timestamps (ms)
const throttleBuckets = new Map<string, Bucket>()
const ipFailureBuckets = new Map<string, Bucket>()
const accountConsecutiveFails = new Map<string, number>()
const accountCooldownUntil = new Map<string, number>()

function pruneAndCount(map: Map<string, Bucket>, key: string, windowMs: number, now: number): number {
  let bucket = map.get(key)
  if (!bucket) {
    bucket = []
    map.set(key, bucket)
  }
  const cutoff = now - windowMs
  // Drop expired timestamps from the front
  while (bucket.length && bucket[0]! < cutoff) bucket.shift()
  return bucket.length
}

function pushEvent(map: Map<string, Bucket>, key: string, now: number) {
  let bucket = map.get(key)
  if (!bucket) {
    bucket = []
    map.set(key, bucket)
  }
  bucket.push(now)
}

/** First entry of x-forwarded-for, trimmed; else the socket remote address. */
export function getClientIp(event: H3Event): string {
  const xff = event.node.req.headers['x-forwarded-for']
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  if (Array.isArray(xff) && xff[0]) {
    const first = xff[0].split(',')[0]?.trim()
    if (first) return first
  }
  return event.node.req.socket?.remoteAddress || 'unknown'
}

export type CheckResult =
  | { ok: true }
  | { ok: false; retryAfter: number; message: string; attempts?: number }

/**
 * Human-friendly retry-time formatter for rate-limit messages.
 * <60s  -> "45 seconds"
 * 60s   -> "1 minute"
 * 90s   -> "2 minutes" (rounded up)
 * 300s  -> "5 minutes"
 */
export function formatRetryAfter(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds))
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`
  const m = Math.ceil(s / 60)
  return `${m} minute${m === 1 ? '' : 's'}`
}

function ceilDiv(a: number, b: number): number {
  return Math.ceil(a / 1000)
}

/**
 * Check whether the next login attempt from this IP / for this account is
 * allowed. Call BEFORE running credential verification. The IP throttle is
 * updated optimistically (incremented on every call) so a tight loop can't
 * slip through the window; the IP-failure block is read-only here (failures
 * are recorded in `recordLoginResult`).
 */
export function checkLoginAllowed(event: H3Event, accountKey: string): CheckResult {
  const now = Date.now()
  const ip = getClientIp(event)

  // 1) Endpoint throttle (20/min/IP) — count this attempt.
  const throttleCount = pruneAndCount(throttleBuckets, ip, THROTTLE_WINDOW_MS, now)
  pushEvent(throttleBuckets, ip, now)
  if (throttleCount >= THROTTLE_LIMIT) {
    const bucket = throttleBuckets.get(ip)!
    const oldest = bucket[0] ?? now
    const retryAfter = Math.max(1, Math.ceil((oldest + THROTTLE_WINDOW_MS - now) / 1000))
    return {
      ok: false,
      retryAfter,
      attempts: throttleCount + 1,
      message: `Too many login attempts from this device. Please wait ${formatRetryAfter(retryAfter)} before trying again.`,
    }
  }

  // 2) Per-IP failed-login block (5 per 15 min).
  const failedCount = pruneAndCount(ipFailureBuckets, ip, IP_FAIL_WINDOW_MS, now)
  if (failedCount >= IP_FAIL_LIMIT) {
    const bucket = ipFailureBuckets.get(ip)!
    const oldest = bucket[0] ?? now
    const retryAfter = Math.max(1, Math.ceil((oldest + IP_FAIL_WINDOW_MS - now) / 1000))
    return {
      ok: false,
      retryAfter,
      attempts: failedCount,
      message: `Too many failed attempts from this device (${failedCount}). Try again in ${formatRetryAfter(retryAfter)}.`,
    }
  }

  // 3) Per-account cooldown.
  const cooldownUntil = accountCooldownUntil.get(accountKey)
  if (cooldownUntil && cooldownUntil > now) {
    const retryAfter = Math.max(1, Math.ceil((cooldownUntil - now) / 1000))
    const attempts = accountConsecutiveFails.get(accountKey) ?? 0
    return {
      ok: false,
      retryAfter,
      attempts,
      message: `Too many failed attempts for this account (${attempts}). Try again in ${formatRetryAfter(retryAfter)}.`,
    }
  }

  return { ok: true }
}

/**
 * Record the outcome of a login attempt. On success, reset the account's
 * consecutive-failure counter and clear its cooldown. On failure, record the
 * IP-failure timestamp (drives the 5/15-min block) and escalate the
 * account-level cooldown if consecutive failures have reached a ladder rung.
 */
export function recordLoginResult(event: H3Event, accountKey: string, success: boolean): void {
  if (success) {
    accountConsecutiveFails.delete(accountKey)
    accountCooldownUntil.delete(accountKey)
    return
  }
  const now = Date.now()
  const ip = getClientIp(event)
  pushEvent(ipFailureBuckets, ip, now)

  const next = (accountConsecutiveFails.get(accountKey) ?? 0) + 1
  accountConsecutiveFails.set(accountKey, next)

  // 5, 10, 15, 20... failures → index 0, 1, 2, 3 → ladder durations
  if (next % 5 === 0) {
    const rung = Math.min(Math.floor(next / 5) - 1, COOLDOWN_LADDER_MS.length - 1)
    const durationMs = COOLDOWN_LADDER_MS[rung]!
    accountCooldownUntil.set(accountKey, now + durationMs)
  }
}

/**
 * Emit a Fail2Ban-parseable line for the systemd journal. The filter regex
 * in fail2ban/budget-auth.conf expects this exact format.
 */
export function logAuthFailure(ip: string, accountKey: string, reason: string): void {
  // One line, no extra prose. Filter regex anchors on `[auth-fail] ip=<HOST>`.
  console.error(`[auth-fail] ip=${ip} user=${accountKey} reason=${reason}`)
}
