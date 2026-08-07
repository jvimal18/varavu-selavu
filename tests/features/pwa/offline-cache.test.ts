/**
 * Offline cache / app-shell smoke (production-preview browser test).
 *
 * The TESTING_PLAN matrix calls for a tiny real-browser check that the
 * service worker precaches the app shell, that `version.json` is fetched
 * `no-store` and never precached, and that a new `version.json` is detected
 * as an update. Browser automation is NOT wired in this repo yet:
 * `@playwright/test` is not installed, `@nuxt/test-utils` browser mode
 * requires a `@playwright/test` peer that is absent, and this lane must not
 * modify package.json or vitest.config.ts.
 *
 * Per the tests/README.md browser-test policy ("If browser automation is not
 * available, write a production-preview smoke checklist ... rather than a
 * failing test"), this file documents the manual smoke checklist below and
 * protects the two static invariants the smoke depends on with assertions
 * that run today:
 *
 *   [18] version.json must be excluded from the workbox precache
 *        (the `globIgnores` entry in nuxt.config.ts) so the old
 *        app shell always fetches the fresh version instead of a precached
 *        install-time copy.
 *
 *   [18] the app-shell assets the service worker precaches must actually
 *        ship in `public/`.
 *
 * The no-store version-discovery half of [19] is covered directly by
 * `pwa/update-prompt.test.ts` (useAppUpdate contract).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('offline cache static invariants', () => {
  it('excludes version.json from the workbox precache so the old shell always fetches the new version', () => {
    const config = readFileSync(resolve(ROOT, 'nuxt.config.ts'), 'utf8')
    // The OLD app shell can only learn the NEW version from the network;
    // precaching version.json at install time would hide every later deploy.
    expect(
      config,
      'removing globIgnores ["**/version.json"] would make the SW serve a stale version.json from precache and break update detection',
    ).toMatch(/globIgnores:\s*\[\s*['"]\*\*\/version\.json['"]\s*\]/)
  })

  it('ships the app-shell assets the service worker precaches', () => {
    const publicDir = resolve(ROOT, 'public')
    for (const asset of ['version.json', 'favicon.svg', 'icon.svg', 'pwa-192.png', 'pwa-512.png']) {
      expect(
        existsSync(resolve(publicDir, asset)),
        `public/${asset} must exist for the SW precache / manifest to reference it`,
      ).toBe(true)
    }
  })
})

/**
 * Manual production-preview smoke checklist (real browser against a
 * `pnpm build` + `pnpm preview` output or the Pi deploy). Run this once per
 * release and record the result in the PR.
 *
 * [18] App-shell precache
 *   1. Load the app and wait for the service worker to install
 *      (Application → Service Workers → "activated").
 *   2. In the console run:
 *        (await caches.keys()).forEach(async (name) => {
 *          console.log(name, (await (await caches.open(name)).keys()).map((r) => r.url))
 *        })
 *   3. EXPECT a workbox precache entry listing the app shell
 *      (/index.html, /_nuxt/*.js, /_nuxt/*.css, /favicon.svg,
 *      /pwa-192.png, /pwa-512.png) and /version.json ABSENT from every
 *      cache. The dashboard runtime cache may be present too.
 *   4. DevTools → Network → Offline, then reload. EXPECT the app shell to
 *      render (navigateFallback: '/').
 *   5. EXPECT that authenticated API responses (e.g. /api/auth/me) are NOT
 *      served from the shared precache when offline — only the shell is.
 *
 * [19] no-store version discovery
 *   1. Open DevTools → Network, then trigger the update check (reload after
 *      a deploy that changed /version.json, or an installed PWA's hourly
 *      periodic sync).
 *   2. EXPECT the /version.json request to show `cache-control: no-cache`
 *      and to hit the network (initiator "Other", not "ServiceWorker").
 *   3. Deploy a newer CHANGELOG entry, reload the old shell: EXPECT the
 *      PwaUpdatePrompt toast with the new version and its first two bullets.
 */
