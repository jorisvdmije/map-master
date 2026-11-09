import {
  Map as GLMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapMouseEvent,
  type StyleSpecification,
  type ExpressionSpecification,
} from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import type { QueryClient } from "@tanstack/react-query";
import { bbox } from "@turf/bbox";
import { assetPath } from "@/lib/paths";
import { basemapQuery, fallbackStyle } from "@/features/examples/queries";
import { type HoverMode } from "@/features/bnb/model";
import {
  labels,
  metrics,
  wards,
  scoreColor,
  formatValue,
  units,
  thresholds,
  highIsMore,
  type Road,
  type Street,
  type Metric,
  type Observation,
} from "./model";

import {
  PropertyCard,
  propertyContent,
} from "@/features/examples/property-card";
import {
  heatPalette,
  hexPalette,
  heatLabels,
  type HeatView,
  type HeatSettings,
} from "./heat";

type Handlers = {
  road: (id: string) => void;
  segment: (id: string) => void;
  ward: (id: string) => void;
  notice: (text: string) => void;
  cell: (id: string) => void;
};
export type MapMode = "streets" | "wards" | "clusters" | "heat";
export async function mountStreets(
  container: HTMLElement,
  signal: AbortSignal,
  client: QueryClient,
  handlers: Handlers,
) {
  if (signal.aborted) return;
  setWorkerUrl(assetPath("/maplibre-worker.mjs"));
  const map = new GLMap({
    container,
    style: structuredClone(fallbackStyle),
    center: [4.9, 52.367],
    zoom: 11.2,
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    fadeDuration: 0,
    pixelRatio: Math.max(2, Math.min(2.5, window.devicePixelRatio || 1)),
  });
  map.touchZoomRotate.disableRotation();
  const remove = () => map.remove();
  signal.addEventListener("abort", remove, { once: true });
  await new Promise<void>((resolve) => {
    map.once("load", () => resolve());
    map.once("remove", () => resolve());
  });
  if (signal.aborted) return;
  const instance = new StreetRuntime(map, handlers);
  signal.removeEventListener("abort", remove);
  signal.addEventListener("abort", () => instance.destroy(), { once: true });
  void client
    .fetchQuery(basemapQuery)
    .then((style) => {
      if (!signal.aborted) map.setStyle(quietBasemap(style));
    })
    .catch(() => {
      if (!signal.aborted)
        handlers.notice(
          "Achtergrondkaart niet beschikbaar. Alle straatlijnen, gebieden en analyses blijven bruikbaar.",
        );
    });
  return instance;
}
export class StreetRuntime {
  private roads: FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };
  private areas: FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };
  private lookup = new Map<string, Street>();
  private details: FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };
  private segmentLookup = new Map<string, Road>();
  private segment: string | null = null;
  private showSegments = false;
  private filterIds: string[] = [];
  private metric: Metric = "treeDensity";
  private mode: MapMode = "streets";
  private selected: string | null = null;
  private heat: HeatView | null = null;
  private heatLookup = new Map<
    string,
    NonNullable<HeatView["data"]>["features"][number]
  >();
  private heatSettings: HeatSettings = {
    kind: "reports",
    radius: 250,
    contrast: 1,
    shape: "smooth",
  };
  private heatReference = 1;
  private selectedCell: string | null = null;
  private fitted = false;
  private card: PropertyCard;
  private observer: ResizeObserver;
  private frame = 0;
  constructor(
    readonly map: GLMap,
    handlers: Handlers,
  ) {
    map.addControl(
      new NavigationControl({ showCompass: false }),
      "bottom-right",
    );
    map.addControl(new ScaleControl({ maxWidth: 90 }), "bottom-left");
    map.addControl(
      {
        onAdd: () => {
          const el = document.createElement("div");
          el.className = "maplibregl-ctrl maplibregl-ctrl-attrib";
          el.textContent = "Brondata: Gemeente Amsterdam · NWB / PDOK";
          return el;
        },
        onRemove: () => {},
      },
      "bottom-left",
    );
    this.card = new PropertyCard(map, "st-tooltip");
    map.on("style.load", this.attach);
    this.attach();
    map.on("mousemove", this.hover);
    map.on("movestart", this.hide);
    map.on("movestart", () => {
      map.getContainer().dataset.idle = "false";
    });
    map.on("moveend", () => {
      map.getContainer().dataset.camera = JSON.stringify([
        map.getCenter().lng,
        map.getCenter().lat,
        map.getZoom(),
      ]);
    });
    map.getCanvasContainer().addEventListener("mouseleave", this.hide);
    map.getCanvas().addEventListener("keydown", this.key);
    map.on("click", (e) => {
      if (!map.getLayer("st-lines")) return;
      const properties = this.describe(e);
      if (this.mode === "heat") {
        this.card.clear();
        const hit = this.heatHit(e);
        if (hit?.properties?.id) handlers.cell(String(hit.properties.id));
      } else if (this.mode === "wards") {
        const hit = map.queryRenderedFeatures(e.point, {
          layers: ["st-areas"],
        })[0];
        if (hit?.properties?.code) handlers.ward(String(hit.properties.code));
      } else if (
        this.showSegments &&
        this.map.queryRenderedFeatures(e.point, { layers: ["st-segments"] })[0]
          ?.properties?.id
      ) {
        handlers.segment(
          String(
            this.map.queryRenderedFeatures(e.point, {
              layers: ["st-segments"],
            })[0]!.properties.id,
          ),
        );
      } else {
        const hit = this.hit(e);
        if (hit?.properties?.id) handlers.road(String(hit.properties.id));
      }
      if (this.mode !== "heat") {
        if (properties) this.card.pin(properties.key, properties.build);
        else this.card.clear();
      }
    });
    this.observer = new ResizeObserver(() => {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => map.resize());
    });
    this.observer.observe(map.getContainer());
    map.on("idle", this.idle);
  }
  private idle = () => {
    this.map.getContainer().parentElement!.dataset.heatDetail =
      this.map.getZoom() >= 16.2 ? "points" : "density";
    this.map.getContainer().dataset.idle = "true";
    this.map.getContainer().dataset.camera = JSON.stringify([
      this.map.getCenter().lng,
      this.map.getCenter().lat,
      this.map.getZoom(),
    ]);
  };
  private attach = () => {
    if (this.map.getSource("st-road-data")) return;
    this.map.addSource("st-road-data", {
      type: "geojson",
      data: this.roads,
      tolerance: 0.2,
      maxzoom: 16,
    });
    this.map.addSource("st-detail-data", {
      type: "geojson",
      data: this.details,
    });
    this.map.addSource("st-heat-data", {
      type: "geojson",
      data: this.heat?.data ?? { type: "FeatureCollection", features: [] },
      maxzoom: 16,
    });
    this.map.addSource("st-hex-data", {
      type: "geojson",
      data: this.heat?.polygons ?? { type: "FeatureCollection", features: [] },
      tolerance: 0,
      maxzoom: 16,
    });
    this.map.addSource("st-area-data", { type: "geojson", data: this.areas });
    const before = this.map
      .getStyle()
      .layers.find((l) => l.type === "symbol")?.id;
    this.map.addLayer(
      {
        id: "st-areas",
        type: "fill",
        source: "st-area-data",
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.38 },
      },
      before,
    );
    this.map.addLayer(
      {
        id: "st-outlines",
        type: "line",
        source: "st-area-data",
        paint: {
          "line-color": "#506568",
          "line-width": 1.2,
          "line-opacity": 0.8,
        },
      },
      before,
    );
    this.map.addLayer(
      {
        id: "st-lines",
        type: "line",
        source: "st-road-data",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#309271",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            9,
            0.8,
            12,
            1.8,
            15,
            4.5,
          ],
          "line-opacity": 0.65,
        },
      },
      before,
    );
    this.map.addLayer(
      {
        id: "st-selected",
        type: "line",
        source: "st-road-data",
        layout: { "line-join": "round", "line-cap": "round" },
        filter: ["==", ["get", "id"], ""],
        paint: {
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            9,
            2.5,
            12,
            4,
            15,
            6.5,
          ],
          "line-opacity": 0.85,
        },
      },
      before,
    );
    this.map.addLayer(
      {
        id: "st-segments",
        type: "line",
        source: "st-detail-data",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-width": 3, "line-opacity": 0.78 },
      },
      before,
    );
    this.map.addLayer(
      {
        id: "st-segment-selected",
        type: "line",
        source: "st-detail-data",
        layout: { "line-join": "round", "line-cap": "round" },
        filter: ["==", ["get", "id"], ""],
        paint: { "line-width": 6, "line-opacity": 0.9 },
      },
      before,
    );
    this.map.addLayer(
      {
        id: "st-heat",
        type: "heatmap",
        source: "st-heat-data",
        maxzoom: 16.5,
        paint: {
          "heatmap-weight": ["get", "count"],
          "heatmap-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            14,
            0.88,
            16.5,
            0,
          ],
        },
      },
      before,
    );
    this.map.addLayer(
      {
        id: "st-heat-points",
        type: "circle",
        source: "st-heat-data",
        minzoom: 13.5,
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            14,
            [
              "interpolate",
              ["linear"],
              ["sqrt", ["get", "count"]],
              1,
              2,
              15,
              5,
            ],
            17,
            [
              "interpolate",
              ["linear"],
              ["sqrt", ["get", "count"]],
              1,
              3.5,
              15,
              9,
            ],
          ],
          "circle-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            13.5,
            0,
            15,
            0.25,
            16.5,
            0.8,
          ],
          "circle-stroke-color": "#fffdf8",
          "circle-stroke-width": 0.7,
          "circle-stroke-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            14,
            0,
            16.5,
            0.8,
          ],
        },
      },
      before,
    );
    this.map.addLayer({
      id: "st-heat-hit",
      type: "circle",
      source: "st-heat-data",
      paint: { "circle-radius": 7, "circle-opacity": 0 },
    });
    this.map.addLayer({
      id: "st-heat-selected",
      type: "circle",
      source: "st-heat-data",
      filter: ["==", ["get", "id"], ""],
      paint: {
        "circle-radius": 7,
        "circle-color": "#a25c4a",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#fffffa",
        "circle-opacity": 0.95,
      },
    });
    this.map.addLayer(
      {
        id: "st-hex-fill",
        type: "fill",
        source: "st-hex-data",
        paint: {
          "fill-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            9,
            0.45,
            12,
            0.55,
            15,
            0.65,
          ],
        },
      },
      before,
    );
    this.map.addLayer(
      {
        id: "st-hex-lines",
        type: "line",
        source: "st-hex-data",
        paint: {
          "line-color": "#fffdf3",
          "line-opacity": 0.65,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.3, 14, 0.8],
        },
      },
      before,
    );
    this.map.addLayer({
      id: "st-hex-selected",
      type: "line",
      source: "st-hex-data",
      filter: ["==", ["get", "id"], ""],
      paint: { "line-color": "#fffdf4", "line-width": 2.5 },
    });
    if (this.map.getStyle().glyphs)
      this.map.addLayer({
        id: "st-hex-labels",
        type: "symbol",
        source: "st-heat-data",
        minzoom: 12.7,
        layout: {
          "text-field": ["to-string", ["get", "count"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-padding": 6,
        },
        paint: {
          "text-color": "#5e5249",
          "text-halo-color": "#fffff5",
          "text-halo-width": 0.8,
        },
      });
    this.apply();
  };
  setData(roads: Street[], assignments: Map<string, number>, colors: string[]) {
    if (this.card.key?.startsWith("street:")) {
      const id = this.card.key.slice(7),
        old = this.lookup.get(id),
        next = roads.find((s) => s.id === id);
      if (!next || old?.raw !== next.raw) this.card.clear();
    }
    this.lookup = new Map(roads.map((r) => [r.id, r]));
    this.roads = {
      type: "FeatureCollection",
      features: roads.map((r) => ({
        type: "Feature",
        id: r.id,
        geometry: r.geometry,
        properties: {
          id: r.id,
          ...Object.fromEntries(metrics.map((m) => [m, r[m]])),
          profileColor: colors[assignments.get(r.id) ?? -1] ?? "#94a1ab",
        },
      })),
    };
    (this.map.getSource("st-road-data") as GeoJSONSource | undefined)?.setData(
      this.roads,
    );
    if (!this.fitted && roads.length) {
      this.fit(null);
      this.fitted = true;
    }
  }
  render(
    visible: Street[],
    metric: Metric,
    mode: MapMode,
    ward: string | null,
    areas: Observation[],
    selected: string | null,
    hoverMode: HoverMode,
    showSegments: boolean,
    segment: string | null,
  ) {
    this.showSegments =
      showSegments && !!selected && mode !== "wards" && mode !== "heat";
    this.segment = segment;
    const street = selected ? this.lookup.get(selected) : undefined;
    this.segmentLookup = new Map(street?.roads.map((r) => [r.id, r]) ?? []);
    this.details = {
      type: "FeatureCollection",
      features: (this.showSegments ? (street?.roads ?? []) : []).map((r) => ({
        type: "Feature",
        id: r.id,
        geometry: r.geometry,
        properties: {
          id: r.id,
          ...Object.fromEntries(metrics.map((m) => [m, r[m]])),
        },
      })),
    };
    (
      this.map.getSource("st-detail-data") as GeoJSONSource | undefined
    )?.setData(this.details);
    if (this.mode !== mode || this.metric !== metric) this.card.clear();
    this.card.setMode(hoverMode);
    if (
      this.card.key?.startsWith("street:") &&
      !visible.some((s) => `street:${s.id}` === this.card.key)
    )
      this.card.clear();
    this.hide();
    this.filterIds = visible.map((r) => r.id);
    this.metric = metric;
    this.mode = mode;
    this.selected = selected;
    const stats = new Map(areas.map((a) => [a.id, a]));
    if (this.card.pinned && this.card.key?.startsWith("ward:")) {
      const id = this.card.key.slice(5),
        row = stats.get(id);
      if (row)
        this.card.pin(`ward:${id}`, () =>
          propertyContent(
            row.name,
            metrics.map((m) => ({
              label: labels[m],
              value: `${formatValue(row[m], m)} ${units[m]}`,
            })),
            `${row.count} gefilterde wegvakken`,
            "Gemeentelijke brondata · nabijheidskoppeling · Esc sluit",
          ),
        );
      else this.card.clear();
    }
    this.areas = {
      type: "FeatureCollection",
      features: wards
        .filter(
          (w) =>
            (!ward || w.properties.code === ward) &&
            stats.has(w.properties.code),
        )
        .map((w) => ({
          ...w,
          properties: {
            ...w.properties,
            color: scoreColor(
              stats.get(w.properties.code)?.[metric] ?? null,
              metric,
            ),
            score: stats.get(w.properties.code)?.[metric],
            count: stats.get(w.properties.code)?.count,
          },
        })),
    };
    (this.map.getSource("st-area-data") as GeoJSONSource | undefined)?.setData(
      this.areas,
    );
    this.apply();
  }
  renderHeat(
    view: HeatView | null,
    settings: HeatSettings,
    reference: number,
    selectedCell: string | null,
  ) {
    const changed = this.heat !== view;
    this.heat = view;
    this.heatSettings = settings;
    this.heatReference = reference;
    this.selectedCell = selectedCell;
    if (changed) {
      this.heatLookup = new Map(
        view?.data.features.map((f) => [f.properties.id, f]) ?? [],
      );
      (
        this.map.getSource("st-heat-data") as GeoJSONSource | undefined
      )?.setData(view?.data ?? { type: "FeatureCollection", features: [] });
      (this.map.getSource("st-hex-data") as GeoJSONSource | undefined)?.setData(
        view?.polygons ?? { type: "FeatureCollection", features: [] },
      );
    }
    this.applyHeat();
  }
  private applyHeat() {
    if (!this.map.getLayer("st-heat")) return;
    this.map.getContainer().dataset.idle = "false";
    this.map.getContainer().dataset.heatTotal = String(this.heat?.total ?? 0);
    this.map.getContainer().dataset.heatCells = String(this.heat?.cells ?? 0);
    const active = this.mode === "heat",
      hex = this.heatSettings.shape === "hex",
      palette = heatPalette(this.heatSettings.kind);
    for (const id of [
      "st-heat",
      "st-heat-points",
      "st-heat-hit",
      "st-heat-selected",
    ])
      this.map.setLayoutProperty(
        id,
        "visibility",
        active && !hex ? "visible" : "none",
      );
    const metresPerPixelAtZero =
      (40075016.686 * Math.cos((52.37 * Math.PI) / 180)) / 512;
    const radius = this.heatSettings.radius / metresPerPixelAtZero;
    this.map.setPaintProperty("st-heat", "heatmap-radius", [
      "interpolate",
      ["exponential", 2],
      ["zoom"],
      0,
      radius,
      22,
      radius * 2 ** 22,
    ]);
    this.map.setPaintProperty(
      "st-heat",
      "heatmap-intensity",
      Math.max(
        0.0008,
        (1.65 / this.heatReference) * this.heatSettings.contrast,
      ),
    );
    this.map.setPaintProperty("st-heat", "heatmap-color", [
      "interpolate",
      ["linear"],
      ["heatmap-density"],
      ...palette.flat(),
    ] as ExpressionSpecification);
    this.map.setPaintProperty(
      "st-heat-points",
      "circle-color",
      palette.at(-1)![1],
    );
    this.map.setPaintProperty(
      "st-heat-selected",
      "circle-color",
      palette.at(-1)![1],
    );
    this.map.setFilter("st-heat-selected", [
      "==",
      ["get", "id"],
      this.selectedCell ?? "",
    ]);
    for (const id of [
      "st-hex-fill",
      "st-hex-lines",
      "st-hex-selected",
      "st-hex-labels",
    ])
      if (this.map.getLayer(id))
        this.map.setLayoutProperty(
          id,
          "visibility",
          active && hex ? "visible" : "none",
        );
    const scale = Math.max(
      1,
      Math.ceil(this.heatReference / this.heatSettings.contrast),
    );
    this.map.setPaintProperty("st-hex-fill", "fill-color", [
      "interpolate",
      ["linear"],
      ["get", "count"],
      ...hexPalette(this.heatSettings.kind).flatMap(([stop, color]) => [
        stop * scale,
        color,
      ]),
    ] as ExpressionSpecification);
    this.map.setFilter("st-hex-selected", [
      "==",
      ["get", "id"],
      this.selectedCell ?? "",
    ]);
    if (this.map.getLayer("st-hex-labels")) {
      this.map.setLayerZoomRange(
        "st-hex-labels",
        Math.log2((34 * metresPerPixelAtZero) / this.heatSettings.radius),
        24,
      );
      this.map.setPaintProperty("st-hex-labels", "text-color", [
        "case",
        [">=", ["get", "count"], scale * 0.6],
        "#fffdf3",
        "#5e5249",
      ]);
      this.map.setPaintProperty("st-hex-labels", "text-halo-color", [
        "case",
        [">=", ["get", "count"], scale * 0.6],
        "rgba(80,50,50,0.25)",
        "rgba(255,255,245,0.65)",
      ]);
    }
  }
  private apply() {
    if (!this.map.getLayer("st-lines")) return;
    this.map.getContainer().dataset.idle = "false";
    this.map.setFilter("st-lines", [
      "all",
      ["in", ["get", "id"], ["literal", this.filterIds]],
      ["!=", ["get", "id"], this.showSegments ? "" : (this.selected ?? "")],
    ]);
    this.map.setFilter("st-selected", [
      "==",
      ["get", "id"],
      this.showSegments ? "" : (this.selected ?? ""),
    ]);
    this.map.setFilter("st-segment-selected", [
      "==",
      ["get", "id"],
      this.segment ?? "",
    ]);
    const [low, high] = thresholds[this.metric];
    const quality = [
      "case",
      ["==", ["get", this.metric], null],
      "#94a1ab",
      ["<", ["get", this.metric], low],
      highIsMore[this.metric] ? "#cc5350" : "#309271",
      ["<", ["get", this.metric], high],
      "#e8a03c",
      highIsMore[this.metric] ? "#309271" : "#cc5350",
    ] as import("maplibre-gl").ExpressionSpecification;
    const color =
      this.mode === "clusters"
        ? ([
            "get",
            "profileColor",
          ] as import("maplibre-gl").ExpressionSpecification)
        : quality;
    this.map.setPaintProperty("st-lines", "line-color", color);
    this.map.setPaintProperty("st-selected", "line-color", color);
    this.map.setPaintProperty("st-segments", "line-color", quality);
    this.map.setPaintProperty("st-segment-selected", "line-color", quality);
    this.map.setPaintProperty(
      "st-lines",
      "line-opacity",
      this.mode === "wards"
        ? 0.12
        : this.mode === "heat"
          ? 0
          : this.showSegments
            ? 0.28
            : 0.65,
    );
    this.map.setLayoutProperty(
      "st-selected",
      "visibility",
      this.mode === "wards" || this.mode === "heat" ? "none" : "visible",
    );
    this.map.setLayoutProperty(
      "st-segments",
      "visibility",
      this.mode === "wards" || this.mode === "heat" ? "none" : "visible",
    );
    this.map.setLayoutProperty(
      "st-segment-selected",
      "visibility",
      this.mode === "wards" || this.mode === "heat" ? "none" : "visible",
    );
    this.map.setLayoutProperty(
      "st-areas",
      "visibility",
      this.mode === "wards" ? "visible" : "none",
    );
    this.map.setLayoutProperty(
      "st-outlines",
      "visibility",
      this.mode === "wards" ? "visible" : "none",
    );
    this.applyHeat();
  }
  fit(ward: string | null) {
    if (!ward || ward === "outside") {
      if (!this.roads.features.length) return;
      const data =
        ward === "outside"
          ? {
              ...this.roads,
              features: this.roads.features.filter(
                (f) => this.lookup.get(String(f.id))?.ward === "outside",
              ),
            }
          : this.roads;
      if (!data.features.length) return;
      const b = bbox(data);
      this.map.fitBounds(
        [
          [b[0]!, b[1]!],
          [b[2]!, b[3]!],
        ],
        { padding: 36, maxZoom: 11.7, duration: 0 },
      );
      return;
    }
    const area = wards.find((w) => w.properties.code === ward);
    if (!area) return;
    const b = bbox(area);
    this.map.fitBounds(
      [
        [b[0]!, b[1]!],
        [b[2]!, b[3]!],
      ],
      { padding: 45, maxZoom: 14.5, duration: 0 },
    );
  }
  fitHeat() {
    if (!this.heat?.data.features.length) return;
    const b = bbox(this.heat.data);
    this.map.fitBounds(
      [
        [b[0]!, b[1]!],
        [b[2]!, b[3]!],
      ],
      { padding: 60, maxZoom: 15, duration: 0 },
    );
  }
  heatCity() {
    this.map.jumpTo({ center: [4.9, 52.368], zoom: 12.6 });
  }
  focus(road: Street) {
    const b = bbox({
      type: "Feature",
      geometry: road.geometry,
      properties: {},
    });
    this.map.fitBounds(
      [
        [b[0]!, b[1]!],
        [b[2]!, b[3]!],
      ],
      { padding: 90, maxZoom: 16, duration: 0 },
    );
  }
  private heatHit(e: MapMouseEvent) {
    return this.map.queryRenderedFeatures(e.point, {
      layers: [
        this.heatSettings.shape === "hex" ? "st-hex-fill" : "st-heat-hit",
      ],
    })[0];
  }
  private hit(e: MapMouseEvent) {
    return this.map.queryRenderedFeatures(
      [
        [e.point.x - 4, e.point.y - 4],
        [e.point.x + 4, e.point.y + 4],
      ],
      { layers: ["st-selected", "st-lines"] },
    )[0];
  }
  private key = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.hide();
  };
  private hide = () => {
    this.card.hide();
  };
  private hover = (e: MapMouseEvent) => {
    if (
      this.map.isMoving() ||
      e.originalEvent.buttons ||
      window.matchMedia("(hover: none)").matches ||
      !this.map.getLayer("st-lines") ||
      (this.mode === "heat" && this.selectedCell)
    ) {
      this.hide();
      return;
    }
    const properties = this.describe(e);
    this.map.getCanvas().style.cursor = properties ? "pointer" : "";
    if (properties) this.card.hover(properties.key, e.point, properties.build);
    else this.card.leave();
  };
  private describe(
    e: MapMouseEvent,
  ): { key: string; build: () => Node } | null {
    if (this.mode === "heat") {
      const hit = this.heatHit(e);
      if (!hit) return null;
      const cell = this.heatLookup.get(String(hit.properties.id));
      if (!cell) return null;
      return {
        key: `cell:${cell.properties.id}`,
        build: () =>
          propertyContent(
            heatLabels[this.heatSettings.kind],
            [
              {
                label: "Registraties",
                value: cell.properties.count.toLocaleString("nl-NL"),
              },
              {
                label: "Vak",
                value:
                  this.heatSettings.shape === "hex"
                    ? `Hexagon · ${this.heatSettings.radius} m breed`
                    : "Bronvak · 25 × 25 m",
              },
              {
                label: "Straatnamen",
                value: cell.properties.names.join(" / "),
              },
            ],
            "Bronlocaties · concentratie, geen risico",
          ),
      };
    }
    const area =
      this.mode === "wards"
        ? this.map.queryRenderedFeatures(e.point, { layers: ["st-areas"] })[0]
        : null;
    const segment =
      this.showSegments && this.mode !== "wards"
        ? this.segmentLookup.get(
            String(
              this.map.queryRenderedFeatures(e.point, {
                layers: ["st-segments"],
              })[0]?.properties?.id,
            ),
          )
        : undefined;
    const road =
      this.mode !== "wards"
        ? this.lookup.get(String(this.hit(e)?.properties?.id))
        : null;
    if (!area && !road && !segment) return null;
    const row = segment ?? road;
    const key = segment
      ? `segment:${segment.id}`
      : road
        ? `street:${road.id}`
        : `ward:${area!.properties.code}`;
    return {
      key,
      build: () => {
        const rows = row
          ? metrics.map((m) => ({
              label: labels[m],
              value: `${formatValue(row[m], m)} ${units[m]}`,
            }))
          : [
              {
                label: labels[this.metric],
                value: `${formatValue(typeof area!.properties.score === "number" ? area!.properties.score : null, this.metric)} ${units[this.metric]}`,
              },
            ];
        if (row)
          rows.push({
            label: "Brontellingen",
            value: `${row.raw.lights} lichtobjecten · ${row.raw.trees} bomen`,
          });
        const meta = segment
          ? `${segment.length} m NWB · wegvak ${segment.id}`
          : road
            ? `${road.count} wegvakken · samengevoegde registraties`
            : `${area!.properties.count} gefilterde wegvakken`;
        return propertyContent(
          row?.name ?? String(area!.properties.name),
          rows,
          meta,
          "Gemeentelijke brondata · nabijheidskoppeling · klik om vast te zetten · Esc sluit",
        );
      },
    };
  }
  destroy() {
    this.observer.disconnect();
    cancelAnimationFrame(this.frame);
    this.card.destroy();
    this.map.getCanvasContainer().removeEventListener("mouseleave", this.hide);
    this.map.getCanvas().removeEventListener("keydown", this.key);
    this.map.remove();
  }
}

/** Keep source-road colors distinct from the decorative background roads. */
function quietBasemap(original: StyleSpecification): StyleSpecification {
  const style = structuredClone(original);
  for (const layer of style.layers) {
    if (layer.type === "line")
      layer.paint = {
        ...layer.paint,
        "line-color": "#c9d2c9",
        "line-opacity": 0.5,
      };
    if (layer.type === "fill") {
      layer.paint = { ...layer.paint, "fill-opacity": 0.55 };
      if (/building/i.test(layer.id))
        layer.paint = {
          ...layer.paint,
          "fill-color": "#dfe5dc",
          "fill-outline-color": "#d6dfd2",
          "fill-opacity": 0.5,
        };
      else if (/water/i.test(layer.id)) layer.paint["fill-color"] = "#d4e2e2";
      else if (/landcover|landuse|park/i.test(layer.id))
        layer.paint["fill-color"] = "#e7edde";
    }
    if (layer.type === "fill-extrusion")
      layer.paint = {
        ...layer.paint,
        "fill-extrusion-color": "#dfe5dc",
        "fill-extrusion-opacity": 0.25,
      };
    if (layer.type === "symbol") {
      const poi = /poi|transit|housenumber|airport|aeroway/i.test(layer.id);
      layer.paint = {
        ...layer.paint,
        "text-color": "#708176",
        "text-opacity": poi ? 0.2 : 0.65,
        "text-halo-color": "#fbfcf8",
        "icon-opacity": poi ? 0.1 : 0.25,
      };
    }
  }
  return style;
}
