import type { ScreenPoint } from '../core/snapping.js';

/** Convert viewport coordinates to map CSS pixels, including CSS-scaled canvases.
 * Do not clamp: captured vertex/group drags can finish outside the canvas.
 */
export function canvasPoint(canvas: HTMLCanvasElement, event: Pick<PointerEvent, 'clientX' | 'clientY'>): ScreenPoint {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * canvas.clientWidth / bounds.width,
    y: (event.clientY - bounds.top) * canvas.clientHeight / bounds.height,
  };
}
