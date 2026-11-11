/**
 * Design tokens for imperative renderers (Canvas 2D, Three.js) that cannot read Tailwind classes.
 * Keep in sync with the CSS variables in src/styles/globals.css.
 */
export const color = {
  void: '#04060b',
  abyss: '#070a12',
  deep: '#0a0e1a',
  surface: '#0e1321',
  raised: '#141b2d',
  line: '#1c253d',
  lineStrong: '#2c3858',
  ink: '#e6ecf6',
  inkMuted: '#8b97ad',
  inkFaint: '#5a6680',
  cyan: '#4fe3f0',
  cyanDeep: '#2096a8',
  violet: '#9d8cff',
  verified: '#5ee0a5',
  caution: '#f0ba68',
  conflict: '#ff7a8a',
  gap: '#7aa2ff',
} as const;

export const motion = {
  /** Standard easing for UI transitions (expo-out). */
  ease: [0.16, 1, 0.3, 1] as const,
  fast: 0.18,
  base: 0.32,
  slow: 0.6,
} as const;
