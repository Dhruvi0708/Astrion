# Design System

ASTRION should read as a scientific instrument, not a SaaS template: dark, precise, layered, with light used sparingly to mean something.

## Tokens

Defined once as CSS variables in `frontend/src/styles/globals.css` (RGB channels so Tailwind alpha modifiers work) and mirrored for Canvas/Three.js in `frontend/src/design/tokens.ts`.

| Token | Value | Use |
|---|---|---|
| `void` | `#04060b` | Landing background |
| `abyss` | `#070a12` | App background |
| `deep` | `#0a0e1a` | Recessed regions, canvases, inputs |
| `surface` | `#0e1321` | Panels |
| `raised` | `#141b2d` | Hover / selected |
| `line` / `line-strong` | `#1c253d` / `#2c3858` | Blue-grey borders |
| `ink` | `#e6ecf6` | Primary text (soft white) |
| `ink-muted` / `ink-faint` | `#8b97ad` / `#5a6680` | Secondary / tertiary text |
| `cyan` | `#4fe3f0` | Primary accent: selection, primary actions, live signal |
| `violet` | `#9d8cff` | Secondary accent: hypotheses, AI-proposed content |
| `verified` | `#5ee0a5` | Verified / supporting evidence / live |
| `caution` | `#f0ba68` | **Sample** content |
| `conflict` | `#ff7a8a` | Contradictions, errors |
| `gap` | `#7aa2ff` | Knowledge gaps |

Semantic colours are reserved: amber always means *sample*, violet always means *hypothesis/proposed*, red always means *conflict or failure*.

## Typography

- **Space Grotesk** (variable) — headings, product text, eyebrows.
- **Inter** (variable) — interface and body text.
- Self-hosted via `@fontsource-variable/*` (no third-party font requests).
- Scale: hero 5.1rem / section 2.75rem / page title 1.85rem / panel title 0.9rem / body 0.85–1rem / meta 0.6875rem (`text-2xs`).
- Eyebrows: 0.6875rem, uppercase, 0.18em tracking, `ink-faint`.

## Components (`frontend/src/components`)

| Component | Notes |
|---|---|
| `Button`, `ButtonLink` | primary (cyan, glow), secondary, outline, ghost, danger; sm/md/lg/icon |
| `Badge`, `SampleBadge`, `PlannedBadge` | Epistemic labels; tone map in Badge.tsx |
| `Panel` | The single bordered surface; header with eyebrow/title/actions |
| `PageHeader`, `Page`, `Notice` | Consistent environment header; notices explain sample/planned status |
| `EmptyState`, `ErrorState`, `Skeleton(Rows)` | Every async region uses these |
| `Dialog`, `Popover` | Focus trap / Escape / outside click |
| `Field`, `Input`, `Textarea`, `Select` | Inline validation, `aria-invalid` |
| `Segmented`, `Meter` | Radio-group control; confidence meter |

## Shape, depth, motion

- Radii are small (4–10px); panels are not pill-shaped.
- Depth comes from layered surfaces and hairline borders, not heavy shadows or glassmorphism. Blur is used only on floating overlays above canvases.
- Glow is reserved for the active/selected element and the primary CTA.
- Motion: expo-out easing (`[0.16, 1, 0.3, 1]`), 150–350ms for UI, ~1s for hero entrance. `prefers-reduced-motion` and the in-app *Reduce motion* setting slow the 3D scene and disable decorative animation.

## Data visualisation

- Graph: node shape encodes kind (circle concept, diamond claim, square source, dashed ring hypothesis); colour encodes cluster; edge colour/dash encodes relation (dashed red contradicts, dotted violet hypothesized).
- Simulation chart: one axis, baseline dashed `#8574e6`, alternative solid `#1fa3b1`. This pair was validated with the dataviz palette validator on the `surface` colour (lightness band, chroma, CVD ΔE 11.5, normal ΔE 18.5, contrast ≥ 3:1 — all PASS). Direct labels + legend + table view; crosshair tooltip.
- Charts never show decorative numbers; every value states whether it is sample, computed-from-sample, or live.

## Accessibility

- Semantic landmarks, one `h1` per page, skip link, breadcrumbs with `aria-current`.
- Focus-visible ring in cyan on every interactive element.
- Canvas graph is keyboard operable (arrows, +/−, 0, Esc) and every node is reachable through search and the inspector's relationship list.
- Status is never colour-only: badges carry text.
