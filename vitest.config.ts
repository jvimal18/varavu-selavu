/**
 * Vitest config — pure unit tests run in Node, file-backed Nuxt HTTP tests
 * use the real server via `tests/helpers/nuxt-server.ts`. Path alias `~~` →
 * repo root (mirrors the Nuxt convention used in the codebase).
 *
 * Phase 2 added real boundary coverage: `fileParallelism: false` is required
 * because each singleton-sensitive HTTP file builds its own isolated Nuxt
 * server, the `useDb()` singleton, and the in-process rate-limit maps are
 * all process-global. `isolate: true` remains on for worker-level test
 * isolation.
 */
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '~~': fileURLToPath(new URL('.', import.meta.url)),
      '~': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Per-test isolation. Drizzle + better-sqlite3 :memory: tests would need
    // separate workers; pure-function tests don't.
    isolate: true,
    // Nuxt HTTP tests set process.env before build and use a module-level DB
    // singleton. Keep those contexts serial; pure suites retain their behavior.
    fileParallelism: false,
    // The top-level `await createNuxtTestHarness()` in each HTTP test file
    // builds a full Nuxt server + runs migrations + seeds. The heavier files
    // (accounts, transactions, dashboard, backup) exceed the 120s default.
    hookTimeout: 300_000,
  },
})
