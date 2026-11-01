# Remove a polygon hole

Fill an interior ring of a selected polygon or multipolygon. Choose the hole on
the map or with the toolbar's dropdown, inspect the preview, then Apply. The
feature keeps its ID and properties; Undo restores the exact original rings.

## Use the toolbar

1. Select one unlocked polygon or multipolygon that contains a hole.
2. Choose **Remove hole**. The first hole is previewed as filled.
3. Click inside another original hole or choose **Part … · Hole …** in the
   dropdown. Part numbers are one-based in the UI; API part indices start at zero.
4. Choose **Apply**, or focus the map and press Enter. **Cancel** or Escape
   discards the preview. Pressing the active tool button again also cancels.

The dropdown supports keyboard selection. With focus on it, Enter applies and
Escape cancels. Clicking the exterior, a solid area or another feature leaves
the chosen hole unchanged. The tool always targets the original geometry,
including a hole currently shown as filled by its preview.

```ts
map.addControl(new EditorToolbar(editor, {
  tools: ['hole', 'remove-hole', 'undo', 'redo'],
}), 'top-left');
```

## Public API

```ts
editor.select('courtyards');
if (editor.removeHole()) {
  editor.setHoleToRemove(2, 0); // Ring 2 in part 0 of the original feature.
  const preview = editor.getHoleRemovalPreview(); // Independent feature, or null.
  if (preview && editor.getState().canFinish) {
    const transaction = editor.finishHoleRemoval();
    // editor.finish() also applies, returning the updated feature.
  }
}
```

`removeHole()` returns false for an unsuitable selection, a locked feature or an
already active removal. Another active tool must be finished or cancelled first.
The mode is `remove-hole`; `activeRingIndex` and `activePartIndex` identify the
original target. `setHoleToRemove()` requires this mode and returns whether the
choice changed. Invalid indices throw `RangeError` without changing the choice.
Ring zero, the exterior, cannot be removed.

Filling a hole containing another part of the same MultiPolygon would make its
parts overlap. That choice has a null preview, `canFinish: false` and
`validationError: 'part-overlap'`. The toolbar explains the problem. Choose
another hole or cancel; invalid geometry is never committed. The original
geometry remains visible for an invalid choice.

## Data, history and lifecycle

Only Apply changes data. A successful removal emits one `onTransaction`, one
`onDataChange` with source `transaction`, and `onChange`. It increments the data
revision once and creates one undo step. Feature order, properties, unrelated
rings and multipart wrappers are preserved. Undo/Redo restores the exact before
and after geometry. Preview getters return independent snapshots.

While active, the selection is fixed and data mutations/history replay are
blocked, as with other geometry tools. Locking the target cancels the tool.
Style replacement rebuilds its preview; finish, cancel and destruction remove
the preview and restore the cursor and double-click zoom setting.

For immediate programmatic removal without a preview, the existing
`editor.deleteHole(ringIndex, partIndex)` remains available while idle. Removing
an exterior or an entire multipart component is outside this tool's scope.
