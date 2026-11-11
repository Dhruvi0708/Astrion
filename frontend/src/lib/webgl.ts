let cached: boolean | null = null;

/** Detects WebGL support once; used to fall back to SVG renderings. */
export function hasWebGL(): boolean {
  if (cached !== null) return cached;
  try {
    const canvas = document.createElement('canvas');
    cached = Boolean(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
  } catch {
    cached = false;
  }
  return cached;
}
