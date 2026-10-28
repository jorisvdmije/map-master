# Repository integration and maintenance

## Initial integration

On 2026-10-28 the public repository
[jorisvdmije/map-master](https://github.com/jorisvdmije/map-master) was created.
The local feature history contains 56 commits after the original `main` commit,
ending at `a9bf610`. They form a single accumulated implementation, not 56
independently pending feature reviews.

The original `main` was pushed as the bootstrap base. Branch
`chore/integrate-beta` imports all completed features plus the repository workflow
changes through one PR. This first PR should use a **merge commit** to preserve
the existing commit ancestry. After it merges, fast-forward local `main` from
`origin/main`; subsequent small features use ordinary short-lived branches and
squash merges. Do not reconstruct old PRs or rewrite the feature history.

Local feature branch pointers are retained until integration is confirmed.
They need not all be pushed. Once their tips are ancestors of `main`, they can be
removed with normal `git branch -d` as housekeeping; they are not permanent
per-feature branches.

## Verified repository settings

Read back through GitHub's authenticated API on 2026-10-28:

- Public source repository, default branch `main`, Issues enabled, wiki disabled.
- Private vulnerability reporting enabled. Form access and delivery of security
  notifications still need verification before npm publication.
- `main` requires a PR, up-to-date `Check (Node 22)` and `Check (Node 24)` status
  checks, and resolved conversations. These requirements include administrators.
- Force pushes and branch deletion are disabled for `main`.
- The solo maintainer can merge without a second approving reviewer. Add a
  required approval when another reviewer is available; do not claim independent
  review for the initial solo-maintained implementation.
- Merged remote branches are deleted automatically. Merge commits are allowed
  for the initial import; squash merges are the normal workflow afterwards.

Configuration is not a passing CI result. The initial PR must pass both matrix
jobs before integration. No npm package or release tag is created by this step.

## Checks and artifacts

`.github/workflows/ci.yml` runs the complete `npm run release:prepare` workflow
on Ubuntu with Node 22 and 24. Action dependencies are pinned to verified commit
SHAs rather than mutable major tags. Review version and SHA together on updates.
Each job retains its candidate archive, checksum and verification/performance
reports for 14 days, including available failure artifacts.

Do not skip failing tests, raise performance budgets just to obtain a green run,
or merge with administrator bypass. Diagnose the failure on the affected platform.
The job names are branch-protection contracts; update repository settings together
with any rename. Compare candidate checksums from the two jobs before choosing
an archive for publication, as described in [release preparation](releases.md).

## Next changes

Start from an up-to-date, clean `main` and create one branch per reviewable change.
The PR template prompts for behavior, validation and limits. Include relevant
docs/tests, run local checks, and require both hosted checks on the current PR
commit. Merge, update local `main`, then start the next branch.

## Remaining distribution gates

- Passing hosted checks for the initial integration and eventual release commit.
- Verification of the private reporting form and notification receipt.
- npm authentication and permission for `@jorisvdmije/map-master` (the name lookup
  returns 404; that does not reserve it). `npm whoami` returned 401 on 2026-10-28.
- A separately reviewed publication change: remove `private: true`, finalize the
  release date, verify the exact archive and publish only with explicit release
  authorization. Repository creation does not authorize a registry release.
