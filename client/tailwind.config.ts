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
          emerald:  '#10b981',
          purple:   'var(--c-accent-2)',
          cyan:     '#22d3ee',
        },
        pnl: {
          profit: 'var(--c-profit)',
          loss:   'var(--c-loss)',
        },
        text: {
          primary:   'var(--c-text-1)',
          secondary: 'var(--c-text-2)',
          muted:     'var(--c-text-3)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card:     '0 1px 3px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)',
        'card-hover': '0 4px 24px rgba(99,102,241,0.1), 0 0 0 1px rgba(255,255,255,0.1)',
        'glow-sm': '0 0 20px rgba(99,102,241,0.15)',
        modal:    '0 25px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.08)',
      },
      backgroundImage: {
        'gradient-sidebar': 'linear-gradient(180deg, #0e0e1a 0%, #09090f 100%)',
        'gradient-primary': 'linear-gradient(135deg, #6366f1 0%, #a78bfa 100%)',
        'gradient-emerald': 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
        'gradient-cyan':    'linear-gradient(135deg, #0891b2 0%, #22d3ee 100%)',
        'gradient-amber':   'linear-gradient(135deg, #d97706 0%, #fbbf24 100%)',
      },
    },
  },
  plugins: [],
} satisfies Config
