import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import Database from 'better-sqlite3'
import { afterAll } from 'vitest'
import { fetch as nuxtFetch, setup } from '@nuxt/test-utils/e2e'

const execFileAsync = promisify(execFile)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const managedEnvironmentKeys = [
  'NODE_ENV',
  'NUXT_DB_PATH',
  'NUXT_ALLOWED_ORIGINS',
  'NUXT_SESSION_SECRET',
  'NUXT_CSP_ENFORCE',
  'NUXT_TEST_RUNTIME_PROBE',
] as const

type ManagedEnvironmentKey = typeof managedEnvironmentKeys[number]
export type SqliteParameter = string | number | bigint | Buffer | null

export interface NuxtHarnessOptions {
  rootDir?: string
  sessionSecret?: string
  allowedOrigins?: string
  /**
   * Maps to `NUXT_CSP_ENFORCE`. Default `false` keeps the security-headers
   * middleware in `Content-Security-Policy-Report-Only` mode. Set `true` to
   * exercise the enforcing `Content-Security-Policy` header.
   */
  cspEnforce?: boolean
}

export interface NuxtTestHarness {
  readonly rootDir: string
  readonly tempDir: string
  readonly dbPath: string
  /** Raw Response pass-through; callers own headers and body serialization. */
  fetch(path: string, init?: RequestInit): Promise<Response>
  /** Explicit alias for tests that need to emphasize raw status/headers/body. */
  rawFetch(path: string, init?: RequestInit): Promise<Response>
  /** Return the raw token from a real vs_session Set-Cookie response header. */
  sessionTokenFromResponse(response: Response): string
  /** Return `vs_session=<real-token>` for a subsequent Cookie request header. */
  cookieFromResponse(response: Response): string
  /** Return a stable unique test IP; repeated calls with a label reuse it. */
  clientIp(label?: string): string
  /** Query the actual file-backed DB after a server request. */
  inspectDb<T = Record<string, unknown>>(sql: string, params?: readonly SqliteParameter[]): T[]
  inspectDbOne<T = Record<string, unknown>>(
    sql: string,
    params?: readonly SqliteParameter[],
  ): T | undefined
  inspectPragma(name: string): unknown
  /** Useful for proving a test did not accidentally select the dev database. */
  isFileBacked(): boolean
}

/**
 * A harness call allocates its DB and environment before `@nuxt/test-utils`
 * loads/builds Nuxt. `setup` owns server startup/stop; this helper's afterAll
 * cleanup runs after it. Vitest file parallelism is disabled because Nuxt's
 * runtime environment and the app DB singleton are process-global.
 */
export async function createNuxtTestHarness(options: NuxtHarnessOptions = {}): Promise<NuxtTestHarness> {
  const rootDir = resolve(options.rootDir ?? repoRoot)
  const tempDir = await mkdtemp(join(process.env.TMPDIR || process.env.TMP || '/tmp', 'varavu-nuxt-test-'))
  const dbPath = join(tempDir, 'runtime.db')
  const sessionSecret = options.sessionSecret ?? 'phase-2-test-session-secret'
  const allowedOrigins = options.allowedOrigins ?? 'http://localhost:3000'
  const cspEnforce = options.cspEnforce ?? false
  const testEnvironment: Record<string, string> = {
    NODE_ENV: 'test',
    NUXT_DB_PATH: dbPath,
    NUXT_ALLOWED_ORIGINS: allowedOrigins,
    NUXT_SESSION_SECRET: sessionSecret,
    NUXT_CSP_ENFORCE: cspEnforce ? 'true' : 'false',
    // Enable the guarded test-only runtime pragma probe
    // (`server/api/__test__/runtime-pragmas.get.ts`). The route returns 404
    // unless this flag is set, so it never exposes anything in production.
    NUXT_TEST_RUNTIME_PROBE: '1',
  }
  const previousEnvironment = new Map<ManagedEnvironmentKey, string | undefined>()
  for (const key of managedEnvironmentKeys) {
    previousEnvironment.set(key, process.env[key])
    process.env[key] = testEnvironment[key]
  }

  let cleaned = false
  const cleanup = async (): Promise<void> => {
    if (cleaned) return
    cleaned = true

    for (const key of managedEnvironmentKeys) {
      const previous = previousEnvironment.get(key)
      if (previous === undefined) delete process.env[key]
      else process.env[key] = previous
    }
    await rm(tempDir, { recursive: true, force: true })
  }

  try {
    // Run the application-owned scripts. No schema SQL is copied into tests.
    await runDatabaseScript('server/db/migrate.ts', testEnvironment)
    await runDatabaseScript('server/db/seed.ts', testEnvironment)

    // This is intentionally the e2e setup boundary, not a direct Nitro handler call.
    // The Nuxt build is produced once by tests/helpers/global-setup.ts before any
    // test file runs. This harness only starts a server from the prebuilt .output/
    // — 15 serial builds → 1 build, dropping runtime from ~17m to ~5-7m.
    // `build: false` also changes @nuxt/test-utils' default nitro output dir to a
    // random `.nuxt/test/<id>/output` that would never be built, so the real
    // prebuilt output dir is pinned explicitly below.
    await setup({
      rootDir,
      runner: 'vitest',
      server: true,
      build: false, // <-- changed: use the prebuilt .output/ from globalSetup
      nuxtConfig: {
        nitro: {
          output: {
            dir: resolve(rootDir, '.output'),
          },
        },
      },
      env: testEnvironment,
    })
  } catch (error) {
    await cleanup()
    throw error
  }

  // @nuxt/test-utils registers its server stop hook inside setup() first.
  afterAll(cleanup)

  const clientIps = new Map<string, string>()
  const harnessId = nextHarnessId++
  let nextIp = 1

  const rawFetch = async (path: string, init?: RequestInit): Promise<Response> => nuxtFetch(path, init)
  const inspectDb = <T = Record<string, unknown>>(
    sql: string,
    params: readonly SqliteParameter[] = [],
  ): T[] => {
    const db = new Database(dbPath, { readonly: true })
    try {
      return db.prepare(sql).all(...(params as never[])) as T[]
    } finally {
      db.close()
    }
  }
  const inspectDbOne = <T = Record<string, unknown>>(
    sql: string,
    params: readonly SqliteParameter[] = [],
  ): T | undefined => {
    const db = new Database(dbPath, { readonly: true })
    try {
      return db.prepare(sql).get(...(params as never[])) as T | undefined
    } finally {
      db.close()
    }
  }

  return {
    rootDir,
    tempDir,
    dbPath,
    fetch: rawFetch,
    rawFetch,
    sessionTokenFromResponse,
    cookieFromResponse,
    clientIp(label = 'default') {
      const existing = clientIps.get(label)
      if (existing) return existing

      // 198.18.0.0/15 is reserved for benchmark/test networks. The harness
      // and label counters make addresses deterministic and collision-free in
      // this Vitest process without touching production rate-limit state.
      const addressNumber = harnessId * 256 + nextIp++
      const secondOctet = 18 + Math.floor(addressNumber / (256 * 256))
      const remainder = addressNumber % (256 * 256)
      const ip = `198.${secondOctet}.${Math.floor(remainder / 256)}.${remainder % 256}`
      clientIps.set(label, ip)
      return ip
    },
    inspectDb,
    inspectDbOne,
    inspectPragma(name: string) {
      const db = new Database(dbPath, { readonly: true })
      try {
        return db.pragma(name, { simple: true })
      } finally {
        db.close()
      }
    },
    isFileBacked() {
      return dbPath !== ':memory:' && isAbsolute(dbPath) && existsSync(dbPath)
    },
  }
}

let nextHarnessId = 0

async function runDatabaseScript(script: string, environment: Record<string, string>): Promise<void> {
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  await execFileAsync(pnpm, ['exec', 'tsx', script], {
    cwd: repoRoot,
    env: { ...process.env, ...environment },
    maxBuffer: 2 * 1024 * 1024,
  })
}

function setCookieHeaders(headers: Headers): string[] {
  const headerWithGetSetCookie = headers as Headers & { getSetCookie?: () => string[] }
  const values = headerWithGetSetCookie.getSetCookie?.()
  if (values?.length) return values

  const combined = headers.get('set-cookie')
  return combined ? [combined] : []
}

function sessionTokenFromResponse(response: Response): string {
  for (const header of setCookieHeaders(response.headers)) {
    const match = header.match(/(?:^|,\s*)vs_session=([^;,\s]+)/)
    if (match?.[1]) return match[1]
  }
  throw new Error('Response did not contain a vs_session Set-Cookie header')
}

function cookieFromResponse(response: Response): string {
  return `vs_session=${sessionTokenFromResponse(response)}`
}
