/**
 * Changelog page rendering (`pages/changelog.vue` + `utils/changelog.ts`).
 *
 * The page is a pure function of `CHANGELOG.md`: it imports the file as a
 * raw string, runs it through `parseChangelog`, renders newest-first with
 * each version's date and its bullets grouped under subsection headings,
 * and runs each bullet through `renderInline` (HTML-escape first, then
 * `**bold**` → `<strong>` and `` `code` `` → `<code>`).
 *
 * Because the rendering logic is pure, the page contract is tested directly
 * against the production utilities and the real `CHANGELOG.md` content —
 * no DOM harness required.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseChangelog, renderInline } from '~~/utils/changelog'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const changelogMd = readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8')

/** Semantic compare for `vX.Y.Z` release tags (descending). */
function compareVersionsDescending(a: string, b: string): number {
  const num = (v: string) => v.slice(1).split('.').map((n) => Number.parseInt(n, 10))
  const [am, ap, apatch] = num(a)
  const [bm, bp, bpatch] = num(b)
  return bm - am || bp - ap || bpatch - apatch
}

describe('changelog page contract', () => {
  it('renders the newest version heading and date from the top of CHANGELOG.md', () => {
    const entries = parseChangelog(changelogMd)

    expect(entries.length, 'an unparseable changelog would render an empty page').toBeGreaterThan(0)
    const newest = entries[0]
    expect(newest.version, 'the hero heading must be a real vX.Y.Z release tag').toMatch(/^v\d+\.\d+\.\d+$/)
    expect(newest.date, 'every release heading must carry its YYYY-MM-DD release date').toMatch(/^\d{4}-\d{2}-\d{2}$/)

    // The page must agree with what the PWA update prompt announces; both are
    // generated from the same CHANGELOG entry and must never drift apart.
    const versionJson = JSON.parse(readFileSync(resolve(ROOT, 'public/version.json'), 'utf8')) as {
      version: string
      date: string
    }
    expect(newest.version, 'the changelog hero must match the version the update prompt announces').toBe(versionJson.version)
    expect(newest.date, 'the changelog date must match the version.json release date').toBe(versionJson.date)
  })

  it('groups bullets under their subsection titles', () => {
    const entries = parseChangelog(changelogMd)
    const newest = entries[0]

    expect(newest.sections.length, 'the newest release must carry at least one subsection').toBeGreaterThan(0)
    for (const section of newest.sections) {
      expect(section.title.trim().length, 'every rendered group must have a non-empty heading').toBeGreaterThan(0)
      expect(section.bullets.length, 'a subsection heading with no bullets must not render').toBeGreaterThan(0)
    }

    // If a parser change ever flattens the group structure, the page would
    // stop drawing the per-subsection headings.
    expect(
      newest.sections.map((s) => s.title),
      'bullets must stay grouped under their original CHANGELOG subsection headings',
    ).toContain('Added')
  })

  it('renders the newest release first', () => {
    const versions = parseChangelog(changelogMd).map((entry) => entry.version)

    expect(versions.length, 'the page needs more than one release to prove ordering').toBeGreaterThan(1)
    const descending = [...versions].sort(compareVersionsDescending)
    expect(versions, 'a mis-ordered parse would render history backwards').toEqual(descending)
    expect(versions[0], 'the first heading must be the newest release').toBe(descending[0])
  })

  it('renders inline markdown to HTML and escapes raw HTML from the source', () => {
    const rendered = renderInline('**bold** text and `code` and <script>alert(1)</script>')

    expect(rendered, '**bold** must become a <strong> element').toMatch(/<strong[^>]*>bold<\/strong>/)
    expect(rendered, '`code` must become a <code> element').toMatch(/<code[^>]*>code<\/code>/)
    expect(rendered, 'raw HTML in the source must be escaped, never injected').toContain('&lt;script&gt;')
    expect(rendered, 'raw HTML in the source must be escaped, never injected').not.toContain('<script>')

    // A real CHANGELOG bullet round-trips through the same path the page uses.
    const firstRealBullet = parseChangelog(changelogMd)[0].sections[0].bullets[0]
    const html = renderInline(firstRealBullet)
    expect(html, 'real bullets must never leak unescaped markup into the v-html sink').not.toMatch(/<script/i)
  })
})
