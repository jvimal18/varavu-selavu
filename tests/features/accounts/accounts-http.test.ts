/**
 * Accounts HTTP contract.
 *
 * The production break these tests protect against is a route, validation,
 * archive-filter, or soft-delete regression in the `/api/accounts` handlers
 * that a pure-function test would not catch. Every request goes through the
 * real Nuxt server with a real session cookie, Origin header, and client IP;
 * every persistence claim is verified against the actual file-backed DB.
 *
 * Accounts are household-shared: there is no per-user column. Any
 * authenticated user reads and mutates the same ledger by design, so the
 * authorisation contract here is (a) unauthenticated → 401 and (b) both
 * seeded users share one mutable list — never per-user isolation.
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
type JsonArray = JsonObject[]

const ACCOUNT_TYPES = [
  'bank',
  'cash',
  'digital_wallet',
  'credit_card',
  'mutual_fund',
  'fixed_deposit',
  'recurring_deposit',
  'other',
] as const

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

function patchJson(path: string, body: JsonObject, label: string, cookie = ''): Promise<Response> {
  return harness.fetch(path, {
    method: 'PATCH',
    headers: {
      ...headers(harness.clientIp(label), cookie),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function deleteReq(path: string, label: string, cookie = ''): Promise<Response> {
  return harness.fetch(path, { method: 'DELETE', headers: headers(harness.clientIp(label), cookie) })
}

async function readJson(response: Response): Promise<JsonObject> {
  try {
    return await response.json() as JsonObject
  } catch {
    return {}
  }
}

/** Extract the user-facing message regardless of whether the error carried `message` or only `statusMessage`. */
function errorMessage(body: JsonObject): string | undefined {
  if (typeof body.message === 'string') return body.message
  if (typeof body.statusMessage === 'string') return body.statusMessage
  if (typeof body.data === 'object' && body.data !== null) {
    const nested = (body.data as JsonObject).message
    if (typeof nested === 'string') return nested
  }
  return undefined
}

interface AccountRow {
  id: string
  name: string
  type: string
  institution: string | null
  last4: string | null
  opening_balance: number
  credit_limit: number | null
  statement_day: number | null
  due_day: number | null
  currency: string
  color: string | null
  icon: string | null
  archived: number
  created_at: string
  updated_at: string
}

let vimalCookie = ''
let pavithraCookie = ''

async function createAccount(body: JsonObject, label: string, cookie: string): Promise<{ id: string; body: JsonObject }> {
  const response = await postJson('/api/accounts', body, label, cookie)
  const responseBody = await readJson(response)
  expect(response.status, `${label}: account creation regression would reject a valid account body`).toBe(200)
  const account = responseBody.account as JsonObject
  expect(account.id, `${label}: account creation regression would omit the new account id`).toMatch(/^acc_[0-9a-f]{20}$/)
  return { id: String(account.id), body: responseBody }
}

async function createExpenseTransaction(accountId: string, amount: number, label: string, cookie: string): Promise<string> {
  const response = await postJson(
    '/api/transactions',
    { type: 'expense', amount, date: '2026-08-10', accountId, categoryId: 'c_groceries' },
    label,
    cookie,
  )
  const responseBody = await readJson(response)
  expect(response.status, `${label}: expense creation regression would reject a valid transaction`).toBe(200)
  return String((responseBody.transaction as JsonObject).id)
}

describe('accounts HTTP contract', () => {
  beforeAll(async () => {
    const vimalSetup = await postJson('/api/auth/setup-pin', { userId: VIMAL, pin: VIMAL_PIN }, 'accounts-setup-vimal')
    const pavithraSetup = await postJson('/api/auth/setup-pin', { userId: PAVITHRA, pin: PAVITHRA_PIN }, 'accounts-setup-pavithra')
    expect(vimalSetup.status, 'accounts tests require the real first-time setup route to establish Vimal\'s PIN').toBe(200)
    expect(pavithraSetup.status, 'accounts tests require the real first-time setup route to establish Pavithra\'s PIN').toBe(200)
    vimalCookie = harness.cookieFromResponse(vimalSetup)
    pavithraCookie = harness.cookieFromResponse(pavithraSetup)
  })

  it('creates one account of each of the 8 types and persists the exact paise row', async () => {
    const expectations: Array<{ type: (typeof ACCOUNT_TYPES)[number]; openingBalance: number; extra?: JsonObject }> = [
      { type: 'bank', openingBalance: 1_00_000 },
      { type: 'cash', openingBalance: 5_000 },
      { type: 'digital_wallet', openingBalance: 12_345 },
      { type: 'credit_card', openingBalance: 0, extra: { creditLimit: 5_00_000, statementDay: 15, dueDay: 5 } },
      { type: 'mutual_fund', openingBalance: 25_000 },
      { type: 'fixed_deposit', openingBalance: 3_00_000 },
      { type: 'recurring_deposit', openingBalance: 45_678 },
      { type: 'other', openingBalance: 9_876 },
    ]

    for (const expectation of expectations) {
      const body: JsonObject = {
        name: `Test ${expectation.type}`,
        type: expectation.type,
        openingBalance: expectation.openingBalance,
        ...(expectation.extra ?? {}),
      }
      const { id } = await createAccount(body, `create-${expectation.type}`, vimalCookie)

      // There is no single-account detail route; verify persistence directly
      // against the DB row.
      const persisted = harness.inspectDbOne<AccountRow>('SELECT * FROM accounts WHERE id = ?', [id])
      expect(persisted, `a ${expectation.type} insert regression would leave no row in accounts`).toBeDefined()
      expect(persisted?.name, `a ${expectation.type} insert regression would store the wrong name`).toBe(`Test ${expectation.type}`)
      expect(persisted?.type, `a ${expectation.type} insert regression would store the wrong type`).toBe(expectation.type)
      expect(persisted?.opening_balance, `a ${expectation.type} insert regression would lose integer paise precision`).toBe(expectation.openingBalance)
      expect(persisted?.archived, `a ${expectation.type} insert regression would mark a new account archived`).toBe(0)
      expect(persisted?.currency, `a ${expectation.type} insert regression would store a non-INR currency`).toBe('INR')

      if (expectation.type === 'credit_card') {
        expect(persisted?.credit_limit, 'a credit_card insert regression would drop the credit limit').toBe(5_00_000)
        expect(persisted?.statement_day, 'a credit_card insert regression would drop the statement day').toBe(15)
        expect(persisted?.due_day, 'a credit_card insert regression would drop the due day').toBe(5)
      } else {
        expect(persisted?.credit_limit, `a ${expectation.type} insert regression would set a credit limit for a non-credit-card`).toBeNull()
      }
      // The response row mirrors the DB row (camelCase).
      expect((await readJson(await get('/api/accounts', `list-check-${expectation.type}`, vimalCookie))).accounts,
        `a ${expectation.type} insert regression would hide the new account from the list`).toContainEqual(expect.objectContaining({ id, type: expectation.type, archived: false }))
    }
  })

  it('rejects a credit_card account without a creditLimit with the documented message', async () => {
    const response = await postJson(
      '/api/accounts',
      { name: 'No-limit card', type: 'credit_card', openingBalance: 0 },
      'credit-card-no-limit',
      vimalCookie,
    )
    const body = await readJson(response)

    expect(response.status, 'a credit-card validation regression would accept a credit card with no limit').toBe(400)
    expect(errorMessage(body), 'a credit-card validation regression would remove the documented message').toContain('Credit limit required for credit card')
    expect(harness.inspectDbOne('SELECT COUNT(*) AS count FROM accounts WHERE name = ?', ['No-limit card'])?.count,
      'a credit-card validation regression would insert the invalid account').toBe(0)
  })

  it.each([
    ['missing name', { type: 'bank', openingBalance: 0 }, 'invalid-missing-name'],
    ['invalid type enum', { name: 'Bad type', type: 'loan', openingBalance: 0 }, 'invalid-type-enum'],
    ['negative openingBalance', { name: 'Negative', type: 'bank', openingBalance: -100 }, 'invalid-negative-balance'],
  ])('returns a structured 400 for %s instead of inserting', async (_scenario, body, label) => {
    const response = await postJson('/api/accounts', body as JsonObject, label, vimalCookie)
    const responseBody = await readJson(response)

    expect(response.status, `${label}: a strict-body validation regression would accept the malformed account`).toBe(400)
    expect(errorMessage(responseBody), `${label}: a strict-body validation regression would remove the Invalid account data message`).toContain('Invalid account data')
  })

  it('lists accounts in createdAt DESC order and filters archived rows out client-side-excluded', async () => {
    const createdIds: string[] = []
    for (const name of ['List first', 'List second', 'List third']) {
      const { id } = await createAccount({ name, type: 'bank', openingBalance: 1_000 }, `list-create-${name}`, vimalCookie)
      createdIds.push(id)
    }

    const response = await get('/api/accounts', 'list-endpoint', vimalCookie)
    const body = await readJson(response)
    const accounts = body.accounts as JsonArray

    expect(response.status, 'a list route regression would fail a valid authenticated GET').toBe(200)
    const dbCount = harness.inspectDbOne<{ count: number }>('SELECT COUNT(*) AS count FROM accounts WHERE archived = 0')?.count ?? -1
    expect(accounts.length, 'a list regression would return a different non-archived account count than the DB').toBe(dbCount)

    for (const id of createdIds) {
      expect(accounts.map((account) => account.id),
        `a list regression would omit the just-created account ${id}`).toContain(id)
    }
    for (let index = 1; index < accounts.length; index++) {
      const previous = accounts[index - 1].createdAt as string
      const current = accounts[index].createdAt as string
      expect(previous >= current,
        'a list regression would break the createdAt DESC ordering contract').toBe(true)
    }
    expect(accounts.every((account) => account.archived === false),
      'a list regression would leak an archived account into the shared list').toBe(true)
  })

  it('patches each mutable field individually and persists every change', async () => {
    const { id } = await createAccount({ name: 'Patch base', type: 'bank', openingBalance: 1_000 }, 'patch-base-create', vimalCookie)

    const patches: Array<{ field: string; column: string; value: unknown }> = [
      { field: 'name', column: 'name', value: 'Renamed bank' },
      { field: 'institution', column: 'institution', value: 'HDFC Bank' },
      { field: 'last4', column: 'last4', value: '9876' },
      { field: 'openingBalance', column: 'opening_balance', value: 654321 },
      { field: 'creditLimit', column: 'credit_limit', value: 999999 },
      { field: 'statementDay', column: 'statement_day', value: 7 },
      { field: 'dueDay', column: 'due_day', value: 21 },
      { field: 'color', column: 'color', value: '#FF0000' },
      { field: 'icon', column: 'icon', value: 'banknote' },
    ]

    for (const patch of patches) {
      const response = await patchJson(`/api/accounts/${id}`, { [patch.field]: patch.value }, `patch-${patch.field}`, vimalCookie)
      const body = await readJson(response)
      const account = body.account as JsonObject

      expect(response.status, `patching ${patch.field} regression would reject a valid single-field patch`).toBe(200)
      expect(account[patch.field], `a ${patch.field} patch regression would return the stale value`).toBe(patch.value)
      const persisted = harness.inspectDbOne<Record<string, unknown>>(
        `SELECT ${patch.column} AS value FROM accounts WHERE id = ?`,
        [id],
      )
      expect(persisted?.value, `a ${patch.field} patch regression would not persist the new value`).toBe(patch.value)
    }
  })

  it('soft-deletes via archived:true, hides the account from the list, and keeps its transactions reachable', async () => {
    const { id } = await createAccount({ name: 'To archive', type: 'bank', openingBalance: 5_000 }, 'archive-create', vimalCookie)
    const transactionId = await createExpenseTransaction(id, 2500, 'archive-txn', vimalCookie)

    const response = await patchJson(`/api/accounts/${id}`, { archived: true }, 'archive-patch', vimalCookie)
    const body = await readJson(response)
    expect(response.status, 'an archive-patch regression would reject archived:true').toBe(200)
    expect((body.account as JsonObject).archived, 'an archive-patch regression would return archived:false').toBe(true)

    const list = (await readJson(await get('/api/accounts', 'archive-list', vimalCookie))).accounts as JsonArray
    expect(list.map((account) => account.id),
      'an archive regression would keep the archived account in the shared list').not.toContain(id)

    const transactionsResponse = await get(`/api/accounts/${id}/transactions`, 'archive-transactions', vimalCookie)
    const transactionsBody = await readJson(transactionsResponse)
    expect(transactionsResponse.status, 'an archive regression would break the per-account transactions endpoint').toBe(200)
    expect((transactionsBody.transactions as JsonArray).map((transaction) => transaction.id),
      'an archive regression would lose transaction history for the archived account').toContain(transactionId)
  })

  it('un-archives via archived:false and the account reappears in the list', async () => {
    const { id } = await createAccount({ name: 'To unarchive', type: 'bank', openingBalance: 1_000 }, 'unarchive-create', vimalCookie)

    await patchJson(`/api/accounts/${id}`, { archived: true }, 'unarchive-archive', vimalCookie)
    const before = (await readJson(await get('/api/accounts', 'unarchive-before', vimalCookie))).accounts as JsonArray
    expect(before.map((account) => account.id),
      'an unarchive precondition regression would keep the account listed before unarchiving').not.toContain(id)

    const response = await patchJson(`/api/accounts/${id}`, { archived: false }, 'unarchive-patch', vimalCookie)
    const body = await readJson(response)
    expect(response.status, 'an un-archive patch regression would reject archived:false').toBe(200)
    expect((body.account as JsonObject).archived, 'an un-archive patch regression would return archived:true').toBe(false)

    const after = (await readJson(await get('/api/accounts', 'unarchive-after', vimalCookie))).accounts as JsonArray
    expect(after.map((account) => account.id),
      'an un-archive regression would keep the restored account hidden').toContain(id)
  })

  it('soft-deletes via DELETE, preserves transaction history, and excludes it from the list', async () => {
    const { id } = await createAccount({ name: 'Delete me', type: 'bank', openingBalance: 7_000 }, 'delete-create', vimalCookie)
    const transactionId = await createExpenseTransaction(id, 3500, 'delete-txn', vimalCookie)

    const response = await deleteReq(`/api/accounts/${id}`, 'delete-account', vimalCookie)
    const body = await readJson(response)
    expect(response.status, 'a DELETE regression would reject a valid soft-delete').toBe(200)
    expect(body.ok, 'a DELETE regression would omit the success envelope').toBe(true)

    const persisted = harness.inspectDbOne<AccountRow>('SELECT archived FROM accounts WHERE id = ?', [id])
    expect(persisted?.archived, 'a DELETE regression would hard-delete instead of soft-deleting').toBe(1)

    const list = (await readJson(await get('/api/accounts', 'delete-list', vimalCookie))).accounts as JsonArray
    expect(list.map((account) => account.id),
      'a DELETE regression would leave the deleted account in the list').not.toContain(id)

    const transactionsResponse = await get(`/api/accounts/${id}/transactions`, 'delete-transactions', vimalCookie)
    const transactionsBody = await readJson(transactionsResponse)
    expect(transactionsResponse.status, 'a DELETE regression would hide the soft-deleted account from its own detail route').toBe(200)
    expect((transactionsBody.transactions as JsonArray).map((transaction) => transaction.id),
      'a DELETE regression would destroy transaction history').toContain(transactionId)
  })

  it('returns 404 for unknown ids and 400 for a missing id on PATCH and DELETE', async () => {
    const patchUnknown = await patchJson('/api/accounts/acc_nope', { name: 'X' }, 'unknown-patch', vimalCookie)
    expect(patchUnknown.status, 'an unknown-id PATCH regression would not return 404').toBe(404)
    expect(errorMessage(await readJson(patchUnknown)), 'an unknown-id PATCH regression would drop the documented message').toContain('Account not found')

    const deleteUnknown = await deleteReq('/api/accounts/acc_nope', 'unknown-delete', vimalCookie)
    expect(deleteUnknown.status, 'an unknown-id DELETE regression would not return 404').toBe(404)
    expect(errorMessage(await readJson(deleteUnknown)), 'an unknown-id DELETE regression would drop the documented message').toContain('Account not found')

    // A doubled slash reaches the `[id]` route with an empty id parameter.
    const patchMissing = await patchJson('/api/accounts//', { name: 'X' }, 'missing-patch', vimalCookie)
    expect(patchMissing.status, 'a missing-id PATCH regression would not return 400').toBe(400)
    expect(errorMessage(await readJson(patchMissing)), 'a missing-id PATCH regression would drop the documented message').toContain('Account id required')

    const deleteMissing = await deleteReq('/api/accounts//', 'missing-delete', vimalCookie)
    expect(deleteMissing.status, 'a missing-id DELETE regression would not return 400').toBe(400)
    expect(errorMessage(await readJson(deleteMissing)), 'a missing-id DELETE regression would drop the documented message').toContain('Account id required')
  })

  it('returns 404 for the per-account transactions endpoint of a non-existent account', async () => {
    const response = await get('/api/accounts/acc_nope/transactions', 'unknown-account-transactions', vimalCookie)
    const body = await readJson(response)

    expect(response.status, 'an unknown-account transactions regression would not return 404').toBe(404)
    expect(errorMessage(body), 'an unknown-account transactions regression would drop the documented message').toContain('Account not found')
  })

  it('enforces auth and treats accounts as one shared household ledger', async () => {
    const anonymous = await get('/api/accounts', 'accounts-anonymous')
    expect(anonymous.status, 'an auth-gate regression would let an unauthenticated request list accounts').toBe(401)

    const vimalListBefore = (await readJson(await get('/api/accounts', 'shared-vimal-before', vimalCookie))).accounts as JsonArray
    const { id } = await createAccount({ name: 'Household shared', type: 'bank', openingBalance: 2_000 }, 'shared-create', vimalCookie)

    const pavithraList = (await readJson(await get('/api/accounts', 'shared-pavithra', pavithraCookie))).accounts as JsonArray
    expect(pavithraList.map((account) => account.id),
      'a household-sharing regression would hide Vimal\'s account from Pavithra').toContain(id)

    const renameResponse = await patchJson(`/api/accounts/${id}`, { name: 'Household renamed' }, 'shared-rename', pavithraCookie)
    expect(renameResponse.status, 'a household-sharing regression would block Pavithra from mutating the shared account').toBe(200)

    const vimalListAfter = (await readJson(await get('/api/accounts', 'shared-vimal-after', vimalCookie))).accounts as JsonArray
    expect(vimalListAfter.find((account) => account.id === id)?.name,
      'a household-sharing regression would not propagate Pavithra\'s rename to Vimal').toBe('Household renamed')
    expect(vimalListAfter.length, 'a household-sharing regression would leak per-user account rows (Vimal sees exactly one more after Pavithra creates one)').toBe(vimalListBefore.length + 1)
  })

  it('persists exact integer paise through create and per-account transaction read-back', async () => {
    const openingPaise = 123456
    const { id } = await createAccount({ name: 'Paise precision', type: 'bank', openingBalance: openingPaise }, 'paise-create', vimalCookie)
    const transactionId = await createExpenseTransaction(id, 45678, 'paise-txn', vimalCookie)

    const response = await get(`/api/accounts/${id}/transactions`, 'paise-readback', vimalCookie)
    const body = await readJson(response)
    const account = body.account as JsonObject
    const transactions = body.transactions as JsonArray

    expect(response.status, 'a paise read-back regression would fail the per-account transactions route').toBe(200)
    expect(account.openingBalance, 'a paise regression would truncate opening balance to whole rupees').toBe(openingPaise)
    const persistedTxn = transactions.find((transaction) => transaction.id === transactionId)
    expect(persistedTxn?.amount, 'a paise regression would lose the fractional-paise transaction amount').toBe(45678)

    const persistedAccount = harness.inspectDbOne<AccountRow>('SELECT opening_balance FROM accounts WHERE id = ?', [id])
    expect(persistedAccount?.opening_balance, 'a paise regression would store a rounded opening balance').toBe(openingPaise)
    const persistedTransaction = harness.inspectDbOne<{ amount: number }>('SELECT amount FROM transactions WHERE id = ?', [transactionId])
    expect(persistedTransaction?.amount, 'a paise regression would store a rounded transaction amount').toBe(45678)
  })
})
