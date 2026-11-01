import type { EditorState, HistoryEvent } from '../core/types.js';

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
}

const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Canvas-scoped commands. Gesture handlers capture Escape first; typing outside
 * the map and unsupported modifiers remain the host application's responsibility.
 * Alt snapping is handled separately because it also observes keyup and blur.
 */
export class KeyboardInteraction {
  constructor(private readonly canvas: HTMLCanvasElement, private readonly actions: KeyboardActions) {
    canvas.addEventListener('keydown', this.key);
  }

  destroy(): void { this.canvas.removeEventListener('keydown', this.key); }

  private readonly key = (event: KeyboardEvent): void => {
    if (event.target !== this.canvas || event.defaultPrevented || event.isComposing || event.altKey) return;
    // Arrow keys move a selection by 1 pixel (Shift: 10) instead of panning the map.
    const arrow = arrows[event.key];
    if (arrow && !event.ctrlKey && !event.metaKey) {
      const step = event.shiftKey ? 10 : 1;
      const state = this.actions.state();
      if (state.mode === 'idle' && state.selectedFeatureIds.length > 0 && this.actions.nudge(arrow[0] * step, arrow[1] * step)) {
        event.preventDefault(); event.stopPropagation();
      }
      return;
    }
    if (event.repeat) return;
    const state = this.actions.state();
    if (event.ctrlKey || event.metaKey) {
      if (event.ctrlKey && event.metaKey || state.mode !== 'idle') return;
      const key = event.key.toLowerCase();
      const direction = key === 'z' ? event.shiftKey ? 'redo' : 'undo'
        : key === 'y' && event.ctrlKey && !event.shiftKey ? 'redo' : null;
      if (direction && state[direction === 'undo' ? 'canUndo' : 'canRedo']) {
        event.preventDefault(); this.actions.history(direction);
      }
      return;
    }
    if (event.shiftKey) return;
    if (state.mode === 'idle') {
      if (state.selectedFeatureIds.length > 0
        && (event.key === 'Escape' || event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        if (event.key === 'Escape') this.actions.deselect();
        else if (state.selectedFeatureIds.length === 1) this.actions.deleteSelected();
        else this.actions.deleteSelection();
      }
      return;
    }
    if (state.mode.startsWith('draw-') && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault(); this.actions.removeLastDrawStep(); return;
    }
    if (state.mode === 'reshape-polygon' && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault(); this.actions.removeReshapePoint(); return;
    }
    if (state.mode === 'split-polygon' && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault(); this.actions.removeSplitPoint(); return;
    }
    if (state.mode.startsWith('edit-') && (event.key === 'Delete' || event.key === 'Backspace')) {
      if (state.selectedVertexIndices.length) { event.preventDefault(); this.actions.removeSelectedVertices(); }
      return;
    }
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      if (event.key === 'Enter') this.actions.finish();
      else this.actions.cancel();
    }
  };
}
