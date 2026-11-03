import { Map as GLMap, NavigationControl, ScaleControl, setWorkerUrl } from "maplibre-gl";
import { EditorToolbar, GeometryEditor, type DataLayer, type EditorState, type FeatureId, type FeatureProperties, type FeatureStyle, type GeometryFeature } from "@jorisvdmije/map-master";
import type { QueryClient } from "@tanstack/react-query";
import { assetPath } from "@/lib/paths";
import { basemapQuery, fallbackStyle } from "@/features/examples/queries";
import { attachFeaturePreview } from "@/features/examples/feature-preview";
import { resolveFeaturePreview, type FeaturePreviewOptions } from "@jorisvdmije/map-master";
import type { LayerFeaturePreview } from "./project";
import { emptyProject, featureStyle, layerId, maxFeatures, newLayer, palette, parseProject, styleProperty, type Project, type Settings } from "./project";

export interface Snapshot { state: EditorState; project: Project; revision: number }
type Notice = (message: string, error?: boolean) => void;

export async function mountPlayground(container: HTMLElement, signal: AbortSignal, client: QueryClient, notice: Notice): Promise<PlaygroundRuntime | undefined> {
  if (signal.aborted) return;
  setWorkerUrl(assetPath("/maplibre-worker.mjs"));
  const initial = emptyProject();
  const map = new GLMap({ container, style: structuredClone(fallbackStyle), center: initial.camera.center, zoom: initial.camera.zoom,
    minZoom: -2, maxZoom: 22, dragRotate: false, pitchWithRotate: false, touchPitch: false, fadeDuration: 0,
    attributionControl: { compact: true }, maxPitch: 0, trackResize: false });
  map.touchZoomRotate.disableRotation();
  const remove = () => map.remove();
  signal.addEventListener("abort", remove, { once: true });
  await new Promise<void>(resolve => { map.once("load", () => resolve()); map.once("remove", () => resolve()); });
  if (signal.aborted) return;
  const runtime = new PlaygroundRuntime(map, client, notice);
  signal.removeEventListener("abort", remove);
  signal.addEventListener("abort", () => runtime.destroy(), { once: true });
  return runtime;
}

/** A single public-API boundary between the React workbench and the map/editor. */
export class PlaygroundRuntime {
  readonly editor: GeometryEditor;
  private listeners = new Set<() => void>();
  private snapshot!: Snapshot;
  private name = "Untitled project";
  private basemap: Settings["basemap"] = "streets";
  private toolbarColumns: Settings["toolbarColumns"] = 2;
  private revision = 0;
  private configFingerprint = "";
  private suspended = false;
  private disposed = false;
  private styleRequest = 0;
  private unsubscribe: () => void;
  private preview: ReturnType<typeof attachFeaturePreview>;
  private hoverPreviews: LayerFeaturePreview[] = [];

  constructor(readonly map: GLMap, private client: QueryClient, private notice: Notice) {
    const initial = emptyProject();
    this.applyToolbarColumns();
    this.editor = new GeometryEditor(map, {
      dataLayers: { layers: initial.layers }, snapping: { enabled: true },
      appearance: { feature: { lineWidth: 2 }, selected: { fillColor: "#e6a446", fillOpacity: 0.27, lineColor: "#ad6819", lineWidth: 3 },
        draft: { fillColor: "#23836d", lineColor: "#176a57" }, vertex: { strokeColor: "#176a57", activeColor: "#176a57" } },
      styling: { feature: featureStyle }, historyLimit: 100, maxFeatures,
    });
    map.addControl(new EditorToolbar(this.editor, { tools: EditorToolbar.allTools, collapsible: true }), "top-left");
    map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new ScaleControl({ maxWidth: 110 }), "bottom-left");
    this.unsubscribe = this.editor.onChange(() => this.refresh());
    this.preview = attachFeaturePreview(map, this.editor, feature => this.hoverPreviews.find(item => item.layerId === layerId(feature))?.options ?? {});
    map.on("moveend", this.moved);
    this.refresh(true);
    void this.applyBasemap();
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private camera(): Project["camera"] {
    const center = this.map.getCenter().wrap();
    return { center: [Number(center.lng.toFixed(8)), Number(Math.max(-85.05112878, Math.min(85.05112878, center.lat)).toFixed(8))], zoom: Number(this.map.getZoom().toFixed(5)) };
  }
  private settings(): Settings {
    return { basemap: this.basemap, snapping: this.editor.getSnapping().enabled, guides: this.editor.getAlignmentGuides().enabled,
      measurements: this.editor.getMeasurements().enabled, scaleBorders: this.editor.getAppearance().polygonOutline.scaleWithZoom, toolbarColumns: this.toolbarColumns };
  }
  private refresh(force = false) {
    if (this.suspended || this.disposed) return;
    const state = this.editor.getState();
    const settings = this.settings();
    const locks = this.editor.getLockedFeatureIds();
    const layers = this.editor.getDataLayers();
    const hoverPreviews = this.hoverPreviews.filter(item => layers.some(layer => layer.id === item.layerId));
    const fingerprint = JSON.stringify([this.name, settings, locks, hoverPreviews]);
    const changed = force || !this.snapshot || state.dataRevision !== this.snapshot.state.dataRevision || state.dataLayerRevision !== this.snapshot.state.dataLayerRevision || this.configFingerprint !== fingerprint;
    if (changed) this.revision++;
    const project: Project = changed ? {
      format: "map-master-playground", version: 1, name: this.name,
      data: !this.snapshot || state.dataRevision !== this.snapshot.state.dataRevision ? this.editor.exportGeoJSON() : this.snapshot.project.data,
      layers, activeLayerId: this.editor.getActiveDataLayer(), lockedFeatureIds: locks, camera: this.camera(), settings, hoverPreviews: structuredClone(hoverPreviews),
    } : this.snapshot.project;
    this.configFingerprint = fingerprint;
    this.snapshot = { state, project, revision: this.revision };
    this.listeners.forEach(listener => listener());
  }
  private moved = () => { if (JSON.stringify(this.camera()) !== JSON.stringify(this.snapshot.project.camera)) this.refresh(true); };
  capture(): Project { return structuredClone({ ...this.snapshot.project, camera: this.camera() }); }
  rename(name: string) { this.name = name.trim().slice(0, 150) || "Untitled project"; this.refresh(); }
  setHoverPreview(id: string, options: FeaturePreviewOptions | null) {
    this.assertIdle();
    if (!this.editor.getDataLayers().some(layer => layer.id === id)) throw new Error("This layer no longer exists.");
    const validated = options === null ? null : resolveFeaturePreview(options);
    this.hoverPreviews = this.hoverPreviews.filter(item => item.layerId !== id);
    if (validated !== null) this.hoverPreviews.push({ layerId: id, options: validated });
    this.preview.refresh(); this.refresh();
  }
  private batch<T>(action: () => T): T {
    this.suspended = true;
    try { return action(); } finally { this.suspended = false; this.refresh(); }
  }
  assertIdle() { if (this.editor.getState().mode !== "idle") throw new Error("Finish or cancel the current edit first."); }

  importGeoJSON(input: unknown, name: string): number {
    this.assertIdle();
    if (this.editor.getDataLayers().length >= 200) throw new Error("A playground project can contain at most 200 layers.");
    const count = typeof input === "object" && input !== null && "features" in input && Array.isArray(input.features) ? input.features.length : 1;
    if (this.editor.getState().featureCount + count > maxFeatures) throw new Error(`A playground project can contain at most ${maxFeatures.toLocaleString()} features.`);
    return this.batch(() => {
      const previous = this.editor.getActiveDataLayer();
      const id = crypto.randomUUID();
      this.editor.addDataLayer(newLayer(id, name.trim().slice(0, 150) || "Imported data", palette[this.editor.getDataLayers().length % palette.length]));
      try {
        const imported = this.editor.importGeoJSON(input, { dataLayerId: id });
        this.editor.setActiveDataLayer(id);
        this.editor.zoomToFeatures(imported.features.map(feature => feature.id), { padding: 75, duration: 0, maxZoom: 17 });
        return imported.features.length;
      } catch (error) {
        this.editor.removeDataLayer(id);
        this.editor.setActiveDataLayer(previous);
        throw error;
      }
    });
  }

  /** Temporarily stage writable layer definitions; the document replacement itself is one atomic transaction. */
  replaceProject(input: unknown) {
    this.assertIdle();
    const project = parseProject(input);
    const before = this.capture();
    const selection = this.editor.getState().selectedFeatureIds;
    this.batch(() => {
      const merged = new globalThis.Map([...before.layers, ...project.layers].map(layer => [layer.id, { ...layer, visible: true, editable: true, locked: false, selectable: true }]));
      this.editor.setDataLayers([...merged.values()]);
      this.editor.setLockedFeatureIds([]);
      const existing = new Set(before.data.features.map(feature => feature.id));
      const incoming = new Set(project.data.features.map(feature => feature.id));
      try {
        this.editor.applyTransaction({
          update: project.data.features.filter(feature => existing.has(feature.id)),
          create: project.data.features.filter(feature => !existing.has(feature.id)),
          delete: before.data.features.filter(feature => !incoming.has(feature.id)).map(feature => feature.id),
        });
      } catch (error) {
        this.editor.setDataLayers(before.layers);
        this.editor.setActiveDataLayer(before.activeLayerId);
        this.editor.setLockedFeatureIds(before.lockedFeatureIds);
        this.editor.selectMany(selection);
        throw error;
      }
      this.editor.setDataLayers(project.layers);
      this.editor.setActiveDataLayer(project.activeLayerId);
      this.editor.setLockedFeatureIds(project.lockedFeatureIds);
      this.editor.select(null);
      this.editor.clearHistory();
      this.name = project.name;
      this.hoverPreviews = structuredClone(project.hoverPreviews); this.preview.refresh();
      this.editor.setSnapping({ enabled: project.settings.snapping });
      this.editor.setAlignmentGuides({ enabled: project.settings.guides });
      this.editor.setMeasurements({ enabled: project.settings.measurements });
      this.editor.setAppearance({ polygonOutline: { scaleWithZoom: project.settings.scaleBorders } });
      this.toolbarColumns = project.settings.toolbarColumns;
      this.applyToolbarColumns();
      const changeStyle = this.basemap !== project.settings.basemap;
      this.basemap = project.settings.basemap;
      this.map.jumpTo({ center: project.camera.center, zoom: project.camera.zoom });
      if (changeStyle) void this.applyBasemap();
    });
    this.refresh(true);
  }

  addLayer() {
    this.assertIdle();
    if (this.editor.getDataLayers().length >= 200) throw new Error("A playground project can contain at most 200 layers.");
    this.batch(() => {
      const layers = this.editor.getDataLayers();
      const id = crypto.randomUUID();
      this.editor.addDataLayer(newLayer(id, `Layer ${layers.length + 1}`, palette[layers.length % palette.length]));
      this.editor.setActiveDataLayer(id);
    });
  }
  updateLayer(id: string, patch: Partial<Omit<DataLayer, "id">>) { this.assertIdle(); this.editor.updateDataLayer(id, patch); }
  reorderLayer(id: string, direction: 1 | -1) {
    this.assertIdle();
    const ids = this.editor.getDataLayers().map(layer => layer.id);
    const index = ids.indexOf(id); const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    this.editor.reorderDataLayers(ids);
  }
  setProperties(id: FeatureId, properties: FeatureProperties) {
    this.assertIdle();
    const feature = this.editor.getFeature(id);
    if (!feature) throw new Error("This feature no longer exists.");
    this.editor.applyTransaction({ update: [{ ...feature, properties } as GeometryFeature] });
  }
  setFeatureStyle(ids: FeatureId[], style: FeatureStyle | null) {
    this.assertIdle();
    const update = ids.map(id => {
      const feature = this.editor.getFeature(id);
      if (!feature) throw new Error("This feature no longer exists.");
      const properties = { ...feature.properties };
      if (style) properties[styleProperty] = style as NonNullable<FeatureProperties>[string]; else delete properties[styleProperty];
      return { ...feature, properties } as GeometryFeature;
    });
    this.editor.applyTransaction({ update });
  }
  toggleLocks(ids: FeatureId[]) {
    this.assertIdle();
    const locks = new Set(this.editor.getLockedFeatureIds());
    const unlock = ids.every(id => locks.has(id));
    ids.forEach(id => unlock ? locks.delete(id) : locks.add(id));
    this.editor.setLockedFeatureIds([...locks]);
  }
  canEdit(feature: GeometryFeature): boolean {
    const layer = this.snapshot.project.layers.find(item => item.id === layerId(feature));
    return this.snapshot.state.mode === "idle" && !!layer?.visible && layer.editable && !layer.locked && !this.editor.isFeatureLocked(feature.id);
  }
  setSetting(key: keyof Settings, value: Settings[keyof Settings]) {
    if (key === "toolbarColumns") {
      if (value !== 1 && value !== 2) throw new Error("Toolbar columns must be 1 or 2.");
      this.toolbarColumns = value; this.applyToolbarColumns(); this.refresh();
    }
    else if (key === "basemap") { this.basemap = value as Settings["basemap"]; this.refresh(); void this.applyBasemap(); }
    else if (key === "snapping") this.editor.setSnapping({ enabled: Boolean(value) });
    else if (key === "guides") this.editor.setAlignmentGuides({ enabled: Boolean(value) });
    else if (key === "measurements") this.editor.setMeasurements({ enabled: Boolean(value) });
    else this.editor.setAppearance({ polygonOutline: { scaleWithZoom: Boolean(value) } });
  }
  private applyToolbarColumns() { this.map.getContainer().parentElement!.dataset.toolbarColumns = String(this.toolbarColumns); }
  private async applyBasemap() {
    const request = ++this.styleRequest;
    if (this.basemap === "blank") { this.map.setStyle(structuredClone(fallbackStyle)); return; }
    try {
      const style = await this.client.fetchQuery(basemapQuery);
      if (!this.disposed && request === this.styleRequest) this.map.setStyle(structuredClone(style));
    } catch {
      if (!this.disposed && request === this.styleRequest) this.notice("The street map is unavailable. Your data is still editable on the plain map.");
    }
  }
  destroy() {
    if (this.disposed) return;
    this.disposed = true; this.styleRequest++;
    this.preview.destroy(); this.unsubscribe(); this.listeners.clear();
    this.map.off("moveend", this.moved);
    this.map.remove();
  }
}
