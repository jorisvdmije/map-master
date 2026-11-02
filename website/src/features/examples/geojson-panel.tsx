"use client";

import { useMemo, useState } from "react";
import { GeoJSONImportError } from "@jorisvdmije/map-master";
import type { DemoRuntime, DemoSnapshot } from "./types";

const initialInput = JSON.stringify({
  type: "FeatureCollection",
  features: [{ type: "Feature", id: "meeting-point", properties: { name: "Meeting point" }, geometry: { type: "Point", coordinates: [4.8692, 52.3586] } }],
}, null, 2);

export function GeoJSONPanel({ runtime, snapshot, onMessage }: {
  runtime: DemoRuntime; snapshot: DemoSnapshot; onMessage: (message: string) => void;
}) {
  const [input, setInput] = useState(initialInput);
  const { editor } = runtime;
  const { dataRevision, dataLayerRevision, mode } = snapshot.state;
  const output = useMemo(() => {
    // Export only when committed data or its layer configuration changes.
    void dataRevision; void dataLayerRevision;
    return JSON.stringify(editor.exportGeoJSON(), null, 2);
  }, [editor, dataRevision, dataLayerRevision]);

  function importData() {
    try {
      const added = editor.importGeoJSON(JSON.parse(input));
      onMessage(`Imported ${added.features.length} feature${added.features.length === 1 ? "" : "s"}; existing features are kept.`);
    } catch (error) {
      onMessage(error instanceof GeoJSONImportError
        ? `Import rejected (${error.code}${error.path ? ` at ${error.path}` : ""}). Nothing changed.`
        : error instanceof SyntaxError ? "That is not valid JSON. Nothing changed." : String(error));
    }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([output], { type: "application/geo+json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "map-master.geojson";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className="demo-panel demo-data">
    <textarea className="geojson-input" rows={6} spellCheck={false} aria-label="GeoJSON to import"
      value={input} onChange={event => setInput(event.target.value)} />
    <div className="demo-data-actions">
      <button type="button" className="button small" onClick={importData} disabled={mode !== "idle"}>Import GeoJSON</button>
      <button type="button" onClick={download} disabled={mode !== "idle"}>Download GeoJSON ↓</button>
    </div>
    <details><summary>Current GeoJSON</summary><pre className="geojson-output">{output}</pre></details>
  </div>;
}
