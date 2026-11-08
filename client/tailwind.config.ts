import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          primary:   'var(--c-bg-primary)',
          secondary: 'var(--c-bg-secondary)',
          card:      'var(--c-bg-card)',
          border:    'var(--c-border)',
          hover:     'var(--c-bg-hover)',
        },
        accent: {
          blue:     'var(--c-accent)',
          'blue-d': 'var(--c-accent)',
          emerald:  'var(--c-profit)',
          purple:   'var(--c-accent-2)',
          cyan:     'var(--c-accent)',
        },
        pnl: {
          profit: 'var(--c-profit)',
          loss:   'var(--c-loss)',
        },
        warn: 'var(--c-warn)',
        text: {
          primary:   'var(--c-text-1)',
          secondary: 'var(--c-text-2)',
          muted:     'var(--c-text-3)',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Helvetica Neue', 'system-ui', 'sans-serif'],
        mono: ['SF Mono', 'ui-monospace', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card:         'var(--c-shadow-card)',
        'card-hover': 'var(--c-shadow-hover)',
        'glow-sm':    'none',
        modal:        'var(--c-shadow-modal)',
      },
      backgroundImage: {
        'gradient-sidebar': 'none',
        'gradient-primary': 'linear-gradient(var(--c-accent), var(--c-accent))',
        'gradient-emerald': 'linear-gradient(var(--c-profit), var(--c-profit))',
        'gradient-cyan':    'linear-gradient(var(--c-accent), var(--c-accent))',
        'gradient-amber':   'linear-gradient(var(--c-warn), var(--c-warn))',
      },
    },
  },
  plugins: [],
} satisfies Config
