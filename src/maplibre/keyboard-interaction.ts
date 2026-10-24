import type { EditorState, HistoryEvent } from '../core/types.js';

interface KeyboardActions {
  state(): EditorState;
  history(direction: HistoryEvent['direction']): void;
  deselect(): void;
  deleteSelected(): void;
  deleteSelection(): void;
  removeSplitPoint(): void;
  removeReshapePoint(): void;
  removeVertex(index: number): void;
  finish(): void;
  cancel(): void;
}

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
    if (event.target !== this.canvas || event.defaultPrevented || event.isComposing || event.repeat || event.altKey) return;
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
    if (state.mode === 'reshape-polygon' && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault(); this.actions.removeReshapePoint(); return;
    }
    if (state.mode === 'split-polygon' && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault(); this.actions.removeSplitPoint(); return;
    }
    if (state.mode.startsWith('edit-') && (event.key === 'Delete' || event.key === 'Backspace')) {
      const index = state.selectedVertexIndex;
      if (index !== null) { event.preventDefault(); this.actions.removeVertex(index); }
      return;
    }
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      if (event.key === 'Enter') this.actions.finish();
      else this.actions.cancel();
    }
  };
}
