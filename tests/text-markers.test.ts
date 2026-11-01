import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import { isTextMarker, textMarkerOptions } from '../src/core/text-marker.js';
import { GeoJSONImportError } from '../src/core/geojson-import.js';
import { FeatureLockedError } from '../src/core/feature-locks.js';
import type { TextMarkerFeature } from '../src/index.js';

const label = (id: string | number = 'label'): TextMarkerFeature => ({
  type: 'Feature', id, geometry: { type: 'Point', coordinates: [4, 52] },
  properties: { nested: { tags: ['a'] }, mapMasterText: { text: 'Café 🌷\nEntrance <b>A</b>', style: { color: '#123', fontWeight: 'bold', fontSize: 22, textAlign: 'left' } } },
});
const session = () => { let id = 0; return new DrawingSession(() => ++id); };

it('anchors a label before committing, rejects empty text, and cancels without data or IDs', () => {
  const tool = session(); tool.startText();
  expect(tool.state).toMatchObject({ mode: 'draw-text', canFinish: false });
  tool.add([4, 52]); expect(tool.finish()).toBeNull();
  tool.setTextMarker({ text: '  \n ' }); expect(tool.state.canFinish).toBe(false);
  tool.cancel(); expect(tool.state.canUndo).toBe(false); expect(tool.getTextMarkerDraft()).toBeNull();
  tool.startText({ text: 'Meeting point' }); expect(tool.state.canFinish).toBe(false);
  tool.add([4, 52]); tool.add([5, 53]); expect(tool.state.vertexCount).toBe(1);
  expect(tool.exportGeoJSON().features).toEqual([]);
  const created = tool.finish()!; expect(created).toMatchObject({ id: 1, geometry: { coordinates: [5, 53] }, properties: { mapMasterText: { text: 'Meeting point' } } });
  expect(isTextMarker(created)).toBe(true); expect(tool.getTextMarkerDraft()).toBeNull();
  const saved = tool.exportGeoJSON(); tool.undo(); expect(tool.state.featureCount).toBe(0);
  tool.redo(); expect(tool.exportGeoJSON()).toEqual(saved);
});

it('edits text, style and position in one change with exact cancel and undo/redo', () => {
  const tool = session(); tool.importGeoJSON(label()); tool.select('label'); tool.clearHistory();
  const original = tool.exportGeoJSON(); tool.editSelected(); tool.setTextMarker({ text: 'New label', style: { color: '#abcdef' } });
  tool.moveVertex(0, [5, 53]); expect(tool.exportGeoJSON()).toEqual(original); tool.cancel();
  expect(tool.exportGeoJSON()).toEqual(original); expect(tool.state.canUndo).toBe(false);
  tool.editSelected(); tool.setTextMarker({ text: 'New label', style: { color: '#abcdef' } }); tool.moveVertex(0, [5, 53]);
  tool.finish(); const saved = tool.exportGeoJSON();
  expect(saved.features[0]).toMatchObject({ id: 'label', properties: { nested: { tags: ['a'] }, mapMasterText: { text: 'New label', style: { color: '#abcdef', fontWeight: 'bold', fontSize: 22 } } }, geometry: { coordinates: [5, 53] } });
  tool.undo(); expect(tool.exportGeoJSON()).toEqual(original); expect(tool.state.canUndo).toBe(false);
  tool.redo(); expect(tool.exportGeoJSON()).toEqual(saved);
});

it('does not record unchanged saves or changes reverted in the draft, even with reordered JSON keys', () => {
  const original = label(); original.properties.mapMasterText = { style: { fontSize: 22 }, text: 'Hello' };
  const tool = session(); tool.importGeoJSON(original); tool.select('label'); tool.clearHistory();
  tool.editSelected(); tool.finish(); expect(tool.state.canUndo).toBe(false);
  tool.editSelected(); tool.setTextMarker({ text: 'Another' }); tool.setTextMarker({ text: 'Hello' }); tool.finish();
  expect(tool.state.canUndo).toBe(false); expect(tool.getSelected()).toEqual(original);
});

it.each([null, '', { text: '' }, { text: ' \n ' }, { text: 7 }, { text: 'x'.repeat(2001) },
  { text: 'x', style: null }, { text: 'x', style: { fontSize: 7 } }, { text: 'x', style: { fontSize: 97 } },
  { text: 'x', style: { color: 'red' } }, { text: 'x', style: { backgroundColor: 'url(evil)' } },
  { text: 'x', style: { fontWeight: 'heavy' } }, { text: 'x', style: { textAlign: 'justify' } },
  { text: 'x', style: { cssText: 'display:none' } }, { text: 'x', html: true },
])('rejects invalid label metadata atomically in import and transactions: %j', (data) => {
  const tool = session(); tool.importGeoJSON(label()); tool.clearHistory(); const before = tool.exportGeoJSON();
  const invalid = { ...label('bad'), properties: { mapMasterText: data } };
  expect(() => tool.importGeoJSON({ type: 'FeatureCollection', features: [label('valid'), invalid] })).toThrow(GeoJSONImportError);
  expect(() => tool.applyTransaction({ delete: ['label'], create: [invalid] })).toThrow(GeoJSONImportError);
  expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state.canUndo).toBe(false);
});

it('validates patches before changing drafts and returns independent options', () => {
  const tool = session(); const options = { text: 'Initial', style: { color: '#123' } }; tool.startText(options);
  options.style.color = '#abc'; const draft = tool.getTextMarkerDraft()!; draft.style!.color = '#def';
  expect(tool.getTextMarkerDraft()).toEqual({ text: 'Initial', style: { color: '#123' } });
  expect(() => tool.setTextMarker({ text: 'Changed', style: { fontSize: NaN } })).toThrow();
  expect(tool.getTextMarkerDraft()!.text).toBe('Initial');
  expect(() => tool.start('Polygon')).toThrow(); tool.cancel();
  expect(() => tool.setTextMarker({ text: 'No draft' })).toThrow();
  tool.start('Point'); expect(() => tool.startText()).toThrow(); tool.cancel();
  expect(textMarkerOptions({ text: 'a'.repeat(2000), style: { fontSize: 96 } }).text.length).toBe(2000);
});

it('round-trips metadata and typed IDs through copying, movement, deletion, locks and transformations', () => {
  const tool = session(); tool.importGeoJSON({ type: 'FeatureCollection', features: [label(0), label('0')] }); tool.select(0);
  tool.clearHistory(); const original = tool.exportGeoJSON();
  tool.duplicateSelection([0.1, 0]); expect(tool.getSelected()!.properties).toEqual(label().properties);
  tool.undo(); expect(tool.exportGeoJSON()).toEqual(original); tool.select(0);
  tool.translateSelection([0.1, 0.1]); tool.undo(); expect(tool.exportGeoJSON()).toEqual(original);
  tool.editSelected(); tool.setTextMarker({ text: 'Unsaved' }); tool.setLockedFeatureIds([0]);
  expect(tool.state.mode).toBe('idle'); expect(tool.getTextMarkerDraft()).toBeNull(); expect(tool.exportGeoJSON()).toEqual(original);
  expect(tool.editSelected()).toBe(false); expect(() => tool.applyTransaction({ update: [{ ...label(0), properties: { mapMasterText: { text: 'Changed' } } }] })).toThrow(FeatureLockedError);
  tool.setLockedFeatureIds([]); tool.bufferSelection(10); tool.finishBuffer();
  expect(isTextMarker(tool.getSelected()!)).toBe(false); tool.undo(); expect(tool.getSelected()).toEqual(label(0));
  tool.deleteSelection(); tool.undo(); expect(tool.getFeature(0)).toEqual(label(0));
  const other = session(); other.importGeoJSON(tool.exportGeoJSON()); expect(other.exportGeoJSON()).toEqual(tool.exportGeoJSON());
});
