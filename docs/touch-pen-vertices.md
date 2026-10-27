# Touch and pen vertex editing

`GeometryEditor` and the `LineEditor` facade accept touch contacts and pen tips
in an existing vertex editing session. Enter Edit through your application's
controls or `editSelected(ringIndex, partIndex)` / `editSharedBoundary()`.
No new option is required. Both demos describe the interaction.

This is the first touch/pen milestone, covering **existing vertex and midpoint
handles**. Automated evidence uses Chromium-dispatched touch and pen input.
Physical tablets, styluses, palm rejection and Safari/Firefox have not been
qualified. Drawing, whole-feature dragging, rectangle group selection and
transform/distance handles still need their own touch workflow and qualification.

## Interaction

- Tap a corner to select it. Tap a midpoint to insert a corner in the draft.
- Drag a corner or midpoint with one finger or the pen tip. If the corner belongs
  to an existing vertex selection, the complete group moves together.
- Use the application's Save/Apply control to commit the session as one Undo
  action. Cancel restores the original feature; a released drag is still a draft.
- Drag away from handles to pan the map. Whole-edge dragging remains a mouse
  interaction, so a touch on an ordinary edge leaves map navigation available.
- Two-finger gestures **starting away from handles** retain the host's map
  pan/zoom/rotation/pitch behavior. If another contact begins during an acquired
  vertex drag, that movement rolls back. Lift all contacts before starting another
  edit or map gesture; this sequence does not hand over midway to pinch zoom.

Touch acquisition uses a **22 CSS pixel radius**, pen a **12 CSS pixel radius**.
The nearest corner wins before any midpoint; equal distances retain draft order.
This reduces ambiguity when enlarged targets overlap. Visible handles retain the
configured `appearance` colors and sizes; those sizes do not change acquisition.
Mouse acquisition and whole-edge behavior remain as previously documented.

Contacts that begin slightly away from a handle keep that initial offset while
moving, so the geometry does not jump under a finger. Movement begins after four
CSS pixels of displacement. Smaller jitter only selects the corner (or inserts
the midpoint). Pressure, tilt, barrel buttons, erasers, hovering and nonprimary
pen contacts do not provide editing commands. Shift+tip on a corner uses the
existing selection toggle when a keyboard is present.

Positions use the shared CSS-scaled canvas conversion. A group receives one
longitude/latitude offset anchored at the grabbed corner, matching mouse group
translation. On a pitched map the other corners need not move the same number of
screen pixels. Snapping, Alt bypass, live snapping options and whole-feature snap
exclusions use the existing editing rules. An invalid geometric draft remains
repairable; invalid bounds reject the whole movement and an invalid release rolls
it back. No original GeoJSON, IDs, properties or history change before Save.

## Interruption and cleanup

Pointer cancellation, lost pointer capture, window blur, camera changes, resize,
style replacement or another contact restore that movement's coordinates and
previous selection. An inserted midpoint is removed on rollback. Earlier released
edits remain part of the session. Shared-boundary endpoints cannot move or be
inserted over; locks retain the existing policy.

Public commands follow the existing mouse interaction contract: vertex mutation
and Finish flush an accepted movement before applying their own action; Cancel,
lock revocation, destruction and style replacement roll it back. Late pointer
movement/release cannot overwrite the result of a public command.

Only a sequence acquired by a handle consumes the corresponding legacy touch and
compatibility click events. This prevents double insertion or camera movement
from the same physical input. The editor temporarily disables and restores drag
panning for the acquired movement, respecting an already disabled handler. It does
not enable touch zoom/rotate or pitch. Outside-handle gestures retain the host's
configuration, including cooperative gestures. A host may deliberately choose a
map configuration that disallows navigation.

Destroy removes the added contact, touch and click listeners. No per-vertex DOM,
permanent touch-action override or new exported geometry fields are introduced.

## Verification and cost

```sh
npm run test:browser -- tests/browser/touch-pen-vertices.test.ts tests/browser/demo-touch-vertices.test.ts
npm run benchmark:direct-picking
npm run test:workspace
```

Tests send touch/pen input through Chromium's input protocol, exercising real
pointer IDs/capture, compatibility clicks, single-finger pan, two-finger zoom,
second-contact rollback, snapping, groups, holes, multipart, markers, fixed
endpoints, locks, callbacks and lifecycle interruptions. The full playground and
independently installed workspace verify cancellation and one-step Undo/Redo.
These are browser emulation checks, not physical-device certification.

Acquisition generates the current handles and scans for the nearest match: O(V)
time and temporary storage in the active ring/component. It occurs at contact
start, not on every movement. Movement reuses the existing animation-frame
coalescing and snapping index. Benchmark results include handle generation and
picking with a fixed deterministic projection; browser/GPU rendering, actual
MapLibre projection, topology validation and snapping are excluded.

Local baseline (2026-10-26, Node 22.23.1, Apple M2 Pro, macOS arm64), 100 samples
after 20 warmups; median / p95 in milliseconds:

| Vertices | Pen acquisition | Touch acquisition |
| --- | ---: | ---: |
| 100 | 0.030 / 0.114 | 0.030 / 0.093 |
| 1,000 | 0.095 / 0.250 | 0.094 / 0.222 |
| 10,000 | 1.765 / 2.166 | 1.775 / 2.254 |

Use the existing editing and installed-consumer budgets for additional workloads;
these measurements do not establish an end-to-end tablet latency guarantee.
