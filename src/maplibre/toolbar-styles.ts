/**
 * Toolbar styles, scoped to `.mm-toolbar`. Applications theme the toolbar through the
 * `--mm-toolbar-*` custom properties or override these classes.
 */
export const toolbarStyles = `
.mm-toolbar {
  --mm-toolbar-accent: #2563eb;
  --mm-toolbar-accent-text: #fff;
  --mm-toolbar-background: #fff;
  --mm-toolbar-color: #1f2937;
  --mm-toolbar-muted: #6b7280;
  --mm-toolbar-border: #e5e7eb;
  --mm-toolbar-hover: #f1f5f9;
  --mm-toolbar-pressed: #dbeafe;
  --mm-toolbar-danger: #dc2626;
  --mm-toolbar-shadow: 0 0 0 2px rgba(0, 0, 0, .1);
  --mm-toolbar-radius: 6px;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font: 500 12px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--mm-toolbar-color);
}
/* Several parts reset all properties; keep the hidden attribute effective. */
.mm-toolbar .mm-toolbar-letter { font-size: 14px; font-weight: 700; line-height: 1; }
.mm-toolbar [hidden] { display: none !important; }
.mm-toolbar .mm-toolbar-tools {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 44px;
  box-sizing: border-box;
  padding: 2px;
  overflow: hidden auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.mm-toolbar .mm-toolbar-group { flex-shrink: 0; width: 32px; }
.mm-toolbar .mm-toolbar-group {
  display: flex;
  flex-direction: column;
  background: var(--mm-toolbar-background);
  border-radius: var(--mm-toolbar-radius);
  box-shadow: var(--mm-toolbar-shadow);
}
.mm-toolbar .mm-toolbar-button {
  all: unset;
  box-sizing: border-box;
  position: relative;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  color: var(--mm-toolbar-color);
  cursor: pointer;
}
.mm-toolbar .mm-toolbar-button + .mm-toolbar-button { border-top: 1px solid var(--mm-toolbar-border); }
.mm-toolbar .mm-toolbar-button:first-child { border-top-left-radius: var(--mm-toolbar-radius); border-top-right-radius: var(--mm-toolbar-radius); }
.mm-toolbar .mm-toolbar-button:last-child { border-bottom-left-radius: var(--mm-toolbar-radius); border-bottom-right-radius: var(--mm-toolbar-radius); }
.mm-toolbar .mm-toolbar-button svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.mm-toolbar .mm-toolbar-button:hover:not(:disabled) { background: var(--mm-toolbar-hover); }
.mm-toolbar .mm-toolbar-button[aria-pressed="true"] { background: var(--mm-toolbar-pressed); color: var(--mm-toolbar-accent); }
.mm-toolbar .mm-toolbar-button:disabled { cursor: default; opacity: .35; }
.mm-toolbar .mm-toolbar-button:focus-visible,
.mm-toolbar .mm-toolbar-action:focus-visible,
.mm-toolbar .mm-toolbar-field input:focus-visible,
.mm-toolbar .mm-toolbar-field select:focus-visible {
  outline: 2px solid var(--mm-toolbar-accent);
  outline-offset: -2px;
}
.mm-toolbar .mm-toolbar-tooltip {
  position: absolute;
  z-index: 3;
  width: max-content;
  box-sizing: border-box;
  padding: 5px 8px;
  border-radius: 4px;
  background: #111827;
  color: #fff;
  white-space: normal;
  overflow-wrap: anywhere;
  overflow: hidden;
  pointer-events: none;
}
.mm-toolbar .mm-toolbar-actions {
  position: absolute;
  left: calc(100% + 8px);
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  width: max-content;
  min-width: 0;
  align-items: center;
  gap: 2px;
  min-height: 32px;
  box-sizing: border-box;
  padding: 3px;
  border-radius: var(--mm-toolbar-radius);
  background: var(--mm-toolbar-background);
  box-shadow: var(--mm-toolbar-shadow), 0 6px 16px rgba(0, 0, 0, .12);
  white-space: nowrap;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.mm-toolbar.mm-toolbar--end .mm-toolbar-actions { left: auto; right: calc(100% + 8px); flex-direction: row-reverse; }
.mm-toolbar .mm-toolbar-actions[data-mode="remove-hole"],
.mm-toolbar .mm-toolbar-actions[data-mode="draw-template"],
.mm-toolbar .mm-toolbar-actions[data-mode="select-lasso"],
.mm-toolbar .mm-toolbar-actions[data-text="true"] { flex-wrap: wrap; }
.mm-toolbar .mm-toolbar-actions[data-mode="draw-template"] { width: 340px; }
.mm-toolbar .mm-toolbar-actions[data-mode="difference-polygons"] { width: 300px; }
.mm-toolbar .mm-toolbar-difference { flex: 0 0 100%; padding: 6px; box-sizing: border-box; white-space: normal; overflow-wrap: anywhere; font-size: 12px; line-height: 1.5; color: var(--mm-toolbar-color); }
.mm-toolbar .mm-toolbar-template { display: flex; flex-wrap: wrap; flex: 0 0 100%; width: 100%; box-sizing: border-box; gap: 6px; padding: 4px; }
.mm-toolbar .mm-toolbar-template .mm-toolbar-field { white-space: normal; }
.mm-toolbar .mm-toolbar-template-notice { font-size: 11px; color: var(--mm-toolbar-danger); padding: 4px; }
.mm-toolbar .mm-toolbar-template .mm-toolbar-field input { width: 94px; }
.mm-toolbar .mm-toolbar-text { display: flex; flex-wrap: wrap; gap: 6px; max-width: 340px; padding: 3px; white-space: normal; }
.mm-toolbar .mm-toolbar-text > label:first-child { width: 100%; }
.mm-toolbar .mm-toolbar-text textarea { width: 210px; min-width: 0; max-width: 100%; box-sizing: border-box; flex: 1; font: inherit; resize: vertical; min-height: 48px; max-height: 160px; }
.mm-toolbar .mm-toolbar-text select { width: 86px; }
.mm-toolbar .mm-toolbar-lasso { display: flex; flex-wrap: wrap; gap: 4px; }
.mm-toolbar .mm-toolbar-action {
  all: unset;
  box-sizing: border-box;
  min-height: 26px;
  max-width: 100%;
  padding: 0 10px;
  border-radius: 4px;
  line-height: 26px;
  white-space: normal;
  overflow-wrap: anywhere;
  color: var(--mm-toolbar-color);
  cursor: pointer;
}
.mm-toolbar .mm-toolbar-action:hover:not(:disabled) { background: var(--mm-toolbar-hover); }
.mm-toolbar .mm-toolbar-action[data-primary="true"] { background: var(--mm-toolbar-accent); color: var(--mm-toolbar-accent-text); }
.mm-toolbar .mm-toolbar-action[data-primary="true"]:hover:not(:disabled) { background: var(--mm-toolbar-accent); filter: brightness(.92); }
.mm-toolbar .mm-toolbar-action:disabled { cursor: default; opacity: .45; }
.mm-toolbar .mm-toolbar-field { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; max-width: 100%; box-sizing: border-box; padding: 0 6px; color: var(--mm-toolbar-muted); white-space: normal; overflow-wrap: anywhere; }
.mm-toolbar .mm-toolbar-field input,
.mm-toolbar .mm-toolbar-field select {
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  width: 64px;
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--mm-toolbar-border);
  border-radius: 4px;
  background: var(--mm-toolbar-background);
  color: var(--mm-toolbar-color);
  font: inherit;
}
.mm-toolbar .mm-toolbar-field input[aria-invalid="true"] { border-color: var(--mm-toolbar-danger); }
.mm-toolbar .mm-toolbar-field select { width: 126px; }
.mm-toolbar .mm-toolbar-notice {
  flex: 1 0 100%;
  box-sizing: border-box;
  padding: 8px;
  border-radius: var(--mm-toolbar-radius);
  background: var(--mm-toolbar-background);
  color: var(--mm-toolbar-danger);
  white-space: normal;
  border-top: 1px solid var(--mm-toolbar-border);
}
.mm-toolbar .mm-geofencing-notice { box-sizing: border-box; width: 240px; padding: 10px; background: white; border: 1px solid #b91c1c; border-radius: 6px; color: #991b1b; white-space: normal; overflow-wrap: anywhere; font: 12px/1.5 system-ui; }
.mm-toolbar > .mm-geofencing-notice { position: absolute; overflow: auto; }
.mm-toolbar .mm-toolbar-actions > .mm-geofencing-notice { flex: 1 0 100%; width: auto; }
`;
