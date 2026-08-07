/**
 * Auth rate-limit HTTP contract.
 *
 * The production break these tests protect against is a middleware/handler
 * wiring regression that bypasses the real IP and account buckets. Every
 * request goes through the running Nuxt server with an explicit forwarded IP.
 * Real HTTP covers the short route boundaries; the 30/60/300-second ladder
 * and reset use the production helpers below with controlled Date.now because
 * real HTTP cannot advance those clocks within bounded CI time.
 */
import type { H3Event } from 'h3'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createNuxtTestHarness } from '~~/tests/helpers/nuxt-server'
import { checkLoginAllowed, recordLoginResult } from '~~/server/utils/rateLimit'

const harness = await createNuxtTestHarness()
const ORIGIN = 'http://localhost:3000'
const VIMAL = 'u_vimal'
const PAVITHRA = 'u_pavithra'
const VIMAL_PIN = '2468'
const PAVITHRA_PIN = '1357'

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

async function login(userId: string, pin: string, label: string): Promise<Response> {
  return postJson('/api/auth/login', { userId, pin }, label)
}

async function readJson(response: Response): Promise<JsonObject> {
  return await response.json() as JsonObject
}

function retryAfter(body: JsonObject): number | undefined {
  if (typeof body.data !== 'object' || body.data === null) return undefined
  const value = (body.data as JsonObject).retryAfter
  return typeof value === 'number' ? value : undefined
}

async function establishPins(): Promise<void> {
  const vimal = await postJson('/api/auth/setup-pin', { userId: VIMAL, pin: VIMAL_PIN }, 'rate-setup-vimal')
  const pavithra = await postJson('/api/auth/setup-pin', { userId: PAVITHRA, pin: PAVITHRA_PIN }, 'rate-setup-pavithra')
  expect(vimal.status, 'rate-limit tests require the real first-time setup route to establish Vimal\'s known PIN').toBe(200)
  expect(pavithra.status, 'rate-limit tests require the real first-time setup route to establish Pavithra\'s known PIN').toBe(200)
}

describe('auth rate limits over HTTP', () => {
  beforeAll(establishPins)

  it('allows exactly 20 login requests per minute from one IP and rejects the 21st', async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => login(VIMAL, VIMAL_PIN, 'throttle')),
    )
    const twentyStatuses = responses.map((response) => response.status)
    const twentyFirst = await login(VIMAL, VIMAL_PIN, 'throttle')
    const body = await readJson(twentyFirst)

    expect(twentyStatuses.every((status) => status === 200), 'a per-IP throttle off-by-one regression would reject one of the first 20 allowed requests').toBe(true)
    expect(twentyFirst.status, 'a per-IP throttle regression would allow the 21st login in the same minute').toBe(429)
    expect(retryAfter(body), 'a throttle error-envelope regression would omit nested data.retryAfter').toEqual(expect.any(Number))
  }, 30_000)

  it('returns five 401 failures, then blocks the sixth request from that IP', async () => {
    const attempts: Response[] = []
    for (let index = 0; index < 5; index++) {
      attempts.push(await login(PAVITHRA, '9999', 'ip-block'))
    }
    const beforeSessions = harness.inspectDbOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?',
      [PAVITHRA],
    )
    const correctAfterBlock = await login(PAVITHRA, PAVITHRA_PIN, 'ip-block')
    const correctBody = await readJson(correctAfterBlock)

    expect(attempts.every((response) => response.status === 401), 'a per-IP failure counter regression would change one of the first five wrong-PIN responses').toBe(true)
    expect(correctAfterBlock.status, 'a per-IP block regression would allow a correct PIN immediately after five failures').toBe(429)
    const retry = retryAfter(correctBody)
    expect(retry, 'a blocked correct-login response regression would omit nested data.retryAfter').toEqual(expect.any(Number))
    expect(retry, 'a blocked correct-login response regression would expose a non-positive retryAfter').toBeGreaterThan(0)
    expect(correctAfterBlock.headers.get('set-cookie') ?? '', 'a blocked correct-login regression would issue a session cookie despite skipping credential verification').not.toMatch(/vs_session=/i)
    const accountProbe = await login(PAVITHRA, PAVITHRA_PIN, 'ip-block-account-probe')
    const accountProbeBody = await readJson(accountProbe)
    expect(accountProbe.status, 'a blocked request regression would fail to preserve the account cooldown on a different IP').toBe(429)
    expect(accountProbeBody.message, 'a blocked request regression would record the sixth request as an additional account failure').toContain('(5)')
    const afterSessions = harness.inspectDbOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?',
      [PAVITHRA],
    )
    expect(afterSessions?.count, 'a blocked correct-login regression would create an unexpected session row').toBe(beforeSessions?.count)
  })

  it('observes the first account cooldown from a different IP after five failures', async () => {
    for (let index = 0; index < 5; index++) {
      const response = await login(VIMAL, '9999', `account-reset-failure-${index}`)
      expect(response.status, 'an account-failure accounting regression would not record each wrong PIN before cooldown').toBe(401)
    }

    const blocked = await login(VIMAL, VIMAL_PIN, 'account-reset-blocked')
    const blockedBody = await readJson(blocked)
    const blockedRetry = retryAfter(blockedBody)
    expect(blocked.status, 'the account cooldown regression would allow a different-IP request before its five-failure cooldown expires').toBe(429)
    expect(blockedRetry, 'the account cooldown regression would omit nested data.retryAfter').toEqual(expect.any(Number))
    expect(blockedRetry, 'the account cooldown regression would expose a non-positive retryAfter').toBeGreaterThan(0)
    expect(blockedRetry, 'the first account cooldown should be close to the documented 30 seconds').toBeGreaterThanOrEqual(29)
    expect(blockedRetry, 'the first account cooldown should not exceed the documented 30 seconds').toBeLessThanOrEqual(30)
  })
})

function fakeEvent(ip: string): H3Event {
  return {
    node: {
      req: {
        headers: { 'x-forwarded-for': ip },
        socket: { remoteAddress: '127.0.0.1' },
      },
    },
  } as unknown as H3Event
}

async function withControlledNow(
  start: number,
  callback: (setNow: (value: number) => void) => Promise<void>,
): Promise<void> {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(start)
  try {
    await callback((value) => clock.mockReturnValue(value))
  } finally {
    clock.mockRestore()
  }
}

function recordAllowedFailure(accountKey: string, ip: string, message: string): void {
  const event = fakeEvent(ip)
  const result = checkLoginAllowed(event, accountKey)
  expect(result.ok, message).toBe(true)
  recordLoginResult(event, accountKey, false)
}

describe('production account cooldown helpers with controlled time', () => {
  it('returns exactly 30, 60, and 300 seconds at the 5, 10, and 15 failure rungs', async () => {
    await withControlledNow(1_700_000_000_000, async (setNow) => {
      const account = 'pure-ladder-account'
      let now = 1_700_000_000_000
      const failFive = (rung: string) => {
        for (let index = 0; index < 5; index++) {
          recordAllowedFailure(account, `198.51.${rung}.${index}`, `the ${rung}-failure helper gate must allow the next recorded failure`)
        }
      }

      failFive('10')
      expect(checkLoginAllowed(fakeEvent('203.0.113.10'), account), 'the production helper must set a 30-second cooldown at five failures').toMatchObject({ ok: false, retryAfter: 30 })

      now += 30_000
      setNow(now)
      failFive('11')
      expect(checkLoginAllowed(fakeEvent('203.0.113.11'), account), 'the production helper must set a 60-second cooldown at ten failures').toMatchObject({ ok: false, retryAfter: 60 })

      now += 60_000
      setNow(now)
      failFive('12')
      expect(checkLoginAllowed(fakeEvent('203.0.113.12'), account), 'the production helper must set a 300-second cooldown at fifteen failures').toMatchObject({ ok: false, retryAfter: 300 })
    })
  })

  it('resets the consecutive-failure ladder after a successful login', async () => {
    await withControlledNow(1_800_000_000_000, async (setNow) => {
      const account = 'pure-reset-account'
      let now = 1_800_000_000_000
      for (let index = 0; index < 5; index++) {
        recordAllowedFailure(account, `198.52.0.${index}`, 'the reset helper setup must record five failures before the cooldown')
      }

      now += 30_000
      setNow(now)
      const successfulEvent = fakeEvent('203.0.114.1')
      expect(checkLoginAllowed(successfulEvent, account).ok, 'the production helper must allow the successful login once the first cooldown expires').toBe(true)
      recordLoginResult(successfulEvent, account, true)

      for (let index = 0; index < 5; index++) {
        recordAllowedFailure(account, `198.53.0.${index}`, 'the reset helper must allow five fresh failures after success')
      }
      expect(checkLoginAllowed(fakeEvent('203.0.114.2'), account), 'a successful login must reset the account counter so the next rung is 30 seconds, not 60').toMatchObject({ ok: false, retryAfter: 30 })
    })
  })
})
