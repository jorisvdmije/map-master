import type { EditorAppearanceOptions } from "@jorisvdmije/map-master";

export const themes: Record<string, EditorAppearanceOptions> = {
  "Blue & orange": {
    feature: { fillColor: "#3b5bdb", fillOpacity: 0.22, lineColor: "#364fc7", lineWidth: 2.5 },
    selected: { fillColor: "#f59f00", fillOpacity: 0.28, lineColor: "#e8590c", lineWidth: 3 },
    draft: { fillColor: "#f59f00", fillOpacity: 0.2, lineColor: "#e8590c", lineWidth: 2.5 },
    marker: { color: "#3b5bdb", radius: 7, strokeColor: "#ffffff", strokeWidth: 2 },
    selectedMarker: { color: "#e8590c", radius: 8, strokeColor: "#ffffff", strokeWidth: 2 },
    vertex: { color: "#ffffff", strokeColor: "#e8590c", radius: 5, activeColor: "#e8590c" },
  },
  Forest: {
    feature: { fillColor: "#2b8a3e", fillOpacity: 0.25, lineColor: "#1b5e20", lineWidth: 2 },
    selected: { fillColor: "#94d82d", fillOpacity: 0.35, lineColor: "#2b8a3e", lineWidth: 3.5 },
    draft: { fillColor: "#94d82d", fillOpacity: 0.25, lineColor: "#2b8a3e", lineWidth: 2.5 },
    marker: { color: "#2b8a3e", radius: 7, strokeColor: "#ffffff", strokeWidth: 2 },
    selectedMarker: { color: "#94d82d", radius: 8, strokeColor: "#1b5e20", strokeWidth: 2 },
    vertex: { color: "#ffffff", strokeColor: "#1b5e20", radius: 5, activeColor: "#94d82d" },
  },
  "High contrast": {
    feature: { fillColor: "#000000", fillOpacity: 0.15, lineColor: "#000000", lineWidth: 3 },
    selected: { fillColor: "#ffd43b", fillOpacity: 0.45, lineColor: "#000000", lineWidth: 4 },
    draft: { fillColor: "#ffd43b", fillOpacity: 0.35, lineColor: "#000000", lineWidth: 3 },
    marker: { color: "#000000", radius: 8, strokeColor: "#ffd43b", strokeWidth: 3 },
    selectedMarker: { color: "#ffd43b", radius: 9, strokeColor: "#000000", strokeWidth: 3 },
    vertex: { color: "#ffd43b", strokeColor: "#000000", radius: 6, activeColor: "#000000" },
  },
};
export const defaultTheme = themes["Blue & orange"]!;
