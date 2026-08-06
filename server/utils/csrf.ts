/**
 * CSRF helpers — pure functions used by `server/middleware/00.csrf.ts`.
 *
 * Strategy: check the `Origin` header on state-changing requests
 * (POST/PATCH/PUT/DELETE) to `/api/*`. The browser always sets `Origin`
 * on these requests, and a cross-site attacker cannot spoof it (same-origin
 * policy + CORS preflight). The header is verified against a server-side
 * allowlist configured via `NUXT_ALLOWED_ORIGINS`.
 *
 * Why not `X-Requested-With`? It would also work, but Nuxt's `$fetch`
 * (ofetch) does NOT set it by default — we'd have to wire up a global
 * `onRequest` hook to set it on every call. `Origin` is set automatically
 * by the browser, so checking it requires zero client changes.
 */

/**
 * Parse the `NUXT_ALLOWED_ORIGINS` env var. Comma-separated, whitespace
 * tolerated, empty entries dropped. An empty string input returns `[]`.
 */
export function parseAllowedOrigins(raw: string | undefined | null): string[] {
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

/**
 * Decide whether a given `Origin` header value is permitted.
 *
 * Returns:
 *   - `{ ok: true }` if the origin is in the allowlist
 *   - `{ ok: false, reason: '...' }` otherwise (with a human-readable reason
 *     suitable for a 403 response body)
 *
 * Note: missing Origin is treated as a hard fail. The app is a single-page
 * app behind Tailscale Funnel — there is no legitimate server-to-server
 * state-changing traffic.
 */
export function isOriginAllowed(
  origin: string | undefined | null,
  allowed: string[],
): { ok: true } | { ok: false; reason: string } {
  if (!origin) {
    return { ok: false, reason: 'Missing Origin header.' }
  }
  if (allowed.length === 0) {
    return { ok: false, reason: 'No origins configured. Set NUXT_ALLOWED_ORIGINS.' }
  }
  if (!allowed.includes(origin)) {
    return { ok: false, reason: `Origin not in allowlist: ${origin}` }
  }
  return { ok: true }
}
