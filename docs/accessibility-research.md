# Accessible tasks and usability research

## Language and terms

Playground and Free analysis use English for a general technical audience. The
Amsterdam examples use Dutch throughout their research flow. Documentation and
API identifiers remain English. Imported field names and source categories are
kept as supplied by their owner. The shared workspace chooser uses the current
application's language; switching applications explicitly changes that language.

| English | Dutch | Meaning |
| --- | --- | --- |
| Feature | Object | One geometry with its properties and typed identifier |
| Area | Gebied | A polygon used for selection or spatial analysis |
| Layer | Laag | An editor layer or a named visual theme; label which one |
| Source year | Bronjaar | Year to which the published figure applies |
| Selection | Selectie | Objects included by the active conditions |
| Save project | Project bewaren | Portable project file; local saving is browser recovery |
| Export | Exporteren | A result, with source metadata; not a full editable project |

Shared application names live in `components/workspaces/navigation.tsx`. New
shared copy should use this language split rather than adding bilingual controls
inside a flow. Dates, units and missing values must remain explicit.

## Core journey without map gestures

Use the Playground for the complete property-editing journey:

1. Open or import a project with native file controls. Import failures retain the
   current document. A saved local copy can be reopened through Local projects.
2. Select a feature through the searchable feature list/table, without clicking a
   rendered map feature. The same typed ID must remain selected.
3. Read the selected feature's geometry summary and properties in the inspector.
4. Open a property field, change it and confirm. Verify its updated text value,
   then Undo and Redo. Cancellation must retain the prior value.
5. Save the editable project and export GeoJSON through native buttons. Reimport
   the download and compare the selected feature's ID and value.

For the housing example use the neighborhood list, BAG address picker, profile
and comparison tables as alternatives to map/plot clicks. Changing a selection
must move focus to its heading without zooming the map. Result tables, labels
and export metadata must explain absent values and source dates.

This defines a task contract. Automated native-control, focus and data tests are
not screenreader qualification. No screenreader participant session is recorded
for this candidate. Geometric drawing still requires the documented mouse or
vertex-keyboard workflows; it is not a complete nonvisual geometry editor.

## Screenreader qualification protocol (pending human execution)

Run the core journey with NVDA + Firefox on Windows and VoiceOver + Safari on
macOS, using the actual applications, not Playwright's WebKit. Record OS,
application versions, input device, participant experience and candidate archive
SHA-256. Use only synthetic or consented data.

For each step record: completed independently / completed with help / blocked,
spoken label and value, focus target before/after, unexpected announcement,
recovery action, and export correctness. A silent failure, lost focus, incorrect
announced value or inaccessible confirmation blocks qualification. Repeat after
fixes. Retain a consented transcript; do not claim a WCAG conformance level from
this protocol alone.

## Independent usability study (pending human execution)

Recruit at least three people unfamiliar with the app. Do not explain the UI or
suggest controls while they work. Tell them this is a test of the product.

| Task | Completion evidence | Interpretation to check |
| --- | --- | --- |
| Find a named Amsterdam neighborhood | Correct neighborhood selected | Neighborhood versus individual dwelling |
| Explain WOZ development | Explain two source years and valuation date | Averages are not sale prices or an individual valuation |
| Combine two filters | Correct intersection and count | Missing is not zero; all conditions apply together |
| Inspect an address | Select correct BAG object and identify data dates | Live registrations versus historical model values |
| Save and share a result | CSV with matching metadata, plus a view link | A view link carries settings, not imported/private datasets |
| Compare Amsterdam and Weesp Kerkstraat | Separate local street selected | No accidental sum of the two places |

Use a 10-minute task limit; note elapsed time, first action, wrong turns, help,
abandonment and participant's own explanation. After all tasks ask what was
unclear. Do not collect personal addresses, recordings or contact details without
consent. Prioritise every incorrect interpretation of source meaning even when
the task technically completed.

Copy this row for every participant/task:

| Candidate hash | Participant code | Task | Outcome | Time | Wrong interpretation | Blocker | Proposed change | Retest |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pending | pending | pending | not run | — | unknown | unknown | after observation | pending |

The table is intentionally empty of results. Maintainers must recruit people and
run the sessions before closing the human-research feedback items.
