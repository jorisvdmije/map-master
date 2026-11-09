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

  async listCopies(): Promise<{ key: string; name: string; modifiedAt: string }[]> {
    const transaction = this.database.transaction("projects", "readonly");
    const request = transaction.objectStore("projects").getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result.filter(row => typeof row.key === "string" && row.key.startsWith("copy:")).map(row => ({ key: row.key, name: typeof row.project?.name === "string" ? row.project.name : "Unreadable project", modifiedAt: row.modifiedAt ?? "" })).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)));
      request.onerror = () => reject(new Error("The project list could not be read."));
    });
  }

  async readCopy(key: string): Promise<unknown> {
    if (!key.startsWith("copy:")) throw new Error("Invalid saved project.");
    const request = this.database.transaction("projects", "readonly").objectStore("projects").get(key);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => request.result ? resolve(request.result.project) : reject(new Error("Saved project no longer exists."));
      request.onerror = () => reject(new Error("Saved project could not be read."));
    });
  }

  async saveCopy(project: Project): Promise<void> {
    const transaction = this.database.transaction("projects", "readwrite"), store = transaction.objectStore("projects");
    // Copies are immutable snapshots. No current-project revision is changed.
    store.put({ key: `copy:${crypto.randomUUID()}`, project, modifiedAt: new Date().toISOString() });
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(new Error("The named copy could not be saved. Download your project to keep your work."));
    });
  }

  close() { this.database.close(); }
}
