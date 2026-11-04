import type { Map, IControl } from "maplibre-gl";
import { propertyPosition, type PropertyMode } from "./property-position";

/** Screen-space properties: hover never catches the pointer; clicked cards can
 * be read, scrolled and closed without moving or blocking the rest of the map. */
export class PropertyCard {
  readonly element: HTMLDivElement;
  key: string | null = null;
  pinned = false;
  private mode: PropertyMode = "follow";
  private dismissed: string | null = null;
  private point = { x: 0, y: 0 };
  private observer: ResizeObserver;
  private control: IControl | null = null;
  constructor(private map: Map, className = "", private label = "Objecteigenschappen") {
    this.element = document.createElement("div"); this.element.className = `mm-property-overlay ${className}`; this.element.hidden = true;
    map.getContainer().append(this.element);
    this.observer = new ResizeObserver(() => this.position()); this.observer.observe(map.getContainer()); this.observer.observe(this.element);
    map.getContainer().addEventListener("mouseleave", this.leave);
    map.getContainer().ownerDocument.addEventListener("keydown", this.escape, true);
    map.on("movestart", this.hide);
  }
  isDismissed(key: string) { return this.dismissed === key; }
  setMode(mode: PropertyMode) { if (this.mode !== mode) { this.mode = mode; this.clear(); } }
  hover(key: string, point: { x: number; y: number }, build: () => Node) {
    if (this.pinned || this.mode === "off" || this.mode === "click" || this.dismissed === key) return;
    this.dismissed = null; this.point = { x: point.x, y: point.y };
    if (this.key !== key || this.element.hidden) this.show(key, build, false);
    this.position(); // Also update when the feature identity has not changed.
  }
  pin(key: string, build: () => Node) {
    if (this.mode === "off") return;
    this.dismissed = null; this.show(key, build, true); this.position();
  }
  private show(key: string, build: () => Node, pinned: boolean) {
    this.key = key; this.pinned = pinned; this.element.dataset.pinned = String(pinned);
    this.element.setAttribute("role", pinned ? "region" : "tooltip"); this.element.setAttribute("aria-label", this.label);
    this.element.replaceChildren(build());
    if (pinned) {
      const close = document.createElement("button"); close.type = "button"; close.className = "mm-property-close";
      close.setAttribute("aria-label", "Sluit eigenschappen"); close.title = "Sluit eigenschappen (Esc)"; close.textContent = "×";
      close.addEventListener("click", this.dismiss); this.element.prepend(close);
    }
    this.element.hidden = false;
  }
  hide = () => { if (!this.pinned) this.clear(false); };
  leave = () => { this.dismissed = null; this.hide(); };
  clear(resetDismissed = true) { this.key = null; this.pinned = false; this.element.hidden = true; this.element.replaceChildren(); if (resetDismissed) this.dismissed = null; }
  private dismiss = () => {
    const focused = this.element.contains(this.element.ownerDocument.activeElement);
    this.dismissed = this.key; this.clear(false);
    if (focused) this.map.getCanvas().focus({ preventScroll: true });
  };
  private escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || this.element.hidden) return;
    const active = this.element.ownerDocument.activeElement;
    if (active?.closest("[role=dialog],dialog") && !this.map.getContainer().contains(active)) return;
    event.preventDefault(); event.stopPropagation(); this.dismiss();
  };
  private position() {
    if (this.element.hidden) return;
    const container = this.map.getContainer();
    this.element.style.maxHeight = `${Math.max(0, Math.min(this.pinned ? 440 : 320, container.clientHeight - 16))}px`;
    const p = propertyPosition(this.point, { width: this.element.offsetWidth, height: this.element.offsetHeight }, { width: container.clientWidth, height: container.clientHeight }, this.pinned ? "fixed" : this.mode);
    Object.assign(this.element.style, { left: `${p.left}px`, top: `${p.top}px` });
  }
  addControl() {
    const root = document.createElement("label"); root.className = "maplibregl-ctrl mm-property-mode";
    const select = document.createElement("select"); select.setAttribute("aria-label", "Property display"); select.title = "Property display";
    for (const [value, label] of [["follow", "Properties · follow cursor"], ["fixed", "Properties · center on hover"], ["click", "Properties · center on click"], ["off", "Properties · hidden"]]) {
      const option = document.createElement("option"); option.value = value!; option.textContent = label!; select.append(option);
    }
    select.addEventListener("change", () => this.setMode(select.value as PropertyMode)); root.append(select);
    this.control = { onAdd: () => root, onRemove: () => root.remove() }; this.map.addControl(this.control, "top-right");
  }
  destroy() {
    this.observer.disconnect(); this.map.off("movestart", this.hide); this.map.getContainer().removeEventListener("mouseleave", this.leave);
    this.element.ownerDocument.removeEventListener("keydown", this.escape, true); this.element.remove();
    if (this.control) this.map.removeControl(this.control);
  }
}

export function propertyContent(title: string, rows: { label: string; value: string }[], meta: string, hint = "Klik om vast te zetten · Esc om te sluiten", className = "mm-feature-preview") {
  const card = document.createElement("section"); card.className = className;
  const heading = document.createElement("h3"), caption = document.createElement("p"), fields = document.createElement("dl"), footer = document.createElement("small");
  heading.textContent = title; caption.textContent = meta; card.append(heading, caption);
  for (const row of rows) { const term = document.createElement("dt"), value = document.createElement("dd"); term.textContent = row.label; value.textContent = row.value; fields.append(term, value); }
  footer.textContent = hint; card.append(fields, footer); return card;
}
