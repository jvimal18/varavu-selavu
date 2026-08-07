/**
 * Backup & operations — the HTTP export API.
 *
 * Capability: `GET /api/export/json` is the authenticated public-route
 * snapshot (the JSON export the browser can download directly). Phase 3
 * aligned it with `scripts/export.mjs` — v1.2 / 6 tables — so the API and
 * the CLI produce interchangeable snapshots.
 *
 * Test strategy: real Nuxt server + real auth via the harness. Each test
 * authenticates (setup-pin), seeds a couple of rows, and asserts on the
 * snapshot shape and — for the parity test — compares the API output to
 * `scripts/export.mjs` run against the same DB.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { createNuxtTestHarness } from '~~/tests/helpers/nuxt-server'
import { runExport } from '~~/scripts/export.mjs'

const harness = await createNuxtTestHarness()
const ORIGIN = 'http://localhost:3000'

/** Seed category tree size (from server/db/seed.ts) — stable across tests. */
const SEED_CATEGORY_COUNT = 37

type JsonObject = Record<string, unknown>
type Snapshot = { version?: unknown; exportedAt?: unknown; [table: string]: unknown }

const TABLE_NAMES = ['users', 'accounts', 'categories', 'transactions', 'userSettings', 'sessions'] as const

/** Paise-bearing columns per table (the only content worth comparing exactly). */
const PAISE_COLUMNS: Partial<Record<(typeof TABLE_NAMES)[number], string[]>> = {
  accounts: ['opening_balance', 'credit_limit'],
  transactions: ['amount'],
  userSettings: ['monthly_budget_paise'],
}

function headers(cookie = '', ip: string): HeadersInit {
  return {
    Cookie: cookie,
    Origin: ORIGIN,
    'x-forwarded-for': ip,
  }
}

async function setupPin(label: string): Promise<string> {
  // First call: setup-pin (user has no PIN yet).
  const setupResponse = await harness.fetch('/api/auth/setup-pin', {
    method: 'POST',
    headers: { ...headers('', harness.clientIp(`export-${label}-setup`)), 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u_vimal', pin: '1234' }),
  })
  if (setupResponse.status === 200) {
    return harness.cookieFromResponse(setupResponse)
  }
  // Subsequent calls in the same file: the user already has a PIN, so
  // setup-pin would 400 ("Current PIN required"). Fall through to login.
  expect(setupResponse.status, 'PIN setup must either succeed or require login').toBe(400)
  const loginResponse = await harness.fetch('/api/auth/login', {
    method: 'POST',
    headers: { ...headers('', harness.clientIp(`export-${label}-login`)), 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u_vimal', pin: '1234' }),
  })
  expect(loginResponse.status, 'PIN login must succeed when the user already has a PIN').toBe(200)
  return harness.cookieFromResponse(loginResponse)
}

/** Insert a row directly (the auth flow already proves setup-pin writes). */
function insertRow(sql: string, params: (string | number | null)[]): void {
  const db = new Database(harness.dbPath)
  try {
    db.prepare(sql).run(...(params as never[]))
  } finally {
    db.close()
  }
}

/** Seed one account + one user_settings row + one transaction (all distinct ids). */
function seedRows(suffix: string): void {
  insertRow(
    'INSERT INTO accounts (id, name, type, opening_balance, credit_limit, currency, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [`a_${suffix}`, `Export ${suffix}`, 'bank', 2500000, 1000000, 'INR', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
  )
  insertRow(
    'INSERT OR REPLACE INTO user_settings (user_id, primary_account_id, monthly_budget_paise, updated_at) VALUES (?, ?, ?, ?)',
    ['u_vimal', `a_${suffix}`, 12000000, 1777593600000],
  )
  insertRow(
    'INSERT INTO transactions (id, type, amount, date, account_id, to_account_id, category_id, description, notes, spent_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?)',
    [`t_${suffix}`, 'expense', 124500, '2026-05-15', `a_${suffix}`, 'c_groceries', 'Monthly groceries', 'u_vimal', '2026-05-15T10:00:00.000Z', '2026-05-15T10:00:00.000Z'],
  )
}

/** camelCase Drizzle keys → snake_case DB column keys (as the CLI exports them). */
function toSnake(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()] = value
  }
  return out
}

function primaryKeyOf(row: Record<string, unknown>): string {
  const snake = toSnake(row)
  return String(snake.user_id ?? snake.id)
}

function expectContentEquivalent(httpJson: Snapshot, scriptJson: Snapshot): void {
  expect(Object.keys(httpJson).sort(), 'an export-parity regression would change the snapshot top-level field set').toEqual(Object.keys(scriptJson).sort())

  for (const table of TABLE_NAMES) {
    const httpRows = (httpJson[table] ?? []) as JsonObject[]
    const scriptRows = (scriptJson[table] ?? []) as JsonObject[]
    expect(httpRows, `an export-parity regression would drop or add the ${table} table in the HTTP export`).toHaveLength(scriptRows.length)

    const paiseCols = PAISE_COLUMNS[table]
    if (!paiseCols) continue
    const httpByKey = new Map(httpRows.map((row) => [primaryKeyOf(row), toSnake(row)]))
    for (const scriptRow of scriptRows) {
      const key = primaryKeyOf(scriptRow)
      const httpRow = httpByKey.get(key)
      expect(httpRow, `an export-parity regression would omit ${table} row ${key} from the HTTP export`).toBeDefined()
      for (const col of paiseCols) {
        expect(httpRow?.[col], `an export-parity regression would change ${table}.${col} (paise) between the API and CLI exports`).toBe(scriptRow[col])
      }
    }
  }
}

describe('GET /api/export/json', () => {
  it('returns a v1.2 snapshot with all 6 tables for an authenticated user', async () => {
    const cookie = await setupPin('v12')
    seedRows('v12')

    const response = await harness.fetch('/api/export/json', {
      headers: headers(cookie, harness.clientIp('export-v12')),
    })
    const body = await response.json() as JsonObject & {
      version?: string
      users?: JsonObject[]
      accounts?: JsonObject[]
      categories?: JsonObject[]
      transactions?: JsonObject[]
      userSettings?: JsonObject[]
      sessions?: JsonObject[]
    }

    expect(response.status, 'an authenticated export regression would reject a valid session').toBe(200)
    expect(body.version, 'the HTTP export must stay aligned with scripts/export.mjs at v1.2').toBe('1.2')
    expect(body.users, 'an export regression would drop the users table').toHaveLength(2)
    expect(body.accounts, 'an export regression would drop the accounts we inserted').toContainEqual(expect.objectContaining({ id: 'a_v12', openingBalance: 2500000 }))
    expect(body.categories, 'an export regression would drop the seeded category tree').toHaveLength(SEED_CATEGORY_COUNT)
    expect(body.transactions, 'an export regression would drop the transactions we inserted').toContainEqual(expect.objectContaining({ id: 't_v12', amount: 124500 }))
    expect(body.userSettings, 'an export regression would drop the user_settings table').toContainEqual(expect.objectContaining({ userId: 'u_vimal', monthlyBudgetPaise: 12000000 }))
    expect(body.sessions, 'an export regression would drop the sessions table').toHaveLength(1)
    expect(body.sessions?.[0], 'an export regression would reference the wrong session owner').toMatchObject({ userId: 'u_vimal' })
    expect(body.exportedAt, 'an export regression would omit the exportedAt timestamp').toEqual(expect.any(String))
  })

  it('rejects an unauthenticated request with 401', async () => {
    const response = await harness.fetch('/api/export/json', {
      headers: headers('', harness.clientIp('export-anon')),
    })

    expect(response.status, 'an auth-gate regression would let an anonymous request download the full snapshot').toBe(401)
  })

  it('is content-equivalent to scripts/export.mjs for the same DB', async () => {
    const cookie = await setupPin('parity')
    seedRows('parity')

    const httpResponse = await harness.fetch('/api/export/json', {
      headers: headers(cookie, harness.clientIp('export-parity-http')),
    })
    const httpJson = await httpResponse.json() as Snapshot

    const outPath = join(harness.tempDir, 'parity-snapshot.json')
    runExport({ dbPath: harness.dbPath, outPath })
    const scriptJson = JSON.parse(readFileSync(outPath, 'utf8')) as Snapshot

    expect(httpResponse.status, 'the parity HTTP export must succeed').toBe(200)
    expect(httpJson.version, 'the API and CLI exports must agree on the snapshot version').toBe(scriptJson.version)
    // exportedAt differs by construction; session expiry/last-seen may tick
    // between the two reads, so the comparison below is structural (tables,
    // row counts, paise) and never compares those timestamps.
    expectContentEquivalent(httpJson, scriptJson)
  })
})
