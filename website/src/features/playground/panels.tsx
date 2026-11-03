"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, Layers, LockKeyhole, LockKeyholeOpen, Plus, Search, SlidersHorizontal, Table2, Trash2, X } from "lucide-react";
import type { DataLayer, FeatureId, FeatureStyle, JsonValue } from "@jorisvdmije/map-master";
import { displayValue, editableField, featureKey, featureName, featureStyle, layerId } from "./project";
import type { PlaygroundRuntime, Snapshot } from "./runtime";
import { HoverSettings } from "./hover-settings";

export type Run = (action: () => void, message?: string) => void;
export type EditField = { id: FeatureId; key: string | null };

export function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} className="pg-dialog" aria-labelledby="pg-dialog-title" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="pg-dialog-heading"><h2 id="pg-dialog-title">{title}</h2><button className="pg-icon-button" type="button" onClick={close} aria-label="Close dialog"><X size={18} /></button></div>
    {children}
  </dialog>;
}

export function PropertyDialog({ runtime, field, close, notify }: { runtime: PlaygroundRuntime; field: EditField; close: () => void; notify: (message: string) => void }) {
  const feature = runtime.editor.getFeature(field.id);
  const value = field.key === null ? "" : feature?.properties?.[field.key];
  const [type, setType] = useState(value === null ? "null" : typeof value === "object" ? "json" : typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string");
  const [draft, setDraft] = useState(() => value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2));
  const [error, setError] = useState("");
  if (!feature) return null;
  const submit = (form: HTMLFormElement, remove = false) => {
    try {
      const data = new FormData(form);
      const key = field.key ?? String(data.get("key") ?? "").trim();
      if ((field.key === null && !key) || !editableField(key)) throw new Error("Choose a field name that is not reserved for layer or style settings.");
      const current = runtime.editor.getFeature(field.id);
      if (!current) throw new Error("This feature no longer exists.");
      if (field.key === null && Object.hasOwn(current.properties ?? {}, key)) throw new Error("This field already exists.");
      const properties = { ...current.properties };
      if (remove) delete properties[key];
      else {
        const raw = draft;
        let parsed: JsonValue = raw;
        if (type === "number") { if (!raw.trim() || !Number.isFinite(Number(raw))) throw new Error("Enter a finite number."); parsed = Number(raw); }
        if (type === "boolean") { if (!["true", "false"].includes(raw)) throw new Error("Use true or false for a boolean."); parsed = raw === "true"; }
        if (type === "null") parsed = null;
        if (type === "json") parsed = JSON.parse(raw) as JsonValue;
        Object.defineProperty(properties, key, { value: parsed, writable: true, enumerable: true, configurable: true });
      }
      runtime.setProperties(field.id, properties);
      close(); notify(remove ? "Field removed. Undo is available." : "Attribute saved. Undo is available.");
    } catch (error) { setError(error instanceof Error ? error.message : "The attribute could not be saved."); }
  };
  return <Dialog title={field.key === null ? "Add an attribute" : `Edit ${field.key}`} close={close}>
    <p className="pg-muted">{featureName(feature)} · {feature.geometry.type}</p>
    <form onSubmit={event => { event.preventDefault(); submit(event.currentTarget); }}>
      <label className="pg-field">Field name<input aria-label="Field name" name="key" defaultValue={field.key ?? ""} readOnly={field.key !== null} required={field.key === null} autoFocus maxLength={200} /></label>
      <label className="pg-field">Value type<select aria-label="Value type" value={type} onChange={event => { setType(event.target.value); setError(""); }}>
        <option value="string">Text</option><option value="number">Number</option><option value="boolean">Boolean</option><option value="null">Null</option><option value="json">JSON object or array</option>
      </select></label>
      <label className="pg-field">Value{type === "boolean" ? <select aria-label="Value" name="value" value={["true", "false"].includes(draft) ? draft : ""} onChange={event => { setDraft(event.target.value); setError(""); }}><option value="" disabled>Choose true or false…</option><option value="true">true</option><option value="false">false</option></select>
        : <textarea aria-label="Value" name="value" rows={type === "json" ? 6 : 3} disabled={type === "null"} value={type === "null" ? "null" : draft} onChange={event => { setDraft(event.target.value); setError(""); }} spellCheck={type === "string"} />}</label>
      {error && <p className="pg-form-error" role="alert">{error}</p>}
      <div className="pg-dialog-actions">{field.key !== null && <button type="button" className="pg-button pg-danger" onClick={event => submit(event.currentTarget.form!, true)}><Trash2 size={15} />Delete field</button>}
        <button type="button" className="pg-button" onClick={close}>Cancel</button><button className="pg-button pg-primary" type="submit">Save attribute</button></div>
    </form>
  </Dialog>;
}

export function LayersPanel({ snapshot, runtime, focused, focus, run, close }: { snapshot: Snapshot; runtime: PlaygroundRuntime; focused: string; focus: (id: string) => void; run: Run; close: () => void }) {
  const { project, state } = snapshot;
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    project.data.features.forEach(feature => result.set(layerId(feature), (result.get(layerId(feature)) ?? 0) + 1));
    return result;
  }, [project.data]);
  return <aside className="pg-layers pg-panel" aria-label="Data layers">
    <div className="pg-panel-heading"><h2><Layers size={16} />Layers<span className="pg-count">{project.layers.length}</span></h2><div>
      <button className="pg-icon-button" disabled={state.mode !== "idle"} onClick={() => run(() => { runtime.addLayer(); focus(runtime.editor.getActiveDataLayer()!); })} aria-label="Add layer"><Plus size={17} /></button>
      <button className="pg-icon-button pg-drawer-close" onClick={close} aria-label="Close layers"><X size={17} /></button></div></div>
    <div className="pg-layer-list">{[...project.layers].reverse().map(layer => <div key={layer.id} className={`pg-layer${layer.id === focused ? " pg-layer-focused" : ""}${!layer.visible ? " pg-layer-hidden" : ""}`} data-layer-id={layer.id}>
      <button className="pg-icon-button" disabled={state.mode !== "idle"} aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`} onClick={() => run(() => runtime.updateLayer(layer.id, { visible: !layer.visible }))}>{layer.visible ? <Eye size={16} /> : <EyeOff size={16} />}</button>
      <button className="pg-layer-name" onClick={() => focus(layer.id)} aria-pressed={layer.id === focused}>
        <span className="pg-layer-swatch" style={{ background: layer.style.shape?.fillColor ?? layer.style.marker?.color ?? "#23836d" }} />
        <span><strong>{layer.name}</strong><small>{counts.get(layer.id) ?? 0} features{layer.id === project.activeLayerId && <span className="pg-editing-badge">Editing</span>}</small></span>
      </button>
      <button className="pg-icon-button" disabled={state.mode !== "idle"} aria-label={`${layer.locked ? "Unlock" : "Lock"} ${layer.name}`} onClick={() => run(() => runtime.updateLayer(layer.id, { locked: !layer.locked }))}>{layer.locked ? <LockKeyhole size={14} /> : <LockKeyholeOpen size={14} />}</button>
    </div>)}</div>
    <div className="pg-layer-help"><span className="pg-kicker">YOUR WORKSPACE</span><p>Each imported file gets its own layer. Select a layer to draw into it.</p><p>Files stay in your browser.</p></div>
    <div className="pg-layer-footer"><span className="pg-status-dot" />{project.data.features.length.toLocaleString()} features in this project</div>
  </aside>;
}

export function StyleEditor({ style, apply, disabled, reset }: { style: FeatureStyle; apply: (style: FeatureStyle) => void; disabled: boolean; reset?: () => void }) {
  return <form className="pg-style-form" onSubmit={event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const fillColor = String(data.get("fill")); const lineColor = String(data.get("stroke"));
    apply({ shape: { ...style.shape, fillColor, lineColor, fillOpacity: Number(data.get("opacity")), lineWidth: Number(data.get("width")) },
      marker: { ...style.marker, shape: data.get("markerShape") as "circle" | "pin", color: fillColor, radius: Number(data.get("radius")), strokeColor: lineColor } });
  }}>
    <label className="pg-field">Marker shape<select aria-label="Marker shape" name="markerShape" defaultValue={style.marker?.shape ?? "circle"} disabled={disabled}><option value="circle">Circle</option><option value="pin">Map pin</option></select></label>
    <div className="pg-color-row"><label>Fill &amp; marker<input aria-label="Fill color" name="fill" type="color" defaultValue={style.shape?.fillColor ?? style.marker?.color ?? "#23836d"} disabled={disabled} /></label>
      <label>Outline<input aria-label="Outline color" name="stroke" type="color" defaultValue={style.shape?.lineColor ?? "#23836d"} disabled={disabled} /></label></div>
    <div className="pg-number-row"><label className="pg-field">Opacity<input aria-label="Fill opacity" name="opacity" type="number" min="0" max="1" step="any" defaultValue={style.shape?.fillOpacity ?? 0.22} disabled={disabled} required /></label>
      <label className="pg-field">Line width<input aria-label="Line width" name="width" type="number" min="0" max="32" step="any" defaultValue={style.shape?.lineWidth ?? 2} disabled={disabled} required /></label>
      <label className="pg-field">Point size<input aria-label="Marker radius" name="radius" type="number" min="0" max="32" step="any" defaultValue={style.marker?.radius ?? 7} disabled={disabled} required /></label></div>
    <button className="pg-button pg-wide" type="submit" disabled={disabled}>Apply style</button>
    {reset && <button type="button" className="pg-link-button" disabled={disabled} onClick={reset}>Use layer style</button>}
  </form>;
}

export function Inspector({ snapshot, runtime, layer, run, edit, close }: { snapshot: Snapshot; runtime: PlaygroundRuntime; layer: DataLayer; run: Run; edit: (field: EditField) => void; close: () => void }) {
  const selected = new Set(snapshot.state.selectedFeatureIds);
  const features = snapshot.project.data.features.filter(feature => selected.has(feature.id));
  const feature = features.length === 1 ? features[0] : undefined;
  const featureLayer = feature ? snapshot.project.layers.find(item => item.id === layerId(feature)) ?? layer : layer;
  const idle = snapshot.state.mode === "idle";
  const editable = !!feature && runtime.canEdit(feature);
  const style = feature ? { ...featureLayer.style, ...featureStyle(feature), shape: { ...featureLayer.style.shape, ...featureStyle(feature)?.shape }, marker: { ...featureLayer.style.marker, ...featureStyle(feature)?.marker } } : layer.style;
  const count = snapshot.project.data.features.filter(feature => layerId(feature) === layer.id).length;
  return <aside className="pg-inspector pg-panel" aria-label="Properties">
    <div className="pg-panel-heading"><h2><SlidersHorizontal size={16} />Properties</h2><button className="pg-icon-button pg-properties-close" onClick={close} aria-label="Close properties"><X size={17} /></button></div>
    <div className="pg-inspector-scroll">
      {features.length > 0 ? <>
        <section className="pg-inspector-section"><span className="pg-kicker">SELECTION</span><h3>{feature ? featureName(feature) : `${features.length} selected features`}</h3>
          <p className="pg-muted">{feature ? `${feature.geometry.type} · ${featureLayer.name}` : "Edit and move these features together."}</p>
          <div className="pg-inline-actions"><button className="pg-button" disabled={!idle} onClick={() => run(() => runtime.editor.zoomToFeatures([...selected], { padding: 70, duration: 200 }))}>Zoom to</button>
            <button className="pg-button" disabled={!idle} onClick={() => run(() => runtime.toggleLocks([...selected]))}>{features.every(feature => snapshot.project.lockedFeatureIds.includes(feature.id)) ? <LockKeyholeOpen size={14} /> : <LockKeyhole size={14} />}Lock / unlock</button></div>
          <label className="pg-field">Move selection to layer<select aria-label="Move selection to layer" value="" disabled={!idle} onChange={event => run(() => { runtime.editor.moveFeaturesToDataLayer([...selected], event.target.value); }, "Selection moved. Undo is available.")}>
            <option value="" disabled>Choose a layer…</option>{snapshot.project.layers.filter(layer => layer.visible && layer.editable && !layer.locked).map(layer => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></label>
          <button className="pg-link-button" onClick={() => run(() => runtime.editor.select(null))}>Clear selection</button>
        </section>
        {feature && <section className="pg-inspector-section"><div className="pg-section-title"><h3>Attributes</h3><button className="pg-icon-button" disabled={!editable} aria-label="Add attribute" onClick={() => edit({ id: feature.id, key: null })}><Plus size={16} /></button></div>
          {!editable && <p className="pg-muted">Finish the current edit or unlock this feature and its layer to change attributes.</p>}
          <dl className="pg-attribute-list"><div><dt>Feature ID</dt><dd>{String(feature.id)}<small>{typeof feature.id}</small></dd></div>
            {Object.entries(feature.properties ?? {}).filter(([key]) => editableField(key)).map(([key, value]) => <div key={key}><dt>{key}</dt><dd><button disabled={!editable} title={displayValue(value)} onClick={() => edit({ id: feature.id, key })}>{displayValue(value)}</button></dd></div>)}
          </dl>
          <button className="pg-button pg-wide" disabled={!editable} onClick={() => run(() => { if (!runtime.editor.editSelected()) throw new Error("This geometry cannot be edited in the current state."); })}>Edit geometry on map</button>
        </section>}
      </> : <section className="pg-inspector-section"><span className="pg-kicker">LAYER SETTINGS</span><h3>{layer.name}</h3><p className="pg-muted">{count} features · {layer.id === snapshot.project.activeLayerId ? "Active drawing layer" : "Select a feature to edit its attributes"}</p>
        <form key={`${layer.id}:${layer.name}`} onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); run(() => runtime.updateLayer(layer.id, { name: String(data.get("name")).trim() }), "Layer renamed."); }}>
          <label className="pg-field">Layer name<input name="name" aria-label="Layer name" defaultValue={layer.name} maxLength={150} required disabled={!idle} /></label><button className="pg-button pg-wide" type="submit" disabled={!idle}>Rename layer</button></form>
        <div className="pg-layer-order"><span>Drawing order</span><button className="pg-icon-button" disabled={!idle || snapshot.project.layers.at(-1)?.id === layer.id} onClick={() => run(() => runtime.reorderLayer(layer.id, 1))} aria-label="Move layer up"><ChevronUp size={16} /></button><button className="pg-icon-button" disabled={!idle || snapshot.project.layers[0]?.id === layer.id} onClick={() => run(() => runtime.reorderLayer(layer.id, -1))} aria-label="Move layer down"><ChevronDown size={16} /></button></div>
        <label className="pg-check"><input type="checkbox" checked={layer.snapping} disabled={!idle} onChange={event => run(() => runtime.updateLayer(layer.id, { snapping: event.target.checked }))} />Snap to this layer</label>
        <label className="pg-check"><input type="checkbox" checked={layer.editable} disabled={!idle} onChange={event => run(() => runtime.updateLayer(layer.id, { editable: event.target.checked }))} />Allow editing</label>
        <button className="pg-button pg-wide pg-danger" disabled={!idle || layer.id === "default" || count > 0} onClick={() => run(() => runtime.editor.removeDataLayer(layer.id))}><Trash2 size={14} />Remove empty layer</button>
        {count > 0 && <p className="pg-muted">Move or delete its features before removing a layer.</p>}
      </section>}
      {(features.length === 0 || feature) && <section className="pg-inspector-section"><h3>{feature ? "Feature style" : "Layer style"}</h3><p className="pg-muted">{feature ? "Override the layer appearance for this feature." : "Base appearance for features in this layer."}</p>
        <StyleEditor key={`${feature ? featureKey(feature.id) : layer.id}:${JSON.stringify(style)}`} style={style} disabled={feature ? !editable : !idle}
          apply={style => run(() => feature ? runtime.setFeatureStyle([feature.id], style) : runtime.updateLayer(layer.id, { style }), "Style updated.")}
          reset={feature && featureStyle(feature) ? () => run(() => runtime.setFeatureStyle([feature.id], null), "Layer style restored.") : undefined} />
      </section>}
      <section className="pg-inspector-section"><h3>Hover · {feature ? featureLayer.name : layer.name}</h3>
        <HoverSettings key={`${feature ? featureLayer.id : layer.id}:${JSON.stringify(snapshot.project.hoverPreviews)}`} options={snapshot.project.hoverPreviews.find(item => item.layerId === (feature ? featureLayer.id : layer.id))?.options ?? {}}
          features={snapshot.project.data.features.filter(item => layerId(item) === (feature ? featureLayer.id : layer.id))} disabled={!idle}
          apply={options => run(() => runtime.setHoverPreview(feature ? featureLayer.id : layer.id, options), "Hover settings saved for this layer.")} />
      </section>
      <section className="pg-inspector-section pg-tip"><span className="pg-kicker">A LITTLE SHORTCUT</span><p>Shift-click adds to a selection. Select a shape and choose Edit vertices. Press Escape to cancel an edit.</p></section>
    </div>
  </aside>;
}

export function AttributeTable({ snapshot, runtime, focused, run, edit }: { snapshot: Snapshot; runtime: PlaygroundRuntime; focused: string; run: Run; edit: (field: EditField) => void }) {
  const [scope, setScope] = useState("layer");
  const [query, setQuery] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const [page, setPage] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [sort, setSort] = useState<{ key: string; ascending: boolean } | null>(null);
  const selected = useMemo(() => new Set(snapshot.state.selectedFeatureIds), [snapshot.state.selectedFeatureIds]);
  const filtered = useMemo(() => snapshot.project.data.features.filter(feature =>
    (scope === "all" || scope === "selection" && selected.has(feature.id) || scope === "layer" && layerId(feature) === focused) && (!onlySelected || selected.has(feature.id))
    && (!query || `${feature.id} ${feature.geometry.type} ${JSON.stringify(feature.properties)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))), [snapshot.project.data, scope, focused, onlySelected, selected, query]);
  const fields = useMemo(() => [...new Set(filtered.flatMap(feature => Object.keys(feature.properties ?? {}).filter(editableField)))].sort((a, b) => a === "name" ? -1 : b === "name" ? 1 : a.localeCompare(b)), [filtered]);
  const sorted = useMemo(() => sort ? [...filtered].sort((a, b) => {
    const av = a.properties?.[sort.key]; const bv = b.properties?.[sort.key];
    const compare = typeof av === "number" && typeof bv === "number" ? av - bv : displayValue(av).localeCompare(displayValue(bv), undefined, { numeric: true });
    return sort.ascending ? compare : -compare;
  }) : filtered, [filtered, sort]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(sorted.length / 100) - 1));
  const visible = sorted.slice(currentPage * 100, (currentPage + 1) * 100);
  const selectable = filtered.filter(feature => runtime.editor.canSelectFeature(feature.id));
  const allSelected = selectable.length > 0 && selectable.every(feature => selected.has(feature.id));
  return <section className={`pg-table-panel${collapsed ? " pg-table-collapsed" : ""}`} aria-label="Attribute table">
    <div className="pg-table-heading"><h2><Table2 size={16} />Attributes<span className="pg-count">{filtered.length.toLocaleString()}</span></h2>
      <div className="pg-table-controls"><select aria-label="Table scope" value={scope} onChange={event => { setScope(event.target.value); setPage(0); }}><option value="layer">Current layer</option><option value="all">All layers</option><option value="selection">Selected only</option></select>
        <button className={`pg-table-filter${onlySelected ? " pg-is-on" : ""}`} aria-pressed={onlySelected} onClick={() => { setOnlySelected(!onlySelected); setPage(0); }}>Selected ({selected.size})</button>
        <label className="pg-table-search"><Search size={14} /><input aria-label="Search attributes" placeholder="Filter attributes…" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
        <button className="pg-icon-button" aria-label={collapsed ? "Expand attributes" : "Collapse attributes"} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button></div>
    </div>
    {!collapsed && <><div className="pg-table-scroll"><table><thead><tr><th className="pg-select-column"><input type="checkbox" aria-label="Select filtered features" checked={allSelected} disabled={snapshot.state.mode !== "idle" || !selectable.length} onChange={() => run(() => {
      const eligible = new Set(selectable.map(feature => feature.id));
      runtime.editor.selectMany(allSelected ? [...selected].filter(id => !eligible.has(id)) : [...new Set([...selected, ...eligible])]);
    })} /></th><th>Feature ID</th><th>Geometry</th>{fields.slice(0, 40).map(key => <th key={key} aria-sort={sort?.key === key ? sort.ascending ? "ascending" : "descending" : "none"}><button onClick={() => setSort({ key, ascending: sort?.key === key ? !sort.ascending : true })}>{key}{sort?.key === key && (sort.ascending ? " ↑" : " ↓")}</button></th>)}</tr></thead>
      <tbody>{visible.map(feature => <tr key={featureKey(feature.id)} data-feature-key={featureKey(feature.id)} aria-selected={selected.has(feature.id)} onDoubleClick={() => run(() => runtime.editor.zoomToFeatures([feature.id], { padding: 80, maxZoom: 18, duration: 200 }))}>
        <td><input type="checkbox" aria-label={`Select ${featureName(feature)}`} checked={selected.has(feature.id)} disabled={snapshot.state.mode !== "idle" || !runtime.editor.canSelectFeature(feature.id)} onChange={() => run(() => runtime.editor.selectMany(selected.has(feature.id) ? [...selected].filter(id => id !== feature.id) : [...selected, feature.id]))} /></td>
        <td><button className="pg-feature-link" disabled={snapshot.state.mode !== "idle" || !runtime.editor.canSelectFeature(feature.id)} onClick={() => run(() => runtime.editor.select(feature.id))}>{String(feature.id)}</button></td>
        <td><span className={`pg-geometry pg-geometry-${feature.geometry.type.toLowerCase()}`}>{feature.geometry.type}</span></td>
        {fields.slice(0, 40).map(key => <td key={key}><button className="pg-cell" title={`${key}: ${displayValue(feature.properties?.[key])}`} disabled={!runtime.canEdit(feature)} onClick={() => edit({ id: feature.id, key })}>{displayValue(feature.properties?.[key])}</button></td>)}
      </tr>)}</tbody></table>{!visible.length && <div className="pg-table-empty">{snapshot.project.data.features.length ? "No features match this view." : "Import data or draw a feature to see its attributes here."}</div>}</div>
      <div className="pg-table-footer"><span>{visible.length ? `${currentPage * 100 + 1}–${currentPage * 100 + visible.length}` : "0"} of {filtered.length.toLocaleString()} features{fields.length > 40 ? " · first 40 fields shown; all fields are in Properties" : ""}</span>
        <span>Click a value to edit <span className="pg-table-paging"><button className="pg-icon-button" disabled={currentPage === 0} aria-label="Previous rows" onClick={() => setPage(currentPage - 1)}>‹</button><button className="pg-icon-button" disabled={(currentPage + 1) * 100 >= sorted.length} aria-label="Next rows" onClick={() => setPage(currentPage + 1)}>›</button></span></span></div>
    </>}
  </section>;
}
