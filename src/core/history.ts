import type { FeatureChange, HistoryAction } from './types.js';

export interface HistoryEntry {
  action: HistoryAction;
  // Internal committed features are immutable: only snapshots leave the session.
  /** Original insertion position for added/removed features; -1 for in-place edits. */
  changes: (FeatureChange & { index: number })[];
}

/** Bounded command history; records only changed features, never full datasets. */
export class EditHistory {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];

  constructor(private readonly limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('historyLimit must be a nonnegative safe integer.');
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }

  peek(direction: 'undo' | 'redo'): HistoryEntry | undefined {
    return (direction === 'undo' ? this.past : this.future).at(-1);
  }

  record(entry: HistoryEntry): void {
    this.future = [];
    if (this.limit === 0) return;
    this.past.push(entry);
    if (this.past.length > this.limit) this.past.shift();
  }

  undo(): HistoryEntry | null {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push(entry);
    return entry;
  }

  redo(): HistoryEntry | null {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push(entry);
    return entry;
  }

  clear(): boolean {
    const changed = this.canUndo || this.canRedo;
    this.past = []; this.future = [];
    return changed;
  }
}
