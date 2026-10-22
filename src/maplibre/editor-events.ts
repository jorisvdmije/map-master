import type {
  EditorState, GeometryFeature, GeometryFeatureCollection, HistoryEvent, SnapResult, TransactionEvent,
} from '../core/types.js';

interface EventPayloads {
  create: GeometryFeature;
  delete: GeometryFeature;
  update: GeometryFeature;
  import: GeometryFeatureCollection;
  transaction: TransactionEvent;
  history: HistoryEvent;
  change: EditorState;
  snap: SnapResult | null;
}

/** Internal subscriptions. The controller supplies a fresh snapshot per observer.
 * Notification is synchronous; observer failures are reported without stopping
 * subsequent observers or interrupting a committed operation.
 */
export class EditorEvents {
  private readonly listeners: { [K in keyof EventPayloads]: Set<(value: EventPayloads[K]) => void> } = {
    create: new Set(), delete: new Set(), update: new Set(), import: new Set(),
    transaction: new Set(), history: new Set(), change: new Set(), snap: new Set(),
  };

  constructor(private readonly reportError: (error: unknown) => void) {}

  on<K extends keyof EventPayloads>(kind: K, listener: (value: EventPayloads[K]) => void): () => void {
    this.listeners[kind].add(listener);
    return () => { this.listeners[kind].delete(listener); };
  }

  emit<K extends keyof EventPayloads>(kind: K, snapshot: () => EventPayloads[K]): void {
    for (const listener of this.listeners[kind]) {
      try { listener(snapshot()); }
      catch (error) { this.reportError(error); }
    }
  }

  clear(): void {
    for (const listeners of Object.values(this.listeners)) listeners.clear();
  }
}
