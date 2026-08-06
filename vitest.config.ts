/**
 * Vitest config — unit tests run in Node, no Nuxt context.
 * Path alias `~~` → repo root (mirrors the Nuxt convention used in the codebase).
 *
 * PR 1's tests are pure-function unit tests (money, dates, account balances,
 * dashboard period resolution). Integration tests against the running server
 * (with @nuxt/test-utils) are deferred to a later PR.
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
  },
})
