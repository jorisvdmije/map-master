# Geodata playground

Open the [Map Master playground](https://jorisvdmije.github.io/map-master/playground/)
to work with your own vector data in the browser. It combines the editor's drawing
and geometry tools with layers, an attribute table, feature properties and styling.
No account is required. Imported files are processed locally; the optional street
basemap requests map tiles from OpenFreeMap.

## Import and draw

Drop a GeoJSON file anywhere in the workspace or choose **Import data**. Each file
becomes a separate layer. A file must be valid JSON, smaller than 10 MB, with valid
WGS84 longitude/latitude coordinates. Point, LineString, Polygon, MultiLineString
and MultiPolygon features are supported. The initial playground supports at most
20,000 features and 200 layers per project. The feature limit applies to drawing,
duplication, templates and geometry operations as well as imports. At capacity,
creation tools are disabled; editing, deletion and Undo/Redo remain available.
Projects at the limit can still be saved, downloaded and restored.
MultiPoint, GeometryCollection, raster
data, Shapefiles and other coordinate systems need conversion before importing.

Feature IDs and JSON attributes are preserved. Missing IDs receive new IDs. IDs
must be unique across the complete project: numeric `7` and text `"7"` are distinct,
but importing a second numeric `7` is rejected. An invalid file imports no features
and leaves existing layers, data and edit history intact. When importing several
files, each valid file succeeds separately and failures identify their file.

Use the layer list to choose the drawing target, change visibility and lock layers.
The list runs from the front layer down to the back. Layer properties include
renaming, drawing order, snapping, editing permission and base style. The initial
default layer can be renamed but cannot be removed. Other layers can be removed
when empty; first move or delete their features.

The map toolbar contains the editor's drawing, geometry, multipart, text, template,
selection and editing tools. It defaults to two columns; **Tool columns** in the
workspace bar switches between one and two columns. The choice is saved with the
project, including local restore. Older project files use the two-column default.
The tools float in separate groups without a surrounding background or visible
scrollbar. On short maps, wheel/touch scrolling and the toolbar's arrow/Home/End
keys still reach every tool. Tool-specific
panels provide Apply/Finish and Cancel. Selection, snapping, locks, topology
validation and the editor's keyboard commands apply throughout the workspace.
Geofencing requires application-defined areas; the playground does not yet expose
an area-policy builder.

## Attributes and appearance

The attribute table can show the current layer, all layers or only selected
features. Search filters feature IDs, geometry types and attributes. Column headers
sort attribute values. Checkboxes and feature IDs select the same features on the
map. Double-click a table row to zoom to that feature. Rows are paginated in groups
of 100; the table shows the first 40 attribute columns, while Properties exposes
all editable fields.

Click a cell or a property to edit a value as text, a number, a boolean, null, or
JSON. The feature's Properties panel also adds or removes fields, locks features,
moves selections between layers and starts geometry editing. Feature IDs and
editor-managed layer/pin/style metadata are read-only in the attribute form. Other
attributes, including nested values, round-trip as JSON.
Existing attribute names are preserved exactly when editing or deleting a field,
including empty names and leading/trailing spaces. Only new field names are trimmed.
Switching the value type preserves your pending input, including a switch to Null
and back. Conversion and validation happen when you save. For Boolean, choose
true or false if the current input is not already one of those values.

Layer styles define fills, outlines, opacity, line width and point size. A feature
can override that style or return to its layer's appearance. Per-feature overrides
are stored in `properties.mapMasterPlaygroundStyle`. Layer membership uses
`properties.mapMasterLayer`. Keep these properties for a lossless playground
round-trip. Layer definitions themselves are stored in project files.

Geometry changes, imports, attribute changes, membership moves and feature-style
changes use the editor's Undo/Redo history. Layer settings, map position and host
feature locks are project settings outside that geometry history. Unlock a feature
or layer if its current policy blocks an undo operation.

## Save, restore and export

**Export GeoJSON** downloads all features, the current layer, or the selected
features, including their attributes and IDs. Export contains committed data;
finish or cancel an active edit first. A GeoJSON export does not include layer
definitions or map settings.

**Save project** downloads a compact `.mapmaster.json` file containing data, ordered layers,
layer and feature styles, feature locks, the drawing target, map position and
drawing-aid settings. **Open project** restores it. Opening a project or starting
a new one replaces the current workspace and clears its edit history after
confirmation. Invalid project data is rejected before replacing the document.
Project files can be up to 50 MB; use **Open project** or keep the `.mapmaster.json`
extension when dropping a larger project file onto the workspace.

Committed changes are automatically saved to IndexedDB in the current browser and
restored on the next visit. Draft geometry and the Undo/Redo stack are not stored.
Local saving is subject to browser storage availability and quota; download
projects for portable backups. An unreadable saved project remains available as a
recovery download until explicitly discarded. A transactional revision check
pauses saving if another tab has changed the saved copy, allowing you to download
your work before reloading.

On narrow screens, **Layers** and **Properties** open the side panels, and the
folder menu contains New project, Open project and Documentation. The attribute
table scrolls horizontally and can collapse to provide more map space. Mouse and
keyboard are the primary editing inputs; the library's documented touch/pen
qualification limits still apply.
