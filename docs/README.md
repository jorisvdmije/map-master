# Documentation

The editor is experimental. Public usage and internal implementation are described
separately so consumers can integrate without depending on internal modules.

| Goal | Guide |
| --- | --- |
| Follow the initial history import and protected-branch workflow | [Repository integration](repository-integration.md) |
| Use the playground controls, direct examples and step-by-step guide | [Playground workflows](playground-workflow.md) |
| Run a standalone installed-package app with saving and recovery | [Beta integration milestone](beta.md) |
| Protect reference geometry from editing while retaining snapping | [Feature locks](feature-locks.md) |
| Check beta browser/input scope and performance gates | [Beta budgets](beta-budgets.md) |
| Prepare and verify a public beta candidate | [Release procedure](releases.md), [changelog](../CHANGELOG.md), [migration policy](migration.md) |
| Find the license or report a vulnerability | [MIT license](../LICENSE), [third-party notices](../THIRD_PARTY_NOTICES.md), [security policy](../SECURITY.md) |
| Customize colors, outlines, previews and editing markers | [Editor appearance](appearance.md) |
| Set up a MapLibre host and use the editor | [GeometryEditor API](geometry-editor.md), [integration setup](line-editor.md#integrate) |
| Apply atomic create/update/delete batches | [Transactions and event semantics](transactions.md) |
| Place, move and save point markers | [Point markers](markers.md) |
| Import and edit multipart lines/polygons | [Multipart geometry](multipart.md) |
| Draw with fixed 45°/90° directions | [Drawing constraints](drawing-constraints.md) |
| Offset open lines left or right | [Line offsets](offset.md) |
| Buffer selected lines and polygons | [Selection buffers](buffer.md) |
| Simplify lines and polygons | [Selection simplification](simplification.md) |
| Scale lines and polygons together | [Selection scaling](scaling.md) |
| Rotate lines and polygons together | [Selection rotation](rotation.md) |
| Edit two adjoining polygons together | [Shared boundaries](shared-boundaries.md) |
| Follow existing edges while drawing | [Boundary tracing](tracing.md) |
| Replace part of a polygon boundary | [Polygon reshape](reshape.md) |
| Keep the common area of selected polygons | [Polygon intersection](intersection.md) |
| Merge selected polygons | [Polygon union](union.md) |
| Subtract cutting polygons from a target | [Polygon difference](difference.md) |
| Split a supported polygon | [Polygon splitting](splitting.md) |
| Maintain an older line-only integration | [LineEditor compatibility facade](line-editor.md) |
| Set per-object colors, order and overlap stripes | [Feature styling](feature-styling.md) |
| Edit existing vertices with the keyboard | [Keyboard vertex editing](keyboard-vertices.md) |
| Edit existing corners with touch or pen | [Touch/pen vertex editing](touch-pen-vertices.md) |
| Locate code for a change | [Code map and walkthrough](code-walkthrough.md) |
| Understand ownership and dependency rules | [Current architecture](architecture.md) |
| Add or review a capability | [Contribution workflow](../CONTRIBUTING.md) |
| Reproduce performance measurements | [Performance baselines and limits](performance.md) |
| See what is implemented and planned | [Incremental roadmap](roadmap.md) |

Start development with `npm ci` and `npm run dev` from the repository root.
Install Chromium with `npx playwright install chromium` before browser testing.
Run `npm run check` before committing code changes; it includes type checks,
architectural lint rules, core/package/browser tests, the demo build and isolated
workspace acceptance against both production and development servers.
