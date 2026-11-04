export type PropertyMode = "follow" | "fixed" | "click" | "off";
export function propertyPosition(pointer: { x: number; y: number }, card: { width: number; height: number }, viewport: { width: number; height: number }, mode: PropertyMode) {
  let left = mode === "follow" ? pointer.x + 16 : (viewport.width - card.width) / 2;
  let top = mode === "follow" ? pointer.y + 16 : (viewport.height - card.height) / 2;
  if (mode === "follow" && left + card.width > viewport.width - 8) left = pointer.x - card.width - 16;
  if (mode === "follow" && top + card.height > viewport.height - 8) top = pointer.y - card.height - 16;
  return { left: Math.max(8, Math.min(left, viewport.width - card.width - 8)), top: Math.max(8, Math.min(top, viewport.height - card.height - 8)) };
}
