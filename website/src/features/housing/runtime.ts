import {
  Map as GLMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapMouseEvent,
} from "maplibre-gl";
import type { FeatureCollection, Feature, Point } from "geojson";
import type { QueryClient } from "@tanstack/react-query";
import { bbox } from "@turf/bbox";
import { assetPath } from "@/lib/paths";
import { basemapQuery, fallbackStyle } from "@/features/examples/queries";
import {
  PropertyCard,
  propertyContent,
} from "@/features/examples/property-card";
import type { PropertyMode } from "@/features/examples/property-position";
import {
  color,
  extent,
  format,
  labels,
  metricValue,
  number,
  type Neighborhood,
  type Metric,
  type Snapshot,
  type Home,
} from "./model";

export async function mountHousing(
  container: HTMLElement,
  signal: AbortSignal,
  client: QueryClient,
  choose: (code: string) => void,
  pick: (home: Home) => void,
) {
  if (signal.aborted) return;
  setWorkerUrl(assetPath("/maplibre-worker.mjs"));
  const map = new GLMap({
    container,
    style: structuredClone(fallbackStyle),
    center: [4.91, 52.36],
    zoom: 11,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    attributionControl: { compact: true },
    fadeDuration: 0,
  });
  const remove = () => map.remove();
  signal.addEventListener("abort", remove, { once: true });
  await new Promise<void>((resolve) => {
    map.once("load", () => resolve());
    map.once("remove", () => resolve());
  });
  if (signal.aborted) return;
  const runtime = new HousingRuntime(map, choose, pick);
  signal.removeEventListener("abort", remove);
  signal.addEventListener("abort", () => runtime.destroy(), { once: true });
  void client
    .fetchQuery(basemapQuery)
    .then((style) => {
      if (!signal.aborted) map.setStyle(style);
    })
    .catch(() => {
      if (!signal.aborted) container.dataset.basemap = "unavailable";
    });
  return runtime;
}
export class HousingRuntime {
  private areas: FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };
  private homes: FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };
  private lookup = new Map<string, Neighborhood>();
  private homeLookup = new Map<string, Home>();
  private trees: FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };
  private selected = "";
  private metric: Metric = "woz";
  private indicators: Snapshot["meta"]["indicators"];
  private card: PropertyCard;
  private observer: ResizeObserver;
  private frame = 0;
  private fitted = false;
  constructor(
    readonly map: GLMap,
    choose: (code: string) => void,
    pick: (home: Home) => void,
  ) {
    map.addControl(
      new NavigationControl({ showCompass: false }),
      "bottom-right",
    );
    map.addControl(new ScaleControl(), "bottom-left");
    map.addControl(
      {
        onAdd: () => {
          const el = document.createElement("div");
          el.className = "maplibregl-ctrl maplibregl-ctrl-attrib";
          el.textContent = "CBS 2025 · BAG / Kadaster / PDOK";
          return el;
        },
        onRemove() {},
      },
      "bottom-left",
    );
    this.card = new PropertyCard(map, "hs-tooltip");
    map.on("style.load", this.attach);
    this.attach();
    map.on("mousemove", this.hover);
    map.on("click", (e) => {
      const hit = this.describe(e);
      if (!hit) {
        this.card.clear();
        return;
      }
      if (hit.home) pick(hit.home);
      else if (hit.area) choose(hit.area.properties.code);
      this.card.pin(hit.key, hit.build);
    });
    map.on("idle", () => {
      map.getContainer().dataset.idle = "true";
      map.getContainer().dataset.camera = JSON.stringify([
        map.getCenter().lng,
        map.getCenter().lat,
        map.getZoom(),
      ]);
    });
    map.on("movestart", () => {
      map.getContainer().dataset.idle = "false";
    });
    this.observer = new ResizeObserver(() => {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => map.resize());
    });
    this.observer.observe(map.getContainer());
  }
  private attach = () => {
    if (this.map.getSource("hs-areas")) return;
    this.map.addSource("hs-areas", { type: "geojson", data: this.areas });
    this.map.addSource("hs-homes", { type: "geojson", data: this.homes });
    this.map.addSource("hs-trees", { type: "geojson", data: this.trees });
    const before = this.map
      .getStyle()
      .layers.find((l) => l.type === "symbol")?.id;
    this.map.addLayer(
      {
        id: "hs-fill",
        type: "fill",
        source: "hs-areas",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": ["case", ["get", "visible"], 0.5, 0.07],
        },
      },
      before,
    );
    this.map.addLayer(
      {
        id: "hs-lines",
        type: "line",
        source: "hs-areas",
        paint: {
          "line-color": "#ecf6f1",
          "line-width": 0.65,
          "line-opacity": 0.75,
        },
      },
      before,
    );
    this.map.addLayer(
      {
        id: "hs-selected",
        type: "line",
        source: "hs-areas",
        filter: ["==", ["get", "code"], this.selected],
        paint: {
          "line-color": "#268077",
          "line-width": 3,
          "line-opacity": 0.85,
        },
      },
      before,
    );
    this.map.addLayer({
      id: "hs-trees",
      type: "circle",
      source: "hs-trees",
      paint: {
        "circle-radius": 3,
        "circle-color": "#427e47",
        "circle-opacity": 0.7,
        "circle-stroke-color": "#fffdf5",
        "circle-stroke-width": 0.5,
      },
    });
    this.map.addLayer({
      id: "hs-points",
      type: "circle",
      source: "hs-homes",
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          11,
          1.5,
          15,
          3.5,
          18,
          6,
        ],
        "circle-color": "#ba6b45",
        "circle-opacity": 0.72,
        "circle-stroke-color": "#fffaf1",
        "circle-stroke-width": 0.8,
      },
    });
  };
  setData(
    all: Neighborhood[],
    visible: Neighborhood[],
    metric: Metric,
    selected: string,
    homes: Home[],
    mode: PropertyMode,
    indicators?: Snapshot["meta"]["indicators"],
  ) {
    this.map.getContainer().dataset.idle = "false";
    this.card.setMode(mode);
    if (this.metric !== metric) this.card.clear();
    this.metric = metric;
    this.indicators = indicators;
    if (selected !== this.selected && this.card.key !== `area:${selected}`)
      this.card.clear();
    this.selected = selected;
    this.lookup = new Map(visible.map((f) => [f.properties.code, f]));
    this.homeLookup = new Map(homes.map((f) => [f.properties.id, f]));
    const range = extent(all, metric);
    this.areas = {
      type: "FeatureCollection",
      features: all.map((f) => ({
        ...f,
        properties: {
          ...f.properties,
          color: color(metricValue(f, metric), range, metric),
          visible: this.lookup.has(f.properties.code),
        },
      })),
    };
    this.homes = { type: "FeatureCollection", features: homes };
    (this.map.getSource("hs-areas") as GeoJSONSource | undefined)?.setData(
      this.areas,
    );
    (this.map.getSource("hs-homes") as GeoJSONSource | undefined)?.setData(
      this.homes,
    );
    if (this.map.getLayer("hs-selected"))
      this.map.setFilter("hs-selected", ["==", ["get", "code"], selected]);
    if (
      this.card.key?.startsWith("area:") &&
      !this.lookup.has(this.card.key.slice(5))
    )
      this.card.clear();
    if (!this.fitted && all.length) {
      this.fit();
      this.fitted = true;
    }
  }
  setTrees(trees: Feature<Point>[]) {
    this.trees = { type: "FeatureCollection", features: trees };
    (this.map.getSource("hs-trees") as GeoJSONSource | undefined)?.setData(
      this.trees,
    );
  }
  fit(area?: Neighborhood) {
    const bounds = bbox(area ?? this.areas);
    if (bounds.every(Number.isFinite))
      this.map.fitBounds(
        [
          [bounds[0], bounds[1]],
          [bounds[2], bounds[3]],
        ],
        { padding: 35, maxZoom: 15.5, duration: 0 },
      );
  }
  private describe(e: MapMouseEvent) {
    if (!this.map.getLayer("hs-points")) return null;
    const hits = this.map.queryRenderedFeatures(
      [
        [e.point.x - 4, e.point.y - 4],
        [e.point.x + 4, e.point.y + 4],
      ],
      { layers: ["hs-points"] },
    );
    const home = this.homeLookup.get(String(hits[0]?.properties?.id ?? ""));
    if (home)
      return {
        key: `home:${home.properties.id}`,
        home,
        build: () =>
          propertyContent(
            home.properties.address,
            [
              { label: "BAG-verblijfsobject", value: home.properties.id },
              {
                label: "Gebruiksoppervlakte",
                value: `${number(home.properties.area)} m²`,
              },
              { label: "Gebruiksdoel", value: home.properties.use },
              { label: "Status", value: home.properties.status },
            ],
            "Actuele BAG-registratie",
            "Geen individuele woningwaarde beschikbaar · Esc sluit",
          ),
      };
    const hit = this.map.queryRenderedFeatures(e.point, {
      layers: ["hs-fill"],
    })[0];
    const area = this.lookup.get(String(hit?.properties?.code ?? ""));
    return area
      ? {
          key: `area:${area.properties.code}`,
          area,
          build: () =>
            propertyContent(
              area.properties.name,
              [
                {
                  label: labels[this.metric],
                  value: format(metricValue(area, this.metric), this.metric),
                },
                {
                  label: "Woningvoorraad",
                  value: number(area.properties.homes),
                },
                {
                  label: "Koopwoningen",
                  value: format(area.properties.owner, "owner"),
                },
              ],
              `${area.properties.code} · CBS ${this.indicators?.[this.metric]?.year ?? 2025}`,
              this.metric === "woz"
                ? "Buurtgemiddelde · WOZ-peildatum 1 januari 2024 · geen verkoopprijs"
                : this.metric === "wozChange"
                  ? "Verandering CBS 2024 → 2025 · buurtgemiddelden, geen individuele prijsstijging"
                  : "Buurtstatistiek · geen kenmerk van een individueel adres · Esc sluit",
            ),
        }
      : null;
  }
  private hover = (e: MapMouseEvent) => {
    const hit = this.describe(e);
    this.map.getCanvas().style.cursor = hit ? "pointer" : "";
    if (hit) this.card.hover(hit.key, e.point, hit.build);
    else this.card.leave();
  };
  destroy() {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.card.destroy();
    this.map.remove();
  }
}
