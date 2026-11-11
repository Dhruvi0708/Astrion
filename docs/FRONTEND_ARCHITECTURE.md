# Frontend Architecture

Stack: React 18.3, TypeScript 5.6 (strict), Vite 5.4, Tailwind CSS 3.4.15 (locked), Framer Motion 11, Three.js 0.170 + React Three Fiber 8 + Drei 9, d3-force 3, Zustand 5, TanStack Query 5, React Router 6.28, lucide-react. All versions pinned exactly in `package.json`.

## Folder structure

```
frontend/src
├── main.tsx                 QueryClient, MotionConfig, RouterProvider
├── app/
│   ├── router.tsx           Route table (lazy, code-split per environment)
│   ├── navigation.ts        Single source of truth for nav items
│   ├── NotFoundPage.tsx
│   └── shell/               AppShell, Sidebar, Topbar, MobileNav, CommandPalette, WorkspaceSelector, PageLoader
├── components/
│   ├── ui/                  Design-system primitives
│   ├── layout/PageHeader    Page, PageHeader, Notice
│   ├── feedback/            ErrorBoundary
│   └── brand/Logo
├── design/tokens.ts         Token mirror for Canvas / WebGL
├── data/sample/             Labelled sample datasets (graph, agents, discoveries, investigations)
├── features/
│   ├── landing/             LandingPage, hero (R3F scene + SVG fallback), sections
│   ├── universe/            GraphCanvas engine, layout, inspector, legend, explorer page
│   ├── overview/ investigation/ agents/ discovery/ simulation/ sources/ settings/ workspaces/
├── lib/
│   ├── api/                 client.ts (typed fetch + ApiError), types.ts, hooks.ts (TanStack Query)
│   ├── hooks.ts             useInView, useReducedMotionPreference, useMediaQuery
│   └── cn.ts, format.ts, webgl.ts
├── stores/ui.ts             Zustand: UI state (ephemeral) + preferences (persisted)
└── styles/globals.css       Tokens + Tailwind layers
```

## Routing

| Path | Environment |
|---|---|
| `/` | Landing |
| `/app` → `/app/overview` | Overview |
| `/app/universe?node=<id>` | Universe Explorer (deep-linkable selection) |
| `/app/investigations?i=<id>` | Investigation Room |
| `/app/intelligence` | Intelligence Network |
| `/app/discovery?d=<id>` | Discovery Laboratory |
| `/app/simulation` | Simulation Laboratory |
| `/app/sources?new=1` | Sources (`new=1` opens the register dialog) |
| `/app/settings` | Settings |
| `*` | 404 |

Each environment is a lazy chunk wrapped in the shell's `Suspense` and a per-route `ErrorBoundary` (keyed by path, so a crash in one environment never takes down navigation).

## State

- **Server state** — TanStack Query only (`lib/api/hooks.ts`). Query keys are centralised. Retries happen once and only for outages (`ApiError.isUnavailable`), never for 4xx.
- **UI state** — Zustand `useUi` (command palette, mobile nav, create-workspace dialog).
- **Preferences** — Zustand `usePreferences` persisted to localStorage with an in-memory fallback (active workspace, sidebar collapse, reduce motion, graph label density).
- **URL state** — selections that should be shareable (`node`, `i`, `d`, `new`).

## API client

`request<T>()` wraps `fetch`, attaches JSON headers, parses the ASTRION error envelope into `ApiError { status, code, kind, details, requestId }`. A network failure, a bare non-envelope 5xx (e.g. dev proxy without backend) or an HTML success response are treated as **unavailable**, which the UI renders as "Backend unavailable — Retry" instead of a generic error.

## 3D hero (`features/landing/hero`)

- `HeroScene` is loaded with `React.lazy` → Three.js (~830 KB raw / 224 KB gzip) is fetched only on the landing page.
- Geometry generated once (`universeData.ts`): 7 clusters × 24 nodes + bridge nodes as one `Points` draw call with a custom soft-glow shader; relationships as one `LineSegments`; cluster hubs as one `InstancedMesh`; ~110 travelling signal particles as one `Points` whose buffer is mutated in `useFrame`; a fresnel-shaded core with lattice and orbital rings; a starfield.
- No React state changes per frame. Pointer is read from a window listener into a ref; motion is damped.
- `frameloop` switches to `"never"` when the hero leaves the viewport (IntersectionObserver).
- `PerformanceMonitor` lowers DPR on slow devices; DPR capped at 1.75.
- Fallbacks: no WebGL → SVG constellation; render error → same SVG via ErrorBoundary.

## Graph engine (`features/universe/graph`)

- `layout.ts` runs a seeded d3-force simulation **once** (320 ticks, cluster attraction) and caches per graph → deterministic, no per-frame physics.
- `GraphCanvas.tsx` renders with Canvas 2D: camera in refs, redraw on demand via `requestAnimationFrame`, continuous loop only while animating a camera transition or showing selected-edge signal pulses, and paused off-screen.
- Interaction: drag pan, wheel/pinch zoom around cursor, hit-tested selection, hover, keyboard controls; imperative handle (`zoomIn`, `zoomOut`, `fit`, `focusNode`, `focusCluster`).
- `wheelZoom="modifier"` on the landing preview so page scrolling is never hijacked.

## Conventions

- Feature folders own their components; shared primitives live in `components/ui`.
- Sample data lives only in `data/sample` and every file starts with a disclaimer.
- No secrets or provider calls in the frontend.
