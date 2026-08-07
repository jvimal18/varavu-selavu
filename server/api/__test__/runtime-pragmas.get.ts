/**
 * Test-only runtime probe. Registered only when the harness sets
 * `NUXT_TEST_RUNTIME_PROBE=1` in the test environment; throws 404 otherwise,
 * so this file does not expose a production diagnostics endpoint.
 *
 * Returns the *live* `server/db/client.ts` singleton's pragmas and database
 * list. Used by `tests/features/migrations/runtime-pragmas.test.ts` to prove
 * that the real `useDb()` initialization sets WAL, foreign keys, and
 * synchronous=NORMAL on the same connection that serves real API requests.
 */
import { createError, defineEventHandler } from 'h3'
import { getSqlite } from '~~/server/db/client'

type DatabaseListRow = {
  seq: number
  name: string
  file: string
}

export default defineEventHandler(() => {
  if (process.env.NUXT_TEST_RUNTIME_PROBE !== '1') {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  const sqlite = getSqlite()
  return {
    journalMode: sqlite.pragma('journal_mode', { simple: true }),
    foreignKeys: sqlite.pragma('foreign_keys', { simple: true }),
    synchronous: sqlite.pragma('synchronous', { simple: true }),
    databaseList: sqlite.prepare('PRAGMA database_list').all() as DatabaseListRow[],
  }
})
