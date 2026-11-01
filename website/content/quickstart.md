# Your first editable map

Create a MapLibre map, add the editor and its toolbar, and let your users draw. This complete Vite project uses [OpenFreeMap](https://openfreemap.org/), a free OpenStreetMap basemap, so you can start without an account or API key.

## 1. Install the packages

Use Node.js 22.13+ within Node 22, or Node 24. Start in an empty directory:

```sh
mkdir my-map
cd my-map
npm init -y
npm install @jorisvdmije/map-master maplibre-gl
npm install --save-dev vite@8.3.5 typescript@6.0.3
```

MapLibre renders the map; Map Master adds the editing tools.

## 2. Give the map a home

Create `index.html` in your project directory:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My editable map</title>
  </head>
  <body>
    <div id="map" aria-label="Editable map"></div>
    <p id="status" role="status">Loading the map…</p>
    <script type="module" src="/main.ts"></script>
  </body>
</html>
```

Create `style.css`. A map needs an explicit height:

```css
body {
  margin: 0;
  font:
    14px system-ui,
    sans-serif;
}
#map {
  height: calc(100vh - 40px);
  min-height: 300px;
}
#status {
  margin: 0;
  padding: 10px 12px;
}
```

## 3. Attach the editor

Create `main.ts`:

```ts
import { Map, NavigationControl, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { EditorToolbar, GeometryEditor } from "@jorisvdmije/map-master";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

// MapLibre 6 serves its worker separately. Vite resolves this URL.
setWorkerUrl(workerUrl);

const status = document.querySelector<HTMLElement>("#status")!;
const map = new Map({
  container: "map",
  // Free OpenStreetMap vector tiles; no account or API key.
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: [4.8679, 52.3579],
  zoom: 16,
});
map.addControl(new NavigationControl(), "bottom-right");

let editor: GeometryEditor | undefined;
map.once("load", () => {
  const tool = new GeometryEditor(map, { snapping: { enabled: true } });
  editor = tool;
  // Buttons for drawing, editing, geometry tools and Undo/Redo.
  map.addControl(new EditorToolbar(tool), "top-left");

  tool.onChange((state) => {
    const count = `${state.featureCount} ${state.featureCount === 1 ? "feature" : "features"}`;
    status.textContent = state.mode === "idle" ? count : `${count} · ${state.mode}`;
  });
  tool.onDataChange(({ source, changes }) => {
    // Every committed change arrives here: save it to your backend.
    console.log(source, changes);
  });
  status.textContent = "Choose a tool in the toolbar.";
});

// In a component-based app, do this when the component unmounts.
window.addEventListener(
  "pagehide",
  () => {
    editor?.destroy();
    map.remove();
  },
  { once: true },
);
```

Attach the editor after the map loads and keep one editor per map. Your application owns the map, the basemap and your data; the editor owns geometry and the editing interactions.

## 4. Draw your first polygon

Start the development server:

```sh
npx vite --host 127.0.0.1
```

Open the URL Vite prints. Choose the polygon tool in the toolbar, click at least three corners and choose **Finish** beside the button. **Cancel** discards the draft and **Undo** removes a committed shape. Click a shape to select it; the editing tools in the toolbar turn on when the selection qualifies.

When the map has keyboard focus, **Enter** finishes and **Escape** cancels. Invalid polygons cannot be committed.

## 5. Take your data with you

`editor.onDataChange` reports every committed change, and `editor.exportGeoJSON()` returns a copy of all committed geometry; unfinished drafts are excluded. Your application decides whether to download it, store it locally or send it to a server. [Saving and loading data](../../docs/persistence.md) shows the patterns.

Try the [import and export example](geojson.md), then explore [editing and Undo](edit.md) and the [complete API](../../docs/geometry-editor.md).

## Before integrating

- Serve your app over HTTPS or localhost; new feature IDs require a secure context.
- Coordinates are `[longitude, latitude]` in 2D WGS84. Review the supported geometry and projection limits.
- OpenFreeMap is free and needs no key. For heavy production traffic, consider hosting tiles yourself or using a commercial provider, and keep the OpenStreetMap attribution visible.
- Prefer your own buttons? The [toolbar guide](../../docs/toolbar.md) shows how to choose or translate its buttons, and [drawing](draw.md) shows how to wire your own UI.
- This quickstart uses Vite. Other bundlers must also serve and configure the MapLibre worker.
- Read [compatibility and limits](../../docs/compatibility.md) before promising support for a browser, device or large dataset.
