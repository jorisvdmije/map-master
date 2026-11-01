# Lasso selection

Select features by drawing a freehand loop around them. Choose whether touching
the loop is enough or whether the whole feature must fit inside, then replace,
add to or subtract from the selection. Selecting never changes geometry or history.

## Interaction

1. Choose **Lasso selection** in the toolbar.
2. Set **Action** to **Replace**, **Add** or **Remove**. Remove affects the selection;
   it does not delete features.
3. Set **Match** to **Touches** or **Fully inside**.
4. Press and drag on the map to outline a loop. Releasing the mouse, pen or finger
   closes the loop, applies the selection once and returns to idle.

The closing edge joins the last recorded point to the first. Escape, Cancel or
pressing the active toolbar button again cancels the tool and retains the original
selection. A click, a straight stroke or a self-crossing loop changes nothing;
the toolbar explains the problem and you can draw another loop. Enter does not
finish a stroke: release the pointer to finish it.

The toolbar and both dropdowns are keyboard accessible. You can also supply a
loop programmatically when building a keyboard-driven selection UI.

```ts
map.addControl(new EditorToolbar(editor, {
  tools: ['lasso', 'edit', 'delete', 'undo', 'redo'],
}));

editor.lasso({ operation: 'add', match: 'contains' });
editor.getLassoOptions(); // Independent options, or null outside lasso mode.
editor.setLassoOptions({ operation: 'subtract' }); // Discards an unfinished stroke.
editor.cancel();
```

## Matching rules

- **Touches** (`intersects`) includes points inside/on the loop, lines crossing or
  touching it, and polygons whose filled surface or boundary touches it. A polygon
  enclosing the lasso also qualifies.
- **Fully inside** (`contains`) requires all of a feature's geometry, including
  every multipart component, to lie inside or on the loop. A line with endpoints
  inside a concave loop does not qualify if a segment leaves the loop.
- Holes remain empty. A loop entirely inside a polygon hole does not select the
  polygon. Touching a hole boundary does qualify for `intersects`.
- Multipart hits have one feature ID. Numeric and string IDs remain distinct.
  Locked features can be selected, but remain protected from editing/deletion.
- Matching uses projected committed geometry, independent of source-upload timing,
  marker size and line width. It does not include a marker merely because its icon
  overlaps the loop. Off-screen components still count for whole-feature containment.

Replace uses collection order. Add retains existing selection order and appends
new hits in collection order. Subtract retains the order of the survivors. A valid
empty loop clears a replacement selection; Add and Remove with no hits retain it.

## Programmatic selection

`selectByLasso()` accepts canvas-relative **CSS pixels**, matching the map view.
Pass at least three finite positions; an explicit closing copy is optional.
Consecutive duplicate samples are ignored. Invalid/self-crossing loops throw
without changing the selection or active tool. The input is copied.

```ts
const hits = editor.selectByLasso([
  { x: 100, y: 100 },
  { x: 320, y: 100 },
  { x: 260, y: 280 },
  { x: 100, y: 240 },
], { operation: 'replace', match: 'intersects' });
console.log(hits, editor.getState().selectedFeatureIds);
```

This works while idle or to complete an active lasso. Defaults are `replace` and
`intersects`; completing an active lasso inherits its options unless overridden.
The returned IDs are the hits, including IDs removed in subtract mode. Invalid
options throw `TypeError`; more than 2,048 positions or an overflowing extent
throws `RangeError`. Drawing/editing must be finished or cancelled first.

## State and lifecycle

The active mode is `select-lasso`. The stroke is a temporary SVG overlay, separate
from the GeoJSON draft: `getDraft()` stays empty and `canFinish` is false. An invalid
stroke sets `validationError`; a corrected stroke or a settings change clears it.
Successful release emits `onChange` once for the resulting selection and mode.
It emits no `onDataChange` or transaction, performs no geometry upload and keeps
the existing data revision and undo/redo entries. Starting the mode and changing
its options also emit `onChange`.

While active, data edits and history replay are blocked. Camera/style changes,
window blur, pointer cancellation or capture loss discard the current stroke,
retaining the tool for another attempt. Escape/Cancel exits the tool. A second
pointer cancels a one-finger stroke. Destruction/map removal releases capture and
removes overlays/listeners. Pan, box zoom, double-click zoom, cursor and touch
behavior return to their previous settings when their owner releases them.

Pointer samples are spaced by 3 CSS pixels and coalesced to animation frames.
Long strokes are thinned to keep at most 1,024 samples; the closing release point
is included. Matching runs on release, not on pointer movement. The lasso follows
the current flat Mercator map, including bearing/pitch, and shares the editor's
existing antimeridian/globe limits. See [performance](performance.md#lasso-selection).
