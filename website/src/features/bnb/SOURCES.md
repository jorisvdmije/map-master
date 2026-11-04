# B&B example data

`wards.json` contains exactly the **110 permit-area polygons** used by the
[City of Amsterdam B&B map](https://kaart.amsterdam.nl/vergunningen-bed-breakfast),
read from its public layer endpoints on 2026-11-03:

- [10503: Beschikbaar](https://kaart.amsterdam.nl/api/layers/10503.json): 68 areas.
- [10504: Beperkt beschikbaar](https://kaart.amsterdam.nl/api/layers/10504.json): 20 areas.
- [10505: Niet beschikbaar](https://kaart.amsterdam.nl/api/layers/10505.json): 22 areas.

These are the smaller **vergunningswijken**, not the nine city districts used by
an earlier example. Source feature identifiers and titles are retained as `code`
and `name`. WGS84 longitude/latitude coordinates are rounded to six decimals.
Each feature also has an interior `anchor` derived from its polygon for demo
point generation, and its source category for traceability. The source categories
are **not** used as invented exact quota counts or live availability in this UI.
The local snapshot works without a live API or credentials.

The [municipal B&B dataset](https://api.data.amsterdam.nl/v1/docs/datasets/vergunningen.html)
provides availability categories per wijk, not the full licensed-address register,
individual application data or exact quota/issued/pending counts used here.
All counts, permit records, locations, guest capacities and processing ages in
`model.ts` are therefore **simulated** with a fixed seed and explicitly identified
as such. No point is geocoded to an actual B&B address; every generated location
is contained in its ward. The scenario date is fixed at 2026-11-03. The 42-day
queue signal is a demo threshold, not a legal processing deadline.

Current free capacity excludes pending applications. The forecast assumes they
are all granted within their own ward, clamps each ward to zero and sums the
results. Capacity cannot be transferred between wards. Location filters do not
change quota statistics. CSV/GeoJSON exports mark permit data as fictitious.

Following properties are created with text nodes (not HTML strings), stay within
the map, ignore pointer events and hide on pointer leave, navigation and Escape.
Users can choose following, centered hover, click-only centered properties or
o card. Clicked cards accept text selection/scrolling, stay in the center during
map navigation/resizing, and close with their button or Escape. Marker selection
no longer changes the camera. A click/tap works without any preceding hover.


Queue medians pool individual pending application ages; missing ages are not
zeros, and city medians are not averages of ward medians. These ages describe
the current fictitious queue, not the duration of completed applications.
Capacity ranking can compare absolute free permits or free share of each
ward's quota, for the currently selected scenario. The scenario and denominator
remain explicit; quotas never move between wards.
