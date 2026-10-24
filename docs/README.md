# Documentation

The editor is experimental. Public usage and internal implementation are described
separately so consumers can integrate without depending on internal modules.

| Goal | Guide |
| --- | --- |
| Set up a MapLibre host and use the editor | [GeometryEditor API](geometry-editor.md), [integration setup](line-editor.md#integrate) |
| Apply atomic create/update/delete batches | [Transactions and event semantics](transactions.md) |
| Import and edit multipart lines/polygons | [Multipart geometry](multipart.md) |
| Edit two adjoining polygons together | [Shared boundaries](shared-boundaries.md) |
| Follow existing edges while drawing | [Boundary tracing](tracing.md) |
| Replace part of a polygon boundary | [Polygon reshape](reshape.md) |
| Keep the common area of selected polygons | [Polygon intersection](intersection.md) |
| Merge selected polygons | [Polygon union](union.md) |
| Subtract cutting polygons from a target | [Polygon difference](difference.md) |
| Split a supported polygon | [Polygon splitting](splitting.md) |
| Maintain an older line-only integration | [LineEditor compatibility facade](line-editor.md) |
| Locate code for a change | [Code map and walkthrough](code-walkthrough.md) |
| Understand ownership and dependency rules | [Current architecture](architecture.md) |
| Add or review a capability | [Contribution workflow](../CONTRIBUTING.md) |
| Reproduce performance measurements | [Performance baselines and limits](performance.md) |
| See what is implemented and planned | [Incremental roadmap](roadmap.md) |

Start development with `npm ci` and `npm run dev` from the repository root.
Install Chromium with `npx playwright install chromium` before browser testing.
Run `npm run check` before committing code changes; it includes type checks,
architectural lint rules, core/package/browser tests and the demo build.
