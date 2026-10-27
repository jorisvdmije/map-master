import type { EditorState, GeometryEditor } from '@jorisvdmije/map-master';

const titles: Record<EditorState['mode'], string> = {
  idle: 'Select or draw', 'draw-point': 'Place a marker', 'draw-line': 'Draw a line',
  'draw-polygon': 'Draw a polygon', 'draw-hole': 'Draw a hole', 'edit-point': 'Move a marker',
  'edit-line': 'Edit line vertices', 'edit-polygon': 'Edit polygon vertices',
  'split-polygon': 'Split polygon', 'reshape-polygon': 'Reshape polygon',
  'edit-shared-boundary': 'Edit shared boundary', 'union-polygons': 'Merge polygons',
  'difference-polygons': 'Subtract polygons', 'intersection-polygons': 'Intersect polygons',
  'rotate-features': 'Rotate selection', 'scale-features': 'Scale selection',
  'simplify-features': 'Simplify selection', 'buffer-features': 'Buffer selection', 'offset-lines': 'Offset lines',
};

/** Presentation only. Existing controls and the public API own command eligibility. */
export class WorkflowControls {
  private mode: EditorState['mode'] = 'idle';
  private readonly reasons = new Map<HTMLButtonElement, HTMLElement>();
  private readonly settings = document.getElementById('operation-settings')!;

  constructor(private readonly editor: GeometryEditor) {
    for (const button of document.querySelectorAll<HTMLButtonElement>('#selection button')) {
      const reason = document.createElement('small');
      reason.id = `${button.id}-reason`; reason.className = 'tool-reason'; reason.hidden = true;
      button.insertAdjacentElement('afterend', reason);
      this.reasons.set(button, reason);
    }
  }

  update(): void {
    const state = this.editor.getState();
    const busy = state.mode !== 'idle';
    document.getElementById('operation-title')!.textContent = titles[state.mode];
    document.querySelector('.action-bar')!.classList.toggle('is-active', busy);
    document.getElementById('selection-busy')!.hidden = !busy;
    this.settings.hidden = ![...this.settings.children].some(child => !(child as HTMLElement).hidden);
    const selected = this.editor.getSelection();
    const locked = selected.some(feature => this.editor.isFeatureLocked(feature.id));
    const targetLocked = selected[0] !== undefined && this.editor.isFeatureLocked(selected[0].id);
    for (const [button, hint] of this.reasons) {
      let reason = '';
      if (button.disabled) {
        reason = busy ? 'Finish or cancel the current operation first.'
          : (button.id === 'difference-selected' ? targetLocked : locked) ? 'Unlock the selected shape before changing it.'
          : button.id === 'offset-selected' ? 'Select only lines to offset.'
          : button.id === 'edit-shared-boundary' ? 'Select two polygons without holes that share a matching boundary.'
          : button.id === 'reshape-selected' ? 'Select one polygon without holes.'
          : button.id === 'split-selected' ? 'Select one Polygon; multipart splitting is not supported.'
          : ['union-selected', 'intersection-selected', 'difference-selected'].includes(button.id) ? 'Select at least two polygons. Shift+click adds to the selection.'
          : button.id === 'delete-hole' ? 'Choose an interior ring in “Ring to edit”.'
          : 'Select exactly one shape to edit its vertices.';
      }
      hint.textContent = reason;
      // During an operation one shared notice avoids repeating the same sentence.
      hint.hidden = !reason || button.hidden || busy;
      button.title = reason;
      if (reason) button.setAttribute('aria-describedby', busy ? 'selection-busy' : hint.id);
      else button.removeAttribute('aria-describedby');
    }
    for (const action of ['undo', 'redo']) {
      const button = document.getElementById(action) as HTMLButtonElement;
      button.title = button.disabled ? busy ? 'Finish or cancel the current operation first.'
        : `No available ${action} action. Locked shapes can block history.` : action === 'undo' ? 'Undo the last saved change' : 'Redo the last undone change';
    }
    if (state.mode !== this.mode && busy && !this.settings.hidden) {
      // Scroll only the tool panel. The map and action bar never leave the viewport.
      document.querySelector('.sidebar')!.scrollTop = 0;
    }
    this.mode = state.mode;
  }
}
