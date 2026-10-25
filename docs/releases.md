# Preparing a public beta

Milestone 18e has local release preparation in place. Public release is pending:
the package is still private, `UNLICENSED`, version `0.0.0`, and there is no
GitHub remote. A successful local check does not establish permission to publish,
registry access, a license, support coverage or hosted CI success.

## Decisions required before public distribution

- **Identity:** agree on the final npm name and GitHub owner/repository; verify
  publishing access to that name/scope. Update package metadata, import paths,
  example dependencies, fixtures, configuration and documentation together.
  Set `repository`, `homepage` and `bugs` to real project locations.
- **License:** select the project license, add its complete text and correct
  copyright holder, and set the matching package metadata. Review runtime
  dependency notices and include any required attribution in the archive.
- **Ownership:** name the actual maintainer(s) and a public support route. Add
  `SECURITY.md` with an operational private vulnerability reporting channel,
  supported versions and an achievable response policy. Do not publish placeholder
  contacts or promise response times before an owner accepts them.
- **Repository checks:** configure the remote, run CI on the final commit, then
  require `Check (Node 22)` and `Check (Node 24)` on `main`. Require PR review and
  resolved conversations as appropriate for the maintainer team. These controls
  are repository settings, not enabled merely by committing a workflow file.
- **Release metadata:** set the first agreed prerelease version (proposed
  `0.1.0-beta.0`), finalize the dated changelog entry and migration notes, and add
  `publishConfig` with the intended registry, public access and `beta` tag. Remove
  `private: true` only when the public-release decisions have been completed.

For a rename, search all tracked files for `@geo/editor`, including package
self-imports and TypeScript/Vite aliases. Regenerate the root lockfile and run
`npm run lock:workspace` after metadata/dependency changes; review both lockfiles.
Add final license/contact files to the package allowlist when necessary and
extend the package-content test to require them.

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
