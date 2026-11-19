# Reachability contours

Reachability contours (isochrones) describe an estimated network travel time from
or to an origin. They are **not circles** or straight-line buffers. The library
provides a renderer-independent asynchronous boundary, a Valhalla adapter, validated
cumulative GeoJSON, and non-overlapping display bands. MapLibre and Mapbox share
the same exports. No request changes an editor, camera, selection or Undo history.

[Open the interactive example](/analysis/reachability/).

```ts
import { calculateReachability, createValhallaProvider } from '@jorisvdmije/map-master';

const controller = new AbortController();
const provider = createValhallaProvider({
  endpoint: 'https://your-routing-server.example/isochrone',
  clientId: 'your-app',
});
const result = await calculateReachability(provider, {
  origin: [4.904, 52.367],
  profile: 'cycling',
  minutes: [5, 10, 15],
  direction: 'from',
}, { signal: controller.signal });

// Render result.bands. Count against/export result.contours.
// Import explicitly when contours should become editable, as one Undo step:
editor.importGeoJSON(result.contours);
```

## Request and response

- `origin`: `[longitude, latitude]`; longitude within ±180, latitude within ±85.
- `profile`: `walking`, `cycling`, `e-bike` or `driving`.
- `minutes`: one to four distinct, positive budgets, at most 60 minutes; sorted in
  the result without changing the caller's input.
- `direction`: `from` (default), or `to` for inverse reachability. These can differ
  with one-way roads and access restrictions.
- The optional `signal` cancels the request. Aborted results cannot be published.

`ReachabilityResult` contains `request`, `provider`, `attribution`, `calculatedAt`,
`contours` and `bands`. Every contour carries minutes, profile, origin, direction,
provenance and spherical `areaSquareMetres`. Cumulative contours contain their
interior; do not add their counts or areas together. `bands` subtracts all smaller
contours to avoid stacked opacity. Empty display bands are omitted. Contour IDs
are stable within a result, such as `reachability-5`; avoid duplicate IDs when
appending multiple results to one editor.

Incomplete budgets, unsupported geometry, invalid topology, missing attribution
and oversized responses fail as a whole with `ReachabilityError`. The Valhalla
adapter normalizes grid-boundary revisits with a geometric union before the strict
GeoJSON import validates the area. It does not replace failed routing with circles.

Contours must be **strictly nested by travel-time budget**: the complete area of
each smaller contour must be contained in the next contour, including every
island and excluding the next contour's holes. Shared boundaries and identical
contours are valid. Any positive-area portion outside the later contour, including
a small model discrepancy, rejects the whole response with `invalid-response`;
the error identifies both budgets. There is no area-percentage tolerance, since
even a narrow sliver can change a location count. Contours are never enlarged by
combining travel-time budgets. The Valhalla adapter's union only normalizes parts
within a single contour; it does not repair nesting between budgets.

## Hosting and custom providers

`createValhallaProvider` requires an explicit endpoint and client identifier. It
supports injected `fetch` and custom headers. Each request has a 30-second timeout.
Its e-bike option uses Valhalla's bicycle model with 25 km/h cycling speed; this
is a model assumption, not an electric-bike-specific legal routing guarantee.

A custom `ReachabilityProvider` receives the normalized request and `{ signal }`,
and returns `{ data, provider, attribution }`. Its `data` is a FeatureCollection
with exactly one Polygon/MultiPolygon per budget and `properties.minutes`.
Credentials belong in the host application or a server-side proxy, not exports.

The website example uses the public FOSSGIS Valhalla demo for small, explicit
requests. Configure `NEXT_PUBLIC_VALHALLA_ENDPOINT` to use your own service; this
value is public. There is no continuous recalculation while dragging or changing
controls. The UI records which parameters produced the displayed result, supports
cancellation, and labels changed inputs as not yet calculated.

Coordinate fields retain incomplete text while editing and accept a decimal dot
or comma. Only a valid longitude/latitude pair updates the map origin; calculation
is disabled until both fields are valid. Empty, missing or invalid URL coordinate
pairs use the Amsterdam default; explicit `lng=0&lat=0` remains a valid origin.

The public demo has rate limits and no availability guarantee. Its maintainers
ask public application publishers to notify them via GitHub Discussions and send
`X-Client-Id`. Before production deployment, follow that policy or configure your
own server. The library never sends a message to a service maintainer for you.

## Example analysis

The example can load up to 20,000 validated GeoJSON objects. Counts use the same
point/boundary/intersection rules as the free analysis: an object touching a
contour counts once per cumulative contour, with no area weighting. No population
estimate is invented from intersected neighborhood totals. Export the contours
and import them as areas in the free analysis to explore further attributes.

The **Meetlijn tekenen** tool uses the editor's real geodesic line measurements
with `measurements.lineStyle: 'along-line'`. The distance is the length of the
drawn line, independent of routed travel time. It follows the current map bearing
and pitch and stays upright. Only explicit zoom controls move the camera.

Sources: [Valhalla isochrone API](https://valhalla.github.io/valhalla/api/isochrone/),
[public demo policy](https://valhalla.github.io/valhalla/#demo-server), and
[OpenStreetMap copyright](https://www.openstreetmap.org/copyright).
