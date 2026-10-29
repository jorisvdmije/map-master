# Draw markers, lines and polygons

Turn map clicks into GeoJSON. Choose a tool, place your coordinates and finish a valid shape. The editor manages the draft, snapping and geometry validation.

[[demo:draw]]

## Try it

1. Choose **Polygon** and click three or more corners in the map.
2. Select **Finish** or press **Enter** while the map has focus.
3. Choose **Line** to draw a path with at least two points, or **Marker** to place one point.
4. Use **Undo** to reverse a completed action. **Cancel** discards only the active draft.

This example starts empty. **Load sample** replaces its contents with two fictional features; **Reset** clears the example and its history.

## The API behind the tools

These calls assume you have an `editor` from the [quickstart](quickstart.md). They are separate button actions, not a sequence to execute together.

```ts
// Start one tool while the editor is idle.
editor.draw("Polygon");
// Other choices: editor.draw('LineString') or editor.draw('Point').
```

```ts
// Finish a valid draft. Invalid drafts remain active.
const feature = editor.finish();
```

```ts
// Or discard the draft without changing committed geometry.
editor.cancel();
```

## Keep controls in sync

Read the state once initially and subscribe to later changes. `canFinish` includes validation, so the Finish button can accurately reflect whether the draft is ready.

```ts
const render = () => {
  const state = editor.getState();
  finishButton.disabled = !state.canFinish;
  undoButton.disabled = !state.canUndo;
};
const unsubscribe = editor.onChange(render);
render();

// On teardown:
// unsubscribe();
// editor.destroy();
```

## Snapping and validation

Snapping is enabled in this example. Existing vertices and edges become targets within the configured screen-pixel distance. **Alt** temporarily bypasses snapping during supported interactions.

A polygon must enclose an area and cannot cross itself. The draft stays editable if it is invalid. See the [geometry API](../../docs/geometry-editor.md) for topology rules and the [drawing constraints guide](../../docs/drawing-constraints.md) for fixed-angle drawing.
