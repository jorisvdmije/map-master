# Draw markers, lines and polygons

Turn map clicks into GeoJSON. Choose a tool, place your coordinates and finish a valid shape. The editor manages the draft, snapping and geometry validation.

[[demo:draw]]

## Try it

1. Choose the **polygon** tool in the toolbar and click three or more corners on the map.
2. Choose **Finish** beside the tool, click the first corner again or press **Enter**.
3. Choose the **line** tool to draw a path with at least two points, or the **marker** tool to place one point.
4. **Undo** reverses a completed shape. **Cancel** discards only the active draft, and **Reset** restores the example.

The toolbar also switches [snapping](../../docs/geometry-editor.md#snapping-while-drawing) and [45° angle constraints](../../docs/drawing-constraints.md) on and off.

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

The [toolbar](../../docs/toolbar.md) used in this example is ready-made: `map.addControl(new EditorToolbar(editor))`. To build your own controls, read the state once initially and subscribe to later changes. `canFinish` includes validation, so the Finish button can accurately reflect whether the draft is ready.

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
