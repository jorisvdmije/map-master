# Gebiedsrapport Amsterdam

`/area-report/` combines the existing, fingerprinted [housing snapshot](../housing/SOURCES.md)
with optional point queries. No new statistical data is invented or interpolated.
CBS indicators keep their own table year, reference year, definition, suppression
and source URL. Counts and geometry use CBS 2025. The displayed polygon area is
computed geodesically, includes water, and is not a CBS land-area statistic.

Address search uses the official [PDOK Locatieserver](https://www.pdok.nl/pdok-locatieserver)
`/bzk/locatieserver/search/v3_1/free`, restricted to `type:adres AND gemeentecode:0363`.
The user chooses a returned address; no first-result guessing is used. Its WGS84
point is intersected locally with the snapshot's 2025 CBS geometry, rather than
joining a current geocoder buurtcode to an older geometry. Multiple matches on
a boundary require an explicit choice. No match keeps the existing report intact.

For a neighborhood selection, a scan line through its geometry supplies an
example location, with holes excluded and multipart areas supported. This is
explicitly not a representative measurement, verified address or accessible
departure point. Shared links contain the buurtcode and coordinates; after reload
these are labelled as a shared point, not a re-verified address. A shared point
outside the chosen polygon is discarded in favor of the labelled example point.

Live sources are requested only after pressing the fetch button, independently:

- Municipal tree registrations within a 250 m geodesic radius using the existing
  `nearbyTrees` adapter. Not tree canopy, all private trees or total neighborhood
  greenery. Registry year is unknown, with the retrieval time recorded separately.
- The existing RIVM Lden raster adapter: map 2022, constituent source years
  2022–2025. Null model cells stay unknown. Not a facade measurement.
- Existing Valhalla provider and validated reachability service, 15 minutes
  cycling from the point. Displayed area is the geodesic area of the cumulative
  contour, not a radius or a count of amenities. Attribution and calculation time
  remain in the UI and JSON. No traffic guarantee or verified OSM observation year.

Queries are keyed by coordinates. Changing areas/addresses never reuses another
point's results. Errors remain independent and successful previous results keep
their timestamps and explicit `stale-after-error` status in the report export.
The JSON envelope contains all source data and status; CSV intentionally contains
only the 25 CBS indicators and definitions. Print CSS supports saving the visible
report as a PDF through the browser print dialog.

Validation: `npm run test:area-report` tests all snapshot geometries, holes and
boundaries, identifiers, years, nulls, exports and address contracts.
`npm run check:area-report` tests exported HTML and browser flows with the real
local CBS snapshot and deterministic network fixtures; this is not a live-source
availability claim. Source endpoints can independently be unavailable in use.
