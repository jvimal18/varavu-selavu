/**
 * Vitest globalSetup — builds the Nuxt app exactly once before any test file
 * runs, and serves every HTTP test harness from that single `.output/`.
 *
 * Before this file existed, `tests/helpers/nuxt-server.ts` called
 * `setup({ build: true })`, forcing a full `nuxt build` per harness
 * (15 serial builds ≈ 14m of the ~17m suite). Collapsing to one build brings
 * the suite under the 15m CI job timeout in
 * `.github/workflows/build-and-test.yml`.
 *
 * The build is cached on an mtime basis: when `.output/server/index.mjs` is
 * newer than every representative source file, `pnpm build` is skipped. In CI
 * the build step runs right before `pnpm test:run`, so the cache always hits;
 * on repeat local runs it hits too. A 300s wall-clock cap keeps a hung
 * `nuxt build` from hanging the whole job forever.
 */
import { spawn } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The built server entry every harness starts via `setup({ build: false })`. */
const outputEntry = resolve(repoRoot, '.output', 'server', 'index.mjs')

/** Hard cap so a hung build cannot hang CI forever (CI job timeout is 15m). */
const BUILD_TIMEOUT_MS = 300_000

/**
 * Root-level files whose freshness must invalidate the cached build.
 *
 * `CHANGELOG.md` is deliberately NOT here: `tests/features/pwa/version-metadata.test.ts`
 * swaps + restores that file (and `public/version.json`) with `writeFileSync`
 * on every run, bumping their mtimes after the build — which would
 * perpetually invalidate an mtime cache on those two files. Nothing in the
 * suite asserts on the *served* copy of either (the changelog/version tests
 * read the repo files directly; the update-prompt test mocks the fetch), so
 * they are safe to exclude from the freshness check.
 */
const rootSourceFiles = [
  'nuxt.config.ts',
  'app.vue',
  'package.json',
  'pnpm-lock.yaml',
  'tailwind.config.ts',
]

/**
 * Source directories walked recursively for the mtime check. `db/` and
 * `scripts/` are deliberately excluded — they run through tsx at harness time
 * and never enter the Nuxt build, so editing them need not invalidate it.
 *
 * `public/version.json` is skipped for the same reason as `CHANGELOG.md`
 * above (the version-metadata test bumps its mtime on every run).
 */
const sourceDirs = [
  'assets',
  'components',
  'composables',
  'layouts',
  'middleware',
  'pages',
  'public',
  'server',
  'stores',
  'utils',
]

/** Repo path excluded from the freshness walk (see version-metadata note). */
const versionJsonPath = resolve(repoRoot, 'public', 'version.json')

function newestSourceMtime(): number {
  let newest = 0
  const consider = (path: string) => {
    try {
      const stats = statSync(path)
      if (stats.isFile() && stats.mtimeMs > newest) newest = stats.mtimeMs
    } catch {
      // A missing file/dir simply contributes nothing.
    }
  }
  for (const file of rootSourceFiles) consider(resolve(repoRoot, file))
  for (const dir of sourceDirs) {
    const root = resolve(repoRoot, dir)
    try {
      for (const entry of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
        const full = join(root, entry)
        if (full === versionJsonPath) continue
        consider(full)
      }
    } catch {
      // Directory absent — skip.
    }
  }
  return newest
}

function outputIsFresh(newestSource: number): boolean {
  try {
    return statSync(outputEntry).mtimeMs >= newestSource
  } catch {
    return false
  }
}

function runBuild(): Promise<void> {
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  return new Promise((resolvePromise, reject) => {
    const child = spawn(pnpm, ['build'], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(
        `[test-global-setup] pnpm build exceeded the ${BUILD_TIMEOUT_MS / 1000}s timeout — killed`,
      ))
    }, BUILD_TIMEOUT_MS)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolvePromise()
      else reject(new Error(`[test-global-setup] pnpm build exited with code ${code}`))
    })
  })
}

/**
 * Vitest invokes this once in the main process before collecting any test
 * file. The returned function is the teardown; the built `.output/` is
 * deliberately kept so the next `pnpm test:run` (and CI's explicit build step
 * before the test job) can reuse it.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const newestSource = newestSourceMtime()
  if (outputIsFresh(newestSource)) {
    console.log('[test-global-setup] using cached build (.output/server/index.mjs)')
    return async () => {}
  }

  console.log('[test-global-setup] building Nuxt once before tests…')
  await runBuild()
  console.log('[test-global-setup] build complete')
  return async () => {}
}
