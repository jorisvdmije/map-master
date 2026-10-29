# Bring your own GeoJSON

Import a collection, edit its geometry and download the result. Map Master validates the complete import before changing the document, so one bad feature cannot leave a half-imported dataset.

[[demo:geojson]]

## Try it

1. The sample garden and walking route are already loaded.
2. Choose **Import GeoJSON** to append the meeting point from the input field.
3. Select any feature on the map or in the feature list, then edit it.
4. Choose **Download GeoJSON** to save the current committed collection.

Importing the same ID twice is rejected. Change the input ID or use **Reset** before importing it again. Malformed input displays an error and leaves the current document intact.

## Import is an append operation

```ts
const collection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "meeting-point",
      properties: { name: "Meeting point" },
      geometry: { type: "Point", coordinates: [4.9017, 52.36934] },
    },
  ],
};

editor.importGeoJSON(collection);
```

The input is validated at runtime. Preserve stable IDs in your own data so you can identify features across edits and persistence. User properties are preserved, and returned snapshots are independent copies.

## Export committed geometry

```ts
const collection = editor.exportGeoJSON();
const json = JSON.stringify(collection, null, 2);

const url = URL.createObjectURL(
  new Blob([json], {
    type: "application/geo+json",
  }),
);
const link = document.createElement("a");
link.href = url;
link.download = "geometry.geojson";
link.click();
setTimeout(() => URL.revokeObjectURL(url), 1000);
```

Export does not include unfinished drafts, selection state or history. Save or cancel edits before presenting a workflow that promises to export all visible changes.

## Handle invalid input

```ts
try {
  editor.importGeoJSON(JSON.parse(textFromYourInput));
} catch (error) {
  // Show this as text in your UI. Existing geometry is unchanged.
  messageElement.textContent =
    error instanceof Error ? error.message : "The data could not be imported.";
}
```

## Connect persistent storage

Your application can send the exported collection to its own API or store it locally. It must handle authentication, concurrent edits, save failures and recovery. The [standalone workspace example](../../docs/beta.md) demonstrates these concerns for browser-local storage.

See the [GeometryEditor reference](../../docs/geometry-editor.md) for supported geometries and the [multipart guide](../../docs/multipart.md) for imported MultiLineString and MultiPolygon data.
