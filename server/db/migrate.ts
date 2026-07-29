/**
 * Standalone migration script — runs all SQL files in db/migrations/ in order.
 * Used by `pnpm db:migrate` and during deployment.
 */
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'

const dbPath = process.env.NUXT_DB_PATH || './data/dev.db'
const absPath = resolve(process.cwd(), dbPath)
const dir = dirname(absPath)
if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

const sqlite = new Database(absPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

// We import drizzle here so the connection is fresh
import { drizzle } from 'drizzle-orm/better-sqlite3'
const db = drizzle(sqlite)

console.log(`[migrate] running migrations against ${absPath}`)
migrate(db, { migrationsFolder: './db/migrations' })
console.log('[migrate] done')
sqlite.close()
