# Area workspace

A small consuming application for the beta integration milestone: draw and
edit areas/routes and place markers, name them, import/export GeoJSON, and save/reopen a workspace
in the browser. Uses only the public `@jorisvdmije/map-master` entry point.

From the repository root:

```sh
npm ci
npm run dev:workspace:published
```

Open <http://127.0.0.1:5174> (`?basemap=off` disables external tiles).
This downloads the pinned published `0.1.0-beta.0` release from npm, verifies its
identity and SHA-512 integrity, and installs it in an isolated temporary copy of
this app. It uses the same pinned tooling and MapLibre versions as candidate tests.
Run `npm run dev:workspace` to test a freshly packed library from the checkout.
Restart either command after changing the example. The local tarball is generated,
so running `npm ci` directly in this folder before preparing it will fail.

To copy this application into another project, replace the `file:vendor/map-master.tgz`
dependency by running `npm install @jorisvdmije/map-master@0.1.0-beta.0 --save-exact`,
then run `npm run dev`. Commit the updated manifest and lockfile. Keep the supplied
worker URL import and stylesheet. The package is MIT-licensed and published as an
experimental npm beta; see the root repository's release status.

Run `npm run test:workspace:published` from the repository root for the published
release, or `npm run test:workspace` for the locally packed candidate. Both run
the isolated package,
production browser acceptance, latency/lifecycle budget gates and development-server
smoke check. `npm run test:budgets` runs only the installed-browser budget gates
and writes the raw report to `artifacts/beta-budgets.json`. See the
[beta integration guide](../../docs/beta.md) for the storage format, recovery,
integration patterns, limits and remaining release gates.

The published commands require npm registry access. They never fall back to a
local build or `latest`, and reject `GEO_RELEASE_ARCHIVE` overrides. Each run keeps
the downloaded archive, checksum, result and budget evidence in a fresh directory
under `artifacts/published-workspace/`. Update `published-release.json` only after
publishing and verifying a new release; review the exact version and integrity.
