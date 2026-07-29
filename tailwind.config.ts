import type { Config } from 'tailwindcss'

export default <Config>{
  content: [
    './components/**/*.{vue,js,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './app.vue',
    './composables/**/*.{js,ts}',
    './stores/**/*.{js,ts}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        cream: { 50: '#FDFBF7', 100: '#FAF7F2', 200: '#F5F1EB', 300: '#EDE7DE' },
        ink: {
          900: '#1C1917', 800: '#292524', 700: '#44403C',
          500: '#78716C', 400: '#A8A29E', 300: '#D6D3D1',
          200: '#E7E5E4', 100: '#F1EFEC',
        },
        terra: {
          50: '#FFF7ED', 100: '#FFEDD5', 200: '#FED7AA', 300: '#FDBA74',
          500: '#F97316', 600: '#EA580C', 700: '#C2410C', 800: '#9A3412',
        },
        success: { 50: '#F0FDF4', 600: '#16A34A', 700: '#15803D' },
        danger: { 50: '#FEF2F2', 600: '#DC2626', 700: '#B91C1C' },
        warn: { 50: '#FFFBEB', 600: '#D97706', 700: '#B45309' },
        sage: { 500: '#4D7C5A', 600: '#3F6349' },
        rose: { 600: '#BE185D' },
        violet: { 600: '#6D28D9' },
        teal: { 600: '#0F766E' },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(28, 25, 23, 0.04), 0 1px 3px rgba(28, 25, 23, 0.06)',
        card: '0 1px 2px rgba(28, 25, 23, 0.04), 0 4px 12px rgba(28, 25, 23, 0.04)',
        lift: '0 4px 6px rgba(28, 25, 23, 0.05), 0 12px 28px rgba(28, 25, 23, 0.08)',
      },
    },
  },
  plugins: [],
}
