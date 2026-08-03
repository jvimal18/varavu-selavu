<script setup lang="ts">
/**
 * /changelog — full release history.
 *
 * Renders CHANGELOG.md (imported as a raw string) via the parseChangelog
 * utility. Each version becomes a section with its date and bulleted
 * changes. Inline markdown (`**bold**`, `` `code` ``) is rendered through
 * renderInline(). The content is trusted (we author CHANGELOG.md), so
 * v-html is safe here.
 */
import { parseChangelog, renderInline } from '~/utils/changelog'
import changelogMd from '~/CHANGELOG.md?raw'

const entries = parseChangelog(changelogMd)

useHead({
  title: 'Changelog — VaravuSelavu',
  meta: [
    { name: 'description', content: 'Release history for VaravuSelavu.' },
  ],
})
</script>

<template>
  <div class="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
    <header class="border-b border-stone-200 pb-4 dark:border-stone-700">
      <h1 class="text-3xl font-bold text-stone-900 dark:text-stone-100">Changelog</h1>
      <p class="mt-2 text-stone-600 dark:text-stone-400">
        All notable changes to VaravuSelavu, newest first.
      </p>
    </header>

    <div class="mt-8 space-y-10 pb-24 md:pb-8">
      <article
        v-for="entry in entries"
        :key="entry.version"
        class="scroll-mt-20"
      >
        <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-stone-200 pb-2 dark:border-stone-700">
          <h2 class="font-mono text-2xl font-bold text-terra-700 dark:text-terra-500">
            {{ entry.version }}
          </h2>
          <time
            :datetime="entry.date"
            class="text-sm text-stone-500 dark:text-stone-400"
          >{{ entry.date }}</time>
        </header>

        <section
          v-for="sec in entry.sections"
          :key="sec.title"
          class="mt-4"
        >
          <h3 class="text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
            {{ sec.title }}
          </h3>
          <ul class="mt-2 space-y-2 text-stone-700 dark:text-stone-300">
            <li
              v-for="(bullet, i) in sec.bullets"
              :key="i"
              class="flex gap-3 leading-relaxed"
            >
              <span class="mt-2.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-terra-700 dark:bg-terra-500" />
              <span v-html="renderInline(bullet)" />
            </li>
          </ul>
        </section>
      </article>
    </div>
  </div>
</template>
