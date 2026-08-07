/**
 * PWA — version metadata generation.
 *
 * Capability: `scripts/generate-version-json.mjs` parses the FIRST
 * `## [vX.Y.Z] - YYYY-MM-DD` section of CHANGELOG.md and writes
 * `public/version.json` as `{ version, date, bullets }`. The OLD app shell
 * fetches that file at runtime (never precached) to learn about the NEW
 * version — so a wrong shape, a wrong section, or a silent empty file each
 * break the update prompt in a distinct way.
 *
 * The script hardcodes repo-root paths (`CHANGELOG.md` in, `public/version.json`
 * out), so these tests swap the real files for the frozen fixture and restore
 * the original bytes after each test. This file runs alone (fileParallelism
 * is off repo-wide) and never leaves a modified repo file behind.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const changelogPath = join(repoRoot, 'CHANGELOG.md')
const versionJsonPath = join(repoRoot, 'public', 'version.json')
const fixturePath = join(repoRoot, 'tests', 'fixtures', 'changelog', 'representative-release.md')

/** The committed CHANGELOG.md + version.json, captured before any swap. */
let originalChangelog: string | null = null
let originalVersionJson: string | null = null

beforeAll(() => {
  originalChangelog = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : null
  originalVersionJson = existsSync(versionJsonPath) ? readFileSync(versionJsonPath, 'utf8') : null
})

afterEach(() => restoreRepoFiles())
afterAll(() => restoreRepoFiles())

function restoreRepoFiles(): void {
  if (originalChangelog !== null) writeFileSync(changelogPath, originalChangelog, 'utf8')
  else if (existsSync(changelogPath)) rmSync(changelogPath)
  if (originalVersionJson !== null) writeFileSync(versionJsonPath, originalVersionJson, 'utf8')
  else if (existsSync(versionJsonPath)) rmSync(versionJsonPath)
}

/** Point the generator at a different CHANGELOG by swapping the real file. */
function swapChangelog(content: string): void {
  writeFileSync(changelogPath, content, 'utf8')
}

function runGenerator(): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('node', ['scripts/generate-version-json.mjs'], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => resolvePromise({ code: code ?? -1, stdout, stderr }))
  })
}

function readVersionJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(versionJsonPath, 'utf8')) as Record<string, unknown>
}

const EXPECTED_BULLETS = [
  'Widget grid on the dashboard',
  'Export parity between the API and the CLI snapshot',
  'Versioned changelog fixture support',
  'Silent user_settings loss in old JSON snapshots',
  'Stray trailing decimal on hero rupee tiles',
  'JSON snapshot version bumped to 1.2',
]

describe('generate-version-json.mjs', () => {
  it('writes public/version.json with { version, date, bullets } from the first release section', async () => {
    swapChangelog(readFileSync(fixturePath, 'utf8'))

    const result = await runGenerator()

    expect(result.code, 'a version-json generation regression would exit non-zero').toBe(0)
    expect(readVersionJson(), 'a version-json shape regression would change the { version, date, bullets } contract').toEqual({
      version: 'v3.14.1',
      date: '2026-07-15',
      bullets: EXPECTED_BULLETS,
    })
  })

  it('collects the union of bullets across every ### subsection of the first release section only', async () => {
    swapChangelog(readFileSync(fixturePath, 'utf8'))

    await runGenerator()
    const payload = readVersionJson()

    expect(payload.bullets, 'a bullet-collection regression would drop bullets from one of the ### subsections').toEqual(EXPECTED_BULLETS)
    expect(payload.bullets, 'a section-boundary regression would leak bullets from an older release section').not.toContain('Old release bullet that must never leak into the first section')
    expect(payload.version, 'a section-boundary regression would parse the wrong release header').toBe('v3.14.1')
  })

  it('exits non-zero and leaves version.json untouched when the changelog has no version header', async () => {
    swapChangelog('# Changelog\n\nNo release sections here.\n')

    const result = await runGenerator()

    expect(result.code, 'an invalid-changelog regression would succeed without a ## [v...] header').toBe(1)
    expect(result.stderr, 'an invalid-changelog regression would drop the actionable error message').toContain('No `## [v')
    expect(readFileSync(versionJsonPath, 'utf8'), 'a failed generation must not overwrite the previous version.json').toBe(originalVersionJson)
  })
})
