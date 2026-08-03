#!/usr/bin/env node
/**
 * scripts/generate-version-json.mjs
 *
 * Parses the latest entry from CHANGELOG.md and writes public/version.json
 * with the shape:
 *
 *   {
 *     "version": "v1.4.2",
 *     "date":    "2026-08-03",
 *     "bullets": ["- bullet one", "- bullet two", ...]
 *   }
 *
 * The OLD app shell fetches /version.json at runtime (always network, never
 * workbox-cached) to learn about the NEW version — the OLD shell can't know
 * what the NEW version is from its own baked-in APP_VERSION.
 *
 * Runs as `prebuild` and `predev` so the file is always up-to-date before
 * Nuxt copies public/ into .output/public/. Safe to re-run; idempotent.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const changelogPath = resolve(rootDir, 'CHANGELOG.md')
const publicDir = resolve(rootDir, 'public')
const outPath = resolve(publicDir, 'version.json')

if (!existsSync(changelogPath)) {
  console.error(`[generate-version-json] CHANGELOG.md not found at ${changelogPath}`)
  process.exit(1)
}

const md = readFileSync(changelogPath, 'utf-8')

// Match the first (latest) version section header.
const sectionRe = /^## \[(v[^\]]+)\] - (\d{4}-\d{2}-\d{2})/m
const headerMatch = sectionRe.exec(md)
if (!headerMatch) {
  console.error('[generate-version-json] No `## [vX.Y.Z] - YYYY-MM-DD` header found in CHANGELOG.md')
  process.exit(1)
}

const version = headerMatch[1]
const date = headerMatch[2]

// Find the end of this section: next `## [` or end of file.
const startIdx = headerMatch.index + headerMatch[0].length
const rest = md.slice(startIdx)
const nextSectionRe = /^## \[/m
const endMatch = nextSectionRe.exec(rest)
const sectionBody = endMatch ? rest.slice(0, endMatch.index) : rest

// Collect every `- …` bullet across all `### Subsection` blocks in this section.
// We keep the raw text (no markdown rendering) so the client can format it.
const bulletRe = /^- (.+)$/gm
const bullets = []
let m
while ((m = bulletRe.exec(sectionBody)) !== null) {
  bullets.push(m[1].trim())
}

if (bullets.length === 0) {
  console.warn(`[generate-version-json] No bullets found under ${version} — is the CHANGELOG entry empty?`)
}

if (!existsSync(publicDir)) mkdirSync(publicDir, { recursive: true })
const payload = { version, date, bullets }
writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8')

console.log(`[generate-version-json] ${outPath} -> ${version} (${date}, ${bullets.length} bullets)`)
