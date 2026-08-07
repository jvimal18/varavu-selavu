import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNuxtTestHarness } from '~~/tests/helpers/nuxt-server'

const appRoot = resolve(process.cwd())
const harness = await createNuxtTestHarness()
const ORIGIN = 'http://localhost:3000'

type RuntimePragmaResponse = {
  journalMode: string
  foreignKeys: number
  synchronous: number
  databaseList: Array<{ seq: number; name: string; file: string }>
}

describe('runtime SQLite initialization', () => {
  it('proves the live authenticated server connection uses the isolated SQLite pragmas', async () => {
    const setup = await harness.rawFetch('/api/auth/setup-pin', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Origin: ORIGIN,
        'x-forwarded-for': harness.clientIp('runtime-pragmas-setup'),
      },
      body: JSON.stringify({ userId: 'u_vimal', pin: '1234' }),
    })
    expect(setup.status, 'real setup-PIN HTTP must succeed before the live probe can authenticate').toBe(200)

    const login = await harness.rawFetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Origin: ORIGIN,
        'x-forwarded-for': harness.clientIp('runtime-pragmas-login'),
      },
      body: JSON.stringify({ userId: 'u_vimal', pin: '1234' }),
    })
    expect(login.status, 'real login HTTP must return a session cookie for the protected probe route').toBe(200)
    const cookie = harness.cookieFromResponse(login)

    const response = await harness.rawFetch('/api/__test__/runtime-pragmas', {
      headers: { Cookie: cookie },
    })
    expect(response.status, 'the guarded probe route must pass through the real auth gate and server when enabled by the harness').toBe(200)
    const values = await response.json() as RuntimePragmaResponse

    expect(
      values.journalMode,
      'deleting useDb() journal_mode initialization would make this live server-process probe fail',
    ).toBe('wal')
    expect(
      values.foreignKeys,
      'deleting useDb() foreign_keys initialization would make this live server-process probe fail',
    ).toBe(1)
    // SQLite reports synchronous=NORMAL as numeric 1; FULL is 2 and OFF is 0.
    expect(
      values.synchronous,
      'deleting useDb() synchronous=NORMAL initialization would make this live server-process probe fail',
    ).toBe(1)

    const resolvedFiles = values.databaseList.map((entry) => resolve(entry.file))
    const databaseFiles = values.databaseList.map((entry) => entry.file)
    expect(databaseFiles, 'the live database_list must not report :memory:').not.toContain(':memory:')
    expect(
      databaseFiles,
      'the live database_list must not report the application data/dev.db',
    ).not.toContain(resolve(appRoot, 'data/dev.db'))
    expect(
      resolvedFiles,
      'the live server connection must expose exactly the harness DB, never :memory: or data/dev.db',
    ).toEqual([resolve(harness.dbPath)])
    expect(
      resolvedFiles[0],
      'the live server must not inspect a separate read-only connection or the shared development DB',
    ).not.toBe(resolve(appRoot, 'data/dev.db'))
  })
})
