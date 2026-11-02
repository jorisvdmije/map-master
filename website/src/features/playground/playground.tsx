"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Check, ChevronRight, Download, FileJson2, FolderOpen, Layers, LocateFixed, MapPinned, MousePointer2, Plus, Redo2, SlidersHorizontal, Undo2, Upload, X } from "lucide-react";
import { assetPath } from "@/lib/paths";
import { AttributeTable, Dialog, Inspector, LayersPanel, PropertyDialog, type EditField, type Run } from "./panels";
import { download, emptyProject, filename, layerId, parseProject, projectFormat, readFile, sampleProject, type Project } from "./project";
import type { PlaygroundRuntime } from "./runtime";
import type { ProjectStorage } from "./storage";
import "./playground.css";

type Message = { text: string; error: boolean };
class Session {
  savedRevision: number;
  constructor(readonly runtime: PlaygroundRuntime, readonly storage: ProjectStorage | null, public blocked: boolean, public recovery: unknown | null, restored: boolean) {
    this.savedRevision = restored ? runtime.getSnapshot().revision : -1;
  }
  pauseSaving() { this.blocked = true; }
  resumeSaving() { this.blocked = false; this.recovery = null; }
  markSaved(revision: number) { this.savedRevision = revision; }
  needsSaving() { return this.runtime.getSnapshot().revision !== this.savedRevision; }
}

export function Playground({ version }: { version: string }) {
  const container = useRef<HTMLDivElement>(null);
  const client = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState("");
  const [message, setMessage] = useState<Message | null>(null);
  const notify = useCallback((text: string, error = false) => setMessage({ text, error }), []);
  useEffect(() => {
    const lifetime = new AbortController();
    let active: Session | undefined;
    let storage: ProjectStorage | undefined;
    void (async () => {
      const [{ mountPlayground }, { ProjectStorage }] = await Promise.all([import("./runtime"), import("./storage")]);
      if (lifetime.signal.aborted) return;
      const runtime = await mountPlayground(container.current!, lifetime.signal, client, notify);
      if (!runtime || lifetime.signal.aborted) return;
      let recovery: unknown | null = null;
      let blocked = false;
      let restored = false;
      try {
        storage = await ProjectStorage.open();
        const saved = await storage.read();
        if (saved !== null) {
          try { runtime.replaceProject(saved); restored = true; }
          catch { recovery = saved; blocked = true; notify("Your saved project could not be restored. Download the saved copy before starting again.", true); }
        }
      } catch (error) {
        storage?.close(); storage = undefined;
        notify(error instanceof Error ? error.message : "Local saving is unavailable. Download your project to keep your work.", true);
      }
      if (lifetime.signal.aborted) { storage?.close(); return; }
      active = new Session(runtime, storage ?? null, blocked, recovery, restored);
      setSession(active);
    })().catch(error => {
      if (!lifetime.signal.aborted) { setFailure(error instanceof Error ? error.message : "The map could not start."); lifetime.abort(); }
    });
    return () => {
      if (active?.storage && !active.blocked && active.needsSaving()) {
        const project = active.runtime.capture();
        void active.storage.save(project).catch(() => {}).finally(() => active?.storage?.close());
      } else storage?.close();
      lifetime.abort();
    };
  }, [attempt, client, notify]);

  return <main className="pg-root" aria-label="Geodata playground" data-playground data-ready={session ? "true" : undefined}>
    <a href="#playground-map" className="skip-link">Skip to map</a>
    <div ref={container} id="playground-map" className="pg-map" tabIndex={-1} role="region" aria-label="Playground map" />
    {session ? <Workbench session={session} version={version} message={message} notify={notify} dismiss={() => setMessage(null)} /> : <>
      <header className="pg-header"><Brand /><span className="pg-loading-label">Your workspace is opening…</span><Link href="/" prefetch={false}>Documentation <ArrowUpRight size={14} /></Link></header>
      <div className="pg-loading-card"><MapPinned size={34} /><h1>{failure ? "The map could not start" : "Making room for your data."}</h1><p>{failure || "Loading the editor and restoring your local project…"}</p>
        {failure && <button className="pg-button pg-primary" onClick={() => { setFailure(""); setAttempt(value => value + 1); }}>Try again</button>}
        <noscript>This playground needs JavaScript and WebGL. Your files are processed locally.</noscript>
      </div>
    </>}
  </main>;
}

function Brand() {
  return <Link href="/" className="pg-brand" prefetch={false} aria-label="Map Master documentation"><Image src={assetPath("/logo.svg")} width={31} height={31} alt="" priority /><span>Map Master<small>PLAYGROUND</small></span></Link>;
}

function Workbench({ session, version, message, notify, dismiss }: { session: Session; version: string; message: Message | null; notify: (text: string, error?: boolean) => void; dismiss: () => void }) {
  const { runtime, storage } = session;
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  const { state, project } = snapshot;
  const [savedRevision, setSavedRevision] = useState(session.savedRevision);
  const [storageError, setStorageError] = useState("");
  const [recovery, setRecovery] = useState(session.recovery);
  const [focused, setFocused] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<"layers" | "properties" | null>(null);
  const [field, setField] = useState<EditField | null>(null);
  const [exporting, setExporting] = useState(false);
  const [replacement, setReplacement] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const mapFrame = useRef<HTMLDivElement>(null);
  const layer = project.layers.find(layer => layer.id === (focused ?? project.activeLayerId)) ?? project.layers[0]!;
  const idle = state.mode === "idle" && !busy;
  const run: Run = (action, text) => { try { action(); if (text) notify(text); } catch (error) { notify(error instanceof Error ? error.message : "This action could not be completed.", true); } };
  const focus = (id: string) => run(() => {
    setFocused(id);
    const layer = runtime.editor.getDataLayers().find(layer => layer.id === id);
    if (layer?.visible && layer.editable && !layer.locked && runtime.editor.getState().mode === "idle") runtime.editor.setActiveDataLayer(id);
  });

  useLayoutEffect(() => {
    const frame = mapFrame.current!;
    const map = runtime.map.getContainer();
    const root = map.parentElement!;
    const sync = () => {
      const bounds = frame.getBoundingClientRect(); const parent = root.getBoundingClientRect();
      Object.assign(map.style, { inset: "auto", left: `${bounds.left - parent.left}px`, top: `${bounds.top - parent.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
      runtime.map.resize();
    };
    const observer = new ResizeObserver(sync);
    observer.observe(frame); sync();
    window.addEventListener("resize", sync);
    return () => { observer.disconnect(); window.removeEventListener("resize", sync); };
  }, [runtime]);

  useEffect(() => {
    if (!storage || session.blocked || snapshot.revision === savedRevision) return;
    let mounted = true;
    const revision = snapshot.revision;
    const timer = setTimeout(() => {
      if (session.blocked) return;
      const document = runtime.capture();
      void storage.save(document).then(() => { session.markSaved(revision); if (mounted) setSavedRevision(revision); }).catch(error => {
        session.pauseSaving();
        if (mounted) { const text = error instanceof Error ? error.message : "Local saving failed. Download your project."; setStorageError(text); notify(text, true); }
      });
    }, 600);
    return () => { mounted = false; clearTimeout(timer); };
  }, [snapshot.revision, savedRevision, runtime, storage, session, notify]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const current = runtime.getSnapshot();
      if (current.state.mode !== "idle" || session.blocked || storage && current.revision !== savedRevision || !storage && current.state.featureCount > 0) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [runtime, storage, session, savedRevision]);

  const replace = (next: Project) => run(() => {
    runtime.replaceProject(next); setFocused(null); setReplacement(null); notify(`Opened ${next.name}.`);
  });
  const requestReplace = (next: Project) => {
    if (runtime.getSnapshot().project.data.features.length > 0) setReplacement(next); else replace(next);
  };
  const importFiles = async (files: File[], projectOnly = false) => {
    if (!files.length || busy) return;
    setBusy(true);
    try {
      runtime.assertIdle();
      if (session.recovery !== null && session.blocked && recovery !== null) throw new Error("Download or discard the saved recovery copy before opening another project.");
      if (files.length > 20) throw new Error("Import at most 20 files at a time.");
      const decoded: { file: File; data: unknown }[] = [];
      const failures: string[] = [];
      for (const file of files) {
        try { decoded.push({ file, data: await readFile(file, projectOnly) }); }
        catch (error) { failures.push(`${file.name}: ${error instanceof Error ? error.message : "This file could not be read."}`); }
      }
      if (!decoded.length) throw new Error(failures.join(" "));
      const isProject = (value: unknown) => typeof value === "object" && value !== null && "format" in value && value.format === projectFormat;
      if (projectOnly || decoded.some(item => isProject(item.data))) {
        if (decoded.length !== 1 || files.length !== 1) throw new Error("Open one project at a time, separately from GeoJSON files.");
        requestReplace(parseProject(decoded[0]!.data));
      } else {
        let imported = 0;
        for (const { file, data } of decoded) {
          try { imported += runtime.importGeoJSON(data, file.name.replace(/\.(geojson|json)$/iu, "")); }
          catch (error) { failures.push(`${file.name}: ${error instanceof Error ? error.message : "Import failed"}`); }
        }
        setFocused(runtime.editor.getActiveDataLayer());
        notify(failures.length ? `${imported} features imported. ${failures.join(" ")}` : `Imported ${imported.toLocaleString()} features. Each file is a separate layer.`, failures.length > 0);
      }
    } catch (error) { notify(error instanceof Error ? error.message : "The file could not be opened.", true); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const root = runtime.map.getContainer().parentElement!;
    const enter = (event: DragEvent) => { if (event.dataTransfer?.types.includes("Files")) { event.preventDefault(); dragDepth.current++; setDragging(true); } };
    const over = (event: DragEvent) => { if (event.dataTransfer?.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } };
    const leave = (event: DragEvent) => { if (event.dataTransfer?.types.includes("Files")) { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); } };
    const drop = (event: DragEvent) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (event.dataTransfer) void importFiles([...event.dataTransfer.files]); };
    root.addEventListener("dragenter", enter); root.addEventListener("dragover", over); root.addEventListener("dragleave", leave); root.addEventListener("drop", drop);
    return () => { root.removeEventListener("dragenter", enter); root.removeEventListener("dragover", over); root.removeEventListener("dragleave", leave); root.removeEventListener("drop", drop); };
  });

  const saveProject = () => run(() => {
    const project = runtime.capture();
    download(JSON.stringify(project), `${filename(project.name)}.mapmaster.json`);
    notify("Project downloaded with data, layers, styles and map position.");
  });
  const edit = (field: EditField) => { setField(field); };
  const mode = state.mode === "idle" ? "Select & explore" : state.mode.replaceAll("-", " ");
  const status = !storage ? "Download to keep your work" : session.blocked ? "Local save paused" : savedRevision === snapshot.revision ? "Saved locally" : "Saving locally…";

  return <div className={`pg-workbench${drawer ? ` pg-show-${drawer}` : ""}${dragging ? " pg-dragging" : ""}`} data-busy={busy ? "true" : undefined} data-feature-count={state.featureCount} data-layer-count={project.layers.length} data-mode={state.mode} aria-busy={busy}>
    <header className="pg-header"><Brand /><span className="pg-header-divider" />
      <div className="pg-project-heading"><input key={project.name} aria-label="Project name" defaultValue={project.name} maxLength={150} onBlur={event => runtime.rename(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} disabled={busy} />
        <span className={`pg-save-state${session.blocked || !storage ? " pg-save-warning" : ""}`} role="status">{savedRevision === snapshot.revision && !session.blocked ? <Check size={11} /> : <span className="pg-status-dot" />}{status}</span></div>
      <div className="pg-project-actions"><button className="pg-icon-button pg-new" title="New project" aria-label="New project" disabled={!idle || recovery !== null} onClick={() => requestReplace(emptyProject())}><Plus size={18} /></button>
        <details className="pg-mobile-project-menu"><summary aria-label="Project actions"><FolderOpen size={17} /></summary><div><button disabled={!idle || recovery !== null} onClick={event => { requestReplace(emptyProject()); event.currentTarget.closest("details")!.open = false; }}><Plus size={14} />New project</button><button disabled={!idle || recovery !== null} onClick={event => { projectInput.current?.click(); event.currentTarget.closest("details")!.open = false; }}><FolderOpen size={14} />Open project</button><Link href="/" prefetch={false}>Documentation <ArrowUpRight size={13} /></Link></div></details>
        <button className="pg-button pg-open-project" aria-label="Open project" disabled={!idle || recovery !== null} onClick={() => projectInput.current?.click()}><FolderOpen size={15} /><span>Open project</span></button>
        <button className="pg-button" aria-label="Save project" disabled={!idle} onClick={saveProject}><Download size={15} /><span>Save project</span></button>
        <button className="pg-button pg-primary" aria-label="Export GeoJSON" disabled={!idle || !state.featureCount} onClick={() => setExporting(true)}><ArrowUpRight size={16} /><span>Export GeoJSON</span></button>
        <Link className="pg-docs-link" href="/" prefetch={false}>Docs <ArrowUpRight size={14} /></Link></div>
    </header>
    <div className="pg-ribbon" role="toolbar" aria-label="Workspace actions">
      <button className="pg-button pg-import-button" disabled={!idle || recovery !== null} onClick={() => fileInput.current?.click()}><Upload size={15} />Import data</button>
      <span className="pg-ribbon-divider" /><button className="pg-icon-button" disabled={!state.canUndo || busy} aria-label="Undo" title="Undo" onClick={() => run(() => { runtime.editor.undo(); })}><Undo2 size={17} /></button>
      <button className="pg-icon-button" disabled={!state.canRedo || busy} aria-label="Redo" title="Redo" onClick={() => run(() => { runtime.editor.redo(); })}><Redo2 size={17} /></button>
      <button className="pg-button pg-fit" disabled={!state.featureCount || busy} onClick={() => run(() => { runtime.editor.zoomToFeatures(undefined, { padding: 70, maxZoom: 17, duration: 250 }); })}><LocateFixed size={15} /><span>Fit data</span></button>
      <span className="pg-ribbon-divider" /><label className="pg-ribbon-toggle"><input type="checkbox" checked={project.settings.snapping} onChange={event => run(() => runtime.setSetting("snapping", event.target.checked))} />Snapping</label>
      <label className="pg-ribbon-toggle pg-guides-toggle"><input type="checkbox" checked={project.settings.guides} onChange={event => run(() => runtime.setSetting("guides", event.target.checked))} />Guides</label>
      <div className="pg-ribbon-end"><button className="pg-button pg-layers-toggle" aria-expanded={drawer === "layers"} onClick={() => setDrawer(drawer === "layers" ? null : "layers")}><Layers size={15} />Layers</button>
        <button className="pg-button pg-properties-toggle" aria-expanded={drawer === "properties"} onClick={() => setDrawer(drawer === "properties" ? null : "properties")}><SlidersHorizontal size={15} />Properties</button>
        <span className="pg-local-note"><span className="pg-status-dot" />Browser-local workspace</span></div>
    </div>
    <input ref={fileInput} className="sr-only" tabIndex={-1} type="file" multiple accept=".geojson,.json,application/geo+json,application/json" aria-label="Import GeoJSON files" onChange={event => { void importFiles([...event.target.files ?? []]); event.target.value = ""; }} />
    <input ref={projectInput} className="sr-only" tabIndex={-1} type="file" accept=".json,application/json" aria-label="Open project file" onChange={event => { void importFiles([...event.target.files ?? []], true); event.target.value = ""; }} />
    <LayersPanel snapshot={snapshot} runtime={runtime} focused={layer.id} focus={focus} run={run} close={() => setDrawer(null)} />
    <div ref={mapFrame} className="pg-map-frame">
      <div className="pg-map-caption"><span className="pg-map-breadcrumb">WORKSPACE <ChevronRight size={12} />{layer.name}</span><div className="pg-caption-actions"><button className="pg-icon-button pg-mobile-fit" aria-label="Fit data" disabled={!state.featureCount || busy} onClick={() => run(() => { runtime.editor.zoomToFeatures(undefined, { padding: 60, maxZoom: 17, duration: 200 }); })}><LocateFixed size={16} /></button><label className="pg-basemap"><span className="sr-only">Basemap</span><select aria-label="Basemap" value={project.settings.basemap} onChange={event => run(() => runtime.setSetting("basemap", event.target.value as "streets" | "blank"))}><option value="streets">Street map</option><option value="blank">Plain map</option></select></label></div></div>
      {!state.featureCount && state.mode === "idle" && recovery === null && <div className="pg-empty-card"><div className="pg-empty-icon"><Layers size={29} /><span>+</span></div><span className="pg-kicker">A CANVAS FOR YOUR GEODATA</span><h1>Your data.<br /><em>Your next idea.</em></h1><p>Drop a GeoJSON file onto the map.<br />Draw, refine and make it yours.</p>
        <button className="pg-button pg-primary pg-wide" disabled={!idle} onClick={() => fileInput.current?.click()}><Upload size={16} />Import GeoJSON</button>
        <button className="pg-link-button" disabled={!idle} onClick={() => run(() => { runtime.replaceProject(sampleProject()); setFocused(null); runtime.editor.zoomToFeatures(undefined, { padding: 75, maxZoom: 14.5, duration: 0 }); }, "Opened the sample project.")}>Or explore the sample project <ArrowUpRight size={13} /></button><small>GeoJSON · WGS84 · up to 10 MB per file</small></div>}
      {recovery !== null && <div className="pg-empty-card pg-recovery"><FileJson2 size={30} /><h1>Keep your saved copy.</h1><p>The previous project could not be restored. Download it for recovery before starting again.</p><button className="pg-button pg-wide" onClick={() => download(JSON.stringify(recovery, null, 2), "playground-recovery.json")}>Download saved copy</button><button className="pg-button pg-danger pg-wide" onClick={() => setReplacement(emptyProject())}>Start a new project</button></div>}
      <div className="pg-map-options"><label><input type="checkbox" checked={project.settings.measurements} onChange={event => run(() => runtime.setSetting("measurements", event.target.checked))} />Measurements</label><label><input type="checkbox" checked={project.settings.scaleBorders} onChange={event => run(() => runtime.setSetting("scaleBorders", event.target.checked))} />Scale borders with zoom</label></div>
      <div className="pg-mode-indicator"><MousePointer2 size={13} /><span>{mode}</span>{state.validationError && <strong>{state.validationError.replaceAll("-", " ")}</strong>}</div>
    </div>
    <Inspector snapshot={snapshot} runtime={runtime} layer={layer} run={run} edit={edit} close={() => setDrawer(null)} />
    <AttributeTable snapshot={snapshot} runtime={runtime} focused={layer.id} run={run} edit={edit} />
    <footer className="pg-statusbar"><span><span className="pg-status-dot" />{busy ? "Reading your file…" : `${state.featureCount.toLocaleString()} features`}{state.selectedFeatureIds.length > 0 && ` · ${state.selectedFeatureIds.length} selected`}</span><span className="pg-status-coordinates">{project.camera.center[1].toFixed(5)}° N, {project.camera.center[0].toFixed(5)}° E</span><span>WGS84 <span className="pg-status-version">· Map Master {version}</span></span></footer>
    {message && <div className={`pg-notice${message.error ? " pg-notice-error" : ""}`} role={message.error ? "alert" : "status"}><span>{message.text}</span><button className="pg-icon-button" aria-label="Dismiss message" onClick={dismiss}><X size={15} /></button></div>}
    {storageError && <span className="sr-only" role="status">{storageError}</span>}
    {dragging && <div className="pg-drop-overlay"><div><Upload size={36} /><h2>Drop your data here</h2><p>GeoJSON up to 10 MB per file · one Map Master project up to 50 MB</p></div></div>}
    {field && <PropertyDialog key={`${typeof field.id}:${field.id}:${field.key}`} runtime={runtime} field={field} close={() => setField(null)} notify={notify} />}
    {exporting && <ExportDialog runtime={runtime} focused={layer.id} close={() => setExporting(false)} notify={notify} />}
    {replacement && <Dialog title="Open a different project?" close={() => setReplacement(null)}><p>This replaces the current workspace and its edit history. Download your project first if you want to keep a separate copy.</p>
      <div className="pg-dialog-actions"><button className="pg-button" onClick={saveProject}><Download size={15} />Download current</button><button className="pg-button" onClick={() => setReplacement(null)}>Cancel</button><button className="pg-button pg-primary" onClick={() => {
        try {
          runtime.replaceProject(replacement);
          setFocused(null); setReplacement(null);
          if (recovery !== null) { session.resumeSaving(); setRecovery(null); setStorageError(""); }
          notify(`Opened ${replacement.name}.`);
        } catch (error) { notify(error instanceof Error ? error.message : "The project could not be opened.", true); setReplacement(null); }
      }}>Open project</button></div></Dialog>}
  </div>;
}

function ExportDialog({ runtime, focused, close, notify }: { runtime: PlaygroundRuntime; focused: string; close: () => void; notify: (message: string) => void }) {
  const snapshot = runtime.getSnapshot();
  const [scope, setScope] = useState("all");
  const [name, setName] = useState(filename(snapshot.project.name));
  const selected = new Set(snapshot.state.selectedFeatureIds);
  const features = snapshot.project.data.features.filter(feature => scope === "all" || (scope === "layer" ? layerId(feature) === focused : selected.has(feature.id)));
  return <Dialog title="Export GeoJSON" close={close}><p>Download your committed geometry and all feature attributes. Use Save project to include layer settings and map appearance.</p>
    <form onSubmit={event => { event.preventDefault(); download(JSON.stringify({ type: "FeatureCollection", features }, null, 2), `${filename(name)}.geojson`, "application/geo+json"); close(); notify(`Exported ${features.length.toLocaleString()} features.`); }}>
      <label className="pg-field">Export scope<select aria-label="Export scope" value={scope} onChange={event => setScope(event.target.value)}><option value="all">All layers</option><option value="layer">Current layer</option><option value="selection" disabled={!selected.size}>Selected features</option></select></label>
      <label className="pg-field">File name<div className="pg-filename"><input value={name} onChange={event => setName(event.target.value)} required maxLength={150} /><span>.geojson</span></div></label>
      <p className="pg-export-count"><FileJson2 size={18} />{features.length.toLocaleString()} features · WGS84 coordinates</p>
      <div className="pg-dialog-actions"><button type="button" className="pg-button" onClick={close}>Cancel</button><button className="pg-button pg-primary" type="submit" disabled={!features.length}><Download size={15} />Download GeoJSON</button></div>
    </form>
  </Dialog>;
}
