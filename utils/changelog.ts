/**
 * utils/changelog.ts
 *
 * Parses the CHANGELOG.md file into a structured form for the /changelog
 * page. The format is simple and stable:
 *
 *   ## [v1.4.2] - 2026-08-03
 *
 *   ### Added
 *   - bullet 1
 *   - bullet 2
 *
 *   ### Removed
 *   - bullet 1
 *
 *   ## [v1.4.1] - 2026-08-03
 *   ...
 *
 * Bullets may contain inline markdown (`**bold**`, `` `code` ``). The page
 * uses renderInline() to convert those to <strong>/<code> elements.
 * CHANGELOG.md is trusted content (we author it), so v-html here is safe.
 */
export interface ChangelogSection {
  title: string
  bullets: string[]
}

export interface ChangelogEntry {
  version: string
  date: string
  sections: ChangelogSection[]
}

const ENTRY_RE = /^## \[(v[^\]]+)\] - (\d{4}-\d{2}-\d{2})([\s\S]*?)(?=^## \[|\Z)/gm
const SECTION_RE = /^### ([^\n]+)\n([\s\S]*?)(?=^### |\Z)/gm
const BULLET_RE = /^- (.+)$/gm

export function parseChangelog(md: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  ENTRY_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ENTRY_RE.exec(md)) !== null) {
    const version = m[1]
    const date = m[2]
    const body = m[3] || ''
    const sections: ChangelogSection[] = []
    SECTION_RE.lastIndex = 0
    let s: RegExpExecArray | null
    while ((s = SECTION_RE.exec(body)) !== null) {
      const title = s[1].trim()
      const subBody = s[2] || ''
      const bullets: string[] = []
      BULLET_RE.lastIndex = 0
      let b: RegExpExecArray | null
      while ((b = BULLET_RE.exec(subBody)) !== null) {
        bullets.push(b[1].trim())
      }
      if (bullets.length > 0) sections.push({ title, bullets })
    }
    entries.push({ version, date, sections })
  }
  return entries
}

/**
 * Minimal inline-markdown renderer for the limited dialect used in
 * CHANGELOG.md: `**bold**` and `` `code` ``. Escapes HTML first so the
 * resulting string is safe to inject with v-html on trusted CHANGELOG.md
 * content.
 */
export function renderInline(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong class="font-semibold text-stone-900 dark:text-stone-100">$1</strong>')
    .replace(/`([^`\n]+)`/g, '<code class="rounded bg-stone-200 px-1 py-0.5 font-mono text-[0.85em] text-stone-800 dark:bg-stone-700 dark:text-stone-200">$1</code>')
}
