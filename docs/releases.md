# Release process

Releases are published manually from a verified archive. CI never publishes and
needs no npm credentials. The [changelog](../CHANGELOG.md) and the
[GitHub releases](https://github.com/jorisvdmije/map-master/releases) record what
each version contains; each GitHub release has the exact archive, its checksum and
the verification reports attached.

## Versioning

The package follows [semantic versioning](https://semver.org/). While the version
is below 1.0, a minor version may contain breaking changes; the changelog and the
[migration guide](migration.md) describe each one. Prereleases such as
`0.2.0-beta.0` are published under the `beta` dist-tag, regular releases under
`latest`. Never overwrite a published version; fix problems in a new one.

## 1. Prepare the release change

On a branch from an up-to-date `main`:

1. Set `version` in `package.json`, and `publishConfig.tag` to `beta` for a
   prerelease or `latest` for a regular release.
2. Run `npm install --package-lock-only` and `npm run lock:workspace`, then review
   both lockfile diffs.
3. Move the **Unreleased** changelog entries under a dated heading for the new
   version, and add migration notes for breaking changes.
4. Open a pull request. Both required checks (Node.js 22 and 24) must pass on the
   final commit before merging.

## 2. Verify one archive

CI runs this for every commit; run it locally to rehearse:

```sh
npm ci && npm ci --prefix website
npx playwright install chromium firefox webkit
npm run release:prepare
```

On Linux, use `npx playwright install --with-deps chromium firefox webkit` to
include system libraries. Release preparation includes the Chromium library and
installed-application suites plus website checks in Chromium, Firefox and WebKit.
To match Ubuntu CI's windowed WebGL mode, install `xvfb` and run
`xvfb-run -a env GEO_DOCS_HEADED=1 npm run release:prepare`.

The command packs the library once into a new `artifacts/releases/candidate-*`
directory and runs `npm run check` against that archive: the package consumer test
and the workspace acceptance and budgets install the exact archive. The directory
then contains:

- the `.tgz` archive and `pack.json` with npm's file list and integrity;
- `beta-budgets.json` with raw timings, memory measurements and the archive SHA-256;
- `verification.json` with the commit, a dirty-worktree flag, Node.js and npm versions,
  the archive SHA-256 and whether every check passed.

The command fails if a check fails, the archive changes during the run or the budget
report belongs to a different archive. A real release must come from a clean,
committed `main` with passing CI. Download the `beta-candidate-node-22` and
`beta-candidate-node-24` artifacts of that CI run and check that both archives have
the same SHA-256.

## 3. Publish

Inspect the verified archive, then publish exactly that file rather than repacking
the working directory:

```sh
npm whoami
npm publish ./path/to/map-master-<version>.tgz --dry-run --tag <beta|latest> --access public
npm publish ./path/to/map-master-<version>.tgz --tag <beta|latest> --access public
```

Afterwards:

1. Check `npm view @jorisvdmije/map-master dist-tags` and that the registry integrity
   matches `pack.json`.
2. Install the published version in a fresh project and import it.
3. Create an annotated `v<version>` tag on the verified commit and a GitHub release
   with the changelog section, the archive, its checksum and the reports.
4. Update `examples/workspace/published-release.json` in a follow-up pull request and
   run `npm run test:workspace:published`. The documentation site needs no update: it
   runs the repository build and shows the version from `package.json`.

## Environment variables

`GEO_RELEASE_ARCHIVE` makes `npm test` and `npm run test:workspace` install an existing
archive instead of packing a new one, and `GEO_BETA_REPORT_DIR` changes where the
budget report is written. `release:prepare` sets both itself.

## Complete local source candidates

`release:prepare` captures every tracked and nonignored untracked regular source
file, records its SHA-256 in `candidate-source.json`, and writes `source.tgz`
next to the package archive. It verifies the source manifest before and after the
checks. Thus a dirty checkout is explicit and its additional source is recoverable;
the baseline commit alone is not used as proof of the tested source.

For a clean install, extract `source.tgz` to an empty directory, run `npm ci` and
`npm ci --prefix website`, install the documented browsers, then run:

```sh
GEO_SOURCE_MANIFEST="$PWD/candidate-source.json" npm run release:prepare
```

This verifies the extracted files without needing a `.git` directory. The report
keeps the original baseline commit and dirty flag instead of inventing a source
commit. Archive hashes identify the candidate. Do not publish the existing
`0.2.0` version as a new release: the source remains Unreleased until maintainers
choose the next version/tag and complete the public release checklist. Source
archives and package archives are local evidence, not publication approval.
