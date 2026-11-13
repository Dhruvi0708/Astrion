import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { color } from '@/design/tokens';
import type { WorkspaceGraph } from '@/lib/api/types';
import { layoutGraph, type LaidOutNode } from './layout3d';

export interface KnowledgeGraph3DProps {
  graph: Pick<WorkspaceGraph, 'nodes' | 'edges'>;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  /** Keys to emphasise (e.g. the claims behind a selected hypothesis). Others dim. */
  highlight?: Set<string> | null;
}

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
  const opacity = state === 'dim' ? 0.18 : 1;
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
      <sphereGeometry
        args={[state === 'focus' ? item.radius * 1.35 : item.radius, item.node.kind === 'entity' ? 24 : 10, item.node.kind === 'entity' ? 16 : 8]}
      />
      <meshStandardMaterial
        color={item.color}
        emissive={item.color}
        emissiveIntensity={state === 'focus' ? 0.9 : 0.35}
        transparent
        opacity={opacity}
        roughness={0.4}
      />
    </mesh>
  );
}

function Edges({ graph, layout, active }: { graph: KnowledgeGraph3DProps['graph']; layout: ReturnType<typeof layoutGraph>; active: Set<string> | null }) {
  const [strong, faint] = useMemo(() => {
    const s: number[] = [];
    const f: number[] = [];
    for (const e of graph.edges) {
      const a = layout.byKey.get(e.source);
      const b = layout.byKey.get(e.target);
      if (!a || !b) continue;
      const on = !active || (active.has(e.source) && active.has(e.target));
      (on ? s : f).push(...a.position, ...b.position);
    }
    const make = (arr: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      return g;
    };
    return [make(s), make(f)];
  }, [graph.edges, layout, active]);
  return (
    <>
      <lineSegments geometry={strong}>
        <lineBasicMaterial color={color.cyanDeep} transparent opacity={0.7} />
      </lineSegments>
      <lineSegments geometry={faint}>
        <lineBasicMaterial color={color.lineStrong} transparent opacity={0.25} />
      </lineSegments>
    </>
  );
}

/** Interactive 3D knowledge graph. Every node and edge comes from the API; nothing is generated here. */
export default function KnowledgeGraph3D({ graph, selectedKey, onSelect, highlight }: KnowledgeGraph3DProps) {
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
    return new Set([...top, ...(selectedKey ? [selectedKey] : []), ...(hovered ? [hovered] : [])]);
  }, [layout, selectedKey, hovered]);

  const distance = Math.max(300, layout.radius * 3.2);

  return (
    <Canvas
      camera={{ position: [distance * 0.2, distance * 0.12, distance], fov: 45, near: 1, far: distance * 6 }}
      dpr={[1, 1.75]}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={[color.abyss]} />
      <ambientLight intensity={0.6} />
      <pointLight position={[200, 200, 300]} intensity={1.2} decay={0} />
      <group position={[0, 0, -60]}>
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
      <OrbitControls enableDamping dampingFactor={0.12} minDistance={60} maxDistance={distance * 3} makeDefault />
    </Canvas>
  );
}
