import type { Project } from "./project";

type Saved = { key: "current"; revision: number; project: unknown };

/** Revision checks and writes share one IndexedDB transaction, including across tabs. */
export class ProjectStorage {
  private revision = 0;
  private writes = Promise.resolve();
  private constructor(private readonly database: IDBDatabase) {}

  static async open(): Promise<ProjectStorage> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("map-master-playground", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("projects", { keyPath: "key" });
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(new ProjectStorage(request.result));
      };
      request.onerror = () => reject(new Error("Local project storage is unavailable. Download your project to keep your work."));
      request.onblocked = () => reject(new Error("Close other playground tabs to enable local saving."));
    });
  }

  async read(): Promise<unknown | null> {
    const transaction = this.database.transaction("projects", "readonly");
    const request = transaction.objectStore("projects").get("current") as IDBRequest<Saved | undefined>;
    return new Promise((resolve, reject) => {
      request.onsuccess = () => { this.revision = request.result?.revision ?? 0; resolve(request.result?.project ?? null); };
      request.onerror = () => reject(new Error("The locally saved project could not be read."));
    });
  }

  save(project: Project): Promise<void> {
    const write = this.writes.then(() => this.write(project));
    this.writes = write.catch(() => {});
    return write;
  }

  private async write(project: Project): Promise<void> {
    const transaction = this.database.transaction("projects", "readwrite");
    const store = transaction.objectStore("projects");
    const request = store.get("current") as IDBRequest<Saved | undefined>;
    let conflict = false;
    const next = this.revision + 1;
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        if ((request.result?.revision ?? 0) !== this.revision) { conflict = true; transaction.abort(); return; }
        try { store.put({ key: "current", revision: next, project } satisfies Saved); }
        catch { transaction.abort(); }
      };
      transaction.oncomplete = () => { this.revision = next; resolve(); };
      transaction.onabort = transaction.onerror = () => reject(new Error(conflict
        ? "Another tab saved this project. Download your work, then reload before continuing local saving."
        : "Local saving failed. Download your project to keep your work."));
    });
  }

  close() { this.database.close(); }
}
