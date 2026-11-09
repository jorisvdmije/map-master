"use client";
import { useEffect, useState } from "react";
import type { ProjectStorage } from "./storage";
import { parseProject, type Project } from "./project";

export function LocalProjects({ storage, capture, open, disabled }: { storage: ProjectStorage; capture: () => Project; open: (project: Project) => void; disabled: boolean }) {
  const [rows, setRows] = useState<{ key: string; name: string; modifiedAt: string }[]>([]);
  const [error, setError] = useState(""), [pending, setPending] = useState(false);
  useEffect(() => { void storage.listCopies().then(setRows).catch(error => setError(String(error))); }, [storage]);
  const save = async (project: Project) => {
    setPending(true); setError("");
    try { await storage.saveCopy(project); setRows(await storage.listCopies()); }
    catch (error) { setError(error instanceof Error ? error.message : "Saving failed."); }
    finally { setPending(false); }
  };
  return <details className="pg-local-projects"><summary>Local projects ({rows.length})</summary><div>
    <p>The current workspace saves automatically. Named copies below are saved versions in this browser. Download a project for a portable backup.</p>
    <button className="pg-button" disabled={disabled || pending} onClick={() => void save(capture())}>Save named copy</button>
    <ul>{rows.map(row => <li key={row.key}><strong>{row.name}</strong><time dateTime={row.modifiedAt}>{new Date(row.modifiedAt).toLocaleString()}</time>
      <button className="pg-button" disabled={disabled || pending} onClick={() => void storage.readCopy(row.key).then(parseProject).then(open).catch(error => setError(String(error)))}>Open</button>
      <button className="pg-button" disabled={disabled || pending} onClick={() => void storage.readCopy(row.key).then(parseProject).then(project => save({ ...project, name: `${project.name.slice(0, 140)} copy` })).catch(error => setError(String(error)))}>Duplicate</button>
    </li>)}</ul>{error && <p role="alert">{error}</p>}
  </div></details>;
}
