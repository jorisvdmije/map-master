"use client";

import { useState } from "react";
import type { KeyboardShortcuts } from "@jorisvdmije/map-master";
import type { DemoRuntime } from "./types";

const alternate: KeyboardShortcuts = {
  polygon: [{ key: "g" }], finish: [{ key: "Enter", modifiers: ["Control"] }],
  cancel: [{ key: "c" }], delete: [{ key: "x" }],
};
const actions = ["polygon", "line", "edit", "finish", "cancel", "delete", "undo", "redo"] as const;

export function ShortcutPanel({ runtime: { editor, map } }: { runtime: DemoRuntime }) {
  const [initialShortcuts] = useState(() => editor.getKeyboardShortcuts());
  const bindings = editor.getKeyboardShortcuts();
  const preset = !bindings.polygon.length ? "off" : bindings.polygon[0]?.key === "g" ? "alternative" : "standard";
  return <div className="demo-panel demo-shortcuts">
    <label>Shortcut preset <select value={preset} onChange={event =>
      editor.setKeyboardShortcuts(event.target.value === "off" ? false : { ...initialShortcuts, ...(event.target.value === "alternative" ? alternate : {}) })}>
      <option value="standard">Standard: P / Enter / Escape</option>
      <option value="alternative">Alternative: G / Ctrl+Enter / C</option>
      <option value="off">Shortcuts off</option>
    </select></label>
    <button type="button" className="button small" onClick={() => map.getCanvas().focus({ preventScroll: true })}>Focus map</button>
    <label>Try typing here <input type="text" placeholder="Shortcuts leave text fields alone" /></label>
    <p className="demo-shortcut-reference" role="status">{actions.map(action => `${action}: ${editor.getKeyboardShortcutLabel(action) || "off"}`).join(" · ")}</p>
  </div>;
}
