# Keyboard shortcuts

Map command shortcuts can be changed while an editor is running. Configure them
at construction or call `setKeyboardShortcuts()` later. The toolbar automatically
updates its tooltips and `aria-keyshortcuts`; button names remain stable.

```ts
import { GeometryEditor, type KeyboardShortcuts } from '@jorisvdmije/map-master';

const shortcuts: KeyboardShortcuts = {
  polygon: [{ key: 'p' }],
  line: [{ key: 'l' }],
  edit: [{ key: 'e' }],
  finish: [{ key: 'Enter', modifiers: ['Mod'] }],
  delete: false,
};
const editor = new GeometryEditor(map, { keyboardShortcuts: shortcuts });

editor.setKeyboardShortcuts({ polygon: [{ key: 'g', modifiers: ['Shift'] }] });
editor.setKeyboardShortcuts({ cancel: [{ key: 'c' }] });
```

Each supplied entry **replaces all alternatives for that action**. Omitted actions
retain their current bindings (the defaults at construction). `false` or `[]`
disables one action. Passing `false` as the whole configuration disables every map
command, including movement. Save a complete snapshot to restore it later:

```ts
const saved = editor.getKeyboardShortcuts();
editor.setKeyboardShortcuts(false);
editor.setKeyboardShortcuts(saved);

editor.getKeyboardShortcutLabel('undo'); // e.g. "Ctrl+Z / Cmd+Z"
editor.getKeyboardShortcutAria('undo');  // "Control+Z Meta+Z"
```

The getter and supplied arrays are copied. A successful change emits `onChange`
without changing the mode, draft, selection, exported data, revision or history.
It does not emit `onDataChange`. No toolbar or editor rebuild is needed. The
deprecated `LineEditor` facade exposes the same configuration and methods.

The `geofencing` action toggles configured area rules and has no default binding.
[Geofencing](geofencing.md) continues to apply while Alt bypasses snapping.

The `pin` and `unpin` actions link shared vertices in the selection or remove its
pin groups. Both have no default bindings. See [pin shared vertices](vertex-pinning.md).

The `guides` action toggles [alignment guides](alignment-guides.md); it has no
default binding. For example: `editor.setKeyboardShortcuts({ guides: [{ key: 'g' }] })`.

## Default reference

| Action | Default | Behavior |
| --- | --- | --- |
| `finish` | Enter | Finish/save/apply the active valid drawing, edit or tool |
| `cancel` | Escape | Cancel the active tool, or clear the idle selection |
| `delete` | Delete / Backspace | Delete the idle selection, remove the last drawn/split/reshape point, or remove selected editable vertices |
| `undo` | Control+Z / Meta+Z | Undo while idle and history is available |
| `redo` | Control+Shift+Z / Meta+Shift+Z / Control+Y | Redo while idle and history is available |
| `nudge-left`, `nudge-right`, `nudge-up`, `nudge-down` | Corresponding arrow | Move the idle selection by 1 CSS pixel |
| `nudge-left-fast`, `nudge-right-fast`, `nudge-up-fast`, `nudge-down-fast` | Shift+corresponding arrow | Move the idle selection by 10 CSS pixels |

Each committed idle nudge is an undoable transaction. Repeated movement events are
allowed. Other map commands ignore auto-repeat. Geometry validation, history
availability and host-owned feature locks still apply.

Every [toolbar tool](toolbar.md#tools) also accepts a binding. Tools
other than the commands above have **no default shortcut**:

- Drawing: `point`, `line`, `polygon`, `rectangle`, `circle`, `ellipse`, `freehand`,
  `hole`, `part`, `cut`.
- Selection and editing: `lasso`, `edit`, `remove-hole`, `split`, `reshape`,
  `shared-boundary`, `union`, `difference`, `intersection`, `combine`, `explode`.
- Transforms and data: `rotate`, `scale`, `buffer`, `offset`, `simplify`, `duplicate`.
- Aids: `snapping`, `constraints`, `tracing`, `measure`, `zoom`.

Tool activation shortcuts operate while idle and use the toolbar's selection and
lock requirements. They do not replace a pending drawing/edit. Duplicate places
copies 24 screen pixels right and down, like the toolbar. Tool bindings also work
without a toolbar mounted. Enabling tracing also enables snapping.

## Keys, modifiers and conflicts

`KeyBinding` uses `KeyboardEvent.key`, following the user's keyboard layout.
Single visible characters are case insensitive; Shift must be specified
explicitly. Named keys are case sensitive: `Enter`, `Escape`, `Delete`,
`Backspace`, `Insert`, the four arrow names, and `F1` through `F24` are supported.
There are no sequences, physical `code` bindings or modifier-only shortcuts.

`modifiers` accepts `Control`, `Meta`, `Alt`, `Shift` and `Mod`. All modifiers must
match exactly. `Mod` resolves to Meta/Command on Apple platforms and Control on
other platforms. It cannot be combined with explicit Control or Meta. Existing
default history shortcuts continue to accept both Control and Meta on every
platform. An application can replace them with just `Mod`:

```ts
editor.setKeyboardShortcuts({
  undo: [{ key: 'z', modifiers: ['Mod'] }],
  redo: [{ key: 'z', modifiers: ['Mod', 'Shift'] }],
});
```

Unknown actions, malformed bindings, duplicate alternatives and collisions throw
`TypeError` before any settings or editor state change. Collisions are checked
on both Mod platforms, including conflicts with defaults. Disable or reassign
the other action in the **same update** when reusing its key. Constructor errors
occur before sources, layers or listeners are mounted. Arrow keys are reserved
for nudge actions and focused-control navigation. Tab, Space, Page Up/Down,
Home/End and modifier-only keys cannot be assigned as map commands.

## Focus and active gestures

Map commands require focus on that editor's canvas. They ignore inputs,
textareas, selects, contenteditable content, toolbar buttons and other maps.
Composition/IME events (including key code 229), AltGraph and already prevented
events are ignored. Only handled commands prevent the browser's default and stop
propagation to MapLibre's camera handler. Unbound keys remain available to the
map/browser. Browser- or OS-reserved combinations may never reach the page; the
host application remains responsible for choosing usable bindings.

The configured `finish`, `cancel` and `delete` also work on the focused
[vertex control](keyboard-vertices.md); finish/cancel work on transform handles.
During a held vertex movement or captured vertex/transform drag, the configured
cancel command first rolls back that movement, retaining earlier draft edits.
Press it again to cancel the whole tool. Finish during a captured pointer gesture
does not commit it: release the pointer first. A lasso or freehand stroke finishes
on pointer release. Cancel exits an active lasso and preserves the old selection.

Native control navigation stays fixed: Tab/Shift+Tab, toolbar arrow navigation,
vertex Page Up/Down, Home/End, Space/Shift+Space and arrows, and transform-handle
arrows/Home. Enter/Escape in the toolbar's numeric/select fields remain local
form submit/cancel keys. Those controls and pointer actions remain usable when
map commands are disabled. Gesture modifiers such as Alt to bypass snapping and
Shift to constrain movement retain their existing behavior.
During a captured gesture, its held Shift/Alt modifier does not prevent a
finish/cancel binding that omits that modifier from matching. A binding that
explicitly requests the modifier still requires it. This keeps Escape available
while holding Shift to select a rectangle or Alt to bypass snapping in a drag.

Destroying the editor or removing the map detaches its command listeners. Runtime
bindings belong to the editor instance; applications can persist the getter's
plain object themselves, separately from GeoJSON.
