import * as THREE from 'three';

/**
 * Procedurally generates the abstract knowledge universe shown in the hero.
 * Purely decorative-structural: it visualises the idea of clustered, connected knowledge and
 * does not represent any real dataset.
 */
export interface UniverseData {
  nodePositions: Float32Array;
  nodeColors: Float32Array;
  nodeSizes: Float32Array;
  hubMatrices: THREE.Matrix4[];
  hubColors: THREE.Color[];
  linePositions: Float32Array;
  lineColors: Float32Array;
  /** Edges eligible for travelling signal particles: [ax, ay, az, bx, by, bz]. */
  signalEdges: Float32Array;
  signalCount: number;
}

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

const PALETTE = ['#4fe3f0', '#9d8cff', '#e6ecf6', '#4fe3f0', '#7aa2ff', '#9d8cff', '#4fe3f0'];

export function generateUniverse(opts: { clusters?: number; perCluster?: number; seed?: number } = {}): UniverseData {
  const { clusters = 7, perCluster = 24, seed = 42 } = opts;
  const random = rng(seed);
  const gauss = () => {
    // Box–Muller
    const u = Math.max(1e-6, random());
    const v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const centres: THREE.Vector3[] = [];
  for (let i = 0; i < clusters; i++) {
    // Fibonacci sphere, flattened into a disc-like galaxy for a cinematic silhouette.
    const y = 1 - (i / (clusters - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = i * 2.399963;
    centres.push(new THREE.Vector3(Math.cos(theta) * r * 4.4, y * 2.1, Math.sin(theta) * r * 3.2));
  }

  const points: THREE.Vector3[] = [];
  const pointCluster: number[] = [];
  const colors: number[] = [];
  const sizes: number[] = [];
  const tmp = new THREE.Color();

  centres.forEach((c, ci) => {
    const base = new THREE.Color(PALETTE[ci % PALETTE.length]);
    for (let j = 0; j < perCluster; j++) {
      const spread = 0.42 + random() * 0.38;
      const p = new THREE.Vector3(c.x + gauss() * spread, c.y + gauss() * spread * 0.7, c.z + gauss() * spread);
      points.push(p);
      pointCluster.push(ci);
      tmp.copy(base).lerp(new THREE.Color('#e6ecf6'), random() * 0.35);
      colors.push(tmp.r, tmp.g, tmp.b);
      sizes.push(random() < 0.12 ? 2.6 + random() * 1.6 : 0.9 + random() * 1.2);
    }
  });

  // Loose "bridge" nodes drifting between clusters
  for (let k = 0; k < 36; k++) {
    const a = centres[Math.floor(random() * clusters)];
    const b = centres[Math.floor(random() * clusters)];
    const t = random();
    const p = a
      .clone()
      .lerp(b, t)
      .add(new THREE.Vector3(gauss() * 0.4, gauss() * 0.4, gauss() * 0.4));
    points.push(p);
    pointCluster.push(-1);
    tmp.set('#8b97ad');
    colors.push(tmp.r, tmp.g, tmp.b);
    sizes.push(0.7 + random() * 0.6);
  }

  const lineP: number[] = [];
  const lineC: number[] = [];
  const signals: number[] = [];
  const push = (a: THREE.Vector3, b: THREE.Vector3, ca: THREE.Color, cb: THREE.Color, signal: boolean) => {
    lineP.push(a.x, a.y, a.z, b.x, b.y, b.z);
    lineC.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b);
    if (signal) signals.push(a.x, a.y, a.z, b.x, b.y, b.z);
  };

  // Intra-cluster: connect each node to its two nearest neighbours in the same cluster.
  points.forEach((p, i) => {
    const ci = pointCluster[i];
    if (ci < 0) return;
    const nearest = points
      .map((q, j) => ({ j, d: j !== i && pointCluster[j] === ci ? p.distanceToSquared(q) : Infinity }))
      .sort((x, y) => x.d - y.d)
      .slice(0, 2);
    const col = new THREE.Color(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]).multiplyScalar(0.55);
    for (const { j } of nearest) if (j > i || random() < 0.3) push(p, points[j], col, col, random() < 0.08);
  });

  // Hubs: cluster centres connect to the core and to neighbouring clusters.
  const core = new THREE.Vector3(0, 0, 0);
  const cyan = new THREE.Color('#4fe3f0');
  const violet = new THREE.Color('#9d8cff');
  const dim = new THREE.Color('#2c3858');
  centres.forEach((c, ci) => {
    const col = new THREE.Color(PALETTE[ci % PALETTE.length]);
    push(core, c, cyan.clone().multiplyScalar(0.9), col.clone().multiplyScalar(0.6), true);
    const next = centres[(ci + 2) % clusters];
    push(c, next, col.clone().multiplyScalar(0.35), dim, true);
    // Spokes from the hub to a few members
    for (let s = 0; s < 5; s++) {
      const idx = ci * perCluster + Math.floor(random() * perCluster);
      push(c, points[idx], col.clone().multiplyScalar(0.45), col.clone().multiplyScalar(0.2), random() < 0.5);
    }
  });

  // Long-range relationships between distant nodes — the "hidden connections"
  for (let k = 0; k < 14; k++) {
    const i = Math.floor(random() * points.length);
    const j = Math.floor(random() * points.length);
    if (pointCluster[i] === pointCluster[j]) continue;
    push(points[i], points[j], violet.clone().multiplyScalar(0.5), cyan.clone().multiplyScalar(0.25), random() < 0.6);
  }

  const hubMatrices: THREE.Matrix4[] = [];
  const hubColors: THREE.Color[] = [];
  const q = new THREE.Quaternion();
  centres.forEach((c, ci) => {
    const s = 0.13 + random() * 0.05;
    hubMatrices.push(new THREE.Matrix4().compose(c, q.setFromEuler(new THREE.Euler(random() * 3, random() * 3, 0)), new THREE.Vector3(s, s, s)));
    hubColors.push(new THREE.Color(PALETTE[ci % PALETTE.length]));
  });

  const nodePositions = new Float32Array(points.length * 3);
  points.forEach((p, i) => nodePositions.set([p.x, p.y, p.z], i * 3));

  return {
    nodePositions,
    nodeColors: new Float32Array(colors),
    nodeSizes: new Float32Array(sizes),
    hubMatrices,
    hubColors,
    linePositions: new Float32Array(lineP),
    lineColors: new Float32Array(lineC),
    signalEdges: new Float32Array(signals),
    signalCount: signals.length / 6,
  };
}
