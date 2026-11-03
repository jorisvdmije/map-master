import type { GeometryEditor, EditorState, GeometryFeature } from "@jorisvdmije/map-master";

const instructions: Partial<Record<EditorState["mode"], string>> = {
  "draw-template": "Choose a template, then click to anchor it. Adjust size, rotation or coordinates and choose Finish. Escape cancels the whole placement.",
  "draw-text": "Click to anchor a label. Enter text and choose its appearance, then Finish. Enter adds a newline in the text field; Ctrl/Command+Enter saves.",
  "draw-point": "Click the map to place a marker.",
  "draw-line": "Click to add points. Choose Finish to complete the line.",
  "draw-polygon": "Click to add corners. Click the first corner or choose Finish.",
  "draw-hole": "Click inside the selected polygon to outline the hole, then Finish.",
  "remove-hole": "Click inside a hole or choose it in the dropdown. Apply fills it; Cancel keeps the original.",
  "select-lasso": "Press and drag to outline a loop, then release to select. Choose Replace/Add/Remove and Touches/Fully inside in the toolbar.",
  "draw-rectangle": "Click one corner, then the opposite corner.",
  "draw-circle": "Click the center, then a point on the edge.",
  "draw-ellipse": "Click the center, then a corner of the box around the ellipse.",
  "draw-freehand": "Press and drag to trace an outline. Releasing the pointer completes it.",
  "draw-cut": "Draw a polygon across the shapes. Close it or choose Apply to cut it away.",
  "draw-part": "Draw the new part, then Finish. Polygon parts may not overlap.",
  "edit-point": "Drag the marker to move it. For text markers, edit text and appearance in the toolbar, then Save.",
  "edit-line": "Drag a point, or click a small midpoint to add one. Save or Cancel.",
  "edit-polygon": "Drag a corner or an edge, or click a small midpoint to add a corner. Save or Cancel.",
  "split-polygon": "Draw a line that crosses the polygon. Apply splits it in two.",
  "reshape-polygon": "Draw a new boundary section that starts and ends on the outline.",
  "edit-shared-boundary": "Drag the common corners. Both polygons change together.",
  "union-polygons": "Preview of the merged shape. Apply merges the selection.",
  "difference-polygons": "Preview only: the first selected shape minus the others. Choose Apply to save. Cutting polygons are kept.",
  "intersection-polygons": "Only the area common to all shapes remains. Apply keeps it.",
  "rotate-features": "Drag the round handle or type an angle.",
  "scale-features": "Drag a corner handle or type a factor.",
  "buffer-features": "Drag the handle or type a distance in meters.",
  "offset-lines": "Drag the handle or type a distance. Positive is left of the line.",
  "simplify-features": "Type a tolerance in meters. Corners closer to the line disappear.",
};
export const featureName = (feature: GeometryFeature | null) =>
  typeof feature?.properties?.name === "string" ? feature.properties.name : (feature?.geometry.type ?? "shape");
const words = (code: string) => code.replaceAll("-", " ");

export function describe(editor: GeometryEditor, state: EditorState): string {
  const problem =
    (state.validationError !== "too-few-vertices" ? state.validationError : null) ??
    state.splitError ?? state.reshapeError ?? state.unionError ?? state.differenceError ??
    state.intersectionError ?? state.bufferError ?? state.offsetError ??
    state.simplificationError ?? state.scaleError ?? state.rotationError ?? state.sharedBoundaryError ?? state.pinningError ?? state.geofencingViolations[0]?.code;
  const note = problem ? ` Not possible yet: ${words(problem)}.` : "";
  if (state.mode !== "idle") return `${instructions[state.mode] ?? ""}${note}`;
  const selected = state.selectedFeatureIds.map((id) => featureName(editor.getFeature(id)));
  if (selected.length) return `Selected: ${selected.join(", ")}. Shift+click adds more shapes.`;
  return `${state.featureCount} ${state.featureCount === 1 ? "feature" : "features"}. Click a shape to select it, or choose a tool.`;
}
