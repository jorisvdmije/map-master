import type { ShortcutBindings } from './shortcut-bindings.js';
import type { EditorMap as MapLibreMap } from '../gl/map.js';
import type { Coordinate } from '../core/types.js';
import { canvasPoint } from './pointer.js';

interface LassoActions {
  enabled(): boolean;
  finish(points: Coordinate[]): void;
  cancel(): void;
}
interface Gesture {
  pointerId: number;
  points: Coordinate[];
  spacing: number;
  pan: boolean;
  boxZoom: boolean;
  camera: string;
}

/** A bounded screen-space stroke; no GeoJSON uploads while the pointer moves. */
export class LassoInteraction {
  private readonly canvas: HTMLCanvasElement;
  private readonly view: Window;
  private readonly overlay: SVGSVGElement;
  private readonly outline: SVGPathElement;
  private gesture: Gesture | undefined;
  private frame: number | undefined;
  private suppressClick = false;
  private touchAction: string | null = null;

  constructor(private readonly map: MapLibreMap, private readonly actions: LassoActions, private readonly shortcuts: ShortcutBindings) {
    this.canvas = map.getCanvas();
    this.view = this.canvas.ownerDocument.defaultView!;
    const document = this.canvas.ownerDocument;
    this.overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.overlay.dataset.geoLasso = '';
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
    this.outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.outline.setAttribute('fill', '#2563eb');
    this.outline.setAttribute('fill-opacity', '.12');
    this.outline.setAttribute('stroke', '#2563eb');
    this.outline.setAttribute('stroke-width', '1.5');
    this.outline.setAttribute('stroke-dasharray', '5 3');
    this.outline.setAttribute('fill-rule', 'evenodd');
    this.overlay.append(this.outline);
    this.canvas.addEventListener('pointerdown', this.down, true);
    this.canvas.addEventListener('pointermove', this.move);
    this.canvas.addEventListener('pointerup', this.up);
    this.canvas.addEventListener('pointercancel', this.interrupt);
    this.canvas.addEventListener('lostpointercapture', this.interrupt);
    this.canvas.addEventListener('click', this.click, true);
    this.canvas.addEventListener('keydown', this.key, true);
    this.view.addEventListener('blur', this.blur);
  }

  setEnabled(enabled: boolean): void {
    if (enabled && this.touchAction === null) {
      this.touchAction = this.canvas.style.touchAction;
      this.canvas.style.touchAction = 'none';
    } else if (!enabled && this.touchAction !== null) {
      this.canvas.style.touchAction = this.touchAction;
      this.touchAction = null;
    }
  }

  stop(restoreGestures = true): void {
    const gesture = this.gesture;
    this.gesture = undefined;
    if (this.frame !== undefined) this.view.cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.overlay.remove();
    if (!gesture) return;
    if (this.canvas.hasPointerCapture(gesture.pointerId)) this.canvas.releasePointerCapture(gesture.pointerId);
    if (restoreGestures) {
      if (gesture.pan) this.map.dragPan.enable(); else this.map.dragPan.disable();
      if (gesture.boxZoom) this.map.boxZoom.enable(); else this.map.boxZoom.disable();
    }
  }

  destroy(restoreGestures: boolean): void {
    this.stop(restoreGestures); this.setEnabled(false);
    this.canvas.removeEventListener('pointerdown', this.down, true);
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerup', this.up);
    this.canvas.removeEventListener('pointercancel', this.interrupt);
    this.canvas.removeEventListener('lostpointercapture', this.interrupt);
    this.canvas.removeEventListener('click', this.click, true);
    this.canvas.removeEventListener('keydown', this.key, true);
    this.view.removeEventListener('blur', this.blur);
  }

  /** Redundant resize notifications do not change the view or invalidate a stroke. */
  cameraChanged(): void {
    if (this.gesture && this.gesture.camera !== this.cameraKey()) this.stop();
  }

  private cameraKey(): string {
    const center = this.map.getCenter(); const padding = this.map.getPadding();
    return JSON.stringify([center.lng, center.lat, this.map.getZoom(), this.map.getBearing(), this.map.getPitch(), (this.map.getRoll?.() ?? 0),
      padding.top, padding.right, padding.bottom, padding.left, this.canvas.clientWidth, this.canvas.clientHeight]);
  }

  private point(event: PointerEvent): Coordinate {
    const { x, y } = canvasPoint(this.canvas, event);
    return [Math.max(0, Math.min(this.canvas.clientWidth, x)), Math.max(0, Math.min(this.canvas.clientHeight, y))];
  }

  private readonly down = (event: PointerEvent): void => {
    if (this.gesture) {
      if (event.pointerId !== this.gesture.pointerId) this.stop();
      return;
    }
    this.suppressClick = false;
    if (!this.actions.enabled() || !event.isPrimary || event.button !== 0 || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    event.preventDefault(); event.stopPropagation();
    this.suppressClick = true;
    this.canvas.focus({ preventScroll: true });
    this.map.stop();
    this.gesture = { pointerId: event.pointerId, points: [this.point(event)], spacing: 3,
      pan: this.map.dragPan.isEnabled(), boxZoom: this.map.boxZoom.isEnabled(), camera: this.cameraKey() };
    this.map.dragPan.disable(); this.map.boxZoom.disable();
    this.canvas.setPointerCapture(event.pointerId);
  };

  private sample(event: PointerEvent, force = false): void {
    const gesture = this.gesture;
    if (!gesture) return;
    const point = this.point(event); const previous = gesture.points.at(-1)!;
    const distance = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    if (distance === 0 || !force && distance < gesture.spacing) return;
    gesture.points.push(point);
    if (gesture.points.length > 1024) {
      gesture.points = gesture.points.filter((_, index, points) => index % 2 === 0 || index === points.length - 1);
      gesture.spacing *= 2;
    }
  }

  private readonly move = (event: PointerEvent): void => {
    if (this.gesture?.pointerId !== event.pointerId) return;
    this.sample(event);
    if (this.frame !== undefined) return;
    this.frame = this.view.requestAnimationFrame(() => {
      this.frame = undefined;
      const points = this.gesture?.points;
      if (!points || points.length < 2) return;
      this.outline.setAttribute('d', `${points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')} Z`);
      if (!this.overlay.isConnected) this.map.getCanvasContainer().append(this.overlay);
    });
  };

  private readonly up = (event: PointerEvent): void => {
    if (this.gesture?.pointerId !== event.pointerId) return;
    this.sample(event, true);
    const points = this.gesture.points;
    this.stop();
    if (this.actions.enabled()) this.actions.finish(points);
  };
  private readonly interrupt = (event: PointerEvent): void => {
    if (this.gesture?.pointerId === event.pointerId) this.stop();
  };
  private readonly click = (event: MouseEvent): void => {
    if (this.suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  private readonly key = (event: KeyboardEvent): void => {
    if (!this.gesture || event.repeat || event.target !== this.canvas) return;
    const cancel = this.shortcuts.matches('cancel', event, ['Shift']);
    if (cancel || this.shortcuts.matches('finish', event, ['Shift'])) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (cancel) this.actions.cancel();
    }
  };
  private readonly blur = (): void => { this.stop(); };
}
