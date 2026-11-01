# Edit geometry with confidence

Select an existing feature, adjust its corners and save the result as one reversible change. Cancel lets users explore an edit without committing it.

[[demo:edit]]

## Try it

The lawn is selected when this example opens.

1. Choose **Edit** in the toolbar. Drag a corner or an edge, or click a small midpoint to add a corner.
2. Choose **Save** beside the tool to commit, or **Cancel** to restore the shape.
3. **Undo** reverses the saved edit and **Redo** applies it again.
4. Click the rose garden or the running route to edit another shape.

**Delete** removes the selection as one transaction, and Undo restores it. **Duplicate** places a copy beside the original. **Reset** restores the example.

## Select and edit

A feature's ID is preserved through editing. String and numeric IDs are distinct: `'7'` and `7` identify different features.

```ts
editor.select("garden");
editor.editSelected();
// The user now adjusts corners on the map.
```

```ts
// Save the edited geometry as one action.
const updated = editor.finish();
```

```ts
// Or abandon the edit.
editor.cancel();
```

For a programmatic edit, move a corner in the active draft and then finish it:

```ts
editor.select("garden");
editor.editSelected();
editor.moveVertex(0, [4.8988, 52.3695]);
editor.finish();
```

## Undo and Redo

Undo is available while the editor is idle. Active previews must first be finished or cancelled. These calls are separate user actions:

```ts
editor.undo();
editor.redo();
```

Use `getState().canUndo` and `getState().canRedo` to enable the corresponding buttons. History is held in memory; exporting GeoJSON exports geometry, not the undo stack.

## React to saved changes

```ts
const unsubscribe = editor.onUpdate((feature) => {
  // A saved edit is now committed. Persist the snapshot if needed.
  console.log(feature.id, feature.geometry);
});
```

Use [transactions and event semantics](../../docs/transactions.md) when coordinating multiple features. For other input methods, see [keyboard vertex editing](../../docs/keyboard-vertices.md) and [touch/pen editing](../../docs/touch-pen-vertices.md).
