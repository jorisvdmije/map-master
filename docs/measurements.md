# Measurements

The editor can show live lengths and areas on the map while users draw and edit,
and for the selected feature. Turn it on with an option, the **Measurements** button
of the [toolbar](toolbar.md), or at run time:

```ts
const editor = new GeometryEditor(map, { measurements: { enabled: true } });

editor.setMeasurements({ units: 'imperial' }); // ft, mi, ft², ac, mi²
editor.setMeasurements({ locale: 'nl' });      // "1,5 km"
editor.setMeasurements({ enabled: false });
```

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Show the labels. |
| `units` | `'metric'` | `'metric'` uses m, km, m², ha and km². `'imperial'` uses ft, mi, ft², ac and mi². |
| `locale` | `'en'` | Language tag for number formatting, such as `'de'` or `'nl'`. |
| `lineStyle` | `'badge'` | Optional `'along-line'` places an unboxed, white-halo length label on the selected line and follows its direction. Labels stay upright when the camera rotates. |

`getMeasurements()` returns the current options. Invalid values throw a `TypeError`;
a malformed locale throws a `RangeError`.

```ts
editor.setMeasurements({ enabled: true, locale: 'nl', lineStyle: 'along-line' });
```

The midpoint follows half the geodesic length of the longest component, rather
than the centre of its bounding box. Multipart labels still report the total
length of all components. Drawing-segment labels can use the same line style.
Polygon measurements retain their horizontal badges. The Playground exposes this
setting as **Line labels → Along the line**, and saves it in the project file.

## What is shown

| Situation | Labels |
| --- | --- |
| Drawing a line | The length of every segment, and the total length at the pointer. |
| Drawing a polygon, hole, cut or part | Segment lengths, and the area and perimeter in the middle. |
| Drawing a rectangle | The length of each side, and the area and perimeter. |
| Drawing a circle | The area and the radius, at the center. |
| Editing a line or polygon | The total length, or the area and perimeter. |
| Rotating, scaling, buffering, offsetting or simplifying one feature | The size of the preview. |
| One line or polygon selected | Its length, or its area and perimeter. |

Segments shorter than 64 screen pixels get no label, so small shapes stay readable.
Markers have no size and get no label.

The labels are HTML elements in the map container, so they work with every map
style, including styles without fonts. Restyle them with these custom properties or
the `.mm-measurement` class:

```css
.maplibregl-map {
  --mm-measurement-background: #1f2937;
  --mm-measurement-color: #fff;
  --mm-measurement-muted: #d1d5db;
}
```

## Measure in your own code

`measure()` returns the length, area and perimeter of any geometry, for example to
store the area with a feature or to check a maximum size:

```ts
import { formatArea, measure } from '@jorisvdmije/map-master';

editor.onDataChange(({ changes }) => {
  for (const { after } of changes) {
    if (!after || after.geometry.type === 'Point') continue;
    const { area, length } = measure(after.geometry);
    console.log(after.id, area > 0 ? formatArea(area, 'metric', 'nl') : `${Math.round(length)} m`);
  }
});
```

| Function | Returns |
| --- | --- |
| `measure(geometry)` | `{ length, area, perimeter }` in meters and square meters. Lines have a length; polygons have an area (holes subtracted) and a perimeter (holes included); markers return zeros. |
| `formatDistance(meters, units?, locale?)` | Text such as `"812 m"`, `"1.23 km"` or `"328 ft"`. |
| `formatArea(squareMeters, units?, locale?)` | Text such as `"512 m²"`, `"2.45 ha"` or `"10 ac"`. |

All measurements are geodesic, on a sphere with the mean Earth radius of
6,371,008.8 m. They differ from ellipsoidal measurements by less than 0.5%, which
is accurate enough for display and plausibility checks, but not for cadastral or
legal surveys.
