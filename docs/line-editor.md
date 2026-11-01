# LineEditor (deprecated)

> **Deprecated.** `LineEditor` will be removed in a future release. Use
> [`GeometryEditor`](geometry-editor.md), which supports lines as well as markers,
> polygons and multipart geometry.

`LineEditor` is a thin line-only facade around `GeometryEditor`, kept for
integrations written against the first prototype. It forwards to the same engine,
so drawing, selection, editing, snapping, history and events behave identically.
Its only differences are line-only return types: `getSelection()`, `getSelected()`,
`finish()` and `deleteSelected()` return `LineFeature` values, `exportGeoJSON()`
returns a `LineCollection`, and the creation, update and deletion listeners only
receive lines. It does not expose import, transactions or geometry tools.

## Migrating to GeometryEditor

| LineEditor | GeometryEditor |
| --- | --- |
| `new LineEditor(map, options)` | `new GeometryEditor(map, options)`; the options are identical. |
| `startLine()` | `draw('LineString')` |
| `exportGeoJSON(): LineCollection` | `exportGeoJSON()` returns all geometry types; filter on `feature.geometry.type === 'LineString'` if you only store lines. |
| `getSelection(): LineFeature[]` | `getSelection()` returns `GeometryFeature[]`; narrow with `feature.geometry.type`. |
| `onCreate` / `onUpdate` / `onDelete` with line features | The same listeners receive every geometry type. Prefer `onDataChange` for persistence. |

Every other method has the same name, arguments and behavior on `GeometryEditor`.
Only one editor can be attached to a map, so replace the facade rather than
creating both.
