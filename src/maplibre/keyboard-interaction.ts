import type { EditorState, HistoryEvent } from '../core/types.js';
import { keyboardTools, type KeyboardAction, type KeyboardTool } from '../core/keyboard-shortcuts.js';
import type { ShortcutBindings } from './shortcut-bindings.js';

interface KeyboardActions {
  state(): EditorState;
  history(direction: HistoryEvent['direction']): void;
  deselect(): void;
  deleteSelected(): void;
  deleteSelection(): void;
  removeLastDrawStep(): void;
  removeSplitPoint(): void;
  removeReshapePoint(): void;
  removeSelectedVertices(): void;
  finish(): void;
  cancel(): void;
  /** Move the selection by screen pixels; false when it cannot move. */
  nudge(x: number, y: number): boolean;
  tool(action: KeyboardTool): boolean;
}

const nudges: Partial<Record<KeyboardAction, [number, number]>> = {
  'nudge-left': [-1, 0], 'nudge-right': [1, 0], 'nudge-up': [0, -1], 'nudge-down': [0, 1],
  'nudge-left-fast': [-10, 0], 'nudge-right-fast': [10, 0], 'nudge-up-fast': [0, -10], 'nudge-down-fast': [0, 10],
};

/** Canvas-scoped commands. Gesture handlers capture Escape first; typing outside
 * the map and unsupported modifiers remain the host application's responsibility.
 * Alt snapping is handled separately because it also observes keyup and blur.
 */
export class KeyboardInteraction {
  constructor(private readonly canvas: HTMLCanvasElement, private readonly actions: KeyboardActions, private readonly bindings: ShortcutBindings) {
    // Capture before MapLibre's navigation handler consumes a remapped movement key.
    canvas.addEventListener('keydown', this.key, true);
  }

  destroy(): void { this.canvas.removeEventListener('keydown', this.key, true); }

  private readonly key = (event: KeyboardEvent): void => {
    if (event.target !== this.canvas || (this.canvas.getRootNode() as Document | ShadowRoot).activeElement !== this.canvas) return;
    const state = this.actions.state();
    const movement = (Object.keys(nudges) as KeyboardAction[]).find(action => this.bindings.matches(action, event));
    if (movement) {
      const [x, y] = nudges[movement]!;
      if (state.mode === 'idle' && state.selectedFeatureIds.length > 0 && this.actions.nudge(x, y)) this.consume(event);
      return;
    }
    if (event.repeat) return;
    const command = (['finish', 'cancel', 'delete', 'undo', 'redo'] as const).find(action => this.bindings.matches(action, event));
    if (command === 'undo' || command === 'redo') {
      if (state.mode === 'idle' && state[command === 'undo' ? 'canUndo' : 'canRedo']) {
        this.consume(event); this.actions.history(command);
      }
      return;
    }
    if (state.mode === 'idle') {
      if (state.selectedFeatureIds.length > 0 && (command === 'cancel' || command === 'delete')) {
        this.consume(event);
        if (command === 'cancel') this.actions.deselect();
        else if (state.selectedFeatureIds.length === 1) this.actions.deleteSelected();
        else this.actions.deleteSelection();
        return;
      }
      const tool = keyboardTools.find(action => this.bindings.matches(action, event));
      if (tool && this.actions.tool(tool)) this.consume(event);
      return;
    }
    if (state.mode.startsWith('draw-') && command === 'delete') {
      this.consume(event); this.actions.removeLastDrawStep(); return;
    }
    if (state.mode === 'reshape-polygon' && command === 'delete') {
      this.consume(event); this.actions.removeReshapePoint(); return;
    }
    if (state.mode === 'split-polygon' && command === 'delete') {
      this.consume(event); this.actions.removeSplitPoint(); return;
    }
    if (state.mode.startsWith('edit-') && command === 'delete') {
      if (state.selectedVertexIndices.length) { this.consume(event); this.actions.removeSelectedVertices(); }
      return;
    }
    if (command === 'finish' || command === 'cancel') {
      this.consume(event);
      if (command === 'finish') this.actions.finish();
      else this.actions.cancel();
    }
  };

  private consume(event: KeyboardEvent): void { event.preventDefault(); event.stopImmediatePropagation(); }
}
