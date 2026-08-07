/**
 * Auth HTTP contract.
 *
 * These tests deliberately stop at the real Nuxt HTTP server: the production
 * break they protect against is a route, middleware, cookie, or DB ordering
 * regression that a handler import would not catch.
 */
/* Revocation coverage decision: the mirrored SQL test is intentionally removed.
 * The setup-pin HTTP assertions below are the primary revokeAllOtherSessions contract.
 * No pure-helper duplicate remains because it would not add HTTP coverage.
 */
import bcrypt from 'bcryptjs'
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createNuxtTestHarness } from '~~/tests/helpers/nuxt-server'

const harness = await createNuxtTestHarness()
const ORIGIN = 'http://localhost:3000'
const VIMAL = 'u_vimal'
const PAVITHRA = 'u_pavithra'
const VIMAL_PIN = '1234'
const PAVITHRA_PIN = '5678'

type JsonObject = Record<string, unknown>

function headers(ip: string, cookie = ''): HeadersInit {
  return {
    Cookie: cookie,
    Origin: ORIGIN,
    'x-forwarded-for': ip,
  }
}

async function postJson(path: string, body: JsonObject, label: string, cookie = ''): Promise<Response> {
  return harness.fetch(path, {
    method: 'POST',
    headers: {
      ...headers(harness.clientIp(label), cookie),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

async function json(response: Response): Promise<JsonObject> {
  return await response.json() as JsonObject
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function mutateTestDb(sql: string, params: readonly (string | number | null)[] = []): void {
  const db = new Database(harness.dbPath)
  try {
    db.prepare(sql).run(...(params as never[]))
  } finally {
    db.close()
  }
}

function errorMessage(body: JsonObject): string | undefined {
  if (typeof body.message === 'string') return body.message
  if (typeof body.data === 'object' && body.data !== null) {
    const message = (body.data as JsonObject).message
    if (typeof message === 'string') return message
  }
  return undefined
}

describe('auth HTTP flows', () => {
  it('sets up a first PIN and stores only a hashed session identifier', async () => {
    const response = await postJson('/api/auth/setup-pin', {
      userId: VIMAL,
      pin: VIMAL_PIN,
    }, 'first-setup')
    const body = await json(response)

    expect(response.status, 'a first-time setup route regression would reject a user with no existing PIN').toBe(200)
    expect(body.user, 'a setup response regression would omit the newly configured user').toMatchObject({ id: VIMAL })

    const token = harness.sessionTokenFromResponse(response)
    expect(token, 'a session-token format regression would make the browser cookie unusable').toMatch(/^[A-Za-z0-9_-]{43}$/)

    const session = harness.inspectDbOne<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM sessions WHERE id = ?',
      [sha256(token)],
    )
    expect(session, 'an awaited session insert regression would return a cookie with no DB session').toMatchObject({ user_id: VIMAL })
    expect(session?.id, 'a DB session leak regression would store an unexpected identifier').toMatch(/^[0-9a-f]{64}$/)
    expect(session?.id, 'storing the bearer token instead of its SHA-256 hash would expose the cookie in SQLite').not.toBe(token)

    const persistedUser = harness.inspectDbOne<{ pin_hash: string | null }>(
      'SELECT pin_hash FROM users WHERE id = ?',
      [VIMAL],
    )
    const persistedHash = persistedUser?.pin_hash ?? ''
    expect(persistedUser?.pin_hash, 'a first-PIN persistence regression would leave users.pin_hash null').not.toBeNull()
    expect(persistedHash, 'a PIN-storage regression would persist the plaintext PIN instead of a password hash').not.toBe(VIMAL_PIN)
    expect(persistedHash, 'a bcrypt persistence regression would store a non-bcrypt PIN hash').toMatch(/^\$2[aby]\$\d{2}\$/)
    expect(await bcrypt.compare(VIMAL_PIN, persistedHash), 'a first-PIN hash regression would make the persisted hash unable to verify the configured PIN').toBe(true)

    const usersResponse = await harness.fetch('/api/auth/users', {
      headers: headers(harness.clientIp('first-setup-users')),
    })
    const usersBody = await json(usersResponse)
    const vimal = (usersBody.users as JsonObject[]).find((user) => user.id === VIMAL)
    expect(vimal?.hasPin, 'a setup write regression would leave the user-picker showing PIN setup as incomplete').toBe(true)
  })

  it('rejects a valid-shape login for a user without a PIN without creating a session', async () => {
    const beforeSessions = harness.inspectDbOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?',
      [PAVITHRA],
    )
    const response = await postJson('/api/auth/login', {
      userId: PAVITHRA,
      pin: PAVITHRA_PIN,
    }, 'no-pin-login')
    const body = await json(response)
    const afterSessions = harness.inspectDbOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?',
      [PAVITHRA],
    )
    const user = harness.inspectDbOne<{ pin_hash: string | null }>(
      'SELECT pin_hash FROM users WHERE id = ?',
      [PAVITHRA],
    )

    expect(response.status, 'a no-PIN login regression would accept a valid-shaped login before setup').toBe(400)
    expect(errorMessage(body), 'a no-PIN login regression would remove the user-facing PIN not set up message').toContain('PIN not set up')
    expect(response.headers.get('set-cookie') ?? '', 'a no-PIN login regression would issue a session cookie before a PIN exists').not.toMatch(/vs_session=/i)
    expect(afterSessions?.count, 'a no-PIN login regression would create a session row despite rejecting authentication').toBe(beforeSessions?.count)
    expect(user?.pin_hash, 'a no-PIN login regression would mutate users.pin_hash while merely attempting login').toBeNull()
  })

  it('lists both seeded users with hasPin while never exposing PIN hash fields', async () => {
    const setupPavithra = await postJson('/api/auth/setup-pin', {
      userId: PAVITHRA,
      pin: PAVITHRA_PIN,
    }, 'second-setup')
    expect(setupPavithra.status, 'a second first-time setup regression would prevent the seeded household user from signing in').toBe(200)

    const response = await harness.fetch('/api/auth/users', {
      headers: headers(harness.clientIp('user-listing')),
    })
    const body = await json(response)
    const users = body.users as JsonObject[]

    expect(response.status, 'a user-picker route regression would make login bootstrap fail').toBe(200)
    expect(users, 'a seed visibility regression would omit one of the two household users').toHaveLength(2)
    expect(users.map((user) => user.id), 'a user identity regression would change the seeded login choices').toEqual(expect.arrayContaining([VIMAL, PAVITHRA]))
    for (const user of users) {
      expect(user.hasPin, 'a hasPin mapping regression would misreport a configured PIN').toBe(true)
      expect(user, 'returning pinHash would expose a bcrypt credential through the public user-picker API').not.toHaveProperty('pinHash')
      expect(user, 'returning passwordHash would expose a credential under an alternate field name').not.toHaveProperty('passwordHash')
    }
    expect(JSON.stringify(users), 'a response-shape regression would leak a credential field into serialized login data').not.toMatch(/pinHash|passwordHash/)
  })

  it('rejects a wrong PIN, accepts the right PIN, and authenticates only with its cookie', async () => {
    const wrong = await postJson('/api/auth/login', {
      userId: VIMAL,
      pin: '9999',
    }, 'login-wrong')
    const wrongBody = await json(wrong)

    expect(wrong.status, 'a credential-verification regression would accept an incorrect PIN').toBe(401)
    expect(errorMessage(wrongBody), 'a login error-envelope regression would remove the client-facing data.message text').toBeTruthy()

    const right = await postJson('/api/auth/login', {
      userId: VIMAL,
      pin: VIMAL_PIN,
    }, 'login-right')
    const rightBody = await json(right)
    const cookie = harness.cookieFromResponse(right)
    const setCookie = right.headers.get('set-cookie') ?? ''

    expect(right.status, 'a valid-login regression would reject the configured PIN').toBe(200)
    expect(rightBody.user, 'a successful login regression would omit the authenticated user').toMatchObject({ id: VIMAL })
    expect(cookie, 'a successful login regression would fail to issue a session cookie').toMatch(/^vs_session=[A-Za-z0-9_-]{43}$/)
    expect(setCookie.toLowerCase(), 'a cookie-hardening regression would omit HttpOnly from the session cookie').toContain('httponly')
    expect(setCookie.toLowerCase(), 'an HTTP test request must not accidentally mark its cookie Secure').not.toContain('secure')
    expect(setCookie, 'a session cookie regression would omit SameSite=Lax and weaken cross-site request protection').toMatch(/(?:^|;\s*)SameSite=Lax(?:;|$)/i)
    expect(setCookie, 'a session cookie regression would omit the root Path and fail to send the cookie to auth routes').toMatch(/(?:^|;\s*)Path=\/(?:;|$)/i)
    expect(setCookie, 'a session cookie regression would change the documented 30-day Max-Age').toMatch(/(?:^|;\s*)Max-Age=2592000(?:;|$)/i)

    const me = await harness.fetch('/api/auth/me', {
      headers: headers(harness.clientIp('me-with-cookie'), cookie),
    })
    const meBody = await json(me)
    expect(me.status, 'a session lookup regression would fail the authenticated /me request').toBe(200)
    expect(meBody.user, 'a valid session regression would not resolve the logged-in user').toMatchObject({ id: VIMAL, hasPin: true })

    const anonymousMe = await harness.fetch('/api/auth/me', {
      headers: headers(harness.clientIp('me-without-cookie')),
    })
    const anonymousBody = await json(anonymousMe)
    expect(anonymousBody.user, 'an anonymous /me regression would incorrectly authenticate a request without a cookie').toBeNull()
  })

  it('rejects an expired real session on /me and a protected endpoint without creating another session', async () => {
    const login = await postJson('/api/auth/login', {
      userId: VIMAL,
      pin: VIMAL_PIN,
    }, 'expired-session-login')
    const cookie = harness.cookieFromResponse(login)
    const sessionId = sha256(harness.sessionTokenFromResponse(login))
    const beforeRequests = harness.inspectDbOne<{ count: number }>('SELECT COUNT(*) AS count FROM sessions')

    mutateTestDb(
      'UPDATE sessions SET expires_at = ? WHERE id = ?',
      ['1970-01-01T00:00:00.000Z', sessionId],
    )
    const expiredRow = harness.inspectDbOne<{ expires_at: string }>(
      'SELECT expires_at FROM sessions WHERE id = ?',
      [sessionId],
    )

    const me = await harness.fetch('/api/auth/me', {
      headers: headers(harness.clientIp('expired-session-me'), cookie),
    })
    const meBody = await json(me)
    const protectedResponse = await harness.fetch('/api/accounts', {
      headers: headers(harness.clientIp('expired-session-protected'), cookie),
    })
    const afterRequests = harness.inspectDbOne<{ count: number }>('SELECT COUNT(*) AS count FROM sessions')

    expect(expiredRow?.expires_at, 'the expired-session fixture mutation would fail to persist the past expiry').toBe('1970-01-01T00:00:00.000Z')
    expect(me.status, 'an expired-session regression would make /me fail instead of returning its anonymous response').toBe(200)
    expect(meBody.user, 'an expired-session regression would authenticate an expired cookie on /me').toBeNull()
    expect(protectedResponse.status, 'an expired-session regression would allow an expired cookie through the protected-route auth gate').toBe(401)
    expect(afterRequests?.count, 'an expired-session regression would create a replacement session while checking an expired cookie').toBe(beforeRequests?.count)
  })

  it('treats a legacy user-id cookie as anonymous instead of throwing', async () => {
    const response = await harness.fetch('/api/auth/me', {
      headers: headers(harness.clientIp('legacy-cookie'), 'vs_session=u_vimal'),
    })
    const body = await json(response)

    expect(response.status, 'a legacy-cookie discriminator regression would turn an old cookie into a server error').toBe(200)
    expect(body.user, 'a legacy-cookie compatibility regression would authenticate a raw user id without a session row').toBeNull()
  })

  it('logs out synchronously, revokes the session row, and tolerates no cookie', async () => {
    const login = await postJson('/api/auth/login', {
      userId: VIMAL,
      pin: VIMAL_PIN,
    }, 'logout-login')
    const cookie = harness.cookieFromResponse(login)
    const token = harness.sessionTokenFromResponse(login)
    const sessionId = sha256(token)

    const logout = await harness.fetch('/api/auth/logout', {
      method: 'POST',
      headers: headers(harness.clientIp('logout'), cookie),
    })
    const logoutBody = await json(logout)
    const clearCookie = logout.headers.get('set-cookie') ?? ''
    const session = harness.inspectDbOne<{ revoked_at: string | null }>(
      'SELECT revoked_at FROM sessions WHERE id = ?',
      [sessionId],
    )

    expect(logout.status, 'a logout route regression would fail to complete a valid logout').toBe(200)
    expect(logoutBody.ok, 'a logout response regression would omit the success envelope').toBe(true)
    expect(clearCookie, 'a logout cookie regression would leave the bearer cookie in the browser').toMatch(/vs_session=.*Max-Age=0/i)
    expect(session?.revoked_at, 'missing await on logout revocation would leave the session active after the response').not.toBeNull()

    const noLongerMe = await harness.fetch('/api/auth/me', {
      headers: headers(harness.clientIp('logout-after'), cookie),
    })
    const noLongerMeBody = await json(noLongerMe)
    expect(noLongerMeBody.user, 'a revoked session regression would continue authenticating after logout').toBeNull()

    const logoutWithoutCookie = await harness.fetch('/api/auth/logout', {
      method: 'POST',
      headers: headers(harness.clientIp('logout-no-cookie')),
    })
    expect(logoutWithoutCookie.status, 'logout should remain idempotent when no session cookie is supplied').toBe(200)
  })

  it('requires the current PIN and revokes only other sessions in the PIN-change flow', async () => {
    const oldLogin = await postJson('/api/auth/login', {
      userId: VIMAL,
      pin: VIMAL_PIN,
    }, 'pin-change-old')
    const oldCookie = harness.cookieFromResponse(oldLogin)
    const oldId = sha256(harness.sessionTokenFromResponse(oldLogin))

    const keepLogin = await postJson('/api/auth/login', {
      userId: VIMAL,
      pin: VIMAL_PIN,
    }, 'pin-change-keep')
    const keepCookie = harness.cookieFromResponse(keepLogin)
    const keepId = sha256(harness.sessionTokenFromResponse(keepLogin))

    const otherLogin = await postJson('/api/auth/login', {
      userId: PAVITHRA,
      pin: PAVITHRA_PIN,
    }, 'pin-change-other')
    const otherCookie = harness.cookieFromResponse(otherLogin)
    const otherId = sha256(harness.sessionTokenFromResponse(otherLogin))

    const missingCurrent = await postJson('/api/auth/setup-pin', {
      userId: VIMAL,
      pin: '4321',
    }, 'pin-change-missing', keepCookie)
    const missingBody = await json(missingCurrent)
    expect(missingCurrent.status, 'a PIN-rotation regression would allow changing an existing PIN without the current PIN').toBe(400)
    expect(errorMessage(missingBody), 'the missing-current-PIN error regression would remove structured client-facing text').toBeTruthy()

    const wrongCurrent = await postJson('/api/auth/setup-pin', {
      userId: VIMAL,
      pin: '4321',
      currentPin: '0000',
    }, 'pin-change-wrong', keepCookie)
    const wrongBody = await json(wrongCurrent)
    expect(wrongCurrent.status, 'a PIN-rotation credential regression would accept the wrong current PIN').toBe(401)
    expect(errorMessage(wrongBody), 'the wrong-current-PIN error regression would remove structured client-facing text').toBeTruthy()

    const changed = await postJson('/api/auth/setup-pin', {
      userId: VIMAL,
      pin: '4321',
      currentPin: VIMAL_PIN,
    }, 'pin-change-right', keepCookie)
    const changedBody = await json(changed)
    const newCookie = harness.cookieFromResponse(changed)
    const newId = sha256(harness.sessionTokenFromResponse(changed))

    expect(changed.status, 'a valid PIN-rotation regression would reject the correct current PIN').toBe(200)
    expect(changedBody.user, 'a PIN-rotation response regression would omit the updated user').toMatchObject({ id: VIMAL })
    expect(newCookie, 'a PIN-rotation regression would fail to issue the replacement session cookie').toMatch(/^vs_session=[A-Za-z0-9_-]{43}$/)
    expect(newId, 'a PIN-rotation session regression would hash the replacement token incorrectly').toMatch(/^[0-9a-f]{64}$/)

    const oldRow = harness.inspectDbOne<{ revoked_at: string | null }>('SELECT revoked_at FROM sessions WHERE id = ?', [oldId])
    const keepRow = harness.inspectDbOne<{ revoked_at: string | null }>('SELECT revoked_at FROM sessions WHERE id = ?', [keepId])
    const newRow = harness.inspectDbOne<{ id: string; user_id: string }>('SELECT id, user_id FROM sessions WHERE id = ?', [newId])
    const otherRow = harness.inspectDbOne<{ revoked_at: string | null }>('SELECT revoked_at FROM sessions WHERE id = ?', [otherId])

    expect(oldRow?.revoked_at, 'a revoke-all-other-sessions regression would leave the other Vimal device active').not.toBeNull()
    expect(keepRow?.revoked_at, 'a PIN-rotation ordering regression would revoke the request session before it can be kept').toBeNull()
    expect(newRow, 'a replacement session ordering regression would return before inserting the new session').toMatchObject({ id: newId, user_id: VIMAL })
    expect(otherRow?.revoked_at, 'a cross-user revocation regression would revoke Pavithra while changing Vimal PIN').toBeNull()

    const oldMe = await harness.fetch('/api/auth/me', { headers: headers(harness.clientIp('pin-change-old-me'), oldCookie) })
    const keepMe = await harness.fetch('/api/auth/me', { headers: headers(harness.clientIp('pin-change-keep-me'), keepCookie) })
    const newMe = await harness.fetch('/api/auth/me', { headers: headers(harness.clientIp('pin-change-new-me'), newCookie) })
    const otherMe = await harness.fetch('/api/auth/me', { headers: headers(harness.clientIp('pin-change-other-me'), otherCookie) })

    expect((await json(oldMe)).user, 'a revoked old session regression would still authenticate the old device').toBeNull()
    expect((await json(keepMe)).user, 'the session used to rotate a PIN must remain authenticated').toMatchObject({ id: VIMAL })
    expect((await json(newMe)).user, 'the newly issued session regression would not authenticate after PIN rotation').toMatchObject({ id: VIMAL })
    expect((await json(otherMe)).user, 'cross-user session isolation regression would log out the other household user').toMatchObject({ id: PAVITHRA })
  })

  it('returns 404 for a syntactically valid unknown user without mutating users or sessions', async () => {
    const beforeUsers = harness.inspectDbOne<{ count: number }>('SELECT COUNT(*) AS count FROM users')
    const beforeSessions = harness.inspectDbOne<{ count: number }>('SELECT COUNT(*) AS count FROM sessions')
    const beforeUnknownUser = harness.inspectDbOne<{ id: string }>('SELECT id FROM users WHERE id = ?', ['u_unknown'])
    const response = await postJson('/api/auth/setup-pin', {
      userId: 'u_unknown',
      pin: '1234',
    }, 'unknown-user')
    const body = await json(response)
    const afterUsers = harness.inspectDbOne<{ count: number }>('SELECT COUNT(*) AS count FROM users')
    const afterSessions = harness.inspectDbOne<{ count: number }>('SELECT COUNT(*) AS count FROM sessions')
    const afterUnknownUser = harness.inspectDbOne<{ id: string }>('SELECT id FROM users WHERE id = ?', ['u_unknown'])

    expect(response.status, 'a setup-pin not-found regression would turn a valid unknown-user request into success or an internal error').toBe(404)
    expect(errorMessage(body) ?? body.statusMessage, 'a setup-pin not-found regression would remove the human-readable User not found response').toContain('User not found')
    expect(response.headers.get('set-cookie') ?? '', 'a not-found setup regression would issue a session cookie for a user that does not exist').not.toMatch(/vs_session=/i)
    expect(afterUsers?.count, 'an unknown-user setup regression would mutate the users table').toBe(beforeUsers?.count)
    expect(afterSessions?.count, 'an unknown-user setup regression would create or revoke a session row').toBe(beforeSessions?.count)
    expect(beforeUnknownUser, 'the unknown-user fixture unexpectedly exists before the not-found request').toBeUndefined()
    expect(afterUnknownUser, 'an unknown-user setup regression would insert a user row').toBeUndefined()
  })

  it.each([
    ['empty body', {}, 'malformed-empty'],
    ['missing userId', { pin: '1234' }, 'malformed-user-id'],
    ['missing pin', { userId: VIMAL }, 'malformed-pin'],
    ['short PIN', { userId: VIMAL, pin: '12' }, 'malformed-short'],
    ['non-digit PIN', { userId: VIMAL, pin: 'abcdef' }, 'malformed-nondigit'],
  ])('returns a structured 400 for malformed %s rather than a 500', async (_scenario, body, label) => {
    const response = await postJson('/api/auth/setup-pin', body, label)
    const responseBody = await json(response)

    expect(response.status, `the ${label} validation regression would turn malformed setup input into a server failure or success`).toBe(400)
    expect(errorMessage(responseBody), `the ${label} error-envelope regression would remove data.message from the client contract`).toBeTruthy()
  })
})
