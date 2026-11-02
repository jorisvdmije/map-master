"use client";

import { useState } from "react";
import { themes } from "./appearance";
import { describe, featureName } from "./describe";
import { GeoJSONPanel } from "./geojson-panel";
import { ShortcutPanel } from "./shortcut-panel";
import type { ExampleControlsProps } from "./types";

export function ExampleControls({ runtime, snapshot, hint }: ExampleControlsProps) {
  const { editor, config } = runtime;
  const extras = new Set(config.extras ?? []);
  const idle = snapshot.state.mode === "idle";
  const [theme, setTheme] = useState("Blue & orange");
  const [feedback, setFeedback] = useState<{ revision: number; message: string } | null>(null);
  const message = feedback?.revision === snapshot.revision ? feedback.message : describe(editor, snapshot.state);
  const onMessage = (message: string) => setFeedback({ revision: runtime.getSnapshot().revision, message });

  function runTransaction() {
    const lawn = editor.getFeature("lawn");
    if (!lawn) return;
    editor.applyTransaction({ update: [{ ...lawn, properties: { ...lawn.properties, name: "Picnic lawn" } }], delete: ["kiosk"] });
  }

  return <>
    <figcaption className="demo-caption">
      <p className="demo-hint"><span className="demo-badge">Try it</span>{hint}</p>
      <div className="demo-footer"><p className="demo-status" role="status">{message}</p>
        <button type="button" className="demo-reset" onClick={runtime.reset}>Reset</button>
      </div>
    </figcaption>
    {extras.has("geojson") && <GeoJSONPanel runtime={runtime} snapshot={snapshot} onMessage={onMessage} />}
    {extras.has("appearance") && <div className="demo-panel"><span>Theme:</span>
      {Object.keys(themes).map(name => <button type="button" key={name} aria-pressed={theme === name} disabled={!idle}
        onClick={() => { editor.setAppearance(themes[name]); setTheme(name); }}>{name}</button>)}
      <label><input type="checkbox" checked={editor.getAppearance().polygonOutline.scaleWithZoom}
        onChange={event => editor.setAppearance({ polygonOutline: { scaleWithZoom: event.target.checked } })} /> Scale polygon borders with zoom</label>
    </div>}
    {extras.has("transaction") && <div className="demo-panel">
      <button type="button" className="button small" data-requires="lawn kiosk" onClick={runTransaction}
        disabled={!idle || !editor.getFeature("lawn") || !editor.getFeature("kiosk")}>Rename the lawn and remove the kiosk</button>
      <span>One transaction, one Undo step.</span>
    </div>}
    {extras.has("events") && <div className="demo-panel demo-events"><strong>onDataChange events</strong>
      <ol className="demo-log">{snapshot.events.map(event => <li key={event.dataRevision}>
        {event.source} · {event.changes.map(({ before, after }) => `${!before ? "+" : !after ? "−" : "~"} ${featureName(after ?? before)}`).join(", ")}
        <span>revision {event.dataRevision}</span>
      </li>)}</ol>
    </div>}
    {extras.has("shortcuts") && <ShortcutPanel runtime={runtime} />}
  </>;
}
