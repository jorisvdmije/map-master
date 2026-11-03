"use client";

import { useState } from "react";
import { featurePreview, type FeaturePreviewField, type FeaturePreviewOptions, type GeometryFeature } from "@jorisvdmije/map-master";
import { editableField } from "./project";

export function HoverSettings({ options, features, disabled, apply }: { options: FeaturePreviewOptions; features: GeometryFeature[]; disabled: boolean; apply: (options: FeaturePreviewOptions | null) => void }) {
  const [draft, setDraft] = useState<FeaturePreviewOptions>(options);
  const [newField, setNewField] = useState("");
  const fields = draft.fields ?? [];
  const keys = new Set<string>(["name", ...(draft.titleProperty === null ? [] : [draft.titleProperty ?? "name"]), ...fields.map(field => field.key)]);
  for (const feature of features) {
    for (const key of Object.keys(feature.properties ?? {})) if (keys.size < 200 && key.length <= 200 && editableField(key)) keys.add(key);
    if (keys.size >= 200) break;
  }
  const availableKeys = [...keys].filter(key => !fields.some(field => field.key === key));
  const canAddField = availableKeys.some(key => JSON.stringify(key) === newField) && fields.length < 40;
  const patch = (value: Partial<FeaturePreviewOptions>) => setDraft(current => ({ ...current, ...value }));
  const update = (index: number, value: Partial<FeaturePreviewField>) => patch({ fields: fields.map((field, i) => i === index ? { ...field, ...value } : field) });
  const move = (index: number, direction: number) => {
    const next = [...fields]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; patch({ fields: next });
  };
  const content = features[0] ? featurePreview(features[0], draft) : null;
  return <details className="pg-hover-settings"><summary>Hover card settings</summary>
    <p className="pg-muted">For this layer. Choose what appears without selecting a feature.</p>
    <form onSubmit={event => { event.preventDefault(); apply(draft); }}>
      <fieldset disabled={disabled}>
        <label className="pg-check"><input type="checkbox" checked={draft.enabled !== false} onChange={event => patch({ enabled: event.target.checked })} />Show hover card</label>
        <label className="pg-field">Title field<select aria-label="Hover title field" value={JSON.stringify(draft.titleProperty === undefined ? "name" : draft.titleProperty)} onChange={event => patch({ titleProperty: JSON.parse(event.target.value) })}>
          <option value="null">Feature ID</option>{[...keys].map(key => <option key={key} value={JSON.stringify(key)}>{key || "(empty property name)"}</option>)}
        </select></label>
        <label className="pg-check"><input type="checkbox" checked={draft.fields != null} onChange={event => patch({ fields: event.target.checked ? [...keys].filter(key => key !== (draft.titleProperty ?? "name")).slice(0, 3).map(key => ({ key })) : null })} />Choose custom fields</label>
        {draft.fields != null && <>
          <ol className="pg-hover-fields">{fields.map((field, index) => <li key={field.key}>
            <strong>{field.key || "(empty property name)"}</strong>
            <label className="pg-field">Label<input aria-label={`Hover label ${index + 1}`} value={field.label ?? ""} placeholder={field.key} maxLength={120} onChange={event => update(index, { label: event.target.value })} /></label>
            <label className="pg-field">Format<select aria-label={`Hover format ${index + 1}`} value={field.format ?? "auto"} onChange={event => update(index, { format: event.target.value as FeaturePreviewField["format"] })}>
              <option value="auto">As stored</option><option value="number">Number</option><option value="date">Date (UTC)</option><option value="json">JSON</option>
            </select></label>
            {field.format === "number" && <label className="pg-field">Decimal places<input aria-label={`Hover decimals ${index + 1}`} type="number" min={0} max={8} value={field.decimals ?? 2} onChange={event => { if (event.target.value !== "") update(index, { decimals: Math.max(0, Math.min(8, Math.round(Number(event.target.value)))) }); }} /></label>}
            <div className="pg-inline-actions"><button type="button" className="pg-button" aria-label={`Move hover field ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" className="pg-button" aria-label={`Move hover field ${index + 1} down`} disabled={index === fields.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" className="pg-button" aria-label={`Remove hover field ${index + 1}`} onClick={() => patch({ fields: fields.filter((_, i) => i !== index) })}>Remove</button></div>
          </li>)}</ol>
          <label className="pg-field">Add a property<select aria-label="Add hover property" value={canAddField ? newField : ""} onChange={event => setNewField(event.target.value)}><option value="">Choose a property…</option>{availableKeys.map(key => <option key={key} value={JSON.stringify(key)}>{key || "(empty property name)"}</option>)}</select></label>
          <button type="button" className="pg-button" disabled={!canAddField} onClick={() => { if (canAddField) patch({ fields: [...fields, { key: JSON.parse(newField) }] }); setNewField(""); }}>Add hover field</button>
        </>}
        <p className="pg-muted">Geometry rows only appear for matching shapes.</p>
        {([['area', 'Area'], ['perimeter', 'Perimeter'], ['length', 'Line length'], ['coordinates', 'Marker coordinates']] as const).map(([key, label]) => <label className="pg-check" key={key}><input type="checkbox" checked={draft.geometry?.[key] !== false} onChange={event => patch({ geometry: { ...draft.geometry, [key]: event.target.checked } })} />{label}</label>)}
        <label className="pg-field">Maximum rows<input aria-label="Hover maximum rows" type="number" min={2} max={10} value={draft.maxRows ?? 5} onChange={event => { if (event.target.value !== "") patch({ maxRows: Math.max(2, Math.min(10, Math.round(Number(event.target.value)))) }); }} /></label>
        <label className="pg-field">Units<select aria-label="Hover units" value={draft.units ?? "metric"} onChange={event => patch({ units: event.target.value as "metric" | "imperial" })}><option value="metric">Metric</option><option value="imperial">Imperial</option></select></label>
        <label className="pg-field">Number and date language<select aria-label="Hover locale" value={draft.locale ?? "en"} onChange={event => patch({ locale: event.target.value })}><option value="en">English</option><option value="nl">Nederlands</option>{draft.locale && !["en", "nl"].includes(draft.locale) && <option value={draft.locale}>{draft.locale}</option>}</select></label>
        <div className="pg-hover-example" aria-label="Hover card example">{content ? <><strong>{content.title}</strong><dl>{content.rows.map((row, i) => <div key={i}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>{content.omittedFields > 0 && <small>{content.omittedFields} more {content.omittedFields === 1 ? "property" : "properties"}</small>}</> : draft.enabled === false ? "Hover cards are hidden for this layer." : "Import or draw a feature to preview this layer."}</div>
        <button className="pg-button pg-wide" type="submit">Apply hover settings</button>
        <button className="pg-link-button pg-wide" type="button" onClick={() => { setDraft({}); apply(null); }}>Reset hover settings</button>
      </fieldset>
    </form>
  </details>;
}
