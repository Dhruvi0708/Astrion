import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import * as THREE from 'three';
import { generateUniverse } from './universeData';

/* -------------------------------------------------------------------------- */
/* Shaders                                                                    */
/* -------------------------------------------------------------------------- */

const pointVertex = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float twinkle = 0.82 + 0.18 * sin(uTime * 1.2 + position.x * 3.1 + position.y * 1.7);
    gl_PointSize = size * uPixelRatio * twinkle * (90.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
    vAlpha = clamp(1.5 - (-mv.z) / 20.0, 0.25, 1.0);
  }
`;

const pointFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float core = 1.0 - smoothstep(0.0, 0.16, d);
    float halo = (1.0 - smoothstep(0.05, 0.5, d)) * 0.32;
    float a = (core + halo) * vAlpha;
    gl_FragColor = vec4(vColor * (core * 1.2 + halo), a);
  }
`;

const fresnelVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const fresnelFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float f = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.4);
    float pulse = 0.85 + 0.15 * sin(uTime * 1.6);
    gl_FragColor = vec4(uColor * f * 1.6 * pulse, f * pulse);
  }
`;

/* -------------------------------------------------------------------------- */
/* Scene parts                                                                */
/* -------------------------------------------------------------------------- */

function usePointer() {
  const pointer = useRef({ x: 0, y: 0 });
  useEffect(() => {
    // Listen on window: the hero copy overlays the canvas, so canvas-only events would miss most movement.
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  return pointer;
}

function KnowledgeCore({ speed }: { speed: number }) {
  const shell = useRef<THREE.Mesh>(null);
  const lattice = useRef<THREE.Mesh>(null);
  const ringA = useRef<THREE.Mesh>(null);
  const ringB = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(() => ({ uColor: { value: new THREE.Color('#4fe3f0') }, uTime: { value: 0 } }), []);

  useFrame((_, dt) => {
    const d = dt * speed;
    uniforms.uTime.value += d;
    if (lattice.current) {
      lattice.current.rotation.y += d * 0.25;
      lattice.current.rotation.x += d * 0.1;
    }
    if (ringA.current) ringA.current.rotation.z += d * 0.18;
    if (ringB.current) ringB.current.rotation.z -= d * 0.12;
  });

  return (
    <group>
      <mesh ref={shell}>
        <sphereGeometry args={[0.62, 48, 48]} />
        <shaderMaterial
          vertexShader={fresnelVertex}
          fragmentShader={fresnelFragment}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.2, 24, 24]} />
        <meshBasicMaterial color="#bff7fb" />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.34, 24, 24]} />
        <meshBasicMaterial color="#4fe3f0" transparent opacity={0.18} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={lattice}>
        <icosahedronGeometry args={[0.92, 1]} />
        <meshBasicMaterial color="#4fe3f0" wireframe transparent opacity={0.14} depthWrite={false} />
      </mesh>
      <mesh ref={ringA} rotation={[Math.PI / 2.3, 0.3, 0]}>
        <torusGeometry args={[1.45, 0.004, 6, 160]} />
        <meshBasicMaterial color="#4fe3f0" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <mesh ref={ringB} rotation={[Math.PI / 1.7, -0.5, 0.4]}>
        <torusGeometry args={[1.9, 0.003, 6, 160]} />
        <meshBasicMaterial color="#9d8cff" transparent opacity={0.28} depthWrite={false} />
      </mesh>
    </group>
  );
}

function Universe({ speed, density }: { speed: number; density: number }) {
  const data = useMemo(() => generateUniverse({ perCluster: Math.round(24 * density) }), [density]);
  const group = useRef<THREE.Group>(null);
  const hubs = useRef<THREE.InstancedMesh>(null);
  const pointer = usePointer();
  const { camera, gl } = useThree();

  const pointUniforms = useMemo(() => ({ uTime: { value: 0 }, uPixelRatio: { value: Math.min(gl.getPixelRatio(), 2) } }), [gl]);

  // Signal particles travelling along a subset of relationships
  const SIGNALS = Math.min(110, data.signalCount * 2);
  const signal = useMemo(() => {
    const positions = new Float32Array(SIGNALS * 3);
    const colors = new Float32Array(SIGNALS * 3);
    const sizes = new Float32Array(SIGNALS);
    const meta = new Float32Array(SIGNALS * 3); // edge index, phase, speed
    const cyan = new THREE.Color('#9ff4fa');
    const violet = new THREE.Color('#c2b8ff');
    for (let i = 0; i < SIGNALS; i++) {
      meta[i * 3] = i % data.signalCount;
      meta[i * 3 + 1] = Math.random();
      meta[i * 3 + 2] = 0.08 + Math.random() * 0.14;
      const c = i % 4 === 0 ? violet : cyan;
      colors.set([c.r, c.g, c.b], i * 3);
      sizes[i] = 1.4 + Math.random() * 1.2;
    }
    return { positions, colors, sizes, meta };
  }, [SIGNALS, data.signalCount]);
  const signalGeo = useRef<THREE.BufferGeometry>(null);

  useLayoutEffect(() => {
    const mesh = hubs.current;
    if (!mesh) return;
    data.hubMatrices.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, data.hubColors[i]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [data]);

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05) * speed;
    pointUniforms.uTime.value += d;
    const g = group.current;
    if (g) {
      // Slow orbital drift plus a damped response to the pointer — never per-frame React state.
      g.rotation.y += d * 0.045;
      const tx = pointer.current.y * 0.18;
      const tz = pointer.current.x * -0.06;
      g.rotation.x += (tx - g.rotation.x) * 0.03;
      g.rotation.z += (tz - g.rotation.z) * 0.03;
    }
    camera.position.x += (pointer.current.x * 0.7 - camera.position.x) * 0.025;
    camera.position.y += (-pointer.current.y * 0.45 + 0.4 - camera.position.y) * 0.025;
    camera.lookAt(0, 0, 0);

    const e = data.signalEdges;
    const { positions, meta } = signal;
    for (let i = 0; i < SIGNALS; i++) {
      const edge = meta[i * 3] * 6;
      let t = meta[i * 3 + 1] + d * meta[i * 3 + 2];
      if (t > 1) t -= 1;
      meta[i * 3 + 1] = t;
      positions[i * 3] = e[edge] + (e[edge + 3] - e[edge]) * t;
      positions[i * 3 + 1] = e[edge + 1] + (e[edge + 4] - e[edge + 1]) * t;
      positions[i * 3 + 2] = e[edge + 2] + (e[edge + 5] - e[edge + 2]) * t;
    }
    const attr = signalGeo.current?.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (attr) attr.needsUpdate = true;
    void state;
  });

  return (
    <group ref={group} rotation={[0.18, 0, -0.04]}>
      <KnowledgeCore speed={speed} />

      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[data.linePositions, 3]} />
          <bufferAttribute attach="attributes-color" args={[data.lineColors, 3]} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors transparent opacity={0.22} depthWrite={false} blending={THREE.AdditiveBlending} />
      </lineSegments>

      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[data.nodePositions, 3]} />
          <bufferAttribute attach="attributes-color" args={[data.nodeColors, 3]} />
          <bufferAttribute attach="attributes-size" args={[data.nodeSizes, 1]} />
        </bufferGeometry>
        <shaderMaterial
          vertexShader={pointVertex}
          fragmentShader={pointFragment}
          uniforms={pointUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      <points>
        <bufferGeometry ref={signalGeo}>
          <bufferAttribute attach="attributes-position" args={[signal.positions, 3]} usage={THREE.DynamicDrawUsage} />
          <bufferAttribute attach="attributes-color" args={[signal.colors, 3]} />
          <bufferAttribute attach="attributes-size" args={[signal.sizes, 1]} />
        </bufferGeometry>
        <shaderMaterial
          vertexShader={pointVertex}
          fragmentShader={pointFragment}
          uniforms={pointUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      <instancedMesh ref={hubs} args={[undefined, undefined, data.hubMatrices.length]}>
        <icosahedronGeometry args={[1, 0]} />
        <meshBasicMaterial wireframe transparent opacity={0.8} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

function Starfield({ count = 1200 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);
  const { positions, sizes, colors } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const r = 16 + Math.random() * 30;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions.set([r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta) * 0.6, r * Math.cos(phi)], i * 3);
      sizes[i] = 0.6 + Math.random() * 1.4;
      c.set(Math.random() < 0.15 ? '#9d8cff' : '#8b97ad');
      colors.set([c.r * 0.6, c.g * 0.6, c.b * 0.6], i * 3);
    }
    return { positions, sizes, colors };
  }, [count]);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uPixelRatio: { value: 0.5 } }), []);
  useFrame((_, dt) => {
    uniforms.uTime.value += dt * 0.4;
    if (ref.current) ref.current.rotation.y += dt * 0.004;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={pointVertex}
        fragmentShader={pointFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/* -------------------------------------------------------------------------- */
/* Canvas                                                                     */
/* -------------------------------------------------------------------------- */

export interface HeroSceneProps {
  active: boolean;
  reducedMotion: boolean;
  compact?: boolean;
}

/** Interactive 3D knowledge universe (lazy-loaded). Rendering pauses entirely when off-screen. */
export default function HeroScene({ active, reducedMotion, compact }: HeroSceneProps) {
  const [dpr, setDpr] = useState(1.5);
  return (
    <Canvas
      frameloop={active ? 'always' : 'never'}
      dpr={[1, dpr]}
      camera={{ position: [0, 0.4, compact ? 15 : 12.5], fov: 42, near: 0.1, far: 120 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      aria-hidden
    >
      <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(1.75)} />
      <fog attach="fog" args={['#04060b', 14, 32]} />
      <Universe speed={reducedMotion ? 0.12 : 1} density={compact ? 0.7 : 1} />
      <Starfield count={compact ? 600 : 1200} />
    </Canvas>
  );
}
