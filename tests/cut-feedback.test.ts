import { expect, it } from 'vitest';
import { splitPolygonRings } from '../src/core/split-polygon.js';
import { reshapePolygon } from '../src/core/reshape-polygon.js';
import { DrawingSession } from '../src/core/drawing-session.js';
import type { Coordinate } from '../src/index.js';
const ring: Coordinate[] = [[0,0],[10,0],[10,10],[0,10],[0,0]];
it('marks actual boundary crossings, attached corners and an incomplete first attachment', () => {
  expect(splitPolygonRings([ring], [[-1,3],[11,3]]).feedback.contacts).toEqual([[0,3],[10,3]]);
  expect(splitPolygonRings([ring], [[0,0],[10,10]]).feedback.contacts).toEqual([[0,0],[10,10]]);
  expect(splitPolygonRings([ring], [[0,3]]).feedback).toEqual({contacts:[[0,3]],problemPoints:[],problemSegments:[]});
  expect(reshapePolygon(ring, [[0,3]]).feedback.contacts).toEqual([[0,3]]);
});
it.each(['split', 'reshape'] as const)('localizes self-crossings for %s without changing input', kind => {
  const path: Coordinate[] = [[0,2],[8,8],[2,8],[10,2]]; const original = structuredClone(path);
  const result = kind === 'split' ? splitPolygonRings([ring], path) : reshapePolygon(ring, path);
  expect(result.error).toBe(`${kind}-self-intersection`);
  expect(result.feedback.problemPoints).toContainEqual([5,5.75]);
  expect(result.feedback.problemSegments).toEqual([[path[0],path[1]],[path[2],path[3]]]);
  expect(path).toEqual(original);
});
it('marks only interior split endpoints and unattached reshape endpoints', () => {
  const split = splitPolygonRings([ring], [[-1,3],[5,3]]);
  expect(split.error).toBe('split-endpoints-inside'); expect(split.feedback.problemPoints).toEqual([[5,3]]);
  const reshape = reshapePolygon(ring, [[0,3],[8,3]]);
  expect(reshape.error).toBe('reshape-endpoints-off-boundary'); expect(reshape.feedback.problemPoints).toEqual([[8,3]]);
});
it.each(['split','reshape'] as const)('marks the forbidden boundary overlap for %s', kind => {
  const path: Coordinate[] = [[0,2],[0,8]];
  const result = kind === 'split' ? splitPolygonRings([ring], path) : reshapePolygon(ring, path);
  expect(result.error).toBe(`${kind}-boundary-touch`);
  expect(result.feedback.problemSegments).toContainEqual(path);
  expect(result.feedback.problemPoints).toContainEqual([0,2]);
});
it('marks hole crossings and excessive outer boundary contacts', () => {
  const hole: Coordinate[] = [[4,4],[4,6],[6,6],[6,4],[4,4]];
  const result = splitPolygonRings([ring,hole], [[-1,5],[11,5]]);
  expect(result.error).toBe('split-hole-crossing');
  expect(result.feedback.problemPoints).toEqual(expect.arrayContaining([[4,5],[6,5]]));
  const excess = splitPolygonRings([ring], [[-1,2],[11,2],[11,8],[-1,8]]);
  expect(excess.error).toBe('split-crossing-count'); expect(excess.feedback.problemPoints).toHaveLength(4);
});
it.each(['split','reshape'] as const)('copies feedback snapshots and clears them on correction, cancel and commit for %s', kind => {
  const tool = new DrawingSession(() => 'created');
  tool.importGeoJSON({type:'Feature', id:'target', properties:null, geometry:{type:'Polygon',coordinates:[ring]}});
  tool.select('target'); tool.clearHistory(); const before = tool.exportGeoJSON();
  const start = () => kind === 'split' ? tool.splitSelected() : tool.reshapeSelected();
  const set = (path: Coordinate[]) => kind === 'split' ? tool.setSplitLine(path) : tool.setReshapePath(path);
  expect(tool.getCutFeedback()).toBeNull(); start(); set([[0,3],[5,3]]);
  const feedback = tool.getCutFeedback()!; feedback.contacts[0]![0] = 99; feedback.problemPoints.length = 0;
  expect(tool.getCutFeedback()!.problemPoints).toEqual([[5,3]]);
  expect(tool.getCutFeedback()!.contacts).toEqual([[0,3]]);
  expect(() => set([[Infinity,0]])).toThrow(); expect(tool.getCutFeedback()!.problemPoints).toEqual([[5,3]]);
  set([[0,3],[10,3]]); expect(tool.getCutFeedback()!.problemPoints).toEqual([]); expect(tool.state.canFinish).toBe(true);
  expect(tool.exportGeoJSON()).toEqual(before); tool.cancel(); expect(tool.getCutFeedback()).toBeNull(); expect(tool.state.canUndo).toBe(false);
  start(); set([[0,3],[10,3]]); if (kind === 'split') tool.finishSplit(); else tool.finishReshape();
  expect(tool.getCutFeedback()).toBeNull(); tool.undo(); expect(tool.exportGeoJSON()).toEqual(before);
});
