import type { Config } from 'tailwindcss';

/**
 * ASTRION design tokens are defined once as CSS variables in src/styles/globals.css
 * (space-separated RGB channels) and exposed to Tailwind here, so utilities such as
 * `bg-surface/60` or `text-cyan` support alpha modifiers.
 */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: token('void'),
        abyss: token('abyss'),
        deep: token('deep'),
        surface: token('surface'),
        raised: token('raised'),
        line: token('line'),
        'line-strong': token('line-strong'),
        ink: token('ink'),
        'ink-muted': token('ink-muted'),
        'ink-faint': token('ink-faint'),
        cyan: token('cyan'),
        'cyan-deep': token('cyan-deep'),
        violet: token('violet'),
        verified: token('verified'),
        caution: token('caution'),
        conflict: token('conflict'),
        gap: token('gap'),
      },
      fontFamily: {
        display: ['"Space Grotesk Variable"', '"Space Grotesk"', 'system-ui', 'sans-serif'],
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.01em' }],
      },
      borderRadius: { DEFAULT: '6px', md: '8px', lg: '10px', xl: '14px' },
      boxShadow: {
        panel: '0 1px 0 0 rgb(255 255 255 / 0.03) inset, 0 12px 32px -16px rgb(0 0 0 / 0.7)',
        glow: '0 0 0 1px rgb(var(--cyan) / 0.35), 0 0 24px -4px rgb(var(--cyan) / 0.45)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
        pulseDot: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.35' } },
      },
      animation: {
        'fade-in': 'fade-in 400ms ease-out both',
        shimmer: 'shimmer 1.6s linear infinite',
        'pulse-dot': 'pulseDot 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
