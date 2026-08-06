import { defineEventHandler } from 'h3'
import { clearSessionCookie } from '~~/server/utils/auth'

/**
 * clearSessionCookie is async in Phase 1 PR 4 (it UPDATEs the sessions
 * row to set revoked_at before deleting the cookie). The handler MUST
 * be async and MUST await it — otherwise the response is sent before
 * the DB write completes, and the session row stays "active" until
 * its natural expiry.
 */
export default defineEventHandler(async (event) => {
  await clearSessionCookie(event)
  return { ok: true }
})
