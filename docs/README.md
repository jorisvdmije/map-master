# Documentation

The [documentation site](https://jorisvdmije.github.io/map-master/) renders these
guides with search and live examples. New users should start with the
[quickstart](https://github.com/jorisvdmije/map-master/blob/main/website/content/quickstart.md).

## Using the library

| Topic | Guide |
| --- | --- |
| Installation, setup and every public method | [GeometryEditor API](geometry-editor.md) |
| Mapbox setup, tokens, CSS, workers and tested versions | [Mapbox GL JS adapter](mapbox.md) |
| Blank maps, disabled tools, imports and framework lifecycle | [Troubleshooting](../website/content/troubleshooting.md) |
| A ready-made toolbar with every tool | [Toolbar](toolbar.md) |
| Using the editor in React, Vue, Svelte or Angular | [Frameworks](frameworks.md) |
| Rectangles, circles and freehand outlines | [Shapes](shapes.md) |
| Live lengths and areas; `measure()` | [Measurements](measurements.md) |
| Loading saved data and saving every change | [Saving and loading data](persistence.md) |
| Browsers, input methods, data limits and performance | [Compatibility and limits](compatibility.md) |
| Batches of creates, updates and deletes; event order | [Transactions and events](transactions.md) |
| Placing and moving point markers | [Point markers](markers.md) |
| Creating and editing styled map labels | [Text markers](text-markers.md) |
| Placing arrows, stars and reusable GeoJSON groups | [Shape templates](shape-templates.md) |
| Named editable, reference and hidden datasets | [Data layers](data-layers.md) |
| Allowed and excluded areas for geometry changes | [Geofencing](geofencing.md) |
| Linking shared corners across features | [Pin shared vertices](vertex-pinning.md) |
| Aligning drawings, vertices and moving shapes | [Alignment guides](alignment-guides.md) |
| MultiLineString and MultiPolygon features; adding, separating and combining parts | [Multipart geometry](multipart.md) |
| Read-only reference geometry | [Feature locks](feature-locks.md) |
| Colors, outlines and editing markers | [Appearance](appearance.md) |
| Per-feature colors, drawing order and overlap stripes | [Feature styling](feature-styling.md) |
| Editing vertices with the keyboard | [Keyboard vertex editing](keyboard-vertices.md) |
| Remapping or disabling map command keys | [Keyboard shortcuts](keyboard-shortcuts.md) |
| Editing vertices with touch or pen | [Touch and pen vertex editing](touch-pen-vertices.md) |
| Upgrading between versions | [Migration guide](migration.md) |

## Drawing aids and geometry tools

| Topic | Guide |
| --- | --- |
| Snapping to vertices and edges | [Snapping](geometry-editor.md#snapping-while-drawing) |
| Following existing boundaries while drawing | [Boundary tracing](tracing.md) |
| 45° and 90° drawing directions | [Drawing constraints](drawing-constraints.md) |
| Cutting a polygon in two | [Splitting](splitting.md) |
| Cutting a drawn area out of features | [Cut](cut.md) |
| Filling a polygon or multipolygon hole | [Remove hole](remove-hole.md) |
| Freehand selection with replace/add/remove and intersects/contains | [Lasso selection](lasso.md) |
| Replacing part of a polygon boundary | [Reshape](reshape.md) |
| Merging polygons | [Union](union.md) |
| Subtracting polygons | [Difference](difference.md) |
| Keeping the common area | [Intersection](intersection.md) |
| Growing lines and polygons into areas | [Buffer](buffer.md) |
| Moving lines sideways | [Line offset](offset.md) |
| Removing detail | [Simplification](simplification.md) |
| Rotating and scaling selections | [Rotation](rotation.md), [scaling](scaling.md) |
| Editing the border between two polygons | [Shared boundaries](shared-boundaries.md) |

## Contributing

| Topic | Guide |
| --- | --- |
| Workflow, setup and definition of done | [Contribution guide](../CONTRIBUTING.md) |
| Ownership and dependency rules | [Architecture](architecture.md) |
| Where to make a change | [Code walkthrough](code-walkthrough.md) |
| Test levels, budgets and cross-browser checks | [Testing](testing.md) |
| Benchmark results and their conditions | [Performance notes](performance.md) |
| The demo playground | [Playground workflows](playground-workflow.md) |
| Publishing a version | [Release process](releases.md) |
| Planned work | [Roadmap](roadmap.md) |
| Ordered plan for the ten remaining comparison gaps | [Geoman comparison plan](geoman-parity-plan.md) |
| The deprecated line-only facade | [LineEditor](line-editor.md) |
