let cached: { width: number; height: number; data: Uint8Array } | undefined;

/** One reusable signed-distance icon: no network, canvas or per-color textures. */
export function pinImage(): { width: number; height: number; data: Uint8Array } {
  if (cached) return cached;
  const width = 80; const height = 112;
  const ring: [number, number][] = [[40, 104]];
  // A circular head joined tangentially to the pointed tail.
  const angle = Math.asin(24 / 68);
  for (let i = 0; i <= 48; i++) {
    const theta = angle - (Math.PI + 2 * angle) * i / 48;
    ring.push([40 + 24 * Math.cos(theta), 36 + 24 * Math.sin(theta)]);
  }
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = x + 0.5; const py = y + 0.5;
    let inside = false; let distance = Infinity;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j]!; const [bx, by] = ring[i]!;
      const dx = bx - ax; const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
      distance = Math.min(distance, Math.hypot(px - ax - t * dx, py - ay - t * dy));
      if ((ay > py) !== (by > py) && px < (bx - ax) * (py - ay) / (by - ay) + ax) inside = !inside;
    }
    const offset = (y * width + x) * 4;
    data[offset] = 255; data[offset + 1] = 255; data[offset + 2] = 255;
    const signedDistance = Math.min(inside ? distance : -distance, Math.hypot(px - 40, py - 36) - 8);
    data[offset + 3] = Math.max(0, Math.min(255, Math.round(192 + signedDistance * 8)));
  }
  cached = { width, height, data };
  return cached;
}
