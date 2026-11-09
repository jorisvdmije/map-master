"use client";

import Image from "next/image";
import Link from "next/link";
import { WorkspaceNavigation } from "@/components/workspaces/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpRight, BarChart3, Check, ChevronLeft, ChevronRight, CircleHelp, Database, FileJson2, Filter, Focus, Info, MapPinned, MousePointer2, Pentagon, Plus, Redo2, Search, SlidersHorizontal, Square, Table2, Trash2, Undo2, Upload, X } from "lucide-react";
import type { EditorState } from "@jorisvdmije/map-master";
import { assetPath } from "@/lib/paths";
import { download, filename } from "@/features/playground/project";
import { areaKm2, categories, csvDataset, defaultFields, demoArea, demoDataset, emptyFilters, exportCSV, fileLimit, filterRows, histogram, parseCSV, parseGeoJSON, savedFileLimit, schema, spatialRows, summarize, valueLabel, type AnalysisArea, type CsvInput, type Dataset, type Fields, type Filters } from "./model";
import type { AnalysisRuntime } from "./runtime";
import { AnalysisIntro, needsIntroduction, rememberIntroduction } from "./intro";
import { openAnalysisRecovery, parseAnalysis, type AnalysisDocument, type AnalysisRecovery } from "./session";
import { Modal } from "./modal";
import "./analysis.css";

const format = (value: number | null, digits = 1) => value === null ? "—" : value.toLocaleString("en-GB", { maximumFractionDigits: digits });
const areaName = (area: AnalysisArea, i: number) => typeof area.properties?.name === "string" ? area.properties.name : `Area ${i + 1}`;
type Notice = { text: string; error: boolean };

export function Analysis() {
  const container = useRef<HTMLDivElement>(null);
  const pickRef = useRef<(index: number) => void>(() => {});
  const client = useQueryClient();
  const [runtime, setRuntime] = useState<AnalysisRuntime | null>(null);
  const [recovery, setRecovery] = useState<AnalysisRecovery | null>(null);
  const [failure, setFailure] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const notify = useCallback((text: string, error = false) => setNotice({ text, error }), []);
  useEffect(() => {
    const lifetime = new AbortController();
    void import("./runtime").then(async ({ mountAnalysis }) => {
      const runtime = await mountAnalysis(container.current!, lifetime.signal, client, i => pickRef.current(i), text => notify(text));
      if (runtime && !lifetime.signal.aborted) {
        const recovery = openAnalysisRecovery();
        try { runtime.replaceAreas(recovery.initial?.areas ?? [demoArea], !!recovery.initial); }
        catch (error) {
          if (!recovery.initial) throw error;
          recovery.rejectRestore(); runtime.replaceAreas([demoArea]);
        }
        if (recovery.initial?.activeArea != null) runtime.editor.select(runtime.areas()[recovery.initial.activeArea].id!);
        setRecovery(recovery); setRuntime(runtime);
      }
    }).catch(error => { if (!lifetime.signal.aborted) { setFailure(error instanceof Error ? error.message : "WebGL is unavailable."); lifetime.abort(); } });
    return () => lifetime.abort();
  }, [attempt, client, notify]);

  return <main className="an-root" data-analysis data-ready={runtime ? "true" : undefined}>
    <a href="#analysis-map" className="skip-link">Skip to map</a>
    <Header />
    {runtime && recovery ? <Workbench runtime={runtime} recovery={recovery} pickRef={pickRef} notify={notify} /> : <div className="an-loading"><MapPinned size={32} /><h1>{failure ? "The map could not start" : "A fresh perspective on your data."}</h1><p>{failure || "Preparing your analysis workspace…"}</p>{failure && <button className="an-button" onClick={() => { setFailure(""); setAttempt(v => v + 1); }}>Try again</button>}<noscript>This workspace needs JavaScript and WebGL.</noscript></div>}
    <div className="an-map-host" ref={container} id="analysis-map" role="region" aria-label="Analysis map" tabIndex={-1} />
    {notice && <div className={`an-notice${notice.error ? " an-error" : ""}`} role={notice.error ? "alert" : "status"}><span>{notice.text}</span><button aria-label="Dismiss message" onClick={() => setNotice(null)}><X size={16} /></button></div>}
  </main>;
}

function Header() {
  return <header className="an-header"><Link className="an-brand" href="/" prefetch={false}><Image src={assetPath("/logo.svg")} width={31} height={31} alt="" priority /><span>Map Master<small>YOUR DATA, IN PERSPECTIVE</small></span></Link>
    <WorkspaceNavigation current="/analysis/" language="en" />
    <Link className="an-docs" href="/" prefetch={false}>Documentation <ArrowUpRight size={14} /></Link>
  </header>;
}

function Workbench({ runtime, recovery, pickRef, notify }: { runtime: AnalysisRuntime; recovery: AnalysisRecovery; pickRef: React.RefObject<(index: number) => void>; notify: (text: string, error?: boolean) => void }) {
  const { editor } = runtime;
  const [dataset, setDataset] = useState(() => recovery.initial?.dataset ?? demoDataset());
  const [fields, setFields] = useState<Fields>(() => recovery.initial?.fields ?? defaultFields(dataset));
  const [filters, setFilters] = useState<Filters>(() => recovery.initial?.filters ?? emptyFilters);
  const [state, setState] = useState<EditorState>(() => editor.getState());
  const [activeId, setActiveId] = useState<string | null>(() => recovery.initial?.activeArea != null ? String(runtime.areas()[recovery.initial.activeArea]?.id) : null);
  const [focused, setFocused] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [csv, setCsv] = useState<{ input: CsvInput; name: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [showIntro, setShowIntro] = useState(() => !recovery.initial && !recovery.blocked && needsIntroduction());
  const savedLocally = useSyncExternalStore(recovery.subscribe, recovery.getSnapshot, recovery.getSnapshot);
  const [recoveryBlocked, setRecoveryBlocked] = useState(recovery.blocked);
  const input = useRef<HTMLInputElement>(null);
  const areaInput = useRef<HTMLInputElement>(null);
  const mapFrame = useRef<HTMLDivElement>(null);
  const selection = useRef<string | null>(null);
  // Cache the editor snapshot by its public data revision, not selection/draft changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const areas = useMemo(() => runtime.areas(), [runtime, state.dataRevision]);
  const selected = areas.find(a => String(a.id) === activeId) ?? null;
  const isSample = dataset.name === "Amsterdam · service requests";
  const sampleArea = isSample ? areas.find(a => a.properties?.name === "City centre") : undefined;
  const columns = useMemo(() => schema(dataset), [dataset]);
  const spatial = useMemo(() => spatialRows(dataset, selected), [dataset, selected]);
  const rows = useMemo(() => filterRows(dataset, spatial, fields, filters), [dataset, spatial, fields, filters]);
  const features = useMemo(() => rows.map(i => dataset.data.features[i]!), [dataset, rows]);
  const stats = useMemo(() => summarize(features, fields.metric), [features, fields.metric]);
  const groups = useMemo(() => {
    const filtered = filterRows(dataset, spatial, fields, { ...filters, category: null });
    const counts = new Map(categories(filtered.map(i => dataset.data.features[i]!), fields.category).map(c => [c.key, c.count]));
    return categories(dataset.data.features, fields.category).map(c => ({ ...c, count: counts.get(c.key) ?? 0 })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [dataset, spatial, fields, filters]);
  const bins = useMemo(() => histogram(filterRows(dataset, spatial, fields, { ...filters, range: null }).map(i => dataset.data.features[i]!), fields.metric), [dataset, spatial, fields, filters]);
  const idle = state.mode === "idle" && !busy;
  const activeFilters = filters.category !== null || filters.range !== null || !!filters.query;
  const run = (action: () => void) => { try { action(); } catch (error) { notify(error instanceof Error ? error.message : "This action could not be completed.", true); } };

  useEffect(() => editor.onChange(() => {
    const next = editor.getState();
    setState(next);
    const id = next.selectedFeatureId === null ? null : String(next.selectedFeatureId);
    if (id !== null && id !== selection.current) setActiveId(id);
    selection.current = id;
  }), [editor]);
  useEffect(() => {
    pickRef.current = i => { setFocused(i); setShowInsights(true); };
    return () => { pickRef.current = () => {}; };
  }, [pickRef]);
  useEffect(() => { runtime.render(dataset, rows, fields, focused); }, [runtime, dataset, rows, fields, focused]);
  useEffect(() => { runtime.fit(dataset); }, [runtime, dataset]);
  // The map lives outside the workbench to preserve its WebGL canvas across loading.
  useEffect(() => {
    const frame = mapFrame.current!, host = runtime.map.getContainer();
    let pending = 0;
    const sync = () => {
      const rect = frame.getBoundingClientRect(), parent = host.parentElement!.getBoundingClientRect();
      Object.assign(host.style, { left: `${rect.left - parent.left}px`, top: `${rect.top - parent.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      runtime.map.resize();
    };
    const schedule = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(sync); };
    const observer = new ResizeObserver(schedule); observer.observe(frame); sync();
    window.addEventListener("resize", schedule);
    return () => { cancelAnimationFrame(pending); observer.disconnect(); window.removeEventListener("resize", schedule); };
  }, [runtime]);

  const document = useMemo<AnalysisDocument>(() => ({ format: "map-master-analysis", version: 1, name: dataset.name, dataset: dataset.data, areas: { type: "FeatureCollection", features: areas }, fields, filters: { category: filters.category, query: filters.query, range: filters.range, rangeExclusive: filters.rangeExclusive === true }, activeArea: selected ? areas.indexOf(selected) : null }), [dataset, areas, fields, filters, selected]);
  const hasDraft = state.mode !== "idle" || busy;
  const saveStatus = recoveryBlocked ? "Recovery copy needs attention" : hasDraft ? "Unfinished changes · finish or cancel to save" : savedLocally ? "Saved in this browser" : "Recovery unavailable · download to keep your work";
  useLayoutEffect(() => { recovery.write(document); }, [recovery, document, recoveryBlocked]);
  useEffect(() => {
    const needsWarning = () => hasDraft || !savedLocally || recoveryBlocked;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (needsWarning()) { event.preventDefault(); event.returnValue = ""; } };
    // Internal links do not trigger beforeunload. Confirm explicitly when recovery
    // is unavailable or a draft cannot be serialized as committed geometry.
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !needsWarning()) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!target || target.download || target.target === "_blank") return;
      const url = new URL(target.href);
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm("This analysis has changes that are not saved for recovery. Use Save analysis to download your committed work. Leave anyway?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); window.document.removeEventListener("click", navigate, true); };
  }, [savedLocally, recoveryBlocked, hasDraft]);
  const restoreDocument = (input: unknown) => {
    const restored = parseAnalysis(input);
    runtime.replaceAreas(restored.areas, true);
    editor.select(restored.activeArea === null ? null : runtime.areas()[restored.activeArea].id!);
    setDataset(restored.dataset); setFields(restored.fields); setFilters(restored.filters); setFocused(null);
    setActiveId(restored.activeArea === null ? null : String(runtime.areas()[restored.activeArea]?.id));
  };
  const changeDataset = (next: Dataset) => {
    runtime.replaceAreas([]);
    setDataset(next); setFields(defaultFields(next)); setFilters(emptyFilters); setFocused(null); setActiveId(null);
    notify(`Loaded ${next.data.features.length.toLocaleString()} features. Draw or import an area to start exploring.`);
  };
  const read = async (file: File | undefined, asAreas = false) => {
    if (!file || !idle) return;
    setBusy(true);
    try {
      const maxBytes = !asAreas && /\.analysis\.json$/iu.test(file.name) ? savedFileLimit : fileLimit;
      if (file.size > maxBytes) throw new Error(`Choose a file smaller than ${maxBytes / 1024 / 1024} MB.`);
      const text = await file.text();
      if (/\.csv$/iu.test(file.name) && !asAreas) { setCsv({ input: parseCSV(text), name: file.name }); return; }
      const value: unknown = JSON.parse(text);
      if (!asAreas && value && typeof value === "object" && "format" in value && value.format === "map-master-analysis") {
        restoreDocument(value);
        notify("Analysis opened with data, areas and filters.");
      } else {
        const next = parseGeoJSON(value, file.name.replace(/\.(geojson|json)$/iu, ""));
        if (asAreas) {
          if (!next.data.features.length || next.data.features.some(f => f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon")) throw new Error("Choose a GeoJSON file containing only polygons or multipolygons.");
          if (areas.length + next.data.features.length > 200) throw new Error("An analysis supports up to 200 areas.");
          // Import all in one transaction so invalid geometry cannot leave a partial import.
          const imported = editor.importGeoJSON({ type: "FeatureCollection", features: next.data.features.map((f, i) => ({ ...f, id: crypto.randomUUID(), properties: { name: typeof f.properties.name === "string" ? f.properties.name : `${next.name} ${i + 1}` } })) });
          const first = imported.features[0]!; editor.select(first.id); setActiveId(String(first.id));
          editor.zoomToFeatures(imported.features.map(f => f.id), { padding: 60, maxZoom: 16, duration: 0 });
          notify(`Added ${imported.features.length} analysis areas.`);
        } else changeDataset(next);
      }
    } catch (error) { notify(error instanceof Error ? error.message : "This file could not be imported.", true); }
    finally { setBusy(false); }
  };
  const save = () => download(JSON.stringify(document), `${filename(dataset.name)}.analysis.json`);
  const exportResults = (type: "geojson" | "csv" | "summary") => {
    const stem = `${filename(dataset.name)}-results`;
    if (type === "geojson") download(JSON.stringify({ type: "FeatureCollection", features }), `${stem}.geojson`, "application/geo+json");
    else if (type === "csv") download(exportCSV(features), `${stem}.csv`, "text/csv;charset=utf-8");
    else download(JSON.stringify({ dataset: dataset.name, area: selected, areaKm2: areaKm2(selected), matchRule: "Intersects area, including boundary; each feature counted once; full attribute values, no area weighting", fields, filters, total: dataset.data.features.length, statistics: stats }, null, 2), `${stem}-summary.json`);
    notify(`Exported ${type === "summary" ? "analysis summary" : `${features.length} matching features`}.`);
  };
  const focusRow = (index: number) => { setFocused(index); runtime.fit(dataset, index); };
  const selectedFeature = focused !== null ? dataset.data.features[focused] : null;
  const closeIntro = () => { rememberIntroduction(); setShowIntro(false); };
  const trySampleArea = () => {
    if (!sampleArea || !idle) return;
    run(() => {
      editor.select(sampleArea.id!); setActiveId(String(sampleArea.id));
      setFields(defaultFields(dataset)); setFilters(emptyFilters); setFocused(null);
      setShowSettings(false); setShowInsights(false); closeIntro();
      editor.zoomToFeatures([sampleArea.id!], { padding: 65, maxZoom: 14, duration: 0 });
      notify("City centre selected. Try Waste in the category chart under Insights to narrow the results.");
    });
  };

  return <div className={`an-workbench${showSettings ? " an-show-settings" : ""}${showInsights ? " an-show-insights" : ""}`} data-mode={state.mode} data-matches={rows.length}>
    <div className="an-titlebar"><div><div className="an-eyebrow">SPATIAL EXPLORER <span>BETA</span></div><div className="an-heading-row"><h1>Find the story in your area.</h1><button className="an-info-button" aria-label="How Analysis works" title="How Analysis works" aria-haspopup="dialog" aria-expanded={showIntro} onClick={event => { event.currentTarget.focus(); setShowIntro(true); }}><Info size={16} /></button></div></div><div className="an-top-actions"><span className="an-recovery-status" role="status" data-analysis-save={savedLocally && !hasDraft && !recoveryBlocked ? "saved" : "unsaved"}>{saveStatus}</span><button className="an-button" disabled={!idle} onClick={save}><ArrowDownToLine size={15} /><span>Save analysis</span></button><details className="an-export"><summary className="an-button an-primary" aria-label="Export results"><ArrowUpRight size={15} />Export results</summary><div>{(["geojson", "csv", "summary"] as const).map(type => <button key={type} onClick={event => { exportResults(type); event.currentTarget.closest("details")!.open = false; }}>{type === "geojson" ? "Matching GeoJSON" : type === "csv" ? "Matching CSV" : "Summary & statistics"}</button>)}</div></details></div></div>
    {recoveryBlocked && <div className="an-recovery-warning" role="alert"><strong>The previous analysis could not be restored.</strong><p>Your saved copy has been preserved. Download it before starting again. Automatic recovery stays paused until you discard that copy.</p><button className="an-button" onClick={() => download(recovery.raw ?? "", "analysis-recovery.json")}>Download recovery copy</button><button className="an-button" onClick={() => run(() => { recovery.discardCorruptCopy(); setRecoveryBlocked(false); })}>Discard recovery copy</button></div>}
    <div className="an-mobile-tabs"><button onClick={() => { setShowSettings(!showSettings); setShowInsights(false); }} aria-expanded={showSettings}><SlidersHorizontal size={15} />Configure</button><button onClick={() => { setShowInsights(!showInsights); setShowSettings(false); }} aria-expanded={showInsights}><BarChart3 size={15} />Insights</button></div>
    <aside className="an-sidebar" aria-label="Analysis configuration">
      <div className="an-panel-title"><h2><SlidersHorizontal size={16} />Configure analysis</h2><button className="an-mobile-close" aria-label="Close configuration" onClick={() => setShowSettings(false)}><X size={16} /></button></div>
      <section><h3><span>01</span> Your data</h3><div className="an-source"><Database size={19} /><div><strong>{dataset.name}</strong><small>{format(dataset.data.features.length, 0)} features · {columns.fields.length} fields</small></div></div>
        {isSample && <div className="an-demo-context"><strong>Where should a maintenance team focus?</strong><p>One dot = one fictitious report. Colour = type. Cost = estimated repair cost in EUR.</p><button className="an-text-button" onClick={trySampleArea} disabled={!idle || !sampleArea}>Explore City centre <ArrowUpRight size={12} /></button><button className="an-text-button" onClick={event => { event.currentTarget.focus(); setShowIntro(true); }}><Info size={12} />About this example</button></div>}
        <button className="an-button an-wide" disabled={!idle} onClick={() => input.current?.click()}><Upload size={14} />Import data / open analysis</button><p className="an-hint">GeoJSON or CSV · WGS84 · up to 10 MB<br />Import replaces the current analysis.</p>
        <button className="an-text-button" disabled={!idle} onClick={() => run(() => { changeDataset(demoDataset()); runtime.replaceAreas([demoArea]); })}>Load sample data <ArrowUpRight size={12} /></button>
        <Link className="an-case-link" href="/analysis/streets/" prefetch={false}><MapPinned size={17} /><span><strong>Amsterdam street lab</strong><small>Trees, lighting, reports & changing patterns</small></span><ArrowUpRight size={13} /></Link>
        <Link className="an-case-link" href="/analysis/housing/" prefetch={false}><MapPinned size={17} /><span><strong>Wonen in Amsterdam</strong><small>BAG-adressen, WOZ & buurtvergelijkingen</small></span><ArrowUpRight size={13} /></Link>
        <Link className="an-case-link" href="/analysis/reachability/" prefetch={false}><MapPinned size={17} /><span><strong>Bereikbaarheidscontouren</strong><small>Reistijdgebieden & afstand langs lijnen</small></span><ArrowUpRight size={13} /></Link>
        <Link className="an-case-link" href="/analysis/bnb/" prefetch={false}><MapPinned size={17} /><span><strong>B&B permit dashboard</strong><small>Wards, available permits & applications</small></span><ArrowUpRight size={13} /></Link>
      </section>
      <section><h3><span>02</span> Analysis area</h3><label className="an-field">Explore within<select aria-label="Analysis area" disabled={!idle} value={selected ? String(selected.id) : ""} onChange={event => { setActiveId(event.target.value || null); if (event.target.value) { const a = areas.find(a => String(a.id) === event.target.value)!; editor.select(a.id!); } else editor.select(null); }}><option value="">All data · no spatial filter</option>{areas.map((a, i) => <option key={String(a.id)} value={String(a.id)}>{areaName(a, i)}</option>)}</select></label>
        <div className="an-button-pair"><button className="an-button" disabled={!idle || areas.length >= 200} onClick={() => run(() => { setShowSettings(false); editor.draw("Polygon"); })}><Pentagon size={14} />Draw area</button><button className="an-button" disabled={!idle || areas.length >= 200} title="Draw a rectangular area" aria-label="Draw rectangle" onClick={() => run(() => { setShowSettings(false); editor.draw("Rectangle"); })}><Square size={14} /></button></div>
        <div className="an-area-actions"><button className="an-text-button" disabled={!idle} onClick={() => areaInput.current?.click()}><Plus size={12} />Import areas</button><button className="an-text-button" disabled={!idle || !selected} onClick={() => run(() => { editor.select(selected!.id!); editor.editSelected(); setShowSettings(false); })}>Edit vertices</button><button className="an-icon" aria-label="Delete analysis area" disabled={!idle || !selected} onClick={() => run(() => { editor.select(selected!.id!); editor.deleteSelected(); setActiveId(null); })}><Trash2 size={13} /></button></div>
        <p className="an-hint">Objects intersecting the area are included, including its boundary. Values are counted in full, without area weighting.</p>
      </section>
      <section><h3><span>03</span> Visualise & measure</h3><label className="an-field">Colour & group by<select aria-label="Category field" value={fields.category} onChange={event => { setFields({ ...fields, category: event.target.value }); setFilters({ ...filters, category: null }); }}><option value="">Single colour</option>{columns.fields.map(key => <option key={key}>{key}</option>)}</select></label>
        <label className="an-field">Numeric measure<select aria-label="Numeric measure" value={fields.metric} onChange={event => { setFields({ ...fields, metric: event.target.value }); setFilters({ ...filters, range: null }); }}><option value="">Count only</option>{columns.numeric.map(key => <option key={key}>{key}</option>)}</select></label>
        <label className="an-checkbox"><input type="checkbox" disabled={!fields.metric} checked={fields.size} onChange={event => setFields({ ...fields, size: event.target.checked })} />Size points by measure</label>
      </section>
      <div className="an-local"><span className="an-live-dot" />Files stay in your browser.<br /><small>Download your analysis to keep your work.</small></div>
    </aside>

    <div className="an-map-frame" ref={mapFrame}>
      <div className="an-map-tools"><span><MousePointer2 size={13} />{idle ? "Explore map" : "Area editor"}</span><button aria-label="Undo area edit" title="Undo area edit" disabled={!state.canUndo || busy} onClick={() => run(() => { editor.undo(); })}><Undo2 size={15} /></button><button aria-label="Redo area edit" title="Redo area edit" disabled={!state.canRedo || busy} onClick={() => run(() => { editor.redo(); })}><Redo2 size={15} /></button><button aria-label="Fit all data" title="Fit all data" onClick={() => runtime.fit(dataset)}><Focus size={15} /></button></div>
      <div className="an-map-caption"><span className="an-live-dot" /><strong>{selected ? areaName(selected, areas.indexOf(selected)) : "All data"}</strong><span>{format(rows.length, 0)} matching features</span></div>
      {state.mode !== "idle" && <div className="an-edit-prompt"><div><Pentagon size={17} /><span><strong>{state.mode.startsWith("draw") ? "Draw your analysis area" : "Adjust the area vertices"}</strong><small>Click to add points. Finish to update the analysis.</small></span></div><button className="an-button" onClick={() => editor.cancel()}>Cancel</button><button className="an-button an-primary" disabled={!state.canFinish} onClick={() => run(() => { const f = editor.finish(); if (f) { setActiveId(String(f.id)); notify("Area applied. Results updated."); } })}><Check size={14} />Apply area</button></div>}
    </div>

    <aside className="an-insights" aria-label="Analysis insights"><div className="an-panel-title"><h2><BarChart3 size={16} />Area insights</h2><span className="an-live-badge">LIVE</span><button className="an-mobile-close" aria-label="Close insights" onClick={() => setShowInsights(false)}><X size={16} /></button></div>
      <div className="an-insights-body"><div className="an-total"><span>Matching features</span><strong data-stat="count">{format(stats.count, 0)}</strong><p>{dataset.data.features.length ? format(stats.count / dataset.data.features.length * 100) : "0"}% of {format(dataset.data.features.length, 0)} total features</p><div className="an-share-track"><i style={{ width: `${dataset.data.features.length ? stats.count / dataset.data.features.length * 100 : 0}%` }} /></div></div>
        <div className="an-stat-grid"><div><span>Sum · {fields.metric || "no measure"}{isSample && fields.metric === "cost" ? " (EUR)" : ""}</span><strong data-stat="sum">{format(stats.sum)}</strong></div><div><span>Average{isSample && fields.metric === "cost" ? " (EUR)" : ""}</span><strong data-stat="average">{format(stats.average)}</strong></div><div><span>Area</span><strong>{selected ? `${format(areaKm2(selected), 2)} km²` : "All data"}</strong></div><div><span>Numeric values</span><strong>{format(stats.valid, 0)}<small> / {format(stats.count, 0)}</small></strong></div></div>
        {fields.metric && <p className="an-hint" data-stat="spread"><b>Median: {format(stats.median)}</b> · Middle 50%: {format(stats.q1)}–{format(stats.q3)}. Each feature has equal weight; no area or length weighting.</p>}
        {fields.metric && stats.missing > 0 && <p className="an-hint">{stats.missing} missing or non-numeric values excluded from sum and average.</p>}
        <section className="an-chart"><div className="an-chart-heading"><h3>{fields.category || "All features"}</h3><small>Click to filter</small></div><div className="an-category-list">{groups.slice(0, 50).map(group => <button className={`an-category${filters.category === group.key ? " an-category-active" : ""}`} key={group.key} aria-pressed={filters.category === group.key} aria-label={`Filter ${group.label}: ${group.count}`} onClick={() => setFilters({ ...filters, category: filters.category === group.key ? null : group.key })}><span className="an-category-label"><i style={{ background: group.color }} /><span title={group.label}>{group.label}</span><b>{format(group.count, 0)}</b></span><span className="an-bar-track"><i style={{ background: group.color, width: `${group.count / Math.max(1, ...groups.map(c => c.count)) * 100}%` }} /></span></button>)}</div>{groups.length > 50 && <p className="an-hint">Showing the 50 largest categories. Search attributes to explore other values.</p>}{!groups.length && <p className="an-hint">Import data to see categories.</p>}</section>
        <section className="an-chart"><div className="an-chart-heading"><h3>{fields.metric || "Distribution"}</h3><small>Click a range</small></div>{bins.length ? <><div className="an-histogram" role="group" aria-label="Numeric distribution">{bins.map((bin, i) => <button key={i} aria-label={`Range ${format(bin.min)} to ${format(bin.max)}${bin.exclusive ? " (upper bound excluded)" : ""}: ${bin.count} features`} aria-pressed={filters.range?.[0] === bin.min} title={`${format(bin.min)}–${bin.exclusive ? "<" : ""}${format(bin.max)}: ${bin.count} features`} onClick={() => setFilters({ ...filters, range: filters.range?.[0] === bin.min ? null : [bin.min, bin.max], rangeExclusive: bin.exclusive })}><span>{bin.count}</span><i style={{ height: `${Math.max(2, bin.count / Math.max(...bins.map(b => b.count), 1) * 76)}px` }} /></button>)}</div><div className="an-chart-axis"><span>{format(bins[0]!.min)}</span><span>{format(bins.at(-1)!.max)}</span></div></> : <p className="an-hint">{fields.metric ? "No numeric values match the current filters." : "Choose a numeric measure to see its distribution."}</p>}</section>
        {selectedFeature && <section className="an-feature-detail"><div className="an-chart-heading"><h3>Selected feature</h3><button className="an-icon" aria-label="Clear selected feature" onClick={() => setFocused(null)}><X size={14} /></button></div><strong>{valueLabel(selectedFeature.properties.name ?? selectedFeature.id ?? `Feature ${focused! + 1}`)}</strong><small>{selectedFeature.geometry.type}{focused !== null && !rows.includes(focused) ? " · Outside current filters" : ""}</small><dl>{Object.entries(selectedFeature.properties).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{valueLabel(value)}</dd></div>)}</dl>{(selectedFeature.geometry.type === "Polygon" || selectedFeature.geometry.type === "MultiPolygon") && <button className="an-button an-wide" disabled={!idle || areas.length >= 200} onClick={() => run(() => { runtime.addArea(selectedFeature as AnalysisArea); const next = runtime.areas().at(-1)!; editor.select(next.id!); setActiveId(String(next.id)); })}>Use polygon as analysis area</button>}</section>}
        <p className="an-footnote"><CircleHelp size={13} />Map, charts and table share the same filters. Faded objects provide context.</p>
      </div>
    </aside>

    <DataTable dataset={dataset} rows={rows} fields={columns.fields} focused={focused} focus={focusRow} filters={filters} setFilters={setFilters} activeFilters={activeFilters} />
    <footer className="an-status"><span><span className="an-live-dot" />{busy ? "Reading file…" : saveStatus}</span><span>{dataset.name === "Amsterdam · service requests" ? "Fictitious demo data · Amsterdam" : dataset.name}</span><span>{areas.length} areas · {format(rows.length, 0)} results</span></footer>
    <input ref={input} className="sr-only" type="file" tabIndex={-1} accept=".csv,.json,.geojson" aria-label="Import analysis data" onChange={event => { void read(event.target.files?.[0]); event.target.value = ""; }} />
    <input ref={areaInput} className="sr-only" type="file" tabIndex={-1} accept=".json,.geojson" aria-label="Import analysis areas" onChange={event => { void read(event.target.files?.[0], true); event.target.value = ""; }} />
    {showIntro && <AnalysisIntro close={closeIntro} trySample={trySampleArea} canTrySample={idle && !!sampleArea} isSample={isSample} />}
    {csv && <CsvDialog csv={csv.input} name={csv.name} close={() => setCsv(null)} apply={(next) => { run(() => changeDataset(next)); setCsv(null); }} />}
  </div>;
}

function DataTable({ dataset, rows, fields, focused, focus, filters, setFilters, activeFilters }: { dataset: Dataset; rows: number[]; fields: string[]; focused: number | null; focus: (index: number) => void; filters: Filters; setFilters: (filters: Filters) => void; activeFilters: boolean }) {
  const [offset, setOffset] = useState(0);
  const current = Math.min(offset, Math.max(0, Math.ceil(rows.length / 50) - 1));
  const selectedPosition = focused === null ? -1 : rows.indexOf(focused);
  const [previousFocus, setPreviousFocus] = useState(focused);
  // A map selection reveals the corresponding table page without resetting manual paging.
  if (previousFocus !== focused) { setPreviousFocus(focused); if (selectedPosition >= 0 && offset !== Math.floor(selectedPosition / 50)) setOffset(Math.floor(selectedPosition / 50)); }
  return <section className="an-table" aria-label="Matching data"><div className="an-table-heading"><h2><Table2 size={15} />Matching data <span>{format(rows.length, 0)}</span></h2><label className="an-search"><Search size={13} /><input aria-label="Search data" placeholder="Search attributes…" value={filters.query} onChange={event => { setFilters({ ...filters, query: event.target.value }); setOffset(0); }} /></label><button className="an-text-button" disabled={!activeFilters} onClick={() => { setFilters(emptyFilters); setOffset(0); }}><Filter size={13} />Reset filters</button></div>
    {(filters.category !== null || filters.range !== null) && <div className="an-filter-note">Chart filters active <button onClick={() => setFilters(emptyFilters)}>Clear all <X size={12} /></button></div>}
    <div className="an-table-scroll"><table><thead><tr><th scope="col">Feature</th><th scope="col">Geometry</th>{fields.map(key => <th scope="col" key={key}>{key}</th>)}</tr></thead><tbody>{rows.slice(current * 50, (current + 1) * 50).map(index => { const f = dataset.data.features[index]!; return <tr key={index} data-focused={focused === index ? "true" : undefined}><td><button aria-label={`Locate feature ${index + 1}`} onClick={() => focus(index)}>{String(f.id ?? index + 1)}<ArrowUpRight size={11} /></button></td><td><span className="an-geometry-type">{f.geometry.type}</span></td>{fields.map(key => <td key={key} title={valueLabel(f.properties[key])}>{valueLabel(f.properties[key])}</td>)}</tr>; })}</tbody></table>{!rows.length && <div className="an-empty"><Search size={22} /><strong>No matching features</strong><span>Try another area or clear your filters.</span></div>}</div>
    <div className="an-table-footer"><span>{rows.length ? `${current * 50 + 1}–${Math.min((current + 1) * 50, rows.length)} of ${format(rows.length, 0)}` : "0 results"}</span><span>Click a feature to locate it on the map</span><div><button aria-label="Previous data page" disabled={current === 0} onClick={() => setOffset(current - 1)}><ChevronLeft size={14} /></button><button aria-label="Next data page" disabled={(current + 1) * 50 >= rows.length} onClick={() => setOffset(current + 1)}><ChevronRight size={14} /></button></div></div>
  </section>;
}

function CsvDialog({ csv, name, close, apply }: { csv: CsvInput; name: string; close: () => void; apply: (dataset: Dataset) => void }) {
  const [longitude, setLongitude] = useState(csv.longitude), [latitude, setLatitude] = useState(csv.latitude), [error, setError] = useState("");
  return <Modal title="Map your CSV coordinates" close={close}><form onSubmit={event => { event.preventDefault(); try { apply(csvDataset(csv, longitude, latitude, name.replace(/\.csv$/iu, ""))); } catch (e) { setError(e instanceof Error ? e.message : "CSV could not be imported."); } }}><p>{name} · {csv.rows.length} rows. Use WGS84 decimal degrees.</p><p className="an-hint">Loading this file replaces your current data and analysis areas.</p>{(["longitude", "latitude"] as const).map(axis => <label className="an-field" key={axis}>{axis === "longitude" ? "Longitude (east / west)" : "Latitude (north / south)"}<select aria-label={`CSV ${axis}`} value={axis === "longitude" ? longitude : latitude} onChange={event => (axis === "longitude" ? setLongitude : setLatitude)(event.target.value)} required><option value="">Choose a column</option>{csv.headers.map(h => <option key={h}>{h}</option>)}</select></label>)}{error && <p className="an-form-error" role="alert">{error}</p>}<div className="an-dialog-actions"><button type="button" className="an-button" onClick={close}>Cancel</button><button className="an-button an-primary" type="submit"><FileJson2 size={14} />Load {csv.rows.length} rows</button></div></form></Modal>;
}
