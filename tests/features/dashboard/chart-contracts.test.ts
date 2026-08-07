/**
 * Chart-data contracts for the dashboard (cashFlow + dailySpends).
 *
 * These protect the two chart payloads the dashboard serves to ECharts: the
 * 6-month cash-flow array anchored at the period end, and the zero-filled
 * daily-spend series. Units are rupees here (the endpoint divides paise by
 * 100 for these two series only), and day bucketing is local-time — a UTC
 * drift would silently move a local-midnight transaction onto the wrong day.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { createNuxtTestHarness } from '~~/tests/helpers/nuxt-server'

const harness = await createNuxtTestHarness()
const ORIGIN = 'http://localhost:3000'
const VIMAL = 'u_vimal'
const VIMAL_PIN = '1234'

type JsonObject = Record<string, unknown>

interface CashFlowEntry { month: string; income: number; expense: number }
interface DailySpend { date: string; label: string; amount: number }

/** Local YYYY-MM-DD — deliberately NOT `toISOString().slice(0, 10)`. */
function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The 7-day daily-spend window is anchored at the real local today so the
// zero-fill and local-bucketing contracts hold on whatever day CI runs.
const now = new Date()
const todayLocal = localISO(now)
const todayUtc = now.toISOString().slice(0, 10)
const twoDaysAgoLocal = localISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2))
const sixDaysAgoLocal = localISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6))

let vimalCookie = ''
let localBankId = ''

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

async function readJson(response: Response): Promise<JsonObject> {
  try {
    return await response.json() as JsonObject
  } catch {
    return {}
  }
}

async function createTransaction(body: JsonObject, label: string): Promise<void> {
  const response = await postJson('/api/transactions', body, label, vimalCookie)
  const responseBody = await readJson(response)
  expect(response.status, `${label}: the real transaction-create route must accept the seeded transaction body`).toBe(200)
  expect(responseBody.transaction, `${label}: a transaction-create regression would omit the created row`).toBeDefined()
}

/** Authenticated GET of the dashboard data envelope (assumes 200). */
async function dashboardData(query: string, label: string): Promise<JsonObject> {
  const response = await get(`/api/dashboard${query}`, label, vimalCookie)
  expect(response.status, `${label}: a dashboard route regression would fail a valid authenticated request`).toBe(200)
  const body = await readJson(response)
  return body.data as JsonObject
}

beforeAll(async () => {
  const vimalSetup = await postJson('/api/auth/setup-pin', { userId: VIMAL, pin: VIMAL_PIN }, 'chart-setup-vimal')
  expect(vimalSetup.status, 'chart tests require the real first-time setup route for Vimal').toBe(200)
  vimalCookie = harness.cookieFromResponse(vimalSetup)

  const accountResponse = await postJson('/api/accounts', { name: 'Local Bank', type: 'bank', openingBalance: 100000 }, 'chart-account', vimalCookie)
  const accountBody = await readJson(accountResponse)
  expect(accountResponse.status, 'chart tests require the real account-create route').toBe(200)
  localBankId = String((accountBody.account as JsonObject).id)

  // Cash-flow seed (anchored window: 2026-05-01..2026-06-15).
  await createTransaction({ type: 'expense', amount: 120000, date: '2026-06-10', accountId: localBankId, categoryId: 'c_groceries' }, 'chart-txn-jun-expense')
  await createTransaction({ type: 'income', amount: 300000, date: '2026-06-05', accountId: localBankId, categoryId: 'c_salary' }, 'chart-txn-jun-income')
  await createTransaction({ type: 'expense', amount: 45000, date: '2026-01-20', accountId: localBankId, categoryId: 'c_dining' }, 'chart-txn-jan-expense')

  // Daily-spend seed (window: today-6 .. today) — one on local today, one two days back.
  await createTransaction({ type: 'expense', amount: 75000, date: todayLocal, accountId: localBankId, categoryId: 'c_groceries' }, 'chart-txn-today-expense')
  await createTransaction({ type: 'expense', amount: 25000, date: twoDaysAgoLocal, accountId: localBankId, categoryId: 'c_dining' }, 'chart-txn-two-days-ago')
})

describe('dashboard chart contracts', () => {
  it('returns exactly 6 cash-flow months anchored at the period end', async () => {
    const data = await dashboardData('?period=custom&from=2026-05-01&to=2026-06-15', 'chart-cashflow-anchor')
    const cashFlow = data.cashFlow as CashFlowEntry[]

    expect(cashFlow.length, 'a cashFlow regression would change the 6-month window').toBe(6)
    expect(cashFlow[0]?.month, 'a cashFlow regression would not start 5 months before the anchor').toBe('Jan')
    expect(cashFlow[5]?.month, 'a cashFlow regression would not end on the period-end month').toBe('Jun')
  })

  it('reports cash-flow months as short labels with non-negative integer rupees', async () => {
    const data = await dashboardData('?period=custom&from=2026-05-01&to=2026-06-15', 'chart-cashflow-values')
    const cashFlow = data.cashFlow as CashFlowEntry[]

    expect(cashFlow.map((entry) => entry.month),
      'a cashFlow month-format regression would change the month labels').toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'])
    for (const entry of cashFlow) {
      expect(Number.isInteger(entry.income) && entry.income >= 0,
        'a cashFlow regression would report a non-integer or negative rupee income').toBe(true)
      expect(Number.isInteger(entry.expense) && entry.expense >= 0,
        'a cashFlow regression would report a non-integer or negative rupee expense').toBe(true)
    }
    expect(cashFlow[0], 'a cashFlow regression would misreport the January expense (45000 paise → ₹450)')
      .toMatchObject({ income: 0, expense: 450 })
    expect(cashFlow[5], 'a cashFlow regression would misreport the June totals (300000/120000 paise → ₹3000/₹1200)')
      .toMatchObject({ income: 3000, expense: 1200 })
  })

  it('zero-fills every day of a 7-day period with date and label fields', async () => {
    const data = await dashboardData(`?period=custom&from=${sixDaysAgoLocal}&to=${todayLocal}`, 'chart-daily-zero-fill')
    const dailySpends = data.dailySpends as DailySpend[]

    expect(dailySpends.length, 'a dailySpends regression would not zero-fill every day in the range').toBe(7)
    for (const spend of dailySpends) {
      expect(spend.date, 'a dailySpends regression would emit a non YYYY-MM-DD date').toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(spend.label, 'a dailySpends regression would emit a non MMM d label').toMatch(/^[A-Z][a-z]{2} \d{1,2}$/)
    }

    const zeroDays = dailySpends.filter((spend) => spend.amount === 0)
    expect(zeroDays.length, 'a dailySpends regression would not keep empty days at zero rupees').toBe(5)

    const todayEntry = dailySpends.find((spend) => spend.date === todayLocal)
    expect(todayEntry, 'a dailySpends regression would drop the local-today entry').toBeDefined()
    expect(todayEntry?.amount, 'a dailySpends regression would misreport today\'s expense (75000 paise → ₹750)').toBe(750)

    const twoDaysEntry = dailySpends.find((spend) => spend.date === twoDaysAgoLocal)
    expect(twoDaysEntry, 'a dailySpends regression would drop the two-days-ago entry').toBeDefined()
    expect(twoDaysEntry?.amount, 'a dailySpends regression would misreport the two-days-ago expense (25000 paise → ₹250)').toBe(250)
  })

  it('buckets daily spends on the local date, never the UTC date', async () => {
    const data = await dashboardData(`?period=custom&from=${sixDaysAgoLocal}&to=${todayLocal}`, 'chart-daily-local-date')
    const dailySpends = data.dailySpends as DailySpend[]

    const localEntry = dailySpends.find((spend) => spend.date === todayLocal)
    const utcEntry = dailySpends.find((spend) => spend.date === todayUtc)

    expect(localEntry, 'a local-bucketing regression would lose the local-midnight transaction from its local date').toBeDefined()
    expect(localEntry?.amount, 'a local-bucketing regression would misreport the local-day expense').toBe(750)

    // On a UTC machine the two dates coincide; only assert the negative case
    // when they differ (that is precisely when the UTC drift is observable).
    if (todayUtc !== todayLocal) {
      expect(utcEntry?.amount ?? 0, 'a UTC-bucketing regression would move a local-midnight transaction onto the UTC date').not.toBe(750)
    }
  })

  it('orders daily spends chronologically ascending', async () => {
    const data = await dashboardData(`?period=custom&from=${sixDaysAgoLocal}&to=${todayLocal}`, 'chart-daily-ordering')
    const dailySpends = data.dailySpends as DailySpend[]

    expect(dailySpends.length, 'a dailySpends ordering test precondition failed').toBe(7)
    for (let index = 1; index < dailySpends.length; index++) {
      expect(dailySpends[index - 1].date < dailySpends[index].date,
        'a dailySpends regression would break chronological ascending order').toBe(true)
    }
  })
})
