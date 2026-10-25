# Preparing a public beta

Milestone 18e prepares **Map Master**, package `@jorisvdmije/map-master`, version
`0.1.0-beta.0`, for its first public beta. The identity and licensing decisions
are complete; public distribution and hosted verification remain pending.

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

The authenticated GitHub lookup returned HTTP 404 on 2026-10-25. The remote URL
is configured, but the repository, Issues, private reporting and branch checks
have not been verified as operational. A registry lookup also returned 404;
this does not reserve the npm name or prove permission to publish to its scope.

1. Create/configure the intended repository with Issues enabled. Enable GitHub
   Private Vulnerability Reporting, verify its form, and update the setup status
   in `SECURITY.md`. Verify that the maintainer receives security notifications.
2. Push the reviewed source and run CI on the release commit. Require
   `Check (Node 22)` and `Check (Node 24)` on `main`, with PR review and resolved
   conversations appropriate to the maintainer team. These are repository
   settings; committing the workflow does not activate branch protection.
3. Confirm npm scope access and the release version's availability. The metadata
   already selects the registry, public access and `beta` tag. The package keeps
   `private: true` until the remaining release gates are complete.
4. Remove the private publishing guard in a reviewed release change, finalize the
   dated changelog entry and verify a fresh archive from that exact clean commit.
   Record the rename migration and retain the archive and evidence for publication.

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
