# Preparing a public beta

Milestone 18e prepares **Map Master**, package `@jorisvdmije/map-master`, version
`0.1.0-beta.0`, for its first public beta. The identity and licensing decisions
are complete; the public source repository is configured and the initial
integration passed hosted verification on `main`. npm distribution and passing
verification of the final publication archive remain separate gates.

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

## Remaining gates before public distribution

On 2026-10-28 the public repository was created, Issues and private vulnerability
reporting enabled, and `main` protected with both required Node checks. PR #1
merged with feature history preserved. Both Node jobs passed on merge commit
`864aa349acfc62f7b7f440336468f0d3bccf390f`; the archives have identical SHA-256
checksums. See the [retained qualification evidence](release-evidence/2026-10-28-main/README.md)
and [repository integration](repository-integration.md).

The npm package lookup still returned 404 and `npm whoami` returned 401 on
2026-10-28. The name is not reserved and publishing access is not verified.

1. Verify access to the enabled private-reporting form and receipt of maintainer
   security notifications. The setting alone does not prove notification delivery.
2. Verify CI again on the final release commit and retain its artifacts. Initial
   integration qualification is complete; later documentation/metadata changes
   require a fresh archive. Required checks and resolved conversations are already
   enforced on `main`; the solo-maintainer policy does not require a second reviewer.
3. Confirm npm scope access and the release version's availability. The metadata
   already selects the registry, public access and `beta` tag. The package keeps
   `private: true` until the remaining release gates are complete.
4. Remove the private publishing guard in a reviewed release change, finalize the
   dated changelog entry and verify a fresh archive from that exact clean commit.
   Record the rename migration and retain the archive and evidence for publication.

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

Open the [private reporting form](https://github.com/jorisvdmije/map-master/security/advisories/new)
while signed in and verify notification receipt through the maintainer's chosen
private reporting check. Record the date and outcome without committing private
report contents. The current browser session redirects to GitHub sign-in, so it
does not establish form access or delivery. No test report has been sent.

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
