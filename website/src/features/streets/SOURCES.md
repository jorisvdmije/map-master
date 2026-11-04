# Amsterdam Street Monitor — real public observations

The `/analysis/streets/` monitor uses real source records and derived spatial
indicators. It contains no generated lighting, safety, maintenance or activity
scores. A source record is not a verified physical observation on a street;
source coverage and nearest-road attribution have explicit limitations below.

## Snapshots and refresh

- Geography: all 45,870 unique NWB road segments returned for municipality
  Amsterdam, including Weesp, retrieved 2026-11-03. The [Rijkswaterstaat/PDOK OGC
  API](https://api.pdok.nl/rws/nationaal-wegenbestand-wegen/ogc/v1/collections/wegvakken?f=html)
  query was `gme_naam=Amsterdam&limit=1000`; all 46 next pages were followed.
- Lighting: all 139,978 records from the municipal [public lighting/fault-status
  API](https://api.data.amsterdam.nl/v1/docs/datasets/storingsmeldingen_ovl_en_klokken.html).
  Eligible source types are Gevel Armaturen, LSD Objecten, Grachtmast,
  Overspanning and Schijnwerpers. The 23 Laadzuilen are excluded. Importantly,
  **these are lighting OBJECTS, not verified counts of individual lamps**.
  LSD includes decorative lighting; this is not a pure functional-street-light
  inventory. The [municipal infrastructure documentation](https://api.data.amsterdam.nl/v1/docs/datasets/leidingeninfrastructuur.html)
  explains LSD as Lichtkunst, Stadsilluminatie, Decoratief. The monitor does not
  use that infrastructure dataset as another source of counts.
- Trees: all 326,538 records from [bomen/stamgegevens](https://api.data.amsterdam.nl/v1/docs/datasets/bomen.html).
  This is the municipal management register, not a census of all private trees.
- Reports: all 575,883 public [MORA records](https://api.data.amsterdam.nl/v1/docs/datasets/meldingen.html)
  with `datumMelding >= 2025-11-01` and `< 2026-11-01`. The chosen window is the
  latest twelve COMPLETE calendar months at extraction, not a partial month.
  The UI also supports its latest three months. Public categories are a subset
  of all municipal reports. Completion dates are restricted and absent from
  the response; no resolution-time analysis is claimed.

All sources were downloaded 2026-11-03. Trees and lighting status are the state
at download, not historical states for each report month. Date-of-download is
not a guarantee of how recently every asset was inspected.

Run `npm run data:streets` to refresh geography, then
`npm run data:street-observations` to rebuild counts, then rebuild the site.
The importer requests WGS84 via `Accept-Crs: EPSG:4326` and verifies the response
CRS, unique record IDs, explicit source totals, report dates, all pages and
reconciliation of accepted/rejected records. It uses 2,000-record pages for
lighting and 10,000-record pages for trees/reports (within the API's page-100
limit). Failed pages retry; a partial extraction never replaces the snapshot.
Successful source responses are cached in the OS temporary directory by URL
and download date. Delete that dated cache deliberately for a fresh same-day
re-fetch. Re-running with the cache reproduces the same source responses.

`observations.json` stores only per-NWB-segment counters and 12 monthly arrays.
`observations-meta.json` stores source URLs, queries, totals, date bounds,
matching audits and SHA-256 hashes of the ordered source page hashes. The NWB
file's SHA-256 binds counts to exact source geography. Content generation
rejects a mismatch. The browser fetches local geometry and count assets, so no
municipal key or API availability is needed by visitors. Future refreshes may
require an API key according to municipal policy.

## Spatial matching and audit

`spatial.ts` matches each source point at most ONCE to the nearest NWB segment
within 30 m. A local metre approximation is used at Amsterdam's latitude; this
is not a legal boundary/distance determination. HR/AFR/OPR road types are not
eligible. Parallel segments sharing a name compete for a single attribution;
they do not multiply the count. If the second closest DIFFERENT street name is
less than 3 m farther than the best, the point is rejected as ambiguous. Ties
inside one name are resolved deterministically. Invalid and remote points are
retained in source audits, not moved onto invented locations.

For MORA we use the PUBLIC `longitudeVisualisatie`/`latitudeVisualisatie` fields,
not unavailable original coordinates. Nearest-street results therefore remain
approximate, especially around junctions, bridges, canals and parallel paths.
NWB coverage itself is not a claim that every private path/recent change exists.

| Source | Matched | Ambiguous | Beyond radius | Invalid | Excluded type |
|---|---:|---:|---:|---:|---:|
| Lighting objects | 117,343 | 15,066 | 7,546 | 0 | 23 |
| Municipal trees | 233,458 | 22,326 | 70,730 | 24 | 0 |
| Public MORA reports | 521,398 | 32,772 | 21,710 | 3 | 0 |

These rows reconcile to each source total. Unmatched trees in parks or lighting
far from an eligible road are not necessarily data errors. Match coverage is
not coverage of all real-world objects: that denominator is unknown. Zero
matched records does not prove that no lights, trees or incidents exist.

## Street geometry and areas

`roads.json` retains original MultiLineString geometry rounded to six decimal
WGS84 coordinates, source ID, name/road label, type, source length in metres
and assigned analysis ward. One street object groups an exact source name,
including disconnected pieces; a name is not an official public-space ID.
Unnamed segments, if present, keep independent identities and are excluded
from named-street correlation/clustering.

`geometry.ts` creates ONLY the overview trace: prefer main carriageways,
sample at <=9 m, suppress nearby duplicate parts within 28 m of retained
traces in that name and join endpoints <38 m, shortest first without cycles.
Branches/components can remain multiple traces. Van Baerlestraat's 72 source
segments form one overview trace. Original geometry is retained in details
and GeoJSON. The display geometry never supplies metric denominators or
matching. Selection does not zoom; explicit controls do. Selected lines retain
their indicator/profile color and gain width, without a black outline.

The 110 area polygons reuse the [B&B permit-area snapshot](../bnb/SOURCES.md).
One representative vertex on each source segment assigns the whole segment to
an area, not clipping or length-majority assignment. There are 22 outside-area
segments. The area filter therefore refers to assigned whole segments, and
cross-boundary portions are included. Source report area labels are not silently
substituted for this different area definition.

## Indicators, denominators and colors

Raw counts are summed FIRST within the chosen street/area, then ratios are
computed. We never average segment percentages. Fewer than five known statuses
means a null fault percentage, even if a few statuses exist. Aggregation can
produce an adequate denominator from individually small segment denominators.

- `outages`: known fault statuses / known binary statuses * 100. No lux,
  perceived safety or causal interpretation.
- `lightDensity`: eligible matched lighting objects / source NWB length * 100.
- `treeDensity`: matched registered trees / source NWB length * 100. No canopy,
  shade, species diversity or private-tree inventory is inferred.
- `reports`: public MORA records in the selected 3/12 months / source NWB length
  * 100 / number of months. The raw selected total is also shown.
- `nuisance`: the same calculation for main categories starting `Overlast`.
  This is a SUBSET of reports, not an independent crime measure.
- `maintenance` arrays: raw report counts with main category
  `Wegen, verkeer, straatmeubilair`, shown as an additional subset in details.

Source NWB length counts parallel carriageways/path components separately.
The unit is explicitly **per 100 m NWB**, not unique street-centreline length.
A zero-length road has null densities. Filters select whole streets AFTER
aggregation within the chosen geography, including NWB-ID searches. A quality
or search filter never cherry-picks pieces of a street to improve its mean.

Color boundaries are illustrative application choices, not municipal standards:

| Indicator | Red | Orange | Green |
|---|---|---|---|
| Fault % | >=10 | 2–<10 | <2 |
| Lighting objects /100 m NWB | <2 | 2–<5 | >=5 |
| Trees /100 m NWB | <1 | 1–<4 | >=4 |
| Reports /100 m NWB/month | >=4 | 1–<4 | <1 |
| Nuisance /100 m NWB/month | >=1 | 0.2–<1 | <0.2 |

Grey means no adequate denominator. “At least 2 attention signals” requires
any two of fault >=10%, trees <1/100 m NWB, reports >=4/100 m NWB/month.
Unavailable fault percentages do not count as a signal. The area ranking uses
the selected indicator with pooled raw denominators and all active filters;
it is not a statistical hotspot test.

## Association, clustering and exports

Correlations weight each named street or area equally and use complete pairs.
The default minimum source length is 100 m (configurable), excluding extreme
ratios on tiny segments. Pearson requires >=3 varying pairs; Spearman uses
average tied ranks. Constant/tiny samples show no coefficient. No synthetic
activity correction remains. Log axes use log(1+x), retain zeros and change only
the display; correlation still uses original values/ranks. A raw Pearson OLS
line appears only on linear axes.

Interpretation: counts depend on reporting willingness, exposure and source
coverage. Both density axes share a length denominator, potentially inducing
associations. Nuisance is a subset of all reports, making their correlation
partly mechanical. Assets and historical reports have different time semantics.
Spatial dependence, selection and these limitations preclude naive p-values,
causal claims or intervention-effect estimates.

Citywide k-means uses lightDensity/treeDensity/reports for streets >=100 m,
log(1+x), then z-standardization, deterministic farthest-first initialization,
k=3–6 and <=60 iterations. No fault percentage is imputed. Nuisance is excluded
from fitting to avoid double-counting the report subset. Back-transformed
centres are means in log space, not arithmetic averages. Filters do not retrain;
a different report window or k does. Profile colors are categorical.

Street CSV includes every selected street's ratios and raw counts. Segment CSV
and GeoJSON retain all source segments belonging to selected streets. JSON
reports preserve source manifests, filters, period, units/metrics, minimum
length, pair/exclusion counts, coefficients, cluster settings/centres and area
statistics. All exports state that counts are spatially derived, the matching
radius, the NWB denominator and zero-count limitations. No synthetic data is
used or exported.

## Concentration maps

The heatmap is an additional `Concentraties` mode, not a replacement of street
indicators. `heat.json` is generated alongside the counters from the SAME source
responses and matching decisions. With `--from-cache`, the downloader uses the
active snapshot date and rejects any change to its counter fingerprint. No
source point is invented at a street centroid. Actual source positions are
binned to 25 × 25 metre local-grid cells, retaining a road-index attribution
and sparse monthly all/nuisance/maintenance counts. Lighting objects, known
faults and trees are stored as independent counters. A 25m cell centre is NOT
an exact individual source location. The 151,171 road/cell rows are merged by
cell after road filtering. Every topic and monthly subset reconciles exactly
to the street counters; multiple road attributions never multiply a source
record. Unmatched/ambiguous source points remain excluded as in the street
monitor. These maps therefore cover the road-linked subset, not a complete
inventory of all trees in parks or every original MORA record.

The optional 6 MB asset loads only when concentration mode is requested and is
bound to the exact `countsSha256`; content publication also checks `heatSha256`.
A missing/invalid asset presents a recoverable error without disabling the
street map. Filtered zero counts present an explicit empty state. Retained data
is cached in React state, not re-downloaded for every topic/period/filter change.

### Rendering and interpretation

- MapLibre's native Gaussian heatmap uses LINEAR source counts as weights;
  weights are not capped, logarithmized, or made equal for repeated locations.
- The smoothing radius is 100, 250 (default), or 500 metres. Its screen radius
  scales exponentially with zoom using a fixed local-latitude approximation.
  It is not a count-within-a-circle query or a statistical hotspot test.
- Intensity is calibrated against the citywide p95 of nonempty radius-sized
  bins, always using 12 months for report topics. Reference values do not depend
  on filtered streets, selected ward, viewport or the selected 3/12-month window.
  Changing topic, radius or contrast can change the scale; colors across
  different topics are not directly comparable. A sparse selection is allowed
  to remain pale rather than being silently amplified to the darkest color.
- The continuous, partly transparent amber/rust ramp (teal for trees) leaves
  empty space transparent. Colors indicate relative concentration, not a risk,
  official quality score, probability, incident rate or defect percentage.
  For percentages, use the street lighting-fault indicator separately.
- The map renders at a bounded high pixel ratio to reduce heat-texture artifacts
  on ordinary screens. The background has muted buildings and POIs. From zoom
  14 to 16.5 the heat fades smoothly into count-scaled source-cell markers.
  Selecting a marker or table row does not pan/zoom. Explicit city/selection
  controls do. The expanded map and native street/area modes remain available.
- Smoothing can extend across selected street/ward boundaries. It does not mean
  source records outside the selected set were added. KDE colors between cells
  are interpolated; cell tooltips/table show actual cell counts, not an estimate
  read from a colored pixel. The cell table provides keyboard access with
  pagination, and the map tooltip obeys follow/fixed/off settings.

The additional concentration GeoJSON exports every selected weighted 25m cell
with count, street names, cell-centre coordinates and metadata for topic,
period, radius, contrast, fixed reference, filters and source fingerprint.
Analysis JSON also preserves concentration settings. Exports describe the
aggregation resolution and do not label cell centres as individual events.

`npm run check:heatmaps` checks all topics, count/period/filter reconciliation,
failed-download recovery, camera preservation, cell-table keyboard access,
100/250/500m radii, expanded/mobile layouts and transitions to markers in
Chromium, Firefox and WebKit. `--visual` uses the real external basemap for
visual inspection; ordinary checks use a deterministic background. Screenshots
are written under `artifacts/heatmaps/`.

### Hexagon mode

`Concentraties → Hexagonen` adds a discrete count map from the same filtered
25 m source centres. Pointy-top regular hexagons use the fixed local origin
(4.9, 52.37) and metre scales (67,900, 111,200 per degree), with 100/250/500 m
width measured between parallel sides. Circumradius is width/sqrt(3), and
area is sqrt(3)/2 * width^2. Axial coordinates with cube rounding assign each
source centre exactly once. Equal-size polygons stay fixed through panning,
zooming and filtering; source-centre assignment near borders is approximate
relative to the unavailable individual positions inside a 25 m source cell.
The full hexagon is drawn even if it crosses an analysis-area boundary.
Only nonempty hexagons are drawn; absence of a polygon means no matched records
in the selected set, not proven real-world absence.

All category/month totals are conserved. Color interpolation uses raw count
against a global p95 of nonempty hexagons for the same subject and width,
always with 12 months. Filtering and viewport changes do not recalibrate it.
The legend's upper bound is ceil(reference / contrast); higher counts use the
same darkest color while retaining their actual number. Labels appear only
when hexagons are large enough on screen; the filled polygon itself is
clickable at every zoom, preserving camera position. Selected hexagons have
a light outline. Table and detail selection use the same stable IDs, which
include width so a size change cannot select a different location by accident.

Hexagon GeoJSON exports Polygon features with closed seven-position rings,
full counts, contributing street names and metadata for grid/projection,
source resolution, width, subject, period, scale, contrast and filters.
Unit checks cover conservation for every subject, equal polygon areas, widths,
point containment, invalid sizes and stable scale; browser checks cover sizes,
polygon exports, fill clicks, table access and mobile layout alongside smooth
heatmap regression checks.


### Shift radar (Verandering)

This uses the same observed monthly counters, with no additional source. For
all reports, nuisance or roads/maintenance, baseline B is the first nine
complete months and recent R the last three. For a local street count b/r and
the citywide matched totals B/R, the reference is `e = b * (R-r)/(B-b)`.
The street is excluded from its own city reference. Filters select streets but
do not retrain the reference; the 3/12-month selector does not change these
fixed 9/3 windows. A ward selection uses the assigned part of the street as the
local series and excludes precisely that part from the city reference.

The reference line for month i is `b/(B-b) * (city_i-street_i)`; baseline
reference counts sum to b. Difference is `r-e`; relative difference is
`100*(r/e-1)` when e is positive. No pseudocounts, smoothing, p-values or claims
of statistical significance are used. True zero recent counts are retained.
A zero baseline has no ratio and receives a limited-basis explanation.

Ranking requires 100 m NWB, a selected annual minimum (10/30/100, default30),
5 baseline records and 5 reference records. Exclusions are mutually exclusive,
in that order (invalid reference before the reference-count threshold). All
named streets remain in the paginated table/CSV, including limited-basis
streets and streets outside the chosen ranking direction. Nameless road
segments do not define a named street and are excluded from this analysis,
but do contribute to the full-city reference. Rankings can use absolute or
relative difference and either direction. The monthly chart, CSV and JSON
preserve raw counts, reference, windows, settings and exclusions.

This is a descriptive triage tool. One year cannot estimate repeated local
seasonality, and citywide changes may themselves combine multiple local
changes. Reporting behaviour, visitors, construction and repeated reports
are unmeasured. A decrease does not prove improvement; a spike does not prove
worsening safety. An independently observed event or source review is needed
to interpret a signal.

### Review of existing analyses

Correlations expose a raw-count comparison over exactly the same complete
pairs when both indicators are densities. Counts are also confounded by
length; this is a sensitivity check, not a correction or causal estimate.
Profile initialization sorts street IDs and stops when no distinct seed
remains; empty clusters are omitted. The UI reports convergence and
`1 - within_cluster_sum_of_squares / total_sum_of_squares` in log/z-space.
This measures compactness, increases with cluster count, and does not establish
cluster validity. Centers remain back-transformed log-space averages. Ward
filters retain the whole-city profile even when displaying only local parts.
