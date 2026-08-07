/**
 * Dashboard HTTP contract.
 *
 * The production break these tests protect against is a route, period
 * resolution, aggregation-unit, or per-user-scoping regression in
 * `server/api/dashboard.get.ts` (and the `user-settings` pair it reads for
 * the monthly budget) that a pure-function test would not catch. Every
 * request goes through the real Nuxt server with a real session cookie,
 * Origin header, and client IP.
 *
 * The seed is deterministic: 7 accounts and 15 transactions with exact paise
 * amounts chosen so every golden aggregate below is hand-derivable. Mixed
 * units are part of the contract — periodIncome/periodExpense/liquidity/
 * topCategories/monthBudget/account balances are paise; cashFlow and
 * dailySpends are rupees (the endpoint divides those two series by 100).
 */
import Database from 'better-sqlite3'
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

interface TopCategory { categoryId: string; name: string; color: string; amount: number }
interface CashFlowEntry { month: string; income: number; expense: number }
interface DailySpend { date: string; label: string; amount: number }
interface AccountCard {
  id: string
  name: string
  type: string
  balance: number
  creditLimit: number | null
  color: string | null
  icon: string | null
  last4: string | null
}
interface RecentTxn { id: string; date: string; createdAt: string }

let vimalCookie = ''
let hdfcId = ''
let cashId = ''
let phonePeId = ''
let iciciId = ''
let mfId = ''
let jewelleryId = ''
let oldBankId = ''
let t09Id = ''
let t12Id = ''

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

/** Local YYYY-MM-DD — deliberately NOT `toISOString().slice(0, 10)`. */
function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function createAccount(body: JsonObject, label: string): Promise<string> {
  const response = await postJson('/api/accounts', body, label, vimalCookie)
  const responseBody = await readJson(response)
  expect(response.status, `${label}: the real account-create route must accept the seeded account body`).toBe(200)
  return String((responseBody.account as JsonObject).id)
}

async function createTransaction(body: JsonObject, label: string): Promise<string> {
  const response = await postJson('/api/transactions', body, label, vimalCookie)
  const responseBody = await readJson(response)
  expect(response.status, `${label}: the real transaction-create route must accept the seeded transaction body`).toBe(200)
  return String((responseBody.transaction as JsonObject).id)
}

/**
 * Raw transaction insert. Used for two fixture cases the POST route cannot
 * produce deterministically: a transaction whose categoryId has no category
 * row (the topCategories 'Unknown' fallback), and a same-date transaction
 * whose `createdAt` must sort strictly after a POST-created sibling (the
 * recentTransactions createdAt tie-break).
 */
function insertTransactionRaw(row: {
  id: string
  type: 'expense' | 'income' | 'transfer' | 'interest'
  amount: number
  date: string
  accountId: string
  toAccountId: string | null
  categoryId: string | null
  createdAt: string
}): void {
  const db = new Database(harness.dbPath)
  try {
    db.prepare(
      `INSERT INTO transactions
        (id, type, amount, date, account_id, to_account_id, category_id, description, notes, spent_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
    ).run(
      row.id,
      row.type,
      row.amount,
      row.date,
      row.accountId,
      row.toAccountId,
      row.categoryId,
      VIMAL,
      row.createdAt,
      row.createdAt,
    )
  } finally {
    db.close()
  }
}

/** Authenticated GET of the dashboard data envelope (assumes 200). */
async function dashboardData(query: string, label: string): Promise<JsonObject> {
  const response = await get(`/api/dashboard${query}`, label, vimalCookie)
  expect(response.status, `${label}: a dashboard route regression would fail a valid authenticated request`).toBe(200)
  const body = await readJson(response)
  return body.data as JsonObject
}

beforeAll(async () => {
  const vimalSetup = await postJson('/api/auth/setup-pin', { userId: VIMAL, pin: VIMAL_PIN }, 'dashboard-setup-vimal')
  const pavithraSetup = await postJson('/api/auth/setup-pin', { userId: PAVITHRA, pin: PAVITHRA_PIN }, 'dashboard-setup-pavithra')
  expect(vimalSetup.status, 'dashboard tests require the real first-time setup route for Vimal').toBe(200)
  expect(pavithraSetup.status, 'dashboard tests require the real first-time setup route for Pavithra').toBe(200)
  vimalCookie = harness.cookieFromResponse(vimalSetup)

  // Accounts — all balances are paise opening balances.
  hdfcId = await createAccount({ name: 'HDFC Bank', type: 'bank', openingBalance: 100000 }, 'seed-account-hdfc')
  cashId = await createAccount({ name: 'Cash', type: 'cash', openingBalance: 20000 }, 'seed-account-cash')
  phonePeId = await createAccount({ name: 'PhonePe', type: 'digital_wallet', openingBalance: 30000 }, 'seed-account-phonepe')
  iciciId = await createAccount({ name: 'ICICI Card', type: 'credit_card', openingBalance: 0, creditLimit: 500000 }, 'seed-account-icici')
  mfId = await createAccount({ name: 'Mutual Fund', type: 'mutual_fund', openingBalance: 250000 }, 'seed-account-mf')
  jewelleryId = await createAccount({ name: 'Jewellery', type: 'other', openingBalance: 90000 }, 'seed-account-jewellery')
  oldBankId = await createAccount({ name: 'Old Bank', type: 'bank', openingBalance: 50000 }, 'seed-account-old-bank')

  const archive = await patchJson(`/api/accounts/${oldBankId}`, { archived: true }, 'seed-archive-old-bank', vimalCookie)
  expect(archive.status, 'the archive route must soft-delete the seeded Old Bank account').toBe(200)

  // In-window transactions (2026-07-01..2026-07-31), amounts in paise.
  await createTransaction({ type: 'income', amount: 250000, date: '2026-07-01', accountId: hdfcId, categoryId: 'c_salary' }, 'seed-t01-salary')
  await createTransaction({ type: 'expense', amount: 100000, date: '2026-07-02', accountId: hdfcId, categoryId: 'c_groceries' }, 'seed-t02-groceries')
  await createTransaction({ type: 'expense', amount: 50000, date: '2026-07-05', accountId: phonePeId, categoryId: 'c_dining' }, 'seed-t03-dining')
  await createTransaction({ type: 'expense', amount: 20000, date: '2026-07-07', accountId: iciciId, categoryId: 'c_dining' }, 'seed-t04-cc-dining')
  await createTransaction({ type: 'income', amount: 150000, date: '2026-07-10', accountId: hdfcId, categoryId: 'c_freelance' }, 'seed-t05-freelance')
  await createTransaction({ type: 'transfer', amount: 60000, date: '2026-07-12', accountId: hdfcId, toAccountId: mfId }, 'seed-t06-transfer')
  await createTransaction({ type: 'expense', amount: 25000, date: '2026-07-15', accountId: cashId, categoryId: 'c_transport' }, 'seed-t07-transport')
  await createTransaction({ type: 'expense', amount: 15000, date: '2026-07-18', accountId: jewelleryId, categoryId: 'c_misc' }, 'seed-t08-misc')
  t09Id = await createTransaction({ type: 'expense', amount: 75000, date: '2026-07-20', accountId: hdfcId, categoryId: 'c_shopping' }, 'seed-t09-shopping')
  await createTransaction({ type: 'expense', amount: 30000, date: '2026-07-22', accountId: phonePeId, categoryId: 'c_groceries' }, 'seed-t10-groceries')
  await createTransaction({ type: 'interest', amount: 5000, date: '2026-07-25', accountId: mfId, categoryId: 'c_investment_returns' }, 'seed-t11-interest')
  // Same date as t09 but with a createdAt that sorts strictly later — the
  // recentTransactions tie-break must prefer it over t09 on 2026-07-20.
  insertTransactionRaw({
    id: 'txn_07_20_late',
    type: 'expense',
    amount: 12500,
    date: '2026-07-20',
    accountId: phonePeId,
    toAccountId: null,
    categoryId: 'c_dining',
    createdAt: '2099-01-01T00:00:00.000Z',
  })
  t12Id = 'txn_07_20_late'

  // Out-of-window transactions — prove recentTransactions is global recency.
  await createTransaction({ type: 'expense', amount: 9000, date: '2026-06-10', accountId: oldBankId, categoryId: 'c_misc' }, 'seed-t13-old-bank')
  await createTransaction({ type: 'income', amount: 50000, date: '2026-06-05', accountId: hdfcId, categoryId: 'c_other_income' }, 'seed-t14-other-income')

  // Unknown category → exercises the 'Unknown' / '#A8A29E' fallback in topCategories.
  insertTransactionRaw({
    id: 'txn_unknown_cat',
    type: 'expense',
    amount: 18000,
    date: '2026-07-21',
    accountId: hdfcId,
    toAccountId: null,
    categoryId: 'c_unknown_cat',
    createdAt: '2026-07-21T12:00:00.000Z',
  })
})

describe('dashboard HTTP contract', () => {
  it('rejects an unauthenticated dashboard request with 401', async () => {
    const response = await get('/api/dashboard', 'dashboard-anonymous')
    const body = await readJson(response)

    expect(response.status, 'an auth-gate regression would let an unauthenticated request read the dashboard').toBe(401)
    expect(errorMessage(body), 'an auth-gate regression would drop the Not authenticated message').toContain('Not authenticated')
  })

  it('returns the documented response shape on the default since_last_salary period', async () => {
    const now = new Date()
    const todayLocal = localISO(now)
    const data = await dashboardData('', 'dashboard-shape')

    // The default period is since_last_salary; the only salary (2026-07-01)
    // anchors `from`, and `to` is always the local today.
    const period = data.period as JsonObject
    expect(period, 'a shape regression would omit the period range').toBeDefined()
    expect(period.from, 'the default period must resolve from the most recent salary date').toBe('2026-07-01')
    expect(period.to, 'the default period must end on the local today').toBe(todayLocal)
    expect(period.label, 'a period-label regression would change the Since MMM d contract').toBe('Since Jul 1')

    expect(data.cashLiquidity, 'a shape regression would omit the cash liquidity tile').toEqual(expect.any(Number))
    expect(data.creditLiquidity, 'a shape regression would omit the credit liquidity tile').toEqual(expect.any(Number))
    expect(data.savingsLiquidity, 'a shape regression would omit the savings liquidity tile').toEqual(expect.any(Number))
    expect(data.periodIncome, 'a shape regression would omit periodIncome').toEqual(expect.any(Number))
    expect(data.periodExpense, 'a shape regression would omit periodExpense').toEqual(expect.any(Number))
    expect(data.monthBudget, 'a shape regression would omit monthBudget').toEqual(expect.any(Number))
    expect(data.monthBudgetSet, 'a shape regression would omit the monthBudgetSet boolean').toEqual(expect.any(Boolean))

    const topCategories = data.topCategories as JsonArray
    expect(Array.isArray(topCategories), 'a shape regression would omit the topCategories array').toBe(true)
    for (const category of topCategories) {
      expect(typeof category.categoryId, 'a topCategories regression would omit categoryId').toBe('string')
      expect(typeof category.name, 'a topCategories regression would omit the category name').toBe('string')
      expect(typeof category.color, 'a topCategories regression would omit the category color').toBe('string')
      expect(typeof category.amount, 'a topCategories regression would omit the category amount').toBe('number')
    }

    const recent = data.recentTransactions as JsonArray
    expect(Array.isArray(recent), 'a shape regression would omit recentTransactions').toBe(true)
    expect(recent.length, 'a recentTransactions regression would exceed the documented 10-row cap').toBeLessThanOrEqual(10)

    const accounts = data.accounts as AccountCard[]
    expect(Array.isArray(accounts), 'a shape regression would omit the account cards').toBe(true)
    for (const account of accounts) {
      expect(typeof account.id, 'an account-card regression would omit the account id').toBe('string')
      expect(typeof account.name, 'an account-card regression would omit the account name').toBe('string')
      expect(typeof account.type, 'an account-card regression would omit the account type').toBe('string')
      expect(typeof account.balance, 'an account-card regression would omit the dynamic balance').toBe('number')
    }

    const cashFlow = data.cashFlow as CashFlowEntry[]
    expect(Array.isArray(cashFlow), 'a shape regression would omit the cashFlow array').toBe(true)
    for (const entry of cashFlow) {
      expect(typeof entry.month, 'a cashFlow regression would omit the month label').toBe('string')
      expect(typeof entry.income, 'a cashFlow regression would omit income').toBe('number')
      expect(typeof entry.expense, 'a cashFlow regression would omit expense').toBe('number')
    }

    const dailySpends = data.dailySpends as DailySpend[]
    expect(Array.isArray(dailySpends), 'a shape regression would omit the dailySpends array').toBe(true)
    for (const spend of dailySpends) {
      expect(typeof spend.date, 'a dailySpends regression would omit the date').toBe('string')
      expect(typeof spend.label, 'a dailySpends regression would omit the label').toBe('string')
      expect(typeof spend.amount, 'a dailySpends regression would omit the amount').toBe('number')
    }
  })

  it('resolves every static period to a valid local from/to/label', async () => {
    const now = new Date()
    const todayLocal = localISO(now)
    const thisMonthFrom = localISO(new Date(now.getFullYear(), now.getMonth(), 1))
    const last30From = localISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30))
    const last90From = localISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90))
    const thisMonthLabel = new Date(now.getFullYear(), now.getMonth(), 1)
      .toLocaleString('en-US', { month: 'long', year: 'numeric' })

    const cases: Array<{ period: string; from: string; label: string }> = [
      { period: 'this_month', from: thisMonthFrom, label: thisMonthLabel },
      { period: 'last_30', from: last30From, label: 'Last 30 days' },
      { period: 'last_90', from: last90From, label: 'Last 90 days' },
    ]

    for (const testCase of cases) {
      const data = await dashboardData(`?period=${testCase.period}`, `dashboard-${testCase.period}`)
      const period = data.period as JsonObject
      expect(period.from, `a ${testCase.period} resolution regression would return the wrong from date`).toBe(testCase.from)
      expect(period.to, `a ${testCase.period} resolution regression would return the wrong to date`).toBe(todayLocal)
      expect(period.label, `a ${testCase.period} label regression would return the wrong label`).toBe(testCase.label)
    }
  })

  it('accepts a valid custom period and rejects every malformed custom period with 400', async () => {
    const valid = await get('/api/dashboard?period=custom&from=2026-07-01&to=2026-07-31', 'dashboard-custom-valid', vimalCookie)
    expect(valid.status, 'a custom-period regression would reject a valid from/to range').toBe(200)
    const validData = (await readJson(valid)).data as JsonObject
    expect((validData.period as JsonObject).from, 'a custom-period regression would not echo the requested from').toBe('2026-07-01')
    expect((validData.period as JsonObject).to, 'a custom-period regression would not echo the requested to').toBe('2026-07-31')
    expect((validData.period as JsonObject).label, 'a custom-period label regression would change the MMM d – MMM d format').toBe('Jul 1 – Jul 31')

    const invalidCases: Array<{ scenario: string; query: string; label: string; messagePart: string }> = [
      { scenario: 'from after to', query: '?period=custom&from=2026-08-01&to=2026-07-01', label: 'dashboard-custom-reversed', messagePart: 'from must be on or before to' },
      { scenario: 'missing from', query: '?period=custom&to=2026-07-31', label: 'dashboard-custom-missing-from', messagePart: 'YYYY-MM-DD' },
      { scenario: 'missing to', query: '?period=custom&from=2026-07-01', label: 'dashboard-custom-missing-to', messagePart: 'YYYY-MM-DD' },
      { scenario: 'malformed dates', query: '?period=custom&from=2026/07/01&to=2026-07-31', label: 'dashboard-custom-malformed', messagePart: 'YYYY-MM-DD' },
    ]
    for (const testCase of invalidCases) {
      const response = await get(`/api/dashboard${testCase.query}`, testCase.label, vimalCookie)
      const body = await readJson(response)
      expect(response.status,
        `a custom-period validation regression would accept a ${testCase.scenario} request`).toBe(400)
      expect(errorMessage(body),
        `a custom-period validation regression would drop the human message for ${testCase.scenario}`).toContain(testCase.messagePart)
    }
  })

  it('rejects an unknown period enum value with 400', async () => {
    const response = await get('/api/dashboard?period=year_to_date', 'dashboard-unknown-period', vimalCookie)
    const body = await readJson(response)

    expect(response.status, 'a period-validation regression would accept an unknown period value').toBe(400)
    expect(errorMessage(body), 'a period-validation regression would drop the Invalid period message').toContain('Invalid period')
  })

  it('returns hand-derived period income and expense in paise for a custom window', async () => {
    const data = await dashboardData('?period=custom&from=2026-07-01&to=2026-07-31', 'dashboard-golden')

    // Income: 250000 (salary) + 150000 (freelance). Expense: 100000 + 50000 +
    // 20000 + 25000 + 15000 + 75000 + 30000 + 12500 + 18000.
    expect(data.periodIncome, 'an income aggregation regression would change the hand-derived paise sum').toBe(400000)
    expect(data.periodExpense, 'an expense aggregation regression would change the hand-derived paise sum').toBe(345500)

    // Transfer (60000) and interest (5000) must never count toward income/expense.
    expect(data.periodIncome, 'a transfer/interest leak regression would inflate period income').not.toBe(400000 + 60000 + 5000)
    expect(data.periodExpense, 'a transfer/interest leak regression would inflate period expense').not.toBe(345500 + 60000 + 5000)
  })

  it('orders topCategories by period expense descending with the Unknown fallback for a missing category', async () => {
    const data = await dashboardData('?period=custom&from=2026-07-01&to=2026-07-31', 'dashboard-top-categories')
    const topCategories = data.topCategories as TopCategory[]

    expect(topCategories.length, 'a topCategories regression would change the top-5 count').toBe(5)
    expect(topCategories.map((category) => category.categoryId),
      'a topCategories ordering regression would change the descending category order').toEqual([
      'c_groceries', 'c_dining', 'c_shopping', 'c_transport', 'c_unknown_cat',
    ])
    expect(topCategories[0], 'a topCategories regression would misreport the Groceries aggregate')
      .toMatchObject({ name: 'Groceries', color: '#C2410C', amount: 130000 })
    expect(topCategories[1], 'a topCategories regression would misreport the Food & Dining aggregate')
      .toMatchObject({ name: 'Food & Dining', color: '#D97706', amount: 82500 })
    expect(topCategories[2], 'a topCategories regression would misreport the Shopping aggregate')
      .toMatchObject({ name: 'Shopping', color: '#BE185D', amount: 75000 })
    expect(topCategories[3], 'a topCategories regression would misreport the Transport aggregate')
      .toMatchObject({ name: 'Transport', color: '#57534E', amount: 25000 })
    expect(topCategories[4], 'a missing-category fallback regression would not report Unknown with the default color')
      .toMatchObject({ name: 'Unknown', color: '#A8A29E', amount: 18000 })

    for (let index = 1; index < topCategories.length; index++) {
      expect(topCategories[index - 1].amount >= topCategories[index].amount,
        'a topCategories regression would break descending amount ordering').toBe(true)
    }
  })

  it('returns recentTransactions by global recency without any period filter', async () => {
    // The query window (07-20..07-25) excludes the 07-07 transaction. If
    // recentTransactions were period-filtered it would disappear.
    const data = await dashboardData('?period=custom&from=2026-07-20&to=2026-07-25', 'dashboard-recent')
    const recent = data.recentTransactions as RecentTxn[]

    expect(recent.length, 'a recentTransactions regression would exceed the documented 10-row cap').toBeLessThanOrEqual(10)
    expect(recent[0]?.date, 'a recentTransactions regression would not lead with the most recent transaction').toBe('2026-07-25')
    expect(recent.map((transaction) => transaction.date),
      'a recentTransactions regression would apply the query period to the recency list').toContain('2026-07-07')

    for (let index = 1; index < recent.length; index++) {
      const previous = recent[index - 1]
      const current = recent[index]
      expect(previous.date >= current.date,
        'a recentTransactions regression would break the date DESC ordering contract').toBe(true)
      if (previous.date === current.date) {
        expect(previous.createdAt >= current.createdAt,
          'a recentTransactions regression would break the createdAt DESC tie-break within the same date').toBe(true)
      }
    }

    const t09Index = recent.findIndex((transaction) => transaction.id === t09Id)
    const t12Index = recent.findIndex((transaction) => transaction.id === t12Id)
    expect(t12Index >= 0, 'a recentTransactions regression would drop the later-created 07-20 transaction').toBe(true)
    expect(t12Index < t09Index,
      'a recentTransactions tie-break regression would not prefer the later createdAt within the same date').toBe(true)
  })

  it('reports dynamic paise balances on the account cards', async () => {
    const data = await dashboardData('?period=custom&from=2026-07-01&to=2026-07-31', 'dashboard-account-cards')
    const accounts = data.accounts as AccountCard[]

    expect(accounts.length, 'an archived-account leak regression would include the archived Old Bank account').toBe(6)
    expect(accounts.map((account) => account.id),
      'an archived-account leak regression would list the archived Old Bank account').not.toContain(oldBankId)

    const balanceById = new Map(accounts.map((account) => [account.id, account.balance]))
    expect(balanceById.get(hdfcId), 'a balance-math regression would change the HDFC hand-derived balance').toBe(297000)
    expect(balanceById.get(cashId), 'a balance-math regression would change the Cash hand-derived balance').toBe(-5000)
    expect(balanceById.get(phonePeId), 'a balance-math regression would change the PhonePe hand-derived balance').toBe(-62500)
    expect(balanceById.get(iciciId), 'a credit-card balance regression would change the ICICI outstanding').toBe(20000)
    expect(balanceById.get(mfId), 'a balance-math regression would change the mutual fund balance').toBe(315000)
    expect(balanceById.get(jewelleryId), 'a balance-math regression would change the other-account balance').toBe(75000)

    const icici = accounts.find((account) => account.id === iciciId)
    expect(icici?.creditLimit, 'an account-card regression would drop the credit limit').toBe(500000)
  })

  it('sums liquidity across the correct account types and excludes other and archived accounts', async () => {
    const data = await dashboardData('?period=custom&from=2026-07-01&to=2026-07-31', 'dashboard-liquidity')

    // Cash: 297000 + (-5000) + (-62500). Credit: 500000 limit - 20000 outstanding.
    // Savings: 315000 (mutual fund balance).
    expect(data.cashLiquidity, 'a cash-liquidity regression would change the bank+cash+wallet paise sum').toBe(229500)
    expect(data.creditLiquidity, 'a credit-liquidity regression would change the available-credit paise sum').toBe(480000)
    expect(data.savingsLiquidity, 'a savings-liquidity regression would change the investment paise sum').toBe(315000)

    // The 'other' account (75000) and the archived account (50000) must stay excluded.
    expect(data.cashLiquidity, 'an other-account leak regression would include the Jewellery account in cash liquidity')
      .not.toBe(229500 + 75000)
    expect(data.cashLiquidity, 'an archived-account leak regression would include the Old Bank account in cash liquidity')
      .not.toBe(229500 + 50000)
  })

  it('reports cashFlow and dailySpends in rupees while period aggregates stay in paise', async () => {
    const data = await dashboardData('?period=custom&from=2026-07-01&to=2026-07-31', 'dashboard-mixed-units')
    const cashFlow = data.cashFlow as CashFlowEntry[]
    const dailySpends = data.dailySpends as DailySpend[]

    // Period aggregates are paise.
    expect(data.periodIncome, 'a paise-to-rupee regression would report periodIncome in rupees').toBe(400000)
    expect(data.periodExpense, 'a paise-to-rupee regression would report periodExpense in rupees').toBe(345500)

    // The last cash-flow month is anchored at the period end (July).
    const july = cashFlow[cashFlow.length - 1]
    expect(july, 'a cashFlow anchoring regression would not end on the period-end month').toBeDefined()
    expect(july.month, 'a cashFlow anchoring regression would change the anchor month').toBe('Jul')
    expect(july.income, 'a cashFlow regression would not divide paise income by 100 (250000+150000 paise → ₹4000)').toBe(4000)
    expect(july.expense, 'a cashFlow regression would not divide paise expense by 100 (345500 paise → ₹3455)').toBe(3455)

    // Daily spends are rupees too.
    const july2 = dailySpends.find((spend) => spend.date === '2026-07-02')
    expect(july2, 'a dailySpends regression would drop the 07-02 entry').toBeDefined()
    expect(july2?.amount, 'a dailySpends regression would not divide paise by 100 (100000 paise → ₹1000)').toBe(1000)

    const july20 = dailySpends.find((spend) => spend.date === '2026-07-20')
    expect(july20, 'a dailySpends regression would drop the 07-20 entry').toBeDefined()
    expect(july20?.amount, 'a dailySpends regression would change the 07-20 rupee total (75000+12500 paise → ₹875)').toBe(875)
  })

  it('exposes monthBudget in paise and flips monthBudgetSet after a budget is set', async () => {
    const before = await dashboardData('?period=custom&from=2026-07-01&to=2026-07-31', 'dashboard-budget-before')
    expect(before.monthBudget, 'an unset-budget regression would report a non-zero monthBudget before any setting exists').toBe(0)
    expect(before.monthBudgetSet, 'an unset-budget regression would report monthBudgetSet=true before any setting exists').toBe(false)

    const put = await putJson('/api/user-settings', { monthlyBudgetPaise: 500000 }, 'dashboard-budget-put', vimalCookie)
    const putBody = await readJson(put)
    expect(put.status, 'a user-settings regression would reject a valid budget write').toBe(200)
    expect(putBody.monthlyBudgetPaise, 'a user-settings regression would not echo the persisted budget').toBe(500000)

    const after = await dashboardData('?period=custom&from=2026-07-01&to=2026-07-31', 'dashboard-budget-after')
    expect(after.monthBudget, 'a dashboard budget regression would not read the persisted monthlyBudgetPaise').toBe(500000)
    expect(after.monthBudgetSet, 'a dashboard budget regression would keep monthBudgetSet false after a budget is set').toBe(true)
  })
})
