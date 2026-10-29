# Public beta releases

## Published 0.1.0-beta.0

**Map Master** (`@jorisvdmije/map-master@0.1.0-beta.0`) was published on 2026-10-28
from clean source commit `a4fd2fac9e73ec65407b44f50445d0579d740813`.
The [GitHub prerelease](https://github.com/jorisvdmije/map-master/releases/tag/v0.1.0-beta.0)
and annotated tag `v0.1.0-beta.0` retain the exact archive, SHA256SUMS, both hosted
verification/budget reports, pack inventories and post-publication verification.

[Final main CI](https://github.com/jorisvdmije/map-master/actions/runs/40725158490)
passed on Node 22 and 24. Both archives and the downloaded npm archive have SHA-256
`b8c160be659b0757ee8aecaab115af070b840aa7f379a9809e4ec796f72702da`.
Registry SHA-512 integrity matched; a fresh registry installation passed ESM
imports, internal-export protection and NodeNext/Bundler declaration resolution.

The `beta` tag points to this version. npm also exposes it under `latest`;
an authenticated removal attempt returned HTTP 400. There is no stable release
at this point. Pin the beta version explicitly in consuming applications.
Notification settings are configured; actual security notification delivery
remains untested. The immutable npm archive contains the preparation-time docs;
this source documentation records the completed publication.

The following preparation record and procedure remain relevant to later releases.

## Agreed project identity

- Package: `@jorisvdmije/map-master`; intended registry `https://registry.npmjs.org/`
  with public access and the `beta` tag.
- Repository: [jorisvdmije/map-master](https://github.com/jorisvdmije/map-master),
  configured locally as `origin`.
- License: [MIT](../LICENSE), copyright 2026 jorisvdmije. Runtime dependency
  notices are included in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
- Maintainer: [@jorisvdmije](https://github.com/jorisvdmije). Non-sensitive bug
  reports and feature requests belong in
  [GitHub Issues](https://github.com/jorisvdmije/map-master/issues).
- Security: [SECURITY.md](../SECURITY.md) designates GitHub Private Vulnerability
  Reporting. A Markdown file alone does not enable that GitHub setting.

## First-beta preparation record

On 2026-10-28 the public repository was created, Issues and private vulnerability
reporting enabled, and `main` protected with both required Node checks. PR #1
merged with feature history preserved. Both Node jobs passed on merge commit
`864aa349acfc62f7b7f440336468f0d3bccf390f`; the archives have identical SHA-256
checksums. See the [retained qualification evidence](release-evidence/2026-10-28-main/README.md)
and [repository integration](repository-integration.md).

Later on 2026-10-28, `npm whoami` returned `jorisvdmije`, matching the intended
personal scope. The package/version lookup still returned 404. Login is verified;
the name is not reserved and actual publishing permission is not yet proven.
The maintainer confirmed configuring repository security alerts and email
notifications. Delivery remains untested; no synthetic vulnerability report is
required to proceed. This replaces the earlier mandatory delivery-test gate.

Both Node jobs also passed on `9073fa0f798f7dadad059a8e7503dcd1f9251b12` in
[the subsequent main run](https://github.com/jorisvdmije/map-master/actions/runs/40680674891).
Downloaded archives have matching SHA-256
`600a013f861d42873122ec4b109c285df78cba55b0ae67d34c3df39070a5f68e`, verified
against their reports, pack inventories and integrity values. Those archives
still contain the old private guard and are not the publication artifacts.

The release change removed the private publishing guard and dated the changelog.
The following steps were completed for the first beta and remain required for later releases:

1. Review and merge the release change after both required PR checks pass. Verify
   CI on the final clean release commit and retain its fresh artifacts. Required
   checks and resolved conversations are enforced on `main`; the solo-maintainer
   policy does not require a second reviewer.
2. Compare the final Node 22 and 24 archive checksums, review package contents and
   perform the publication dry-run using the selected verified archive.
3. Recheck npm identity and version availability, obtain explicit publication
   authorization, then publish that same archive with the `beta` tag. Verify
   registry integrity, install the published version and create the prerelease.

### Maintainer account checks

Authenticate in your own terminal and verify the account used for the intended
scope. [npm login](https://docs.npmjs.com/cli/v11/commands/npm-login/) stores the
registry credentials locally; do not put credentials in release notes or Git.

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm view @jorisvdmije/map-master@0.1.0-beta.0 version --registry=https://registry.npmjs.org/
```

Confirm that the account owns the intended personal scope, or has publishing
permission if an organization owns it. A 404 does not reserve the package name;
successful login alone does not prove publication permission. Record account
identity and the verification date, never authentication tokens.

Private reporting is enabled through GitHub's repository setting. Subscribe to
**Watch → Custom → Security alerts** and enable email under **Subscriptions →
Watching** in [notification settings](https://github.com/settings/notifications).
The maintainer confirmed completing these settings on 2026-10-28. The agent's
browser still redirects to sign-in; neither direct form access nor delivery was
independently verified. Record configuration separately from delivery evidence.
The [reporting form](https://github.com/jorisvdmije/map-master/security/advisories/new)
is for concrete vulnerabilities; do not invent one to satisfy a release checklist.

After changes to metadata or dependencies, regenerate the root lockfile and run
`npm run lock:workspace`; review both lockfiles. The package-content tests require
the project license, security policy, dependency notices and release documentation.

## Build and verify one archive

After `npm ci` and installing Chromium with the repository's Playwright setup:

```sh
npm run release:prepare
```

This command creates a fresh directory under `artifacts/releases/candidate-*`,
builds and packs once, then runs the complete `npm run check` suite. The package
consumer test and both production/development workspace checks install that same
archive. Core and adapter tests still exercise the checkout and its build.

Each candidate directory contains:

- The `.tgz` archive and `pack.json` inventory with npm's integrity metadata.
- `beta-budgets.json`, including the SHA-256 of the installed archive, raw timing
  samples, lifecycle measurements and environment information.
- `verification.json`, recording the source commit, dirty-worktree flag, Node/npm
  versions, archive SHA-256 and whether the entire check command passed.

The command exits unsuccessfully if a check fails, the archive changes while
testing, or the budget report does not pass for that exact archive. Failures
retain their candidate directory and a failed verification report for diagnosis;
early failures may have no archive or budget report. No old report is reused.
Dirty development worktrees are allowed for rehearsal and explicitly recorded.
An actual release must come from a clean, committed tree with passing hosted CI.

The CI matrix runs this same preparation on Node 22 and 24 and retains each
candidate and its evidence for 14 days, including failed checks when available.
After metadata is final, compare the archive checksums from both successful jobs.
If they differ, investigate the content differences before selecting an artifact;
do not claim both jobs verified one identical artifact. A manual workflow run
alone is not a substitute for the required PR checks.

For local diagnosis, `GEO_RELEASE_ARCHIVE` can point to an existing local tarball
when running `npm test` or `npm run test:workspace`; otherwise those commands
continue to build fresh archives. `GEO_BETA_REPORT_DIR` changes the workspace
budget output directory. `release:prepare` sets both variables itself, so its
evidence always belongs to the candidate it just created.

## Final release review and publication

Review the final identity, license, contacts, changelog, migration notes, complete
archive inventory and passing checks. Check that the verification commit is the
intended release commit, `dirty` is false, and the SHA-256 still matches the
selected archive. Confirm the npm name/version is available and publishing access
is operational. The current tooling verifies tests, not these administrative gates.

After these conditions and publication authorization are satisfied, first inspect
the selected archive with a dry-run. Replace the path below with the verified
archive; do not run publication from the working directory and repack implicitly:

```sh
npm publish ./path/to/verified-candidate.tgz --dry-run --tag beta --access public --registry https://registry.npmjs.org/
```

A dry-run does not prove registry authorization or reserve a name/version.
The actual publication uses the same command and archive without `--dry-run`.
Keep `--tag beta` explicit to avoid updating `latest`. Verify registry integrity
and the `beta` tag after publication, then smoke-test installation by the exact
published version in a fresh consumer. Record the verified source commit in an
annotated version tag and attach the archive, checksums, reports and changelog to
the corresponding GitHub prerelease. Never overwrite an already-published version;
fix problems in a new prerelease and document the migration.

Publication is intentionally a separate operation; neither local checks nor CI
contain an npm publish step or require publishing credentials.

## References

- [npm pack: local archives and dry runs](https://docs.npmjs.com/cli/v10/commands/npm-pack/)
- [npm publish: tarball input, access and tags](https://docs.npmjs.com/cli/v10/commands/npm-publish/)
- [GitHub required checks and current-commit requirements](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
