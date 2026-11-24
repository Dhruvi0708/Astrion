import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { color } from '@/design/tokens';
import type { WorkspaceGraph } from '@/lib/api/types';
import { layoutGraph, type LaidOutNode } from './layout3d';

export type CameraCommand = { kind: 'reset' | 'fit' | 'focus'; key?: string; nonce: number };

export interface KnowledgeGraph3DProps {
  graph: Pick<WorkspaceGraph, 'nodes' | 'edges'>;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  /** Keys to emphasise (e.g. the claims behind a selected hypothesis). Others dim. */
  highlight?: Set<string> | null;
  command?: CameraCommand | null;
}

/** Relationship colours: causal links warm, associative links cool, provenance links neutral. */
export const EDGE_COLOR: Record<string, string> = {
  CAUSES: '#f0ba68',
  INFLUENCES: '#e0a37a',
  CORRELATES_WITH: color.cyan,
  ASSOCIATED_WITH: '#7aa2ff',
  PART_OF: color.violet,
  PRECEDES: '#c7d36b',
  LOCATED_IN: color.verified,
  MEASURES: '#f5a3d0',
  ABOUT: color.lineStrong,
};

const OFFSET = new THREE.Vector3(0, 0, -60);

function Node({
  item,
  state,
  onSelect,
  onHover,
}: {
  item: LaidOutNode;
  state: 'normal' | 'focus' | 'dim';
  onSelect: () => void;
  onHover: (on: boolean) => void;
}) {
  const r = state === 'focus' ? item.radius * 1.35 : item.radius;
  return (
    <mesh
      position={item.position}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        onHover(false);
        document.body.style.cursor = '';
      }}
    >
      {item.node.kind === 'entity' ? <sphereGeometry args={[r, 24, 16]} /> : <octahedronGeometry args={[r * 1.2, 0]} />}
      <meshStandardMaterial
        color={item.color}
        emissive={item.color}
        emissiveIntensity={state === 'focus' ? 0.9 : 0.35}
        transparent
        opacity={state === 'dim' ? 0.16 : 1}
        roughness={0.4}
      />
    </mesh>
  );
}

function Edges({ graph, layout, active }: { graph: KnowledgeGraph3DProps['graph']; layout: ReturnType<typeof layoutGraph>; active: Set<string> | null }) {
  const groups = useMemo(() => {
    const by = new Map<string, { on: number[]; off: number[] }>();
    for (const e of graph.edges) {
      const a = layout.byKey.get(e.source);
      const b = layout.byKey.get(e.target);
      if (!a || !b) continue;
      const g = by.get(e.type) ?? { on: [], off: [] };
      (!active || (active.has(e.source) && active.has(e.target)) ? g.on : g.off).push(...a.position, ...b.position);
      by.set(e.type, g);
    }
    const make = (arr: number[]) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      return geo;
    };
    return [...by.entries()].map(([type, g]) => ({ type, on: make(g.on), off: make(g.off) }));
  }, [graph.edges, layout, active]);
  useEffect(() => () => groups.forEach((g) => (g.on.dispose(), g.off.dispose())), [groups]);
  return (
    <>
      {groups.map((g) => (
        <group key={g.type}>
          <lineSegments geometry={g.on}>
            <lineBasicMaterial color={EDGE_COLOR[g.type] ?? color.cyanDeep} transparent opacity={0.75} />
          </lineSegments>
          <lineSegments geometry={g.off}>
            <lineBasicMaterial color={color.lineStrong} transparent opacity={0.18} />
          </lineSegments>
        </group>
      ))}
    </>
  );
}

/** Smoothly moves the camera and orbit target in response to reset / fit / focus commands. */
function CameraRig({ command, layout, home }: { command?: CameraCommand | null; layout: ReturnType<typeof layoutGraph>; home: THREE.Vector3 }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null };
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  useEffect(() => {
    if (!command) return;
    if (command.kind === 'focus' && command.key) {
      const n = layout.byKey.get(command.key);
      if (!n) return;
      const t = new THREE.Vector3(...n.position).add(OFFSET);
      const dir = camera.position
        .clone()
        .sub(controls?.target ?? new THREE.Vector3())
        .normalize();
      goal.current = { target: t, pos: t.clone().add(dir.multiplyScalar(Math.max(70, n.radius * 14))) };
    } else {
      const center = new THREE.Vector3();
      layout.nodes.forEach((n) => center.add(new THREE.Vector3(...n.position)));
      if (layout.nodes.length) center.divideScalar(layout.nodes.length);
      center.add(OFFSET);
      const dist = command.kind === 'fit' ? Math.max(180, layout.radius * 2.6) : home.length();
      goal.current = {
        target: command.kind === 'reset' ? OFFSET.clone() : center,
        pos: command.kind === 'reset' ? home.clone() : center.clone().add(new THREE.Vector3(0.15, 0.1, 1).normalize().multiplyScalar(dist)),
      };
    }
  }, [command, layout, camera, controls, home]);
  useFrame(() => {
    const g = goal.current;
    if (!g || !controls) return;
    camera.position.lerp(g.pos, 0.12);
    controls.target.lerp(g.target, 0.12);
    controls.update();
    if (camera.position.distanceTo(g.pos) < 0.5 && controls.target.distanceTo(g.target) < 0.5) goal.current = null;
  });
  return null;
}

/** Interactive 3D knowledge graph. Every node and edge comes from the API; nothing is generated here. */
export default function KnowledgeGraph3D({ graph, selectedKey, onSelect, highlight, command }: KnowledgeGraph3DProps) {
  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const [hovered, setHovered] = useState<string | null>(null);

  const active = useMemo(() => {
    if (selectedKey && layout.byKey.has(selectedKey)) return new Set([selectedKey, ...(layout.neighbours.get(selectedKey) ?? [])]);
    return highlight && highlight.size ? highlight : null;
  }, [selectedKey, highlight, layout]);

  const labelled = useMemo(() => {
    const top = layout.nodes
      .filter((n) => n.node.kind === 'entity')
      .sort((a, b) => (b.node.mention_count ?? 0) - (a.node.mention_count ?? 0))
      .slice(0, 12)
      .map((n) => n.node.key);
    const near = selectedKey ? [...(layout.neighbours.get(selectedKey) ?? [])].filter((k) => layout.byKey.get(k)?.node.kind === 'entity') : [];
    return new Set([...top, ...near, ...(selectedKey ? [selectedKey] : []), ...(hovered ? [hovered] : [])]);
  }, [layout, selectedKey, hovered]);

  const distance = Math.max(300, layout.radius * 3.2);
  const home = useMemo(() => new THREE.Vector3(distance * 0.2, distance * 0.12, distance), [distance]);

  return (
    <Canvas camera={{ position: home.toArray(), fov: 45, near: 1, far: distance * 8 }} dpr={[1, 1.75]} onPointerMissed={() => onSelect(null)}>
      <color attach="background" args={[color.abyss]} />
      <fog attach="fog" args={[color.abyss, distance * 1.4, distance * 4]} />
      <ambientLight intensity={0.6} />
      <pointLight position={[200, 200, 300]} intensity={1.2} decay={0} />
      <group position={OFFSET.toArray()}>
        <Edges graph={graph} layout={layout} active={active} />
        {layout.nodes.map((item) => {
          const key = item.node.key;
          const state = key === selectedKey ? 'focus' : active && !active.has(key) ? 'dim' : 'normal';
          return (
            <group key={key}>
              <Node item={item} state={state} onSelect={() => onSelect(key)} onHover={(on) => setHovered((h) => (on ? key : h === key ? null : h))} />
              {labelled.has(key) && state !== 'dim' && (
                <Html position={[item.position[0], item.position[1] + item.radius + 4, item.position[2]]} center distanceFactor={260} zIndexRange={[10, 0]}>
                  <span className="pointer-events-none select-none whitespace-nowrap rounded bg-void/80 px-1.5 py-0.5 text-[11px] text-ink">
                    {item.node.kind === 'claim' ? `${item.node.label.slice(0, 48)}…` : item.node.label}
                  </span>
                </Html>
              )}
            </group>
          );
        })}
      </group>
      <OrbitControls enableDamping dampingFactor={0.12} minDistance={30} maxDistance={distance * 4} makeDefault />
      <CameraRig command={command} layout={layout} home={home} />
    </Canvas>
  );
}
