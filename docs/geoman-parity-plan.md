# Geoman comparison: implementation plan

This plan covers the ten remaining capabilities identified in the comparison
thread `2aa7bbcb-76bf-4aad-8d58-6e2b735f1263`. It builds on the shapes,
measurements, cutting, multipart tools and external-layer snapping already
implemented. It does not claim that either product is better in every respect.
Reference: [Geoman MapLibre documentation](https://geoman.io/docs/maplibre).

## Delivery rules

Each step includes a public typed API, toolbar controls where appropriate,
keyboard access, cancellation and cleanup, a guide and a working map example.
Geometry changes preserve IDs/properties, respect locks, validate before
committing and produce one undoable transaction. Tests cover successful use,
invalid input and cancellation. Run `npm run check` before completing a step.

## Ordered steps

1. **Remove polygon holes through the toolbar** — Implemented; see the
   [guide and live example](remove-hole.md). Select a polygon
   or multipolygon, choose a hole on the map or from an accessible list, preview
   the filled result, then Apply or Cancel. Prevent filling a hole occupied by
   another component. Undo restores the exact original geometry. Existing
   `deleteHole()` remains available for immediate programmatic removal.
2. **Lasso selection** — Implemented; see the [guide and live example](lasso.md).
   Draw a freehand selection region with a dedicated tool.
   Define intersection versus containment explicitly, support add/subtract
   selection, deduplicate multipart hits and keep holes empty. Selection never
   changes exported data or history; Escape discards a pending gesture.
3. **Configurable keyboard shortcuts** — Implemented; see the
   [shortcut reference and live example](keyboard-shortcuts.md). Typed action
   bindings retain existing defaults and support runtime remapping, disabling,
   platform modifiers and atomic conflict validation. Canvas focus, input fields,
   composition, AltGraph and repeats are handled explicitly. Toolbar hints and
   editing/gesture commands follow the current bindings without rebuilding.
4. **Text markers** — Implemented; see the [guide and live example](text-markers.md). Create and edit labels as Point features with documented
   GeoJSON properties. Add safe text rendering, label styling, keyboard input,
   movement, duplication, locks and exact undo/redo. Imported/exported labels
   round-trip without losing text or styling.
5. **Reusable shape templates** — Implemented; see the [guide and live example](shape-templates.md). Accept validated GeoJSON templates and provide
   example arrows and stars. Preview placement, size and rotation before one
   commit. Support template properties, reject invalid transforms and allow
   application-defined template pickers through the toolbar API.
6. **Alignment guides** — Implemented; see the [guide and live example](alignment-guides.md).
   Horizontal/vertical and extension guides support drawing, vertex editing and
   movement, with CSS-pixel tolerances, ordinary snapping/constraint priority,
   Alt bypass, toolbar/keyboard toggles and lifecycle cleanup. Candidate searches
   are capped; fixed-dataset query and browser pointer timings are recorded in
   [performance notes](performance.md#alignment-guides).
7. **Pin shared vertices** — Implemented; see the [guide and live example](vertex-pinning.md).
   Explicit exact/tolerant linking and merging persist in validated GeoJSON
   metadata. Vertex edits and whole-feature translation preview all participants
   and commit one transaction, including points, holes and multipart components.
   Covers current addresses, stable coordinate membership, locks, invalid results,
   unlinking, deletion, detached duplicates, cancellation and exact history.
8. **Geofencing** — Implemented; see the [guide and live example](geofencing.md).
   Validated allowed/excluded area unions support explicit containment and
   intersection rules, including boundary contacts, holes and multipart geometry.
   The same policy blocks invalid drawing, editing, transforms, linked moves,
   imports, transactions and history replay atomically. Includes correctable
   previews, typed diagnostics, accessible toolbar/shortcut controls and reference
   overlays independent of editable data.
9. **Multiple editable data layers** — Implemented; see the [guide and live example](data-layers.md).
   Stable IDs and GeoJSON memberships support active drawing targets, native
   bottom-to-top rendering, base styles, visibility, selection scope, reference
   snapping and layer locks. Atomic membership moves, imports, transactions,
   linked edits and history respect current layer policy. Includes an accessible
   layer control and separate editable, reference and hidden example datasets;
   external basemap snapping remains a separate API.
10. **Mapbox GL JS adapter** — Implemented; see the [setup guide and example](mapbox.md).
    A minimal structural GL map boundary supports both renderers without importing
    either one. The `/mapbox` entry point shares the API; existing MapLibre imports
    remain compatible and optional peers avoid installing the other renderer.
    Equivalent geometry, gesture, lifecycle and style-reload tests run on MapLibre
    6.15.0 and Mapbox 3.34.1. The guide documents token/CSS/worker setup, tested
    builds and remaining qualification limits.

## Follow-up qualification

These ten steps cover the gaps named in the original comparison. Track broader
work separately on the [roadmap](roadmap.md): full browser/input qualification,
removing individual multipart components, broader line/polygon splitting and
performance improvements. Verify upstream behavior again before each step;
this is a scoped backlog, not a permanent feature ranking.
