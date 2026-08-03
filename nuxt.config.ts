// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-10-01',
  devtools: { enabled: true },

  modules: [
    '@pinia/nuxt',
    '@vueuse/nuxt',
    '@nuxt/icon',
    '@nuxtjs/tailwindcss',
    '@vite-pwa/nuxt',
  ],

  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'VaravuSelavu',
      short_name: 'VaravuSelavu',
      description: 'Personal + household budget tracker',
      theme_color: '#C2410C',
      background_color: '#FAF7F2',
      display: 'standalone',
      start_url: '/',
      icons: [
        { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      navigateFallback: '/',
      runtimeCaching: [
        {
          urlPattern: /\/api\/dashboard/,
          handler: 'NetworkFirst',
          options: {
            cacheName: 'dashboard',
            expiration: { maxAgeSeconds: 60 * 5 },
          },
        },
      ],
    },
    devOptions: {
      // Don't register the dev service worker. Without this, @vite-pwa/nuxt
      // generates a hashed dev-sw (e.g. dev-sw-dist/workbox-<hash>.js) that
      // the browser tries to fetch after a code change, but the hash has
      // moved on — leading to a noisy ENOENT in the dev console. Production
      // service workers (the workbox block above) are unaffected.
      enabled: false,
    },
  },

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
