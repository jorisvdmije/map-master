# Object colors and overlap stripes

The global [appearance](appearance.md) remains the default. Optional style rules
let applications choose colors from properties or external state, configure
selection overrides and order features without accessing editor-owned map layers.
Nothing implicitly interprets a property named `color`, `category` or `style`.

```ts
const editor = new GeometryEditor(map, {
  styling: {
    feature: feature => ({
      shape: {
        fillColor: feature.properties?.category === 'park' ? '#1b998b' : '#ed8b34',
        fillOpacity: 0.35,
      },
      sortKey: typeof feature.properties?.priority === 'number'
        ? feature.properties.priority : 0,
    }),
    // Only replace the selected outline; preserve each object's fill.
    selected: { shape: { lineColor: '#2563eb', lineWidth: 6 } },
    overlap: { enabled: true, stripeWidth: 12, opacity: 0.7 },
  },
});
```

`GeometryEditor` and the `LineEditor` facade expose:

- `setStyling(options: EditorStylingOptions)`: **replace** the complete ruleset.
  Unlike `setAppearance`, this is not a field patch. `{}` restores global themes
  and normal alpha blending. To change one option, spread `getStyling()` and its
  relevant nested group. Settings also work during an active operation.
- `getStyling()`: an isolated settings snapshot. Function references are retained;
  arrays and objects are copied. There are no serialized callbacks in GeoJSON.
- `refreshStyling()`: rerun rules after changing external application state.
- `getStylingIssues()`: copied diagnostics from the latest styling evaluation.
  Each has `kind: 'feature' | 'overlap'`, a message and, for feature errors, a
  typed `featureId`. Read it in `onChange` to display application feedback.

Setting or refreshing styling emits one `onChange`. It does not change data
revision, selection, drafts, feature IDs, geometry, properties or Undo/Redo, and
emits no transaction events. Both setters throw after destruction. Constructor
settings are validated before acquiring editor resources. Settings and images
survive `map.setStyle`; destruction removes all owned sources, layers, images and
listeners. Host basemap styles are unchanged.

## Object and selection rules

`feature(feature)` returns a `FeatureStyle`, `null` or `undefined`:

- `shape`: partial `ShapeAppearance`, for polygon fills, outlines and lines.
- `marker`: partial `PointAppearance`, for points.
- `sortKey`: a finite number, default 0. Higher values draw later within each
  fill, line or marker layer. Equal values retain source order. All outlines
  remain above all polygon fills, and markers above outlines. This is not a
  general cross-layer z-index. Picking follows the same order, retaining the
  existing preference for nearby outlines/markers over polygon interiors.

Omitted fields inherit the current global `appearance.feature` or
`appearance.marker`. Zero opacity/width is valid and does not change permissions.
`selected` is optional. Omit it to use the full global selected theme; provide
`{}` to retain every object style; or override only the fields you want to change.
Selection does not change sort order or automatic stripe color order.

Callbacks receive independent feature snapshots. Treat them as synchronous, pure
functions: do not call editor mutation methods from them. They run on committed
data changes, configuration changes and explicit refresh, not on selection,
camera movement or pointer movement. Theme changes update fallback fields but
do not rerun the feature callback; explicitly refresh if it reads external theme
state. Shape/marker values use the same literal hex colors and numeric bounds as
the global appearance API. MapLibre expressions and CSS functions are not accepted.

Invalid configuration rejects the whole setter before any settings change.
Runtime callback exceptions or invalid returned styles fall back to the global
style for that feature and produce a diagnostic. They never invalidate a data
transaction or prevent Undo. An invalid overlap callback or geometry calculation
disables the derived fill for that evaluation and restores ordinary alpha
blending for all polygons. Fix the rule and refresh to recover.

## Striped overlap

With `overlap.enabled: true`, polygon interiors are partitioned into disjoint
regions with the exact set of contributing features. Only regions covered by
two or more features use stripes. Holes are excluded, multipart features count
as one member, and boundary-only contact has no overlap area. Three-way overlap
cycles through three colors instead of stacking pairwise patterns. The unselected
fill color of each member supplies the automatic palette, ordered by serialized
typed feature ID (so `7` and `"7"` remain distinct). Repeated colors are retained.

```ts
// A fixed palette, independent of source colors.
editor.setStyling({
  ...editor.getStyling(),
  overlap: {
    enabled: true,
    palette: ['#1b998b', '#ed8b34', '#7764c0'],
    stripeWidth: 14,
    direction: 'ascending',
    opacity: 0.65,
  },
});

// Different colors for different combinations of application categories.
editor.setStyling({
  ...editor.getStyling(),
  overlap: {
    enabled: true,
    palette: members => members.some(m => m.feature.properties?.category === 'water')
      ? ['#0284c7', '#fbbf24']
      : members.map(m => m.color),
  },
});
```

`palette` accepts 1–16 literal hex colors or a synchronous callback returning
them. A single color is a solid overlap fill. Omit it for automatic colors.
Palette callbacks receive `{ feature, color }` snapshots in stable ID order,
once per member combination per restyle. A palette can have a different number
of colors than the number of contributing polygons.

`stripeWidth` is 2–32, default 12; `direction` is `ascending` (↗, default) or
`descending` (↘); `opacity` is 0–1, default 0.7. Width is the perpendicular band
width in CSS pixels at integer zoom in a flat Mercator view. Patterns are anchored
to the map, rotate with bearing and foreshorten with pitch. MapLibre's native
pattern scaling applies between integer zoom levels; these are not screen-fixed
SVG stripes. Images use seamless power-of-two tiles with a matching pixel ratio.
See the [MapLibre fill-pattern contract](https://maplibre.org/maplibre-style-spec/layers/#fill-pattern).

The overlap fill is composited **once** over the basemap at its own opacity.
Original polygon fills are excluded there, avoiding additional darkening or color
mixing underneath the bands. Original outlines remain visible above the stripes.
Selected outlines can change without changing any band colors. Single-covered
regions retain their own object/selection fill and opacity.

## Editing, persistence and geometry operations

Overlap is a derived display, never a collection of extra editable features.
Export, picking, snapping, locks and history still use the original objects.
While any committed feature is hidden for an edit/transform/drag preview, the
whole partition display is suspended and ordinary fills plus the global draft
theme are shown. This avoids stale overlap areas and expensive clipping on every
pointer move. Cancel restores the cached partition; saving recomputes it from
committed geometry. New drawings use the global draft theme until committed.

To save a user's chosen color, the **application** updates a property through
`applyTransaction`, then maps that property in its resolver. That is a document
change with normal lock validation and Undo. A theme/palette change is presentation
only. The demo uses its own `demoColor` and `demoOrder` properties; these names have
no special meaning in the library. External ID-to-style maps are another option;
call `refreshStyling` when their entries change and manage new IDs yourself.

Existing operation policies determine property inheritance: duplication and split
copy source properties; union/intersection retain the first selected feature's
properties; difference retains target properties; transforms keep each feature's
properties. The resolver runs again on the results. No automatic semantic merging
of categories or colors is inferred. Undo restores original properties and colors.

## Cost, limits and checks

Styling is opt-in. Committed style changes upload render attributes; selection
uses feature state without geometry uploads or callback evaluation. Overlap
partitioning is synchronous, uses the existing `polygon-clipping` dependency in
the Mercator plane and rejects coordinates outside ±85.0511287798066° latitude.
Bounding boxes skip disjoint cells. Geometry is cached independently of colors,
palette, selection, zoom, bearing and pitch. Property-only changes reuse the
partition; changes to coordinates/IDs/order invalidate it.

The initial bounded implementation accepts at most 1,000 polygon features,
20,000 input vertices, 4,096 regions and 10,000 intersecting cell checks; a
cumulative generated-vertex budget of 200,000 also bounds fragmentation. At most
128 distinct patterns and 8 MiB of retained/pending texture pixels are allowed.
Unused images are removed when the map becomes idle. If rapid restyles exhaust
the texture cache before idle, refresh afterwards. Automatic palettes containing
more than 16 members require an explicit smaller palette. Exceeding a limit
produces a diagnostic and ordinary fills, never partial or outdated stripes.
These bounds are resource policies, not a guarantee of frame-time performance
for every geometry. A worker-based solution for larger datasets is future work.

`npm run benchmark:styling` measures uncached partitioning and cached restyling
on fixed disjoint, three-member-group and dense workloads. It excludes source
workers/GPU rendering; the full `npm run check` also covers the installed-consumer
latency/lifecycle budgets with default styling. Unit tests cover topology,
validation, stability and texture generation; real Chromium tests cover picking,
selected styles, actual rendered pixels, palette refresh, previews, data/history,
style replacement, failure fallback and cleanup. The playground tests its optional
color picker, overlap controls and Undo through the public API.

Local baseline (2026-10-26, Node 22.23.1, Apple M2 Pro, macOS arm64),
20 measured runs after three warmups; median / p95 in milliseconds:

| Workload | Polygons | Regions | Partition | Cached restyle |
| --- | ---: | ---: | ---: | ---: |
| Disjoint | 1,000 | 1,000 | 4.757 / 5.928 | 4.321 / 4.934 |
| Groups of three | 999 | 1,665 | 62.331 / 65.837 | 7.021 / 7.570 |
| Dense | 30 | 59 | 23.067 / 24.437 | 0.322 / 0.368 |

The dense workload uses an explicit three-color palette. Hardware, geometry and
concurrent load affect these observations; they are not production latency SLAs.
