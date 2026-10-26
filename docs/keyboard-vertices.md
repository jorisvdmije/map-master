# Keyboard vertex editing

Keyboard controls are built into `GeometryEditor` and its `LineEditor` facade.
Start a normal `editSelected(ringIndex, partIndex)` or `editSharedBoundary()` session
through your application's controls. No additional option or callback is required.
The library adds one focusable vertex control inside the map's canvas container.
Both demos explain this interaction during editing.

From the focused map canvas, press **Home** to focus the first vertex. **Tab** also
reaches the vertex control in normal DOM order. The control displays the focused
vertex number; a blue ring identifies its location on the map. Focus and the
existing vertex selection are separate: visiting a vertex does not change the
selection, draft, export or history.

| Key on the vertex control | Action |
| --- | --- |
| Page Up / Page Down | Previous / next vertex, wrapping at either end |
| Home / End | First / last vertex |
| Space | Select only the focused vertex |
| Shift+Space | Add or remove the focused vertex from the selection |
| Arrow keys | Move 1 CSS pixel in the corresponding screen direction |
| Shift+Arrow keys | Move 10 CSS pixels |
| Delete / Backspace | Remove selected vertices if the remaining geometry has enough points |
| Enter | Save the complete valid editing session |
| Escape | Cancel the editing session, or roll back a currently held movement |
| Tab / Shift+Tab | Leave the control normally; there is no focus trap |

Page Up/Down and Home/End also enter vertex focus from the map canvas. Arrows on
the canvas keep their normal MapLibre camera behavior; arrows on the vertex
control edit the geometry. Ctrl/Meta/Alt combinations, composition events and keys
in other controls are left to the application/browser. Navigation and destructive
keys ignore auto-repeat. Arrow repeat is supported.

## Precise movement and groups

Moving an unselected focused vertex selects only that vertex. If the focused
vertex is already selected, all selected vertices move together. The focused
vertex is the anchor. Its projected position moves by the requested number of
screen pixels; every member receives the resulting common longitude/latitude
offset. On a pitched map, other vertices need not move exactly that pixel distance.
This matches the existing pointer group translation model.

Keyboard nudges deliberately bypass snapping, including when the snapping toggle
is enabled. Each key step therefore moves predictably instead of repeatedly
snapping back. Keyboard focus clears the pointer snap indicator. This does not
change the configured snapping settings for subsequent mouse interactions.

One or more simultaneously held arrow keys form one movement. The movement uses
frozen originals and a cumulative screen offset, so auto-repeat does not accumulate
round-trip projection drift. Releasing the last arrow keeps the preview; it does
not save anything. Escape while any arrow is held restores that movement's original
coordinates and selection, preserving earlier released nudges and mouse edits.
After release, Escape cancels the entire edit session. Enter, deletion and selection
commands are ignored while arrows remain held. Navigating to another vertex ends
the current movement and retains its preview.

All edits still save together through the existing Finish/Save API as **one Undo
action**. Invalid intermediate topology remains a repairable draft and cannot be
saved. A step outside finite longitude/latitude bounds is rejected for the whole
selection; the last accepted preview remains and movement can resume in the
opposite direction. No wraparound or partial group movement is applied.

## Interruptions and lifecycle

Losing control focus, window blur, camera movement, resize, style replacement or
a new pointer gesture rolls back a currently held movement. Public vertex API
commands, finish/cancel commands and lock changes also stop/restore that movement
before applying their own operation. Released movements are already part of the
draft and remain until Save or Cancel. Late keyup/repeat events cannot replace
newer API changes. A new non-repeat keydown starts normally after interruption.

Focusing the vertex control interrupts an unfinished mouse vertex drag or
rectangle selection, restoring that gesture before keyboard editing begins.
No map gesture handler settings are changed by keyboard editing; handled events
are consumed before MapLibre camera shortcuts. Existing disabled pan/keyboard
settings therefore remain disabled.

Leaving the editing session removes the control and highlight. If the removed
control held focus, focus returns to the map canvas; unrelated application focus
is preserved. Destroying the editor or removing the map unregisters listeners and
removes owned DOM. Style changes retain the current vertex focus and settings.

## Scope and accessibility

The controls work with points, lines, polygon rings, active multipart components
and shared-boundary drafts. The duplicated polygon closing coordinate is not a
separate vertex. Only the active draft is navigated. Shared-boundary endpoints can
be visited and identified as fixed, but cannot be selected through the control,
moved or removed. A group containing a fixed endpoint is rejected in full. Point
deletion and reductions below two line points or three polygon corners are blocked.

The control has a descriptive accessible name, `aria-describedby` instructions,
`aria-keyshortcuts`, selection state (`aria-pressed`) and invalid-state feedback
(`aria-invalid`). Instructions become visible when focused. A polite live region
reports vertex navigation, selection, invalid geometry, fixed endpoints and
completed movement coordinates. The focus ring remains distinct from the ordinary
selected vertex fill; invalid geometry uses a red ring plus a textual explanation.

The DOM size is constant regardless of vertex count: a single tab stop, instructions,
live region and highlight. An offscreen/unprojectable vertex retains its accessible
control and can still be navigated; its ring is hidden and status asks the user to
pan to see it. There is no automatic camera recentering. The control's colors are
fixed UI focus/validation colors; geometry and ordinary handles retain the configured
appearance.

This milestone covers navigation, selection, movement and removal **inside an
existing editing session**. Keyboard-only feature acquisition and drawing/inserting
new vertices remain separate work; applications can already expose their own
feature lists and coordinate inputs through the public API. Screen-reader behavior
has not been manually certified. Automated coverage uses real Chromium keyboard
input and accessibility attributes; Firefox, Safari, touch and pen coverage remain
outside the current compatibility matrix.

## Verification

Run `npm run test:browser -- tests/browser/vertex-keyboard.test.ts tests/browser/demo-vertex-keyboard.test.ts`
for the targeted controls and demo. Cases cover screen movement at different zooms,
bearing/pitch, groups, auto-repeat, modifiers, typed inputs, cancellation and late
events, fixed endpoints, bounds, invalid geometry, holes/multipart/markers, one-step
Undo/Redo, lock/style/removal cleanup, large drafts and synchronous host callbacks.
`npm run benchmark:vertex-keyboard` measures navigation and nudge coordination on
fixed line sizes; full checks retain the installed-consumer latency/lifecycle gates.

Local baseline (2026-10-26, Node 22.23.1, Chromium 156.0.8078.4, Apple M2 Pro):
30 measured samples after five warmups; median / p95 in milliseconds.

| Line vertices | Tab stops | Navigation | Nudge |
| --- | ---: | ---: | ---: |
| 100 | 1 | 0.100 / 0.200 | 0.100 / 0.200 |
| 1,000 | 1 | 0.200 / 0.300 | 0.200 / 0.300 |
| 10,000 | 1 | 0.400 / 0.500 | 0.700 / 1.800 |

These timings include synchronous event handling, draft validation and focus DOM
updates. They exclude the following animation-frame preview/GPU render. Polygon
topology validation may cost more than these line fixtures. The existing editing
and installed-consumer benchmarks cover additional workloads; these are observations,
not production latency guarantees.
