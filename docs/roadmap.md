# Roadmap

Map Master covers drawing, selection, vertex editing, snapping, tracing, undo/redo,
transactions, GeoJSON exchange, styling, feature locks and a complete set of
geometry tools. The [changelog](../CHANGELOG.md) records what each release added.

Further work is prioritized by the needs of real applications. Open an
[issue](https://github.com/jorisvdmije/map-master/issues) to describe a use case;
concrete requirements move items up.

The [Geoman comparison implementation plan](geoman-parity-plan.md) defines the
ordered delivery and acceptance criteria for ten remaining comparison gaps,
with hole removal, lasso selection, configurable shortcuts, text markers, reusable
shape templates, alignment guides, shared-vertex pinning, geofencing and multiple
editable data layers and the Mapbox GL JS adapter implemented. All ten scoped
comparison steps are complete; broader qualification and geometry work follows
the candidates below.

## Stable 1.0

- Gather feedback from applications using the 0.x releases and settle the public API.
- Remove the deprecated `LineEditor` facade.
- Define a compatibility and deprecation policy for 1.x.

## Candidates

| Area | Idea |
| --- | --- |
| Browsers | Qualify shipping Firefox and Safari releases with the full library test suite and performance budgets, not only the example application's workflows. |
| Touch | Extend touch and pen input from vertex editing to drawing, selection rectangles, moving shapes and transform handles; test on physical devices. |
| Multipart | Remove and split individual parts of multipart features. |
| Geometry tools | Trim and extend lines to other geometry; split lines and multipart features, and cut through holes. |
| Integrations | Thin wrapper packages for UI frameworks, beyond the [framework examples](frameworks.md). |
| Map libraries | Broader Mapbox qualification: hosted styles, Standard slots, CSP/ESM builds, other browsers and performance budgets. |
| Scale | Incremental rendering updates instead of full source uploads for large datasets. |

## Principles

- Ship one small, tested capability at a time.
- Keep geometry and editing state independent of the map renderer and UI framework.
- Exchange data as GeoJSON; applications own persistence and authorization.
- Measure before claiming performance or compatibility.
