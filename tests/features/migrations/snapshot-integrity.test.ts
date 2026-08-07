/**
 * Migrations — folder structural integrity.
 *
 * Capability: every SQL migration has a matching snapshot file
 * (and no orphan snapshots are left behind). Cheap, file-system
 * only; would have caught the PR 4 + PR 5 missing-snapshot bug
 * at the CI layer.
 *
 * Companion files:
 *   fresh-schema.test.ts          - migrator on a fresh DB
 *   historical-upgrade.test.ts    - migrator on an existing DB
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

describe('migrations folder integrity', () => {
  it('every SQL migration has a matching snapshot file', () => {
    const migrationsDir = './db/migrations'
    const metaDir = './db/migrations/meta'
    if (!existsSync(migrationsDir)) {
      throw new Error(`migrations dir missing: ${migrationsDir}`)
    }
    const sqlFiles = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f))
    expect(sqlFiles.length).toBeGreaterThan(0)

    const missing: string[] = []
    for (const sql of sqlFiles) {
      const idx = sql.split('_')[0] // "0002"
      const snapshot = join(metaDir, `${idx}_snapshot.json`)
      if (!existsSync(snapshot)) {
        missing.push(`${sql} (expected ${idx}_snapshot.json)`)
      }
    }
    expect(missing, missing.join('\n')).toEqual([])
  })

  it('every snapshot in meta/ has a matching SQL migration', () => {
    // Catches the reverse bug: orphan snapshots left behind after a SQL file
    // is deleted. The migrator won't apply orphan snapshots (the journal
    // is the source of truth for what runs), but they bloat the repo.
    const migrationsDir = './db/migrations'
    const metaDir = './db/migrations/meta'
    const sqlFiles = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f))
    const sqlIdxs = new Set(sqlFiles.map((f) => f.split('_')[0]))

    const snapshotFiles = readdirSync(metaDir).filter((f) => /^\d{4}_snapshot\.json$/.test(f))
    const orphan: string[] = []
    for (const snap of snapshotFiles) {
      const idx = snap.split('_')[0]
      if (!sqlIdxs.has(idx)) {
        orphan.push(snap)
      }
    }
    expect(orphan, orphan.join('\n')).toEqual([])
  })
})
