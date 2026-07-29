// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-10-01',
  devtools: { enabled: true },

  modules: [
    '@pinia/nuxt',
    '@vueuse/nuxt',
    '@nuxt/icon',
    '@nuxtjs/tailwindcss',
  ],

  css: ['~/assets/css/main.css'],

  app: {
    head: {
      title: 'VaravuSelavu',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#C2410C' },
        { name: 'description', content: 'Personal budget tracker for Vimal & Pavithra' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap',
        },
      ],
    },
  },

  runtimeConfig: {
    sessionSecret: process.env.NUXT_SESSION_SECRET || 'dev-only-change-me-in-prod',
    dbPath: process.env.NUXT_DB_PATH || './data/dev.db',
    public: {
      appName: 'VaravuSelavu',
    },
  },

  typescript: {
    strict: true,
  },

  nitro: {
    experimental: {
      // better-sqlite3 is native; ensure it gets included
    },
  },
})
