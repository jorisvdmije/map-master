import mapboxgl from 'mapbox-gl';
import { DataLayerControl, EditorToolbar, GeometryEditor } from '@jorisvdmije/map-master/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';

const setup = document.querySelector<HTMLParagraphElement>('#setup')!;
const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;
if (!token) {
  setup.textContent = 'To run this Mapbox example, set VITE_MAPBOX_ACCESS_TOKEN in your environment and restart npm run dev. Use your Mapbox public access token. The MapLibre playground works without a token.';
} else {
  setup.hidden = true; document.querySelector('main')!.hidden = false;
  const map = new mapboxgl.Map({
    container: 'map', accessToken: token,
    style: 'mapbox://styles/mapbox/streets-v12',
    projection: 'mercator', center: [4.895, 52.372], zoom: 14,
  });
  const status = document.querySelector<HTMLParagraphElement>('#status')!;
  map.on('error', () => { status.textContent = 'The map could not load a resource. Check the access token and network connection.'; });
  map.once('load', () => {
    const editor = new GeometryEditor(map, {
      snapping: { enabled: true },
      dataLayers: { layers: [{ id: 'parcels', name: 'Parcels' }, { id: 'notes', name: 'Notes' }], activeLayerId: 'parcels' },
    });
    map.addControl(new EditorToolbar(editor), 'top-left');
    map.addControl(new DataLayerControl(editor), 'top-right');
    const update = () => {
      status.textContent = `${editor.getState().featureCount} features · ${editor.getState().mode}`;
      document.querySelector<HTMLTextAreaElement>('#geojson')!.value = JSON.stringify(editor.exportGeoJSON(), null, 2);
    };
    editor.onChange(update); update();
    const reload = document.querySelector<HTMLButtonElement>('#reload')!;
    const reloadStyle = () => { map.setStyle('mapbox://styles/mapbox/streets-v12', { diff: false, localFontFamily: null, localIdeographFontFamily: 'sans-serif' }); };
    reload.addEventListener('click', reloadStyle);
    map.once('remove', () => { reload.removeEventListener('click', reloadStyle); });
  });
  const cleanup = () => { map.remove(); };
  window.addEventListener('pagehide', cleanup, { once: true });
  import.meta.hot?.dispose(() => { window.removeEventListener('pagehide', cleanup); map.remove(); });
}
