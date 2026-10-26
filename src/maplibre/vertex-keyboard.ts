import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Coordinate, EditorState, VertexUpdate } from '../core/types.js';

interface Actions {
  state(): EditorState;
  draft(): Coordinate[];
  start(): void;
  select(indices: readonly number[]): void;
  move(updates: readonly VertexUpdate[]): void;
  remove(): boolean;
  finish(): void;
  cancel(): void;
}
interface Movement {
  originals: VertexUpdate[];
  selected: number[];
  anchor: Coordinate;
  x: number;
  y: number;
  dx: number;
  dy: number;
  keys: Set<string>;
  session: string;
}
const directions: Record<string, Coordinate> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const instructions = 'Page Up / Page Down: previous / next vertex. Home / End: first / last. Space: select; Shift+Space: toggle. Arrows: move 1 pixel; Shift: 10 pixels. Delete: remove selected vertices. Enter: save. Escape while holding an arrow: undo that movement; otherwise cancel editing.';
const sessionKey = (state: EditorState): string => JSON.stringify([state.mode, state.selectedFeatureIds, state.activePartIndex, state.activeRingIndex]);

/** One tab stop for any draft size. Focus and selection are separate; movement
 * uses one frozen geographic group offset and never invokes pointer snapping. */
export class VertexKeyboard {
  private readonly canvas: HTMLCanvasElement;
  private readonly view: Window;
  private readonly root: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private readonly help: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly marker: HTMLDivElement;
  private index = 0;
  private session = '';
  private layoutKey = '';
  private movement: Movement | undefined;
  private blocked = new Set<string>();
  private destroyed = false;

  constructor(private readonly map: MapLibreMap, private readonly actions: Actions) {
    this.canvas = map.getCanvas(); this.view = this.canvas.ownerDocument.defaultView!;
    const doc = this.canvas.ownerDocument;
    this.root = doc.createElement('div'); this.root.dataset.geoVertexKeyboard = '';
    this.root.style.cssText = 'position:absolute;z-index:2;left:10px;bottom:40px;max-width:min(390px,calc(100% - 20px));pointer-events:none;font:12px/1.5 system-ui;color:#172b25;';
    this.button = doc.createElement('button'); this.button.type = 'button'; this.button.dataset.geoVertexFocus = '';
    this.button.style.cssText = 'pointer-events:auto;border:1px solid #64748b;border-radius:6px;background:white;color:#172b25;padding:7px 12px;min-height:36px;font:inherit;cursor:pointer;';
    this.button.title = instructions;
    this.button.setAttribute('aria-keyshortcuts', 'PageUp PageDown Home End Space Shift+Space ArrowLeft ArrowRight ArrowUp ArrowDown Enter Escape Delete');
    this.help = doc.createElement('div'); this.help.id = `geo-vertex-help-${this.view.crypto.randomUUID()}`;
    this.help.textContent = instructions; this.help.style.cssText = 'background:white;padding:8px;border:1px solid #64748b;border-radius:6px;margin-top:4px;'; this.help.hidden = true;
    this.button.setAttribute('aria-describedby', this.help.id);
    this.status = doc.createElement('div'); this.status.dataset.geoVertexKeyboardStatus = '';
    this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite'); this.status.setAttribute('aria-atomic', 'true');
    this.status.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);';
    this.marker = doc.createElement('div'); this.marker.dataset.geoVertexKeyboardMarker = ''; this.marker.setAttribute('aria-hidden', 'true');
    this.marker.style.cssText = 'position:absolute;pointer-events:none;width:22px;height:22px;box-sizing:border-box;border:3px solid #1d4ed8;border-radius:50%;box-shadow:0 0 0 2px white;transform:translate(-50%,-50%);'; this.marker.hidden = true;
    this.root.append(this.button, this.help, this.status);
    this.button.addEventListener('focus', this.focus); this.button.addEventListener('blur', this.blur);
    this.button.addEventListener('click', this.click);
    this.view.addEventListener('keydown', this.key, true); this.view.addEventListener('keyup', this.up, true);
    this.view.addEventListener('blur', this.interrupt);
    // Capture a new pointer interaction before vertex/rectangle handlers mutate the draft.
    map.getCanvasContainer().addEventListener('pointerdown', this.interrupt, true);
    map.on('move', this.camera); map.on('resize', this.camera);
  }

  render(): void {
    if (this.destroyed) return;
    const state = this.actions.state();
    if (!state.mode.startsWith('edit-')) { this.clear(); return; }
    const draft = this.actions.draft(); if (!draft.length) { this.clear(); return; }
    const session = sessionKey(state);
    if (session !== this.session) {
      this.movement = undefined; this.session = session;
      this.index = state.selectedVertexIndex ?? (state.mode === 'edit-shared-boundary' && draft.length > 2 ? 1 : 0);
    } else if (!this.focused() && !this.movement && state.selectedVertexIndex !== null) this.index = state.selectedVertexIndex;
    this.index = Math.min(this.index, draft.length - 1);
    const layoutKey = JSON.stringify([session, this.index, draft.length, state.selectedVertexIndices, state.canFinish, state.validationError, state.sharedBoundaryError, this.focused(), draft[this.index]]);
    if (layoutKey === this.layoutKey) return;
    this.layoutKey = layoutKey;
    if (!this.root.isConnected) this.map.getCanvasContainer().append(this.root, this.marker);
    const fixed = this.fixed(this.index, state, draft.length);
    const label = `${state.mode === 'edit-point' ? 'Point' : 'Vertex'} ${this.index + 1} of ${draft.length}${fixed ? ' · fixed endpoint' : ''}`;
    this.button.textContent = label;
    this.button.setAttribute('aria-label', `${label}. Keyboard editing`);
    this.button.setAttribute('aria-pressed', String(state.selectedVertexIndices.includes(this.index)));
    this.button.setAttribute('aria-invalid', String(!state.canFinish));
    const projected = this.map.project(draft[this.index]!);
    const onScreen = Number.isFinite(projected.x) && Number.isFinite(projected.y) && projected.x >= 0 && projected.y >= 0
      && projected.x <= this.canvas.clientWidth && projected.y <= this.canvas.clientHeight;
    this.marker.hidden = !this.focused() || !onScreen;
    if (onScreen) { this.marker.style.left = `${projected.x}px`; this.marker.style.top = `${projected.y}px`; }
    this.marker.style.borderColor = !state.canFinish ? '#b91c1c' : fixed ? '#64748b' : '#1d4ed8';
    if (this.focused()) {
      const error = state.validationError ?? state.sharedBoundaryError;
      this.announce(`${label}. ${state.selectedVertexIndices.length} selected.${onScreen ? '' : ' Outside view; pan the map to see it.'}${error ? ` Cannot save: ${error.replaceAll('-', ' ')}.` : ' Ready to save.'}`);
    }
  }

  private focused(): boolean { return this.canvas.ownerDocument.activeElement === this.button; }
  private fixed(index: number, state = this.actions.state(), length = state.vertexCount): boolean {
    return state.mode === 'edit-shared-boundary' && (index === 0 || index === length - 1);
  }
  private announce(text: string): void { if (this.status.textContent !== text) this.status.textContent = text; }

  /** External draft changes interrupt the held-key movement before applying. */
  stop(rollback = true): void {
    const movement = this.movement; if (!movement) return;
    this.movement = undefined;
    for (const key of movement.keys) this.blocked.add(key);
    if (rollback && sessionKey(this.actions.state()) === movement.session) {
      this.actions.move(movement.originals);
      if (!this.destroyed && sessionKey(this.actions.state()) === movement.session) this.actions.select(movement.selected);
    }
    this.render();
  }

  clear(): void {
    this.movement = undefined; this.session = ''; this.layoutKey = '';
    if (this.focused() && this.canvas.isConnected) this.canvas.focus({ preventScroll: true });
    this.root.remove(); this.marker.remove(); this.help.hidden = true;
  }

  destroy(): void {
    this.destroyed = true; this.clear(); this.blocked.clear();
    this.button.removeEventListener('focus', this.focus); this.button.removeEventListener('blur', this.blur); this.button.removeEventListener('click', this.click);
    this.view.removeEventListener('keydown', this.key, true); this.view.removeEventListener('keyup', this.up, true); this.view.removeEventListener('blur', this.interrupt);
    this.map.getCanvasContainer().removeEventListener('pointerdown', this.interrupt, true);
    this.map.off('move', this.camera); this.map.off('resize', this.camera);
  }

  private readonly focus = (): void => {
    this.actions.start(); this.help.hidden = false;
    this.button.style.outline = '3px solid #1d4ed8'; this.button.style.outlineOffset = '2px'; this.render();
  };
  private readonly blur = (): void => {
    this.stop(true); this.help.hidden = true; this.marker.hidden = true; this.button.style.outline = ''; this.layoutKey = '';
  };
  private readonly click = (event: MouseEvent): void => { event.stopPropagation(); this.button.focus({ preventScroll: true }); };
  private readonly interrupt = (): void => { this.stop(true); };
  private readonly camera = (): void => { this.stop(true); this.layoutKey = ''; this.render(); };
  private readonly up = (event: KeyboardEvent): void => {
    this.blocked.delete(event.key);
    this.movement?.keys.delete(event.key);
    if (this.movement && this.movement.keys.size === 0) {
      this.movement = undefined; this.render();
      const coordinate = this.actions.draft()[this.index];
      if (coordinate && this.actions.state().canFinish && this.focused()) this.announce(`Movement previewed. Longitude ${coordinate[0].toFixed(6)}, latitude ${coordinate[1].toFixed(6)}. Enter saves; Escape cancels editing.`);
    }
  };

  private readonly key = (event: KeyboardEvent): void => {
    if (this.destroyed || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const onCanvas = event.target === this.canvas; const onButton = event.target === this.button;
    const state = this.actions.state();
    if (!state.mode.startsWith('edit-') || !onCanvas && !onButton) return;
    const navigation = ['PageUp', 'PageDown', 'Home', 'End'].includes(event.key);
    if (onCanvas && !navigation) return;
    if (!navigation && !directions[event.key] && ![' ', 'Enter', 'Escape', 'Delete', 'Backspace'].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (navigation) {
      if (event.repeat || event.shiftKey) return;
      this.stop(false);
      const count = this.actions.draft().length;
      if (!count) return;
      this.index = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (this.index + (event.key === 'PageDown' ? 1 : count - 1)) % count;
      this.button.focus({ preventScroll: true }); this.render(); return;
    }
    if (directions[event.key]) {
      if (!event.repeat) this.blocked.delete(event.key);
      if (this.blocked.has(event.key) || event.repeat && !this.movement) return;
      this.nudge(event.key, event.shiftKey ? 10 : 1); return;
    }
    if (event.repeat || event.shiftKey && event.key !== ' ') return;
    if (event.key === 'Escape') {
      if (this.movement) { this.stop(true); this.announce('Movement cancelled. Earlier edits retained.'); }
      else this.actions.cancel();
      return;
    }
    if (this.movement) return; // Release arrows before saving/deleting/changing selection.
    if (event.key === 'Enter') { if (state.canFinish) this.actions.finish(); else this.announce('Cannot save this shape. Correct the invalid geometry or press Escape to cancel.'); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      const removed = this.actions.remove(); this.render();
      if (!removed) this.announce('Cannot remove this selection: minimum vertex count or fixed endpoint.');
      return;
    }
    if (this.fixed(this.index)) { this.announce('This shared boundary endpoint is fixed.'); return; }
    const selected = state.selectedVertexIndices;
    this.actions.select(event.shiftKey ? selected.includes(this.index) ? selected.filter(i => i !== this.index) : [...selected, this.index] : [this.index]);
    this.render();
  };

  private nudge(key: string, pixels: number): void {
    const state = this.actions.state(); const draft = this.actions.draft();
    const indices = state.selectedVertexIndices.includes(this.index) ? state.selectedVertexIndices : [this.index];
    if (indices.some(index => this.fixed(index, state, draft.length))) { this.announce('Fixed endpoints cannot move. Choose interior vertices.'); return; }
    if (!this.movement) {
      const anchor = draft[this.index]; if (!anchor) return;
      const point = this.map.project(anchor);
      this.movement = { originals: indices.map(index => ({ index, coordinate: [...draft[index]!] })), selected: state.selectedVertexIndices,
        anchor, x: point.x, y: point.y, dx: 0, dy: 0, keys: new Set(), session: sessionKey(state) };
    }
    const movement = this.movement; movement.keys.add(key);
    const direction = directions[key]!;
    const dx = movement.dx + direction[0] * pixels; const dy = movement.dy + direction[1] * pixels;
    const target = this.map.unproject([movement.x + dx, movement.y + dy]);
    const delta: Coordinate = [target.lng - movement.anchor[0], target.lat - movement.anchor[1]];
    const updates = movement.originals.map(({ index, coordinate }) => ({ index, coordinate: [coordinate[0] + delta[0], coordinate[1] + delta[1]] as Coordinate }));
    if (updates.some(({ coordinate: [lng, lat] }) => !Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90)) {
      this.announce('Movement outside geographic bounds. Move in the opposite direction.'); return;
    }
    movement.dx = dx; movement.dy = dy;
    this.actions.move(updates);
    if (this.movement === movement) this.render();
  }
}
