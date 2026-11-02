import type { Coordinate, EditorState, GeometryFeature } from '../core/types.js';
import type { KeyboardTool } from '../core/keyboard-shortcuts.js';
import type { GeometryEditor } from './geometry-editor.js';
import { geometryParts } from '../core/geometry.js';

const isPoint = (f: GeometryFeature): boolean => f.geometry.type === 'Point';
const isPolygonal = (f: GeometryFeature): boolean => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon';
const isSimplePolygon = (f: GeometryFeature): boolean => f.geometry.type === 'Polygon' && f.geometry.coordinates.length === 1;
const isLineal = (f: GeometryFeature): boolean => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString';
const isMultipart = (f: GeometryFeature): boolean => f.geometry.type === 'MultiPolygon' || f.geometry.type === 'MultiLineString';

/** Shared toolbar and shortcut availability, including host locks. */
export function toolAvailable(editor: GeometryEditor, tool: KeyboardTool, state: EditorState, features = editor.getSelection()): boolean {
  const locked = state.selectedFeatureIds.some((id) => editor.isFeatureLocked(id));
  const single = features.length === 1 ? features[0]! : null;
  const pinned = features.some(feature => Array.isArray(feature.properties?.mapMasterPins) && feature.properties.mapMasterPins.length > 0);
  if (pinned && ['shared-boundary', 'split', 'reshape', 'union', 'difference', 'intersection', 'combine', 'explode', 'rotate', 'scale', 'buffer', 'offset', 'simplify', 'cut', 'remove-hole'].includes(tool)) return false;
  if (tool === 'cut' && !features.length && editor.getPinnedVertices().length) return false;
  switch (tool) {
    case 'geofencing': { const rules = editor.getGeofencing(); return rules.allowed.length + rules.excluded.length > 0; }
    case 'pin': return editor.canPinSharedVertices();
    case 'unpin': return editor.canUnpinSelection();
    case 'text': case 'point': case 'line': case 'polygon': case 'rectangle': case 'circle': case 'ellipse': case 'freehand': return editor.canDrawInDataLayer();
    case 'template': return editor.canDrawInDataLayer() && editor.getShapeTemplates().length > 0;
    case 'lasso': return true;
    case 'hole': return single !== null && isPolygonal(single) && !locked;
    case 'remove-hole': return single !== null && !locked && geometryParts(single.geometry).some((part) => part.type === 'Polygon' && part.coordinates.length > 1);
    case 'part': return single !== null && !isPoint(single) && !locked;
    case 'cut': return state.featureCount > 0 && !locked;
    case 'combine': return features.length >= 2 && (features.every(isPolygonal) || features.every(isLineal)) && !locked;
    case 'explode': return features.some(isMultipart) && !locked && editor.canCreateFeatures(features.reduce((count, feature) => count + (isMultipart(feature) ? geometryParts(feature.geometry).length - 1 : 0), 0));
    case 'edit': return single !== null && !locked;
    case 'split': return single?.geometry.type === 'Polygon' && !locked && editor.canCreateFeatures();
    case 'reshape': return single !== null && isSimplePolygon(single) && !locked;
    case 'shared-boundary': return features.length === 2 && features.every(isSimplePolygon) && !locked;
    case 'union': case 'difference': case 'intersection': return features.length >= 2 && features.every(isPolygonal) && !locked;
    case 'rotate': case 'scale': case 'buffer': case 'delete': return features.length > 0 && !locked;
    case 'simplify': return features.some((f) => !isPoint(f)) && !locked;
    case 'offset': return features.length > 0 && features.every(isLineal) && !locked;
    case 'duplicate': return editor.canDuplicateSelection();
    case 'guides': case 'snapping': case 'constraints': case 'tracing': case 'measure': return true;
    case 'zoom': return state.featureCount > 0;
    case 'undo': return state.canUndo;
    case 'redo': return state.canRedo;
  }
}

export function runTool(editor: GeometryEditor, tool: KeyboardTool, duplicateOffset: Coordinate): void {
  switch (tool) {
    case 'geofencing': editor.setGeofencing({ enabled: !editor.getGeofencing().enabled }); break;
    case 'pin': editor.pinSharedVertices(); break;
    case 'unpin': editor.unpinSelection(); break;
    case 'template': editor.drawTemplate(); break;
    case 'text': editor.drawText(); break;
    case 'point': editor.draw('Point'); break;
    case 'line': editor.draw('LineString'); break;
    case 'polygon': editor.draw('Polygon'); break;
    case 'rectangle': editor.draw('Rectangle'); break;
    case 'circle': editor.draw('Circle'); break;
    case 'ellipse': editor.draw('Ellipse'); break;
    case 'freehand': editor.draw('Freehand'); break;
    case 'hole': editor.drawHole(); break;
    case 'lasso': editor.lasso(); break;
    case 'remove-hole': editor.removeHole(); break;
    case 'part': editor.drawPart(); break;
    case 'cut': editor.drawCut(); break;
    case 'combine': editor.combineSelection(); break;
    case 'explode': editor.explodeSelection(); break;
    case 'edit': editor.editSelected(); break;
    case 'split': editor.splitSelected(); break;
    case 'reshape': editor.reshapeSelected(); break;
    case 'shared-boundary': editor.editSharedBoundary(); break;
    case 'union': editor.unionSelection(); break;
    case 'difference': editor.differenceSelection(); break;
    case 'intersection': editor.intersectionSelection(); break;
    case 'rotate': editor.rotateSelection(); break;
    case 'scale': editor.scaleSelection(); break;
    case 'buffer': editor.bufferSelection(); break;
    case 'offset': editor.offsetSelection(); break;
    case 'simplify': editor.simplifySelection(); break;
    case 'duplicate': editor.duplicateSelection(duplicateOffset); break;
    case 'delete': editor.deleteSelection(); break;
    case 'guides': editor.setAlignmentGuides({ enabled: !editor.getAlignmentGuides().enabled }); break;
    case 'snapping': editor.setSnapping({ enabled: !editor.getSnapping().enabled }); break;
    case 'constraints': editor.setDrawingConstraints({ enabled: !editor.getDrawingConstraints().enabled }); break;
    case 'tracing': {
      const enabled = !editor.getTracing().enabled;
      // Tracing follows snapped boundaries, so it needs snapping.
      if (enabled && !editor.getSnapping().enabled) editor.setSnapping({ enabled: true });
      editor.setTracing({ enabled });
      break;
    }
    case 'measure': editor.setMeasurements({ enabled: !editor.getMeasurements().enabled }); break;
    case 'zoom': editor.zoomToFeatures(); break;
    case 'undo': editor.undo(); break;
    case 'redo': editor.redo(); break;
  }
}
