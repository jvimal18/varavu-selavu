/**
 * Transactions HTTP contract.
 *
 * The production break these tests protect against is a route, Zod
 * validation, type-compat invariant, FK-404, or hard-delete regression in
 * the `/api/transactions` handlers that a pure-function test would not
 * catch. Every request goes through the real Nuxt server with a real
 * session cookie, Origin header, and client IP; every persistence and
 * filter claim is verified against the actual file-backed DB.
 *
 * Transactions are household-shared: there is no per-user column, so the
 * authorisation contract is (a) unauthenticated → 401 and (b) both seeded
 * users share one mutable ledger — never per-user isolation.
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

let vimalCookie = ''

async function createAccount(body: JsonObject, label: string, cookie: string): Promise<string> {
  const response = await postJson('/api/accounts', body, label, cookie)
  const responseBody = await readJson(response)
  expect(response.status, `${label}: account creation regression would reject a valid account body`).toBe(200)
  return String((responseBody.account as JsonObject).id)
}

async function createTxn(body: JsonObject, label: string, cookie: string): Promise<{ id: string; body: JsonObject }> {
  const response = await postJson('/api/transactions', body, label, cookie)
  const responseBody = await readJson(response)
  expect(response.status, `${label}: transaction creation regression would reject a valid body`).toBe(200)
  const transaction = responseBody.transaction as JsonObject
  expect(transaction.id, `${label}: transaction creation regression would omit the new id`).toMatch(/^txn_[0-9a-f]{20}$/)
  return { id: String(transaction.id), body: responseBody }
}

/** Lazily-created shared accounts for scenarios that only need a valid FK target. */
let seeded: { bank: string; cash: string; fd: string } | undefined
async function seededAccounts(cookie: string): Promise<{ bank: string; cash: string; fd: string }> {
  if (seeded) return seeded
  const bank = await createAccount({ name: 'Seed bank', type: 'bank', openingBalance: 100000 }, 'seed-accounts-bank', cookie)
  const cash = await createAccount({ name: 'Seed cash', type: 'cash', openingBalance: 0 }, 'seed-accounts-cash', cookie)
  const fd = await createAccount({ name: 'Seed FD', type: 'fixed_deposit', openingBalance: 0 }, 'seed-accounts-fd', cookie)
  seeded = { bank, cash, fd }
  return seeded
}

async function login(userId: string, pin: string, label: string): Promise<string> {
  const response = await postJson('/api/auth/login', { userId, pin }, label)
  expect(response.status, `${label}: a valid-login regression would reject the configured PIN`).toBe(200)
  return harness.cookieFromResponse(response)
}

describe('transactions HTTP contract', () => {
  beforeAll(async () => {
    const vimalSetup = await postJson('/api/auth/setup-pin', { userId: VIMAL, pin: VIMAL_PIN }, 'txn-setup-vimal')
    const pavithraSetup = await postJson('/api/auth/setup-pin', { userId: PAVITHRA, pin: PAVITHRA_PIN }, 'txn-setup-pavithra')
    expect(vimalSetup.status, 'transactions tests require the real first-time setup route to establish Vimal\'s PIN').toBe(200)
    expect(pavithraSetup.status, 'transactions tests require the real first-time setup route to establish Pavithra\'s PIN').toBe(200)
    vimalCookie = harness.cookieFromResponse(vimalSetup)
  })

  it('creates one transaction of each type with a valid shape and exact integer paise', async () => {
    const { bank, cash, fd } = await seededAccounts(vimalCookie)
    const transactions: Array<{
      type: string
      amount: number
      date: string
      accountId: string
      toAccountId?: string
      categoryId?: string
      description?: string
    }> = [
      { type: 'expense', amount: 12345, date: '2026-08-01', accountId: bank, categoryId: 'c_groceries', description: 'Monthly groceries' },
      { type: 'income', amount: 500000, date: '2026-08-02', accountId: bank, categoryId: 'c_salary', description: 'Salary' },
      { type: 'transfer', amount: 10000, date: '2026-08-03', accountId: bank, toAccountId: cash },
      { type: 'interest', amount: 999, date: '2026-08-04', accountId: fd },
    ]

    for (const body of transactions) {
      const { id } = await createTxn(body, `create-${body.type}`, vimalCookie)
      const persisted = harness.inspectDbOne<{
        type: string
        amount: number
        date: string
        account_id: string
        to_account_id: string | null
        category_id: string | null
        spent_by: string
      }>(
        'SELECT type, amount, date, account_id, to_account_id, category_id, spent_by FROM transactions WHERE id = ?',
        [id],
      )

      expect(persisted?.type, `a ${body.type} insert regression would store the wrong type`).toBe(body.type)
      expect(persisted?.amount, `a ${body.type} insert regression would lose exact integer paise`).toBe(body.amount)
      expect(persisted?.date, `a ${body.type} insert regression would store the wrong date`).toBe(body.date)
      expect(persisted?.account_id, `a ${body.type} insert regression would store the wrong account`).toBe(body.accountId)
      expect(persisted?.to_account_id, `a ${body.type} insert regression would set the wrong to-account`).toBe(body.toAccountId ?? null)
      expect(persisted?.category_id, `a ${body.type} insert regression would set the wrong category`).toBe(body.categoryId ?? null)
      expect(persisted?.spent_by, 'a spentBy-default regression would not fall back to the current user').toBe(VIMAL)
    }
  })

  it.each<[string, (bank: string) => JsonObject, string]>([
    ['missing accountId', (_bank) => ({ type: 'expense', amount: 100, categoryId: 'c_groceries' }), 'invalid-missing-account'],
    ['negative amount', (bank) => ({ type: 'expense', amount: -100, accountId: bank, categoryId: 'c_groceries' }), 'invalid-negative-amount'],
    ['non-integer amount', (bank) => ({ type: 'expense', amount: 100.5, accountId: bank, categoryId: 'c_groceries' }), 'invalid-fractional-amount'],
    ['invalid type enum', (bank) => ({ type: 'loan', amount: 100, accountId: bank, categoryId: 'c_groceries' }), 'invalid-type-enum'],
    ['malformed date', (bank) => ({ type: 'expense', amount: 100, accountId: bank, categoryId: 'c_groceries', date: 20240101 }), 'invalid-date'],
  ])('returns a structured 400 for %s instead of inserting', async (_scenario, bodyFactory, label) => {
    const { bank } = await seededAccounts(vimalCookie)
    const response = await postJson('/api/transactions', bodyFactory(bank), label, vimalCookie)
    const responseBody = await readJson(response)

    expect(response.status, `${label}: a strict-body validation regression would accept the malformed transaction`).toBe(400)
    expect(errorMessage(responseBody), `${label}: a strict-body validation regression would remove the Invalid transaction data message`).toContain('Invalid transaction data')
  })

  it('enforces the transfer-specific invariants with the documented messages', async () => {
    const { bank, cash } = await seededAccounts(vimalCookie)

    const missingTo = await postJson('/api/transactions', { type: 'transfer', amount: 100, accountId: bank }, 'transfer-missing-to', vimalCookie)
    expect(missingTo.status, 'a transfer validation regression would accept a transfer without toAccountId').toBe(400)
    expect(errorMessage(await readJson(missingTo)), 'a transfer validation regression would drop the documented message').toContain('toAccountId required for transfer')

    const sameAccount = await postJson('/api/transactions', { type: 'transfer', amount: 100, accountId: bank, toAccountId: bank }, 'transfer-same-account', vimalCookie)
    expect(sameAccount.status, 'a transfer validation regression would allow a transfer to its own account').toBe(400)
    expect(errorMessage(await readJson(sameAccount)), 'a transfer validation regression would drop the documented message').toContain('Cannot transfer to same account')

    const withCategory = await postJson('/api/transactions', { type: 'transfer', amount: 100, accountId: bank, toAccountId: cash, categoryId: 'c_groceries' }, 'transfer-with-category', vimalCookie)
    expect(withCategory.status, 'a transfer validation regression would accept a transfer with a category').toBe(400)
    expect(errorMessage(await readJson(withCategory)), 'a transfer validation regression would drop the documented message').toContain('Transfers cannot have a category')

    expect(harness.inspectDbOne('SELECT COUNT(*) AS count FROM transactions')?.count,
      'a transfer validation regression would insert rejected transfers').toBe(4)
  })

  it('rejects an interest transaction that carries a toAccountId', async () => {
    const { bank, fd } = await seededAccounts(vimalCookie)
    const response = await postJson('/api/transactions', { type: 'interest', amount: 100, accountId: fd, toAccountId: bank }, 'interest-with-to', vimalCookie)
    const body = await readJson(response)

    expect(response.status, 'an interest validation regression would accept interest with a toAccountId').toBe(400)
    expect(errorMessage(body), 'an interest validation regression would drop the documented message').toContain('Interest transactions cannot have a toAccountId')
  })

  it('requires a categoryId for expense and income transactions', async () => {
    const { bank } = await seededAccounts(vimalCookie)

    const expense = await postJson('/api/transactions', { type: 'expense', amount: 100, accountId: bank }, 'expense-no-category', vimalCookie)
    expect(expense.status, 'an expense validation regression would accept an expense without a category').toBe(400)
    expect(errorMessage(await readJson(expense)), 'an expense validation regression would drop the documented message').toContain('Category required for expense/income')

    const income = await postJson('/api/transactions', { type: 'income', amount: 100, accountId: bank }, 'income-no-category', vimalCookie)
    expect(income.status, 'an income validation regression would accept income without a category').toBe(400)
    expect(errorMessage(await readJson(income)), 'an income validation regression would drop the documented message').toContain('Category required for expense/income')
  })

  it.each([
    ['unknown accountId', (bank: string) => ({ type: 'expense', amount: 100, accountId: 'acc_nope', categoryId: 'c_groceries' }), 'Account not found', 'fk-unknown-account'],
    ['unknown toAccountId', (bank: string) => ({ type: 'transfer', amount: 100, accountId: bank, toAccountId: 'acc_nope2' }), 'Destination account not found', 'fk-unknown-to-account'],
    ['unknown categoryId', (bank: string) => ({ type: 'expense', amount: 100, accountId: bank, categoryId: 'c_nope' }), 'Category not found', 'fk-unknown-category'],
  ])('returns a 404 for POST with an %s instead of a 500', async (_scenario, bodyFactory, message, label) => {
    const { bank } = await seededAccounts(vimalCookie)
    const response = await postJson('/api/transactions', bodyFactory(bank), label, vimalCookie)
    const body = await readJson(response)

    expect(response.status, `${label}: an FK-404 regression would turn an unknown reference into a non-404`).toBe(404)
    expect(errorMessage(body), `${label}: an FK-404 regression would drop the documented message`).toContain(message)
    expect(harness.inspectDbOne<{ count: number }>('SELECT COUNT(*) AS count FROM transactions')?.count,
      `${label}: an FK-404 regression would insert a transaction with a dangling reference`).toBe(4)
  })

  it('patches every field individually and re-validates type compatibility after the merge', async () => {
    const { bank, cash } = await seededAccounts(vimalCookie)
    const { id } = await createTxn(
      { type: 'expense', amount: 1111, date: '2026-08-10', accountId: bank, categoryId: 'c_groceries', description: 'Original' },
      'patch-create',
      vimalCookie,
    )

    const positivePatches: Array<{ patch: JsonObject; field: string; value: unknown }> = [
      { patch: { amount: 2222 }, field: 'amount', value: 2222 },
      { patch: { description: 'Patched description' }, field: 'description', value: 'Patched description' },
      { patch: { notes: 'Patched notes' }, field: 'notes', value: 'Patched notes' },
      { patch: { date: '2026-08-15' }, field: 'date', value: '2026-08-15' },
      { patch: { spentBy: PAVITHRA }, field: 'spentBy', value: PAVITHRA },
      { patch: { accountId: cash }, field: 'accountId', value: cash },
      { patch: { categoryId: 'c_dining' }, field: 'categoryId', value: 'c_dining' },
      { patch: { type: 'income' }, field: 'type', value: 'income' },
    ]

    for (const { patch, field, value } of positivePatches) {
      const response = await patchJson(`/api/transactions/${id}`, patch, `patch-${field}`, vimalCookie)
      const responseBody = await readJson(response)
      expect(response.status, `patching ${field} regression would reject a valid single-field patch`).toBe(200)
      expect((responseBody.transaction as JsonObject)[field], `a ${field} patch regression would return the stale value`).toBe(value)
      const column = field === 'accountId' ? 'account_id' : field === 'categoryId' ? 'category_id' : field === 'spentBy' ? 'spent_by' : field
      const persisted = harness.inspectDbOne<Record<string, unknown>>(
        `SELECT ${column} AS value FROM transactions WHERE id = ?`,
        [id],
      )
      expect(persisted?.value, `a ${field} patch regression would not persist the new value`).toBe(value)
    }

    const transferWithoutTo = await patchJson(`/api/transactions/${id}`, { type: 'transfer' }, 'patch-expense-to-transfer', vimalCookie)
    expect(transferWithoutTo.status, 'a post-merge validation regression would allow turning an expense into a transfer without toAccountId').toBe(400)
    expect(errorMessage(await readJson(transferWithoutTo)), 'a post-merge validation regression would drop the documented message').toContain('toAccountId required for transfer')

    const stripCategory = await patchJson(`/api/transactions/${id}`, { categoryId: null }, 'patch-strip-category', vimalCookie)
    expect(stripCategory.status, 'a post-merge validation regression would allow stripping the category from an income').toBe(400)
    expect(errorMessage(await readJson(stripCategory)), 'a post-merge validation regression would drop the documented message').toContain('Category required for expense/income')

    const unchanged = harness.inspectDbOne<{ type: string; category_id: string | null; amount: number }>(
      'SELECT type, category_id, amount FROM transactions WHERE id = ?',
      [id],
    )
    expect(unchanged?.type, 'a failed-patch regression would partially apply a rejected transfer patch').toBe('income')
    expect(unchanged?.category_id, 'a failed-patch regression would partially apply a rejected category patch').toBe('c_dining')
    expect(unchanged?.amount, 'a failed-patch regression would partially apply a rejected patch').toBe(2222)
  })

  it('returns 404 for PATCH on an unknown id or with an unknown FK reference', async () => {
    const { bank, cash } = await seededAccounts(vimalCookie)
    const { id: expenseId } = await createTxn(
      { type: 'expense', amount: 500, date: '2026-08-16', accountId: bank, categoryId: 'c_groceries' },
      'patch-404-create',
      vimalCookie,
    )
    const { id: transferId } = await createTxn(
      { type: 'transfer', amount: 300, date: '2026-08-17', accountId: bank, toAccountId: cash },
      'patch-404-transfer-create',
      vimalCookie,
    )

    const unknownId = await patchJson('/api/transactions/txn_nope', { amount: 1 }, 'patch-unknown-id', vimalCookie)
    expect(unknownId.status, 'an unknown-id PATCH regression would not return 404').toBe(404)
    expect(errorMessage(await readJson(unknownId)), 'an unknown-id PATCH regression would drop the documented message').toContain('Transaction not found')

    const unknownAccount = await patchJson(`/api/transactions/${expenseId}`, { accountId: 'acc_nope' }, 'patch-unknown-account', vimalCookie)
    expect(unknownAccount.status, 'an unknown-account PATCH regression would not return 404').toBe(404)
    expect(errorMessage(await readJson(unknownAccount)), 'an unknown-account PATCH regression would drop the documented message').toContain('Account not found')

    const unknownCategory = await patchJson(`/api/transactions/${expenseId}`, { categoryId: 'c_nope' }, 'patch-unknown-category', vimalCookie)
    expect(unknownCategory.status, 'an unknown-category PATCH regression would not return 404').toBe(404)
    expect(errorMessage(await readJson(unknownCategory)), 'an unknown-category PATCH regression would drop the documented message').toContain('Category not found')

    const unknownToAccount = await patchJson(`/api/transactions/${transferId}`, { toAccountId: 'acc_nope2' }, 'patch-unknown-to-account', vimalCookie)
    expect(unknownToAccount.status, 'an unknown-to-account PATCH regression would not return 404').toBe(404)
    expect(errorMessage(await readJson(unknownToAccount)), 'an unknown-to-account PATCH regression would drop the documented message').toContain('Destination account not found')
  })

  it('hard-deletes a transaction and returns 404/400 for unknown and missing ids', async () => {
    const { bank } = await seededAccounts(vimalCookie)
    const { id } = await createTxn(
      { type: 'expense', amount: 700, date: '2026-08-18', accountId: bank, categoryId: 'c_groceries' },
      'delete-create',
      vimalCookie,
    )

    const response = await deleteReq(`/api/transactions/${id}`, 'delete-txn', vimalCookie)
    const body = await readJson(response)
    expect(response.status, 'a DELETE regression would reject a valid hard-delete').toBe(200)
    expect(body.ok, 'a DELETE regression would omit the success envelope').toBe(true)
    expect(harness.inspectDbOne('SELECT * FROM transactions WHERE id = ?', [id]),
      'a DELETE regression would leave the deleted row in the DB').toBeUndefined()

    const unknown = await deleteReq('/api/transactions/txn_nope', 'delete-unknown', vimalCookie)
    expect(unknown.status, 'an unknown-id DELETE regression would not return 404').toBe(404)
    expect(errorMessage(await readJson(unknown)), 'an unknown-id DELETE regression would drop the documented message').toContain('Transaction not found')

    const missing = await deleteReq('/api/transactions//', 'delete-missing', vimalCookie)
    expect(missing.status, 'a missing-id DELETE regression would not return 400').toBe(400)
    expect(errorMessage(await readJson(missing)), 'a missing-id DELETE regression would drop the documented message').toContain('Transaction id required')
  })

  it('lists all rows without filters and narrows by accountId both sides, type, and q substring', async () => {
    const listSource = await createAccount({ name: 'Filter source', type: 'bank', openingBalance: 0 }, 'filter-source-create', vimalCookie)
    const listDest = await createAccount({ name: 'Filter dest', type: 'cash', openingBalance: 0 }, 'filter-dest-create', vimalCookie)

    const expense = await createTxn(
      { type: 'expense', amount: 1000, date: '2026-11-20', accountId: listSource, categoryId: 'c_groceries', description: 'zebra-striped groceries' },
      'filter-expense',
      vimalCookie,
    )
    const income = await createTxn(
      { type: 'income', amount: 5000, date: '2026-11-21', accountId: listSource, categoryId: 'c_salary' },
      'filter-income',
      vimalCookie,
    )
    const transfer = await createTxn(
      { type: 'transfer', amount: 2000, date: '2026-11-22', accountId: listSource, toAccountId: listDest },
      'filter-transfer',
      vimalCookie,
    )

    const all = await readJson(await get('/api/transactions', 'filter-all', vimalCookie))
    const dbCount = harness.inspectDbOne<{ count: number }>('SELECT COUNT(*) AS count FROM transactions')?.count ?? -1
    expect(all.limit, 'a no-filter list regression would change the documented default limit').toBe(100)
    expect(all.offset, 'a no-filter list regression would change the documented default offset').toBe(0)
    expect((all.transactions as JsonArray).length, 'a no-filter list regression would return a different transaction count than the DB').toBe(dbCount)

    const fromSource = (await readJson(await get(`/api/transactions?accountId=${listSource}`, 'filter-account-source', vimalCookie))).transactions as JsonArray
    const sourceIds = fromSource.map((transaction) => transaction.id)
    expect(sourceIds, 'an accountId-filter regression would drop the transfer from the source side').toContain(expense.id)
    expect(sourceIds, 'an accountId-filter regression would drop the income from the source side').toContain(income.id)
    expect(sourceIds, 'an accountId-filter regression would drop the transfer from the source side match').toContain(transfer.id)

    const fromDest = (await readJson(await get(`/api/transactions?accountId=${listDest}`, 'filter-account-dest', vimalCookie))).transactions as JsonArray
    expect(fromDest.map((transaction) => transaction.id),
      'an accountId-filter regression would not match the destination side of a transfer').toContain(transfer.id)

    const transfers = (await readJson(await get('/api/transactions?type=transfer', 'filter-type', vimalCookie))).transactions as JsonArray
    expect(transfers.map((transaction) => transaction.id),
      'a type-filter regression would drop the transfer from the type-filtered list').toContain(transfer.id)
    expect(transfers.every((transaction) => transaction.type === 'transfer'),
      'a type-filter regression would leak a non-transfer row').toBe(true)

    const search = (await readJson(await get('/api/transactions?q=zebra-striped', 'filter-q', vimalCookie))).transactions as JsonArray
    expect(search.map((transaction) => transaction.id),
      'a q-filter regression would not find the description substring').toContain(expense.id)
    expect(search.length, 'a q-filter regression would return rows that do not match the description').toBe(1)

    const noMatch = (await readJson(await get('/api/transactions?q=no-such-description-xyz', 'filter-q-none', vimalCookie))).transactions as JsonArray
    expect(noMatch, 'a q-filter regression would match a description substring that does not exist').toEqual([])
  })

  it('respects limit and offset pagination boundaries on the list endpoint', async () => {
    const paginationAccount = await createAccount({ name: 'Pagination account', type: 'bank', openingBalance: 0 }, 'pagination-account', vimalCookie)
    const oldest = await createTxn(
      { type: 'expense', amount: 100, date: '2026-12-01', accountId: paginationAccount, categoryId: 'c_groceries' },
      'pagination-2026-12-01',
      vimalCookie,
    )
    const middle = await createTxn(
      { type: 'expense', amount: 200, date: '2026-12-02', accountId: paginationAccount, categoryId: 'c_groceries' },
      'pagination-2026-12-02',
      vimalCookie,
    )
    const newest = await createTxn(
      { type: 'expense', amount: 300, date: '2026-12-03', accountId: paginationAccount, categoryId: 'c_groceries' },
      'pagination-2026-12-03',
      vimalCookie,
    )

    const firstPage = (await readJson(await get('/api/transactions?limit=1', 'pagination-limit-1', vimalCookie))) as JsonObject & { transactions: JsonArray }
    expect(firstPage.limit, 'a pagination regression would ignore the requested limit').toBe(1)
    expect(firstPage.transactions.length, 'a pagination regression would return more rows than the requested limit').toBe(1)
    expect(firstPage.transactions[0].id, 'a pagination regression would return the wrong newest row first').toBe(newest.id)

    const secondPage = (await readJson(await get('/api/transactions?limit=1&offset=1', 'pagination-offset-1', vimalCookie))) as JsonObject & { transactions: JsonArray }
    expect(secondPage.transactions[0].id, 'a pagination regression would return the wrong row at offset 1').toBe(middle.id)

    const beyond = (await readJson(await get('/api/transactions?offset=100', 'pagination-beyond', vimalCookie))).transactions as JsonArray
    expect(beyond, 'a pagination regression would not return an empty page beyond the data set').toEqual([])

    const oldestById = (await readJson(await get(`/api/transactions?accountId=${paginationAccount}&to=2026-12-01`, 'pagination-oldest', vimalCookie))).transactions as JsonArray
    expect(oldestById.map((transaction) => transaction.id), 'a pagination regression would mis-order the oldest row').toContain(oldest.id)
  })

  it('returns 400 for invalid query strings instead of a 200 error envelope', async () => {
    const invalidType = await get('/api/transactions?type=invalid', 'query-invalid-type', vimalCookie)
    expect(invalidType.status, 'an invalid-type query regression would not return 400').toBe(400)
    expect(errorMessage(await readJson(invalidType)), 'an invalid-type query regression would drop the Invalid query message').toContain('Invalid query')

    const zeroLimit = await get('/api/transactions?limit=0', 'query-zero-limit', vimalCookie)
    expect(zeroLimit.status, 'a zero-limit query regression would not return 400').toBe(400)
    expect(errorMessage(await readJson(zeroLimit)), 'a zero-limit query regression would drop the Invalid query message').toContain('Invalid query')

    const negativeOffset = await get('/api/transactions?offset=-1', 'query-negative-offset', vimalCookie)
    expect(negativeOffset.status, 'a negative-offset query regression would not return 400').toBe(400)
    expect(errorMessage(await readJson(negativeOffset)), 'a negative-offset query regression would drop the Invalid query message').toContain('Invalid query')
  })

  it('filters by the from/to date range across a month boundary', async () => {
    const datesAccount = await createAccount({ name: 'Dates account', type: 'bank', openingBalance: 0 }, 'dates-account', vimalCookie)
    const july = await createTxn(
      { type: 'expense', amount: 1111, date: '2026-07-31', accountId: datesAccount, categoryId: 'c_groceries' },
      'dates-july-31',
      vimalCookie,
    )
    const august = await createTxn(
      { type: 'expense', amount: 2222, date: '2026-08-01', accountId: datesAccount, categoryId: 'c_groceries' },
      'dates-aug-01',
      vimalCookie,
    )

    const fromBoundary = (await readJson(await get(`/api/transactions?accountId=${datesAccount}&from=2026-08-01`, 'dates-from', vimalCookie))).transactions as JsonArray
    expect(fromBoundary.map((transaction) => transaction.id),
      'a from-filter regression would include the day before the boundary').not.toContain(july.id)
    expect(fromBoundary.map((transaction) => transaction.id),
      'a from-filter regression would drop the transaction on the boundary').toContain(august.id)

    const toBoundary = (await readJson(await get(`/api/transactions?accountId=${datesAccount}&to=2026-07-31`, 'dates-to', vimalCookie))).transactions as JsonArray
    expect(toBoundary.map((transaction) => transaction.id),
      'a to-filter regression would include the day after the boundary').not.toContain(august.id)
    expect(toBoundary.map((transaction) => transaction.id),
      'a to-filter regression would drop the transaction on the boundary').toContain(july.id)

    const both = (await readJson(await get(`/api/transactions?accountId=${datesAccount}&from=2026-07-31&to=2026-08-01`, 'dates-both', vimalCookie))).transactions as JsonArray
    expect(both.map((transaction) => transaction.id), 'a date-range regression would drop an in-range transaction').toEqual(expect.arrayContaining([july.id, august.id]))
  })

  it('enforces auth and treats transactions as one shared household ledger', async () => {
    const anonymous = await get('/api/transactions', 'shared-ledger-anonymous')
    expect(anonymous.status, 'an auth-gate regression would let an unauthenticated request list transactions').toBe(401)

    const vimalSession = await login(VIMAL, VIMAL_PIN, 'shared-login-vimal')
    const pavithraSession = await login(PAVITHRA, PAVITHRA_PIN, 'shared-login-pavithra')
    const sharedAccount = await createAccount({ name: 'Shared ledger', type: 'bank', openingBalance: 0 }, 'shared-ledger-account', vimalSession)
    const { id } = await createTxn(
      { type: 'expense', amount: 4321, date: '2026-10-01', accountId: sharedAccount, categoryId: 'c_groceries' },
      'shared-ledger-create',
      vimalSession,
    )

    const pavithraList = (await readJson(await get('/api/transactions', 'shared-ledger-pavithra-list', pavithraSession))).transactions as JsonArray
    expect(pavithraList.map((transaction) => transaction.id),
      'a household-sharing regression would hide Vimal\'s transaction from Pavithra').toContain(id)

    const patch = await patchJson(`/api/transactions/${id}`, { amount: 9999 }, 'shared-ledger-patch', pavithraSession)
    expect(patch.status, 'a household-sharing regression would block Pavithra from mutating the shared transaction').toBe(200)

    const vimalList = (await readJson(await get('/api/transactions', 'shared-ledger-vimal-list', vimalSession))).transactions as JsonArray
    expect(vimalList.find((transaction) => transaction.id === id)?.amount,
      'a household-sharing regression would not propagate Pavithra\'s patch to Vimal').toBe(9999)

    const del = await deleteReq(`/api/transactions/${id}`, 'shared-ledger-delete', pavithraSession)
    expect(del.status, 'a household-sharing regression would block Pavithra from deleting the shared transaction').toBe(200)
    const afterDelete = (await readJson(await get('/api/transactions', 'shared-ledger-vimal-after', vimalSession))).transactions as JsonArray
    expect(afterDelete.map((transaction) => transaction.id),
      'a household-sharing regression would not propagate Pavithra\'s delete to Vimal').not.toContain(id)
  })

  it('leaves no orphaned state after a hard delete', async () => {
    const orphanAccount = await createAccount({ name: 'Orphan probe', type: 'bank', openingBalance: 0 }, 'orphan-account', vimalCookie)
    const { id } = await createTxn(
      { type: 'expense', amount: 1234, date: '2026-11-01', accountId: orphanAccount, categoryId: 'c_groceries' },
      'orphan-create',
      vimalCookie,
    )

    const beforeCounts = {
      transactions: harness.inspectDbOne<{ count: number }>('SELECT COUNT(*) AS count FROM transactions')?.count ?? -1,
      accounts: harness.inspectDbOne<{ count: number }>('SELECT COUNT(*) AS count FROM accounts')?.count ?? -1,
      categories: harness.inspectDbOne<{ count: number }>('SELECT COUNT(*) AS count FROM categories')?.count ?? -1,
    }

    const response = await deleteReq(`/api/transactions/${id}`, 'orphan-delete', vimalCookie)
    expect((await readJson(response)).ok, 'an orphan-check delete regression would omit the success envelope').toBe(true)

    const afterCounts = {
      transactions: harness.inspectDbOne<{ count: number }>('SELECT COUNT(*) AS count FROM transactions')?.count ?? -1,
      accounts: harness.inspectDbOne<{ count: number }>('SELECT COUNT(*) AS count FROM accounts')?.count ?? -1,
      categories: harness.inspectDbOne<{ count: number }>('SELECT COUNT(*) AS count FROM categories')?.count ?? -1,
    }
    expect(afterCounts.transactions, 'a hard-delete regression would leave the deleted transaction row behind').toBe(beforeCounts.transactions - 1)
    expect(afterCounts.accounts, 'a hard-delete regression would cascade into the accounts table').toBe(beforeCounts.accounts)
    expect(afterCounts.categories, 'a hard-delete regression would cascade into the categories table').toBe(beforeCounts.categories)

    const danglingReferences = harness.inspectDbOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM transactions WHERE id = ? OR account_id = ? OR to_account_id = ? OR category_id = ?',
      [id, id, id, id],
    )
    expect(danglingReferences?.count, 'a hard-delete regression would leave an orphan reference to the deleted id').toBe(0)
  })

  it('computes golden integer-paise balances for all four transaction types', async () => {
    const source = await createAccount({ name: 'Golden source', type: 'bank', openingBalance: 100000 }, 'golden-source', vimalCookie)
    const destination = await createAccount({ name: 'Golden destination', type: 'cash', openingBalance: 0 }, 'golden-dest', vimalCookie)

    await createTxn({ type: 'income', amount: 50000, date: '2026-09-01', accountId: source, categoryId: 'c_salary' }, 'golden-income', vimalCookie)
    await createTxn({ type: 'expense', amount: 25000, date: '2026-09-02', accountId: source, categoryId: 'c_groceries' }, 'golden-expense', vimalCookie)
    await createTxn({ type: 'transfer', amount: 10000, date: '2026-09-03', accountId: source, toAccountId: destination }, 'golden-transfer', vimalCookie)
    await createTxn({ type: 'interest', amount: 5000, date: '2026-09-04', accountId: source }, 'golden-interest', vimalCookie)

    const dashboard = (await readJson(await get('/api/dashboard?period=last_30', 'golden-dashboard', vimalCookie))).data as JsonObject
    const accountCards = dashboard.accounts as JsonArray
    const sourceCard = accountCards.find((card) => card.id === source)
    const destinationCard = accountCards.find((card) => card.id === destination)

    expect(sourceCard?.balance, 'a balance regression would mis-sum the golden source balance (100000 + 50000 - 25000 - 10000 + 5000)').toBe(120000)
    expect(destinationCard?.balance, 'a balance regression would mis-sum the golden destination balance (0 + 10000)').toBe(10000)

    const sourceTxns = (await readJson(await get(`/api/accounts/${source}/transactions`, 'golden-source-txns', vimalCookie))).transactions as JsonArray
    expect(sourceTxns.map((transaction) => transaction.amount).sort((a, b) => (a as number) - (b as number)),
      'a paise regression would lose integer precision on the source account transactions').toEqual([5000, 10000, 25000, 50000])
    const destinationTxns = (await readJson(await get(`/api/accounts/${destination}/transactions`, 'golden-dest-txns', vimalCookie))).transactions as JsonArray
    expect(destinationTxns.map((transaction) => transaction.amount),
      'a paise regression would lose integer precision on the destination account transactions').toEqual([10000])
  })
})
