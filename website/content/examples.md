# Interactive examples

Every feature guide opens with a live map. This one has all the tools: click shapes to select them, then choose a tool. Tools turn on when the selection qualifies. The basemap shows OpenStreetMap data served by OpenFreeMap; your edits stay in this page.

[[demo:examples]]

## Examples by feature

[[gallery]]

## Larger applications

The repository includes a [full playground](../../docs/playground-workflow.md) with every option, and an [area workspace](../../examples/workspace/README.md) with local saving, recovery and validation. Run them from a clone with `npm run dev` and `npm run dev:workspace`.

## Where your application takes over

Map Master manages editing, geometry validation and Undo. Your application supplies persistent storage, authorization, routing or spatial analysis. Editor feature locks are interaction controls, not security boundaries.
