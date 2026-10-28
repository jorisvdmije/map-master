// 999 grid features plus one isolated 100-corner edit target, all near Amsterdam.
export function dataset() {
  const features = Array.from({ length: 999 }, (_, id) => {
    const x = 4.87 + id % 37 * 0.0005; const y = 52.36 + Math.floor(id / 37) * 0.0005;
    const geometry = id % 3 === 0 ? { type: 'Point', coordinates: [x, y] }
      : id % 3 === 1 ? { type: 'LineString', coordinates: [[x, y], [x + 0.0002, y + 0.0002]] }
      : { type: 'Polygon', coordinates: [[[x, y], [x + 0.0002, y], [x + 0.0002, y + 0.0002], [x, y + 0.0002], [x, y]]] };
    return { type: 'Feature', id, properties: { name: `Feature ${id}`, group: id % 3 }, geometry };
  });
  const ring = Array.from({ length: 100 }, (_, i) => [4.905 + Math.cos(i * Math.PI / 50) * 0.001, 52.372 + Math.sin(i * Math.PI / 50) * 0.001]);
  ring.push([...ring[0]]);
  features.push({ type: 'Feature', id: 999, properties: { name: 'Edit target', group: 3 }, geometry: { type: 'Polygon', coordinates: [ring] } });
  return { type: 'FeatureCollection', features };
}
