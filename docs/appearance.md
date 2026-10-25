# Editor appearance

Configure presentation through the public API, without accessing editor-owned map
layers or modifying GeoJSON. Defaults preserve the existing green features, blue
selection, orange dotted drafts and white editing handles.

```ts
import { GeometryEditor, type EditorAppearanceOptions } from '@geo/editor';

const appearance: EditorAppearanceOptions = {
  feature: { lineColor: '#0369a1', fillColor: '#38bdf8', lineWidth: 4 },
  selected: { lineColor: '#6d28d9', fillColor: '#a78bfa', fillOpacity: 0.35 },
  draft: { lineColor: '#0f766e', fillColor: '#2dd4bf', secondaryFillColor: '#f59e0b' },
  vertex: { strokeColor: '#0f766e', activeColor: '#0f766e', radius: 6 },
  midpoint: { strokeColor: '#0f766e' },
};

const editor = new GeometryEditor(map, { appearance });
const original = editor.getAppearance();
editor.setAppearance({ selected: { lineWidth: 8 } });
editor.setAppearance(original); // Restore the complete captured appearance.
```

Create the editor after the MapLibre style has initialized, as usual.
`LineEditor` accepts the same constructor option and exposes the same methods.

## Patch and event contract

- `getAppearance(): EditorAppearance` returns a complete independent snapshot.
  Mutating it, constructor options or an earlier patch never changes the editor.
  Like exported committed data, this snapshot remains readable after destruction.
- `setAppearance(patch: EditorAppearanceOptions): void` merges individual fields.
  Omitted fields keep their current values. `{}` is a no-op; it does **not** reset
  defaults. Capture a complete initial appearance to implement reset.
- All fields are validated before applying anything. An invalid field rejects the
  whole patch and leaves current paint, settings, geometry and events untouched.
  Invalid constructor appearance reserves no map resources or editor ownership.
- A changed patch emits one ordinary `onChange` notification, with unchanged
  `EditorState`. Consumers can read `getAppearance()` there. Identical field
  values (after lowercasing hex colors) emit nothing and make no paint calls.
- No create/update/delete/transaction/history event is emitted. No data revision,
  GeoJSON, IDs, properties, selected IDs, Undo/Redo action or saved application
  snapshot changes.
- Updates are supported during drawing, editing, overlays, transforms and shape
  dragging. They do not finish or cancel the active operation. Changing settings
  after `destroy()` throws.
- Settings survive `map.setStyle(...)`, including updates made while replacement
  layers are loading. They are per editor instance and are not persisted by the
  library or included in exported GeoJSON.

## Settings

Every group is optional; every field within a group is optional when patching.
`getAppearance()` returns all of them.

**ShapeAppearance** (`feature` and `selected`):

| Field | Meaning | Default feature / selected |
| --- | --- | --- |
| `lineColor` | Line and polygon-outline color | `#116b5b` / `#2563eb` |
| `lineWidth` | Outline width in CSS pixels | 4 / 6 |
| `lineOpacity` | Outline opacity | 1 / 1 |
| `fillColor` | Polygon interior color | `#116b5b` / `#2563eb` |
| `fillOpacity` | Polygon interior opacity | 0.18 / 0.3 |

`draft` uses **DraftAppearance**, the same fields plus `secondaryFillColor`.
Defaults: line/fill `#df772e`, width 3, line opacity 1, fill opacity 0.22,
secondary fill `#7c3aed`. Secondary fill distinguishes the second result in split
and shared-boundary previews. All preview outlines use the primary draft line
color. Translation previews use the draft fill and outline, including the short
period after release while the map worker processes committed geometry.

Draft outlines retain their fixed dotted pattern (nine CSS pixels between centers,
anchored to each edge). Width changes the dot diameter; it does not select a
different dash pattern. Large widths can make neighboring dots overlap.
Editing corner insets retain their existing spacing.

**PointAppearance** (`midpoint` and `pivot`, also the basis for `vertex`/`snap`):

- `color`: circle interior color.
- `radius`: circle radius in CSS pixels.
- `opacity`: circle interior opacity (the stroke remains opaque).
- `strokeColor` and `strokeWidth`: outline color and width.

| Group | Color | Radius | Opacity | Stroke color / width | Additional fields |
| --- | --- | --- | --- | --- | --- |
| `vertex` | `#fff` | 5 | 1 | `#df772e` / 2 | `activeColor: '#df772e'`, `activeRadius: 7`, `lockedColor: '#64748b'` |
| `midpoint` | `#fff` | 4 | 1 | `#df772e` / 1 | None |
| `snap` | `#7c3aed` | 8 | 0.85 | `#fff` / 3 | `edgeRadius: 6` |
| `pivot` | `#fff` | 6 | 1 | `#1e293b` / 3 | None |

`vertex` uses **VertexAppearance**. Locked shared-boundary endpoints use
`lockedColor`; it takes priority over `activeColor`. Active vertices use
`activeRadius`. `snap` uses **SnapAppearance**: `radius` is for vertex snaps,
`edgeRadius` for edge snaps. `pivot` styles the rotation/scale center.

## Validation and scope

Colors accept literal `#RGB` or `#RRGGBB` (case insensitive, normalized to
lowercase). Named colors, alpha hex, CSS variables, `currentColor`, CSS functions,
URLs, callbacks and MapLibre expressions are not accepted. This deliberate common
subset renders consistently in MapLibre paint and the SVG preview. Use opacity
fields instead of embedding alpha in colors.

All numeric values must be finite. Opacities are in [0, 1], widths/radii in [0, 32]
CSS pixels, except `strokeWidth` in [0, 16]. Zero is accepted. Unknown groups,
unknown fields, null, explicit undefined fields and invalid structures are rejected.
Color/structure errors throw `TypeError`; invalid numeric values throw `RangeError`.

Settings control presentation, not permissions or snapping. A transparent or
zero-width shape is not protected from editing. Vertex acquisition margins,
snapping tolerance and selection policy are unchanged; wider rendered outlines
can affect outline picking because MapLibre queries the rendered strokes. Large
handle radii do not expand the vertex interaction's acquisition distance.
Keep sizes usable for the application and use separate operation restrictions
when those become available.

The contract is global per editor. Per-feature styling, CSS-driven themes,
custom icons, layer ordering and a theme registry are outside this milestone.
Basemap styling belongs to the application's MapLibre style. The examples' presets
are illustrative palettes, not a claim of accessibility certification.

## Implementation and checks

The pure core appearance module owns types, defaults, patch merging and validation.
The MapLibre renderer regenerates its owned layer definitions and updates paint
properties in place; it does not replace sources or upload geometry. Missing
layers receive the current settings when remounted after a style change.

SVG overlays are updated without removing them or interrupting a drag/commit
handoff. Color/opacity changes reuse path geometry; changing draft width recomputes
projected dots with a clipping margin that includes their new radius. Offscreen
work remains bounded by visible edge intervals.

Both the [playground](../examples/basic/) and the
[area workspace](../examples/workspace/) expose **Map colors** with Original,
Ocean and High contrast presets. A preset is one full appearance patch and can be
changed while drawing or editing. The workspace does not mark geometry dirty or
save appearance in its local geometry document.

Unit tests cover validation, partial merging, isolation and wide-dot clipping.
Real Chromium tests cover paint, editing/split/snap/transform previews, style
replacement, separate instances, the legacy facade, invalid constructors,
no-op notifications, no source uploads, no color-only reprojection, live dragging
and its delayed worker handoff. Both the playground and installed workspace test
their controls and unchanged exports/history. No new runtime dependency is added.
