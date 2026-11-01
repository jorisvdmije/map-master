# React, Vue, Svelte and Angular

Map Master has no framework dependency. Create the map and editor when the
component mounts, and destroy them when it unmounts. These examples use the
[toolbar](toolbar.md), report the feature count to the component, and save every
change. Each needs `maplibre-gl/dist/maplibre-gl.css`, and a map container with a
height.

Two rules apply everywhere:

- Create the editor after the map's `load` event, and only in the browser. In
  Next.js, Nuxt or SvelteKit, render the map component on the client only.
- Remove the map on unmount. Removing the map destroys the editor and its toolbar.

## React

```tsx
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { EditorToolbar, GeometryEditor, type GeometryFeatureCollection } from '@jorisvdmije/map-master';
import 'maplibre-gl/dist/maplibre-gl.css';

export function MapEditor({ data, onSave }: {
  data: GeometryFeatureCollection;
  onSave: (data: GeometryFeatureCollection) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  // The editor lives as long as the map; read the latest callback through a ref.
  const save = useRef(onSave);
  save.current = onSave;

  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [4.8679, 52.3579],
      zoom: 15,
    });
    map.on('load', () => {
      const editor = new GeometryEditor(map, { snapping: { enabled: true } });
      map.addControl(new EditorToolbar(editor), 'top-left');
      editor.importGeoJSON(data);
      editor.clearHistory();
      editor.onChange((state) => { setCount(state.featureCount); });
      editor.onDataChange(() => { save.current(editor.exportGeoJSON()); });
      setCount(editor.getState().featureCount);
    });
    return () => { map.remove(); };
    // Load the data once; later changes come from the editor itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div ref={container} style={{ height: 480 }} />
      <p>{count} features</p>
    </>
  );
}
```

In React's development mode, Strict Mode mounts effects twice. The cleanup removes
the first map, so the second mount starts cleanly.

For Next.js, load the component without server rendering:

```ts
import dynamic from 'next/dynamic';

const MapEditor = dynamic(() => import('./MapEditor').then((m) => m.MapEditor), { ssr: false });
```

## Vue

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import maplibregl from 'maplibre-gl';
import { EditorToolbar, GeometryEditor, type GeometryFeatureCollection } from '@jorisvdmije/map-master';
import 'maplibre-gl/dist/maplibre-gl.css';

const props = defineProps<{ data: GeometryFeatureCollection }>();
const emit = defineEmits<{ save: [data: GeometryFeatureCollection] }>();
const container = ref<HTMLDivElement>();
const count = ref(0);
// Keep MapLibre objects out of Vue's deep reactivity.
const map = shallowRef<maplibregl.Map>();

onMounted(() => {
  map.value = new maplibregl.Map({
    container: container.value!,
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [4.8679, 52.3579],
    zoom: 15,
  });
  map.value.on('load', () => {
    const editor = new GeometryEditor(map.value!, { snapping: { enabled: true } });
    map.value!.addControl(new EditorToolbar(editor), 'top-left');
    editor.importGeoJSON(props.data);
    editor.clearHistory();
    editor.onChange((state) => { count.value = state.featureCount; });
    editor.onDataChange(() => { emit('save', editor.exportGeoJSON()); });
    count.value = editor.getState().featureCount;
  });
});
onBeforeUnmount(() => { map.value?.remove(); });
</script>

<template>
  <div ref="container" style="height: 480px" />
  <p>{{ count }} features</p>
</template>
```

In Nuxt, wrap the component in `<ClientOnly>`.

## Svelte

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import { EditorToolbar, GeometryEditor, type GeometryFeatureCollection } from '@jorisvdmije/map-master';
  import 'maplibre-gl/dist/maplibre-gl.css';

  let { data, onsave }: { data: GeometryFeatureCollection; onsave: (data: GeometryFeatureCollection) => void } = $props();
  let container: HTMLDivElement;
  let count = $state(0);

  onMount(() => {
    const map = new maplibregl.Map({
      container,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [4.8679, 52.3579],
      zoom: 15,
    });
    map.on('load', () => {
      const editor = new GeometryEditor(map, { snapping: { enabled: true } });
      map.addControl(new EditorToolbar(editor), 'top-left');
      editor.importGeoJSON(data);
      editor.clearHistory();
      editor.onChange((state) => { count = state.featureCount; });
      editor.onDataChange(() => { onsave(editor.exportGeoJSON()); });
      count = editor.getState().featureCount;
    });
    return () => map.remove();
  });
</script>

<div bind:this={container} style="height: 480px"></div>
<p>{count} features</p>
```

`onMount` only runs in the browser, so this also works with SvelteKit's server
rendering.

## Angular

Add `node_modules/maplibre-gl/dist/maplibre-gl.css` to the `styles` of your project
in `angular.json`.

```ts
import { Component, ElementRef, EventEmitter, Input, NgZone, OnDestroy, Output, ViewChild, signal, type AfterViewInit } from '@angular/core';
import maplibregl from 'maplibre-gl';
import { EditorToolbar, GeometryEditor, type GeometryFeatureCollection } from '@jorisvdmije/map-master';

@Component({
  selector: 'app-map-editor',
  standalone: true,
  template: `<div #map style="height: 480px"></div><p>{{ count() }} features</p>`,
})
export class MapEditorComponent implements AfterViewInit, OnDestroy {
  @ViewChild('map') container!: ElementRef<HTMLDivElement>;
  @Input({ required: true }) data!: GeometryFeatureCollection;
  @Output() save = new EventEmitter<GeometryFeatureCollection>();
  count = signal(0);
  private map?: maplibregl.Map;

  constructor(private zone: NgZone) {}

  ngAfterViewInit(): void {
    // Map rendering does not need change detection on every frame.
    this.zone.runOutsideAngular(() => {
      this.map = new maplibregl.Map({
        container: this.container.nativeElement,
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [4.8679, 52.3579],
        zoom: 15,
      });
      this.map.on('load', () => {
        const editor = new GeometryEditor(this.map!, { snapping: { enabled: true } });
        this.map!.addControl(new EditorToolbar(editor), 'top-left');
        editor.importGeoJSON(this.data);
        editor.clearHistory();
        editor.onChange((state) => { this.count.set(state.featureCount); });
        editor.onDataChange(() => { this.zone.run(() => { this.save.emit(editor.exportGeoJSON()); }); });
        this.count.set(editor.getState().featureCount);
      });
    });
  }

  ngOnDestroy(): void { this.map?.remove(); }
}
```

## Your own controls

The toolbar is optional. To build the controls in your framework instead, keep
`editor.getState()` in component state from an `onChange` listener and call the
editor's methods from your buttons; see [Drawing](../website/content/draw.md) and the
[GeometryEditor reference](geometry-editor.md).
