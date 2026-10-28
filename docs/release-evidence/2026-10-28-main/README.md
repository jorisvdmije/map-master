# Initial hosted qualification — 2026-10-28

[PR #1](https://github.com/jorisvdmije/map-master/pull/1) merged with feature
history preserved. Both jobs in the subsequent
[main CI run](https://github.com/jorisvdmije/map-master/actions/runs/40620481848)
passed `npm run release:prepare` on commit
`864aa349acfc62f7b7f440336468f0d3bccf390f` with clean checkouts.

The two downloaded archives were checked against their verification reports,
the installed-consumer reports and npm's SHA-512 integrity in `pack.json`.
Both archives have this SHA-256:

```text
74a255200eccdbd4e596d9d4dbcefc8ec288269ff2d708cee358602a8555b4e9
```

The [manifest](manifest.json) identifies the run, candidate directories, archive
hashes and hashes of the original reports preserved here. GitHub retains the
full candidate artifacts for 14 days. Local copies were downloaded under
`artifacts/ci/run-40620481848/`; that directory is ignored by Git. This committed
record preserves the raw timing and verification evidence after hosted expiry;
it does not preserve the tarballs in Git or replace a final release archive.

| Job | Verification | Raw latency and lifecycle report |
| --- | --- | --- |
| [Node 22](https://github.com/jorisvdmije/map-master/actions/runs/40620481848/job/122593025655) | [verification](node-22-verification.json) | [budgets](node-22-beta-budgets.json) |
| [Node 24](https://github.com/jorisvdmije/map-master/actions/runs/40620481848/job/122593025882) | [verification](node-24-verification.json) | [budgets](node-24-beta-budgets.json) |

Latency p95, milliseconds, rounded to one decimal:

| Metric | Node 22 job | Node 24 job | Budget |
| --- | ---: | ---: | ---: |
| Workspace import | 121.4 | 147.4 | 2,000 |
| Workspace selection | 71.6 | 83.2 | 150 |
| Editor selection render | 49.6 | 65.5 | 100 |
| Cold pointer preview | 55.3 | 92.5 | 150 |
| Warm pointer preview | 50.9 | 59.8 | 100 |
| Commit render | 199.0 | 206.9 | 1,000 |

Both lifecycle reports pass. The jobs used different AMD processors, recorded
in their reports, so these timings are not a controlled comparison of Node
versions. Compatibility remains limited to the documented
[Chromium/MapLibre profile](../../beta-budgets.md).

## Publication status

This is qualification of the initial integrated source, not a published release.
The archive still contains `private: true`. Documentation or metadata changes
produce a different archive and require fresh verification for publication.

On 2026-10-28, the registry lookup for `@jorisvdmije/map-master@0.1.0-beta.0`
returned 404 and `npm whoami` returned 401. GitHub's API reported private
vulnerability reporting enabled, but the browser redirected the report URL to
GitHub sign-in. Form access and notification receipt were not verified, and no
test report was sent. Follow the remaining [release gates](../../releases.md).
