/**
 * Categories HTTP contract.
 *
 * Categories are seed-only data: there are no mutation endpoints. The
 * production breaks these tests protect against are a route, ordering, or
 * archive-filter regression in `GET /api/categories`, and an auth-gate
 * regression that would expose the shared category tree anonymously.
 */
import Database from 'better-sqlite3'
import { beforeAll, describe, expect, it } from 'vitest'
import { createNuxtTestHarness } from '~~/tests/helpers/nuxt-server'

const harness = await createNuxtTestHarness()
const ORIGIN = 'http://localhost:3000'
const VIMAL = 'u_vimal'
const VIMAL_PIN = '1234'

type JsonObject = Record<string, unknown>
type JsonArray = JsonObject[]

// Hand-derived from `server/db/seed.ts`: the exact (type ASC, sortOrder ASC,
// name ASC) projection of the 37 seeded categories.
const EXPECTED_ORDERED_IDS = [
  'c_housing', 'c_rent', 'c_maintenance', 'c_property_tax',
  'c_utilities', 'c_electricity', 'c_water', 'c_internet', 'c_mobile',
  'c_groceries',
  'c_dining', 'c_restaurants', 'c_delivery', 'c_coffee',
  'c_transport', 'c_fuel', 'c_cab', 'c_public',
  'c_shopping', 'c_health', 'c_entertainment', 'c_travel', 'c_education',
  'c_insurance', 'c_personal_care', 'c_gifts', 'c_misc',
  'c_loan_repayment', 'c_plants_gardening', 'c_hobbies',
  'c_salary', 'c_freelance', 'c_investment_returns', 'c_rental_income',
  'c_refunds', 'c_gifts_in', 'c_other_income',
]

const ROOT_ID = 'c_housing'
const HOUSING_CHILDREN = ['c_rent', 'c_maintenance', 'c_property_tax']

let vimalCookie = ''

function headers(ip: string, cookie = ''): HeadersInit {
  return {
    Cookie: cookie,
    Origin: ORIGIN,
    'x-forwarded-for': ip,
  }
}

function getCategories(cookie = '', label = 'categories-list'): Promise<Response> {
  return harness.fetch('/api/categories', { headers: headers(harness.clientIp(label), cookie) })
}

async function readJson(response: Response): Promise<JsonObject> {
  try {
    return await response.json() as JsonObject
  } catch {
    return {}
  }
}

describe('categories HTTP contract', () => {
  beforeAll(async () => {
    const vimalSetup = await harness.fetch('/api/auth/setup-pin', {
      method: 'POST',
      headers: {
        ...headers(harness.clientIp('categories-setup-vimal')),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ userId: VIMAL, pin: VIMAL_PIN }),
    })
    expect(vimalSetup.status, 'categories tests require the real first-time setup route to establish the PIN').toBe(200)
    vimalCookie = harness.cookieFromResponse(vimalSetup)
  })

  it('returns the full seeded category tree of 37 categories', async () => {
    const response = await getCategories(vimalCookie, 'categories-full')
    const body = await readJson(response)
    const categories = body.categories as JsonArray

    expect(response.status, 'a categories route regression would fail a valid authenticated GET').toBe(200)
    expect(categories.length, 'a seed-visibility regression would change the documented 37-category tree size').toBe(37)
    expect(categories.map((category) => category.id),
      'a seed-visibility regression would omit or duplicate a seeded category').toEqual(expect.arrayContaining(EXPECTED_ORDERED_IDS))
    for (const category of categories) {
      expect(category, 'a categories row regression would leak an unknown field').toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
          type: expect.stringMatching(/^(expense|income|both)$/),
          isEssential: expect.any(Boolean),
          sortOrder: expect.any(Number),
          archived: false,
        }),
      )
    }
  })

  it('orders categories by type ASC, then sortOrder ASC, then name ASC', async () => {
    const body = await readJson(await getCategories(vimalCookie, 'categories-order'))
    const categories = body.categories as JsonArray

    expect(categories.map((category) => category.id),
      'a category-ordering regression would break the exact (type, sortOrder, name) sequence').toEqual(EXPECTED_ORDERED_IDS)

    for (let index = 1; index < categories.length; index++) {
      const previous = categories[index - 1]
      const current = categories[index]
      const typeOrder = (previous.type as string).localeCompare(current.type as string)
      const sortOrderOrder = (previous.sortOrder as number) - (current.sortOrder as number)
      const nameOrder = (previous.name as string).localeCompare(current.name as string)
      expect(
        typeOrder < 0
        || (typeOrder === 0 && (sortOrderOrder < 0 || (sortOrderOrder === 0 && nameOrder <= 0))),
        'a category-ordering regression would break the type/sortOrder/name comparator between adjacent rows',
      ).toBe(true)
    }
  })

  it('exposes the parentId tree with root categories and children of a known parent', async () => {
    const body = await readJson(await getCategories(vimalCookie, 'categories-tree'))
    const categories = body.categories as JsonArray

    const roots = categories.filter((category) => category.parentId === null)
    expect(roots.length, 'a parentId tree regression would change the number of root categories (37 − 13 subcategories)').toBe(24)
    expect(roots.map((category) => category.id),
      'a parentId tree regression would not list the Housing root').toContain(ROOT_ID)

    const housing = categories.find((category) => category.id === ROOT_ID)
    expect(housing?.parentId, 'a parentId tree regression would give the Housing root a parent').toBeNull()

    const housingChildren = categories
      .filter((category) => category.parentId === ROOT_ID)
      .map((category) => category.id)
      .sort()
    expect(housingChildren, 'a parentId tree regression would change the children of Housing').toEqual([...HOUSING_CHILDREN].sort())

    const rent = categories.find((category) => category.id === 'c_rent')
    expect(rent?.parentId, 'a parentId tree regression would not attach Rent to Housing').toBe(ROOT_ID)
  })

  it('marks at least one category essential and at least one non-essential', async () => {
    const body = await readJson(await getCategories(vimalCookie, 'categories-essential'))
    const categories = body.categories as JsonArray

    const essential = categories.filter((category) => category.isEssential === true)
    const nonEssential = categories.filter((category) => category.isEssential === false)
    expect(essential.length, 'an isEssential seed regression would mark no category essential').toBeGreaterThan(0)
    expect(nonEssential.length, 'an isEssential seed regression would mark every category essential').toBeGreaterThan(0)
    expect(essential.map((category) => category.id),
      'an isEssential regression would not mark Housing essential').toContain(ROOT_ID)
    expect(nonEssential.map((category) => category.id),
      'an isEssential regression would not mark Food & Dining non-essential').toContain('c_dining')
  })

  it('filters archived categories out of the response', async () => {
    // Plant an archived category directly in the file-backed DB, the way a
    // legacy migration or future admin action could.
    const db = new Database(harness.dbPath)
    try {
      db.prepare(
        "INSERT INTO categories (id, name, icon, color, parent_id, type, is_essential, sort_order, archived, created_at) " +
          "VALUES ('c_archived_probe', 'Archived Probe', 'trash', '#000000', NULL, 'expense', 0, 999, 1, '2026-01-01T00:00:00.000Z')",
      ).run()
    } finally {
      db.close()
    }

    const body = await readJson(await getCategories(vimalCookie, 'categories-archived'))
    const categories = body.categories as JsonArray

    expect(categories.map((category) => category.id),
      'an archive-filter regression would leak the archived category into the response').not.toContain('c_archived_probe')
    expect(categories.every((category) => category.archived === false),
      'an archive-filter regression would return an archived row').toBe(true)
    expect(categories.length, 'an archive-filter regression would change the visible category count').toBe(37)
  })

  it('rejects an unauthenticated request with 401', async () => {
    const response = await getCategories('', 'categories-anonymous')
    const body = await readJson(response)

    expect(response.status, 'an auth-gate regression would expose the category tree anonymously').toBe(401)
    expect(body.message ?? body.statusMessage, 'an auth-gate regression would drop the Not authenticated message').toContain('Not authenticated')
  })
})
