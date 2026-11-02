const bottomCorner = '.maplibregl-ctrl-bottom-left, .maplibregl-ctrl-bottom-right, .mapboxgl-ctrl-bottom-left, .mapboxgl-ctrl-bottom-right';

/** Available height respects the control's corner, margins and preceding controls. */
export function controlHeight(root: HTMLElement, canvas: HTMLCanvasElement, padding = 8): number {
  const view = canvas.getBoundingClientRect();
  const bounds = root.getBoundingClientRect();
  const scale = view.height / canvas.clientHeight || 1;
  const bottom = root.closest(bottomCorner) !== null;
  const inset = bottom ? (view.bottom - bounds.bottom) / scale : (bounds.top - view.top) / scale;
  let available = canvas.clientHeight - Math.max(padding, inset) - padding;
  const right = root.closest('.maplibregl-ctrl-top-right, .maplibregl-ctrl-bottom-right, .mapboxgl-ctrl-top-right, .mapboxgl-ctrl-bottom-right') !== null;
  const opposite = `${bottom ? 'top' : 'bottom'}-${right ? 'right' : 'left'}`;
  const other = canvas.closest('.maplibregl-map, .mapboxgl-map')?.querySelector(`.maplibregl-ctrl-${opposite}, .mapboxgl-ctrl-${opposite}`)?.getBoundingClientRect();
  if (other && other.height && bounds.left < other.right && bounds.right > other.left) {
    available = Math.min(available, (bottom ? bounds.bottom - other.bottom : other.top - bounds.top) / scale - padding);
  }
  return Math.max(0, available);
}

/** Fit an absolutely positioned control in the canvas, including transformed hosts. */
export function fitControlPanel(panel: HTMLElement, root: HTMLElement, canvas: HTMLCanvasElement, anchor: HTMLElement, end: boolean): void {
  const view = canvas.getBoundingClientRect();
  if (!view.width || !view.height) return;
  const padding = 8;
  const scaleX = view.width / canvas.clientWidth || 1;
  const scaleY = view.height / canvas.clientHeight || 1;
  const bounds = root.getBoundingClientRect();
  const sideWidth = end ? (bounds.left - view.left) / scaleX - 2 * padding
    : canvas.clientWidth - (bounds.right - view.left) / scaleX - 2 * padding;
  // Keep the tool column usable whenever there is room for a practical panel.
  panel.style.maxWidth = `${Math.max(0, sideWidth >= 128 ? sideWidth : canvas.clientWidth - 2 * padding)}px`;
  panel.style.maxHeight = `${Math.max(0, canvas.clientHeight - 2 * padding)}px`;
  const size = panel.getBoundingClientRect();
  const width = size.width / scaleX;
  const height = size.height / scaleY;
  const minLeft = (view.left - bounds.left) / scaleX + padding;
  const minTop = (view.top - bounds.top) / scaleY + padding;
  const left = end ? -width - padding : root.offsetWidth + padding;
  const top = (anchor.getBoundingClientRect().top - bounds.top) / scaleY;
  panel.style.left = `${Math.max(minLeft, Math.min(minLeft + canvas.clientWidth - 2 * padding - width, left))}px`;
  panel.style.right = 'auto';
  panel.style.top = `${Math.max(minTop, Math.min(minTop + canvas.clientHeight - 2 * padding - height, top))}px`;
}
