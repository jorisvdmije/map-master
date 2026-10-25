import type { GeometryFeatureCollection } from '@jorisvdmije/map-master';

export const STORAGE_KEY = 'geo-area-workspace:v1';
const MAX_BYTES = 5 * 1024 * 1024;

export interface WorkspaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Application persistence; the editor owns geometry validation, never storage. */
export class WorkspaceStore {
  private baseline: string | null = null;
  private blocked = true;

  constructor(private readonly storage: WorkspaceStorage) {}

  get recovery(): string | null { return this.baseline; }
  get canSave(): boolean { return !this.blocked; }

  read(): { data: unknown } | null {
    this.blocked = true;
    this.baseline = this.storage.getItem(STORAGE_KEY);
    if (this.baseline === null) return null;
    if (new Blob([this.baseline]).size > MAX_BYTES) throw new Error('The saved workspace exceeds the 5 MB limit.');
    const document: unknown = JSON.parse(this.baseline);
    if (typeof document !== 'object' || document === null
      || !('format' in document) || document.format !== 'geo-area-workspace'
      || !('version' in document) || document.version !== 1
      || !('data' in document)) {
      throw new Error('This saved workspace has an unsupported format or version.');
    }
    return { data: document.data };
  }

  /** Call only after importing the complete document successfully (or no saved copy). */
  accept(): void { this.blocked = false; }

  save(data: GeometryFeatureCollection): void {
    if (this.blocked) throw new Error('Recover or discard the unreadable saved copy before saving.');
    const next = JSON.stringify({ format: 'geo-area-workspace', version: 1, data });
    if (new Blob([next]).size > MAX_BYTES) throw new Error('The workspace exceeds the 5 MB storage limit. Export GeoJSON to keep your work.');
    this.assertUnchanged();
    this.storage.setItem(STORAGE_KEY, next);
    // A failed write must not advance the saved baseline.
    this.baseline = next;
  }

  discard(): void {
    this.assertUnchanged();
    this.storage.removeItem(STORAGE_KEY);
    this.baseline = null;
    this.blocked = false;
  }

  private assertUnchanged(): void {
    if (this.storage.getItem(STORAGE_KEY) !== this.baseline) {
      throw new Error('Another tab changed the saved copy. Export your work, then reload to open that copy.');
    }
  }
}
