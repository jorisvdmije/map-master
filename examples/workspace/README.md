# Area workspace

A small consuming application for the local beta integration milestone: draw and
edit areas/routes, name them, import/export GeoJSON, and save/reopen a workspace
in the browser. Uses only the public `@geo/editor` entry point.

From the repository root:

```sh
npm ci
npm run dev:workspace
```

Open <http://127.0.0.1:5174> (`?basemap=off` disables external tiles).
The launcher installs a freshly packed library in an isolated temporary copy of
this app. Restart it after changing the example. The local tarball is generated,
so running `npm ci` directly in this folder before preparing it will fail.

To copy this application into another project, put an `npm pack` archive at
`vendor/geo-editor.tgz`, then run `npm ci` and `npm run dev`. Keep the supplied
worker URL import and stylesheet. The package is not yet published or licensed
for public distribution; see the root repository's release status.

Run `npm run test:workspace` from the repository root for the isolated package,
production browser acceptance and development-server smoke check. See the
[beta integration guide](../../docs/beta.md) for the storage format, recovery,
integration patterns, limits and remaining release gates.
