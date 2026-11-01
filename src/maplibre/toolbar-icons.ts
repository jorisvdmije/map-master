import type { ToolbarTool } from './toolbar.js';

/** One SVG child element: tag name and attributes. */
type Shape = readonly [tag: 'path' | 'circle' | 'rect', attributes: Readonly<Record<string, string>>];

const path = (d: string, extra: Record<string, string> = {}): Shape => ['path', { d, ...extra }];
const dot = (cx: number, cy: number): Shape => ['circle', { cx: String(cx), cy: String(cy), r: '1.7', fill: 'currentColor', stroke: 'none' }];
const circle = (cx: number, cy: number, r: number): Shape => ['circle', { cx: String(cx), cy: String(cy), r: String(r) }];
const rect = (x: number, y: number, size: number, rx: number, extra: Record<string, string> = {}): Shape =>
  ['rect', { x: String(x), y: String(y), width: String(size), height: String(size), rx: String(rx), ...extra }];
const tint = { fill: 'currentColor', 'fill-opacity': '.16' };
const dashed = { 'stroke-dasharray': '2.4 2.4' };

// 24×24 outline icons in `currentColor`; the toolbar styles set the stroke width and size.
const icons: Record<ToolbarTool, readonly Shape[]> = {
  point: [path('M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z'), circle(12, 10, 2.3)],
  line: [path('M4 18 9.5 8.5l5 6L20 5'), dot(4, 18), dot(9.5, 8.5), dot(14.5, 14.5), dot(20, 5)],
  polygon: [path('M5 9.5 12 4l7 5.5-2.7 9.5H7.7z', tint), dot(5, 9.5), dot(12, 4), dot(19, 9.5), dot(16.3, 19), dot(7.7, 19)],
  hole: [path('M4 9 12 3.5 20 9l-3 11H7z', tint), path('M10 10.5h4v4h-4z')],
  edit: [path('M4 20h4.5L19 9.5 14.5 5 4 15.5z'), path('m12.5 7 4.5 4.5')],
  split: [circle(6.5, 6.5, 2.5), circle(6.5, 17.5, 2.5), path('M8.6 8 20 17.5M8.6 16 20 6.5')],
  reshape: [path('M12 5H5v14h14'), path('M12 5c5.5 0 7.5 3.5 5 7s-1 5.5 2 7', dashed)],
  'shared-boundary': [path('M3 6h9v12H3zM12 6h9v12h-9', tint), path('M12 4v16', { 'stroke-width': '3' })],
  union: [path('M4 4h10v6h6v10H10v-6H4z', tint)],
  difference: [path('M4 4h10v6h-4v4H4z', tint), path('M10 10h10v10H10z', dashed)],
  intersection: [path('M4 4h10v10H4zM10 10h10v10H10z', dashed), path('M10 10h4v4h-4z', { fill: 'currentColor' })],
  rotate: [path('M19.5 12a7.5 7.5 0 1 1-2.2-5.3'), path('M19.5 4v4.5H15')],
  scale: [rect(4, 11, 9, 1), path('M14 4h6v6M20 4l-7 7')],
  buffer: [rect(9, 9, 6, 0.5, tint), rect(4, 4, 16, 5, dashed)],
  offset: [path('M3 13 9 7l4 4 8-8'), path('m3 20 6-6 4 4 8-8', dashed)],
  simplify: [path('m3 13 2.5-4 2 3.5 3-6 2 5 3-4.5 2 3.5 3.5-4.5', { opacity: '.45' }), path('M3 19 21 9')],
  duplicate: [rect(9, 9, 11, 2), path('M15 9V5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15H9')],
  delete: [path('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3')],
  snapping: [path('M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4z'), path('M6 8h4m4 0h4')],
  constraints: [path('M4 20h16M4 20 16 8'), path('M10.5 20a6.5 6.5 0 0 0-1.9-4.6')],
  tracing: [path('M4 19 8 6h10l2 13z', { ...dashed, opacity: '.5' }), path('M8 6h10l2 13', { 'stroke-width': '2.6' })],
  undo: [path('M9 14 4 9l5-5'), path('M4 9h10.5a5.5 5.5 0 0 1 0 11H11')],
  redo: [path('m15 14 5-5-5-5'), path('M20 9H9.5a5.5 5.5 0 0 0 0 11H13')],
};

const svgNamespace = 'http://www.w3.org/2000/svg';

/** Build a tool icon with DOM methods, so it also works where `innerHTML` is restricted. */
export function toolbarIcon(document: Document, tool: ToolbarTool): SVGSVGElement {
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [tag, attributes] of icons[tool]) {
    const shape = document.createElementNS(svgNamespace, tag);
    for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
    svg.append(shape);
  }
  return svg;
}
