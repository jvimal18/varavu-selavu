import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as schema from './schema'

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null
let _sqlite: Database.Database | null = null

function resolveDbPath(): string {
  const config = useRuntimeConfig()
  const raw = config.dbPath as string
  return resolve(process.cwd(), raw)
}

export function useDb() {
  if (_db) return _db

  const dbPath = resolveDbPath()
  const dir = dirname(dbPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  _sqlite = new Database(dbPath)
  // WAL mode for crash safety on Pi
  _sqlite.pragma('journal_mode = WAL')
  _sqlite.pragma('foreign_keys = ON')
  _sqlite.pragma('synchronous = NORMAL')

  _db = drizzle(_sqlite, { schema })
  return _db
}

export function getSqlite(): Database.Database {
  if (!_sqlite) useDb()
  return _sqlite!
}

export { schema }
