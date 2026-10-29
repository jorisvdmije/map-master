# Your first editable map

Create a MapLibre map, attach one editor and let your users draw. This complete Vite example uses a plain background, so you can start without a basemap account or API key.

## 1. Install the packages

Use Node.js 22.13+ within Node 22, or Node 24. Start in an empty directory:

```sh
mkdir my-map
cd my-map
npm init -y
npm install @jorisvdmije/map-master@0.1.0-beta.0 maplibre-gl@6.15.0
npm install --save-dev vite@8.3.5 typescript@6.0.3
```

MapLibre renders the map. Map Master adds geometry editing. These versions match the published beta's tested integration.

> The API is experimental. Pin the exact beta while integrating. npm currently also assigns this beta to `latest`; that is not a stable-release guarantee.

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
    <nav aria-label="Geometry tools">
      <button id="draw" disabled>Draw polygon</button>
      <button id="finish" disabled>Finish</button>
      <button id="cancel" disabled>Cancel</button>
      <button id="undo" disabled>Undo</button>
    </nav>
    <p id="status" role="status">Loading the map…</p>
    <div id="map" aria-label="Editable map"></div>
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
nav {
  display: flex;
  gap: 8px;
  padding: 12px;
}
button {
  padding: 8px 12px;
}
#status {
  margin: 0 12px 12px;
}
#map {
  width: 100%;
  height: 70vh;
  min-height: 300px;
}
```

## 3. Attach the editor

Create `main.ts`:

```ts
import { Map, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { GeometryEditor } from "@jorisvdmije/map-master";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

// MapLibre 6 serves its worker separately. Vite resolves this URL.
setWorkerUrl(workerUrl);

const draw = document.querySelector<HTMLButtonElement>("#draw")!;
const finish = document.querySelector<HTMLButtonElement>("#finish")!;
const cancel = document.querySelector<HTMLButtonElement>("#cancel")!;
const undo = document.querySelector<HTMLButtonElement>("#undo")!;
const status = document.querySelector<HTMLElement>("#status")!;

const map = new Map({
  container: "map",
  center: [4.9, 52.37],
  zoom: 14,
  style: {
    version: 8,
    sources: {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#eef1e9" },
      },
    ],
  },
});

let editor: GeometryEditor | undefined;
map.on("error", () => {
  status.textContent = "The map could not load.";
});
map.once("load", () => {
  editor = new GeometryEditor(map, {
    snapping: { enabled: true, distance: 16 },
  });
  const tool = editor;
  const update = () => {
    const state = tool.getState();
    draw.disabled = state.mode !== "idle";
    finish.disabled = !state.canFinish;
    cancel.disabled = state.mode === "idle";
    undo.disabled = !state.canUndo;
    status.textContent = state.validationError
      ? `Draft: ${state.validationError}`
      : `${state.featureCount} features · ${state.mode}`;
  };

  draw.onclick = () => {
    tool.draw("Polygon");
  };
  finish.onclick = () => {
    tool.finish();
  };
  cancel.onclick = () => {
    tool.cancel();
  };
  undo.onclick = () => {
    tool.undo();
  };
  tool.onChange(update);
  update();
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

Attach the editor after the map loads. Keep one editor per map. Your application owns the toolbar, basemap and map lifecycle; the editor owns geometry and editing interactions.

## 4. Draw your first polygon

Start the development server:

```sh
npx vite --host 127.0.0.1
```

Open the URL Vite prints. Choose **Draw polygon**, click at least three corners and select **Finish**. Use **Cancel** to discard a draft and **Undo** to remove a committed shape. Clicking an existing shape selects it.

When the map has keyboard focus, **Enter** finishes and **Escape** cancels. Invalid polygons cannot be committed; the status text explains the validation result.

## 5. Take your data with you

After the editor is ready, `editor.exportGeoJSON()` returns a copy of committed geometry. Unfinished drafts are excluded. Your application decides whether to download it, store it locally or send it to a server.

Try the [import and export example](geojson.md), then explore [editing and Undo](edit.md) and the [complete API](../../docs/geometry-editor.md).

## Before integrating

- Serve your app over HTTPS or localhost; new feature IDs require a secure context.
- Coordinates are `[longitude, latitude]` in 2D WGS84. Review the supported geometry and projection limits.
- Use a basemap style of your choice in place of the plain background; its licensing and access requirements are separate.
- This quickstart uses Vite. Other bundlers must also serve and configure the MapLibre worker.
- Read [compatibility and performance scope](../../docs/beta-budgets.md) before promising support for a browser, device or large dataset.
