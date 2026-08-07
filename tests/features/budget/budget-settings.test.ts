/**
 * Per-user budget + primary-account settings contract.
 *
 * The production break these tests protect against is a scoping, upsert, or
 * validation regression in `server/api/user-settings.{get,put}.ts` that a
 * pure-function test would not catch. `user_settings` is keyed by `user_id`:
 * user A's budget must never overwrite user B's. Every request goes through
 * the real Nuxt server with a real session cookie, Origin header, and client
 * IP, and every persistence claim is verified against the file-backed DB.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { createNuxtTestHarness } from '~~/tests/helpers/nuxt-server'

const harness = await createNuxtTestHarness()
const ORIGIN = 'http://localhost:3000'
const VIMAL = 'u_vimal'
const PAVITHRA = 'u_pavithra'
const VIMAL_PIN = '1234'
const PAVITHRA_PIN = '5678'

type JsonObject = Record<string, unknown>

let vimalCookie = ''
let pavithraCookie = ''
let accountId = ''

function headers(ip: string, cookie = ''): HeadersInit {
  return {
    Cookie: cookie,
    Origin: ORIGIN,
    'x-forwarded-for': ip,
  }
}

function get(path: string, label: string, cookie = ''): Promise<Response> {
  return harness.fetch(path, { headers: headers(harness.clientIp(label), cookie) })
}

function postJson(path: string, body: JsonObject, label: string, cookie = ''): Promise<Response> {
  return harness.fetch(path, {
    method: 'POST',
    headers: {
      ...headers(harness.clientIp(label), cookie),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function putJson(path: string, body: JsonObject, label: string, cookie = ''): Promise<Response> {
  return harness.fetch(path, {
    method: 'PUT',
    headers: {
      ...headers(harness.clientIp(label), cookie),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

async function readJson(response: Response): Promise<JsonObject> {
  try {
    return await response.json() as JsonObject
  } catch {
    return {}
  }
}

/** Extract the user-facing message regardless of the error envelope shape. */
function errorMessage(body: JsonObject): string | undefined {
  if (typeof body.message === 'string') return body.message
  if (typeof body.statusMessage === 'string') return body.statusMessage
  if (typeof body.data === 'object' && body.data !== null) {
    const nested = (body.data as JsonObject).message
    if (typeof nested === 'string') return nested
  }
  return undefined
}

/** Authenticated GET of the user settings envelope (assumes 200). */
async function getSettings(label: string, cookie: string): Promise<JsonObject> {
  const response = await get('/api/user-settings', label, cookie)
  expect(response.status, `${label}: a user-settings route regression would fail a valid authenticated GET`).toBe(200)
  return readJson(response)
}

beforeAll(async () => {
  const vimalSetup = await postJson('/api/auth/setup-pin', { userId: VIMAL, pin: VIMAL_PIN }, 'settings-setup-vimal')
  const pavithraSetup = await postJson('/api/auth/setup-pin', { userId: PAVITHRA, pin: PAVITHRA_PIN }, 'settings-setup-pavithra')
  expect(vimalSetup.status, 'settings tests require the real first-time setup route for Vimal').toBe(200)
  expect(pavithraSetup.status, 'settings tests require the real first-time setup route for Pavithra').toBe(200)
  vimalCookie = harness.cookieFromResponse(vimalSetup)
  pavithraCookie = harness.cookieFromResponse(pavithraSetup)

  // Accounts are household-shared, so one account serves both users' PUTs.
  const accountResponse = await postJson('/api/accounts', { name: 'Settings Account', type: 'bank', openingBalance: 50000 }, 'settings-account', vimalCookie)
  const accountBody = await readJson(accountResponse)
  expect(accountResponse.status, 'settings tests require the real account-create route').toBe(200)
  accountId = String((accountBody.account as JsonObject).id)
})

describe('budget and primary-account settings', () => {
  it('rejects an unauthenticated GET with 401', async () => {
    const response = await get('/api/user-settings', 'settings-anonymous')
    const body = await readJson(response)

    expect(response.status, 'an auth-gate regression would let an unauthenticated request read user settings').toBe(401)
    expect(errorMessage(body), 'an auth-gate regression would drop the Not authenticated message').toContain('Not authenticated')
  })

  it('returns nulls for primaryAccountId and monthlyBudgetPaise before any settings row exists', async () => {
    const settings = await getSettings('settings-initial-nulls', vimalCookie)

    expect(settings.primaryAccountId,
      'an empty-settings regression would return a non-null primaryAccountId before a row exists').toBeNull()
    expect(settings.monthlyBudgetPaise,
      'an empty-settings regression would return a non-null budget before a row exists').toBeNull()
  })

  it('persists a PUT and a subsequent null clear returns the field to null', async () => {
    const put = await putJson('/api/user-settings', { primaryAccountId: accountId, monthlyBudgetPaise: 123456 }, 'settings-put', vimalCookie)
    const putBody = await readJson(put)
    expect(put.status, 'a user-settings regression would reject a valid PUT').toBe(200)
    expect(putBody.primaryAccountId, 'a PUT regression would not echo the persisted primaryAccountId').toBe(accountId)
    expect(putBody.monthlyBudgetPaise, 'a PUT regression would not echo the persisted budget').toBe(123456)

    const afterPut = await getSettings('settings-after-put', vimalCookie)
    expect(afterPut.primaryAccountId, 'a GET regression would not return the persisted primaryAccountId').toBe(accountId)
    expect(afterPut.monthlyBudgetPaise, 'a GET regression would not return the persisted budget').toBe(123456)

    const clear = await putJson('/api/user-settings', { monthlyBudgetPaise: null }, 'settings-clear-budget', vimalCookie)
    expect(clear.status, 'a user-settings regression would reject a null clear').toBe(200)
    const afterClear = await getSettings('settings-after-clear', vimalCookie)
    expect(afterClear.monthlyBudgetPaise, 'a null-clear regression would not reset the budget to null').toBeNull()
    expect(afterClear.primaryAccountId,
      'a partial-update regression would clobber an untouched field on a null clear').toBe(accountId)
  })

  it('rejects a primaryAccountId that references an unknown account with 400', async () => {
    const response = await putJson('/api/user-settings', { primaryAccountId: 'acc_does_not_exist' }, 'settings-unknown-account', vimalCookie)
    const body = await readJson(response)

    expect(response.status, 'an unknown-primary-account regression would not return 400').toBe(400)
    expect(errorMessage(body), 'an unknown-primary-account regression would drop the Account not found message').toContain('Account not found')
  })

  it('keeps each user budget isolated from the other user', async () => {
    const vimalPut = await putJson('/api/user-settings', { monthlyBudgetPaise: 100000 }, 'settings-isolation-vimal', vimalCookie)
    const pavithraPut = await putJson('/api/user-settings', { monthlyBudgetPaise: 200000 }, 'settings-isolation-pavithra', pavithraCookie)
    expect(vimalPut.status, 'a scoping regression would reject Vimal\'s budget write').toBe(200)
    expect(pavithraPut.status, 'a scoping regression would reject Pavithra\'s budget write').toBe(200)

    const vimalSettings = await getSettings('settings-isolation-vimal-get', vimalCookie)
    const pavithraSettings = await getSettings('settings-isolation-pavithra-get', pavithraCookie)
    expect(vimalSettings.monthlyBudgetPaise, 'a scoping regression would return Pavithra\'s budget to Vimal').toBe(100000)
    expect(pavithraSettings.monthlyBudgetPaise, 'a scoping regression would return Vimal\'s budget to Pavithra').toBe(200000)

    // Re-writing Vimal must not overwrite Pavithra's row.
    await putJson('/api/user-settings', { monthlyBudgetPaise: 150000 }, 'settings-isolation-vimal-rewrite', vimalCookie)
    const pavithraAfter = await getSettings('settings-isolation-pavithra-after', pavithraCookie)
    expect(pavithraAfter.monthlyBudgetPaise,
      'a per-user-scoping regression would let Vimal overwrite Pavithra\'s budget').toBe(200000)

    const rows = harness.inspectDb<{ user_id: string; monthly_budget_paise: number }>(
      'SELECT user_id, monthly_budget_paise FROM user_settings',
    )
    expect(rows.length, 'a user-settings upsert regression would create more than one row per user').toBe(2)
    expect(rows.map((row) => row.user_id),
      'a user-settings upsert regression would not create a row per user').toEqual(expect.arrayContaining([VIMAL, PAVITHRA]))
    expect(rows.find((row) => row.user_id === VIMAL)?.monthly_budget_paise,
      'a user-settings upsert regression would persist the wrong budget for Vimal').toBe(150000)
    expect(rows.find((row) => row.user_id === PAVITHRA)?.monthly_budget_paise,
      'a user-settings upsert regression would persist the wrong budget for Pavithra').toBe(200000)
  })

  it('rejects a negative monthlyBudgetPaise with 400', async () => {
    const response = await putJson('/api/user-settings', { monthlyBudgetPaise: -100 }, 'settings-negative-budget', vimalCookie)
    const body = await readJson(response)

    expect(response.status, 'a body-validation regression would accept a negative budget').toBe(400)
    expect(errorMessage(body), 'a body-validation regression would drop the Invalid user settings message').toContain('Invalid user settings')
  })
})
