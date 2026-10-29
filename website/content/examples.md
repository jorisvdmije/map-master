# Learn with working examples

Three small workflows, running the published npm package. Each example pairs an editable map with the API calls behind it. All geometry stays in this page unless you download it.

[[examples]]

## What is included

The examples use a bundled, fictional neighborhood. There is no basemap service, access token, backend or account to set up. They demonstrate the public API of `@jorisvdmije/map-master@0.1.0-beta.0` with MapLibre 6.15.0.

## Start from a complete project

The [quickstart](quickstart.md) includes every file needed for a minimal Vite application. The examples below show the additional calls for one workflow, assuming `editor` is already attached to a loaded map.

For a larger application, the repository also includes an [area workspace](../../docs/beta.md) with local saving, recovery and validation, and a [full playground](../../docs/playground-workflow.md).

## Where your application takes over

Map Master manages editing, geometry validation and Undo. Your application supplies persistent storage, authorization, routing or spatial analysis. Editor feature locks are interaction controls, not security boundaries.
