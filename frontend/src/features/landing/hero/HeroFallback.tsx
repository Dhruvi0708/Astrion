import { useMemo } from 'react';

/** Vector constellation shown when WebGL is unavailable or the 3D scene fails. */
export function HeroFallback() {
  const { nodes, links } = useMemo(() => {
    let seed = 11;
    const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const centres = Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * Math.PI * 2;
      return { x: 300 + Math.cos(a) * 190, y: 300 + Math.sin(a) * 150 };
    });
    const nodes = centres.flatMap((c, ci) =>
      Array.from({ length: 10 }, () => ({ x: c.x + (r() - 0.5) * 120, y: c.y + (r() - 0.5) * 110, s: 1 + r() * 2.4, ci })),
    );
    const links = nodes.map((n, i) => ({ a: n, b: nodes[(i + 3) % nodes.length] })).filter((_, i) => i % 2 === 0);
    return { nodes, links: [...links, ...centres.map((c) => ({ a: { x: 300, y: 300 }, b: c }))] };
  }, []);
  return (
    <svg viewBox="0 0 600 600" className="h-full w-full" aria-hidden>
      <defs>
        <radialGradient id="hf-core">
          <stop offset="0" stopColor="#4fe3f0" stopOpacity="0.9" />
          <stop offset="1" stopColor="#4fe3f0" stopOpacity="0" />
        </radialGradient>
      </defs>
      {links.map((l, i) => (
        <line key={i} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke={i % 5 === 0 ? '#9d8cff' : '#4fe3f0'} strokeOpacity={0.18} strokeWidth={0.8} />
      ))}
      {nodes.map((n, i) => (
        <circle key={i} cx={n.x} cy={n.y} r={n.s} fill={n.ci % 3 === 1 ? '#9d8cff' : n.ci % 3 === 2 ? '#e6ecf6' : '#4fe3f0'} fillOpacity={0.8} />
      ))}
      <circle cx="300" cy="300" r="60" fill="url(#hf-core)" opacity="0.5" />
      <circle cx="300" cy="300" r="10" fill="#bff7fb" />
      <ellipse cx="300" cy="300" rx="120" ry="40" fill="none" stroke="#4fe3f0" strokeOpacity="0.3" transform="rotate(-20 300 300)" />
    </svg>
  );
}
