# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub Private Vulnerability Reporting](https://github.com/jorisvdmije/map-master/security/advisories/new):
on the repository, choose **Security → Advisories → Report a vulnerability**.
Do not disclose vulnerability details, exploit code, credentials or sensitive
geometry in public issues.

Include the affected package version or commit, a minimal reproduction using
synthetic data, the expected and observed behavior, the potential impact and the
browser and MapLibre versions involved. The maintainer,
[@jorisvdmije](https://github.com/jorisvdmije), coordinates the investigation and
disclosure through the private advisory. This is a volunteer project without a
guaranteed response time.

If the reporting form is unavailable, open a public issue asking for a private
contact channel, without any vulnerability details.

## Supported versions

Security fixes are released for the latest published version only. Upgrade to the
newest release to receive them; the [changelog](CHANGELOG.md) lists every fix.

## Scope

The geometry editor does not fetch map tiles or transmit edited geometry. The
host owns map sources, network access and storage. The optional
`createValhallaProvider` service sends the chosen origin, travel mode, minutes and
travel direction to its explicitly configured endpoint when the host calls
`calculateReachability`. No request is made merely by importing or creating the
editor/provider. Use an endpoint whose privacy and service policies fit your
application; see [reachability](docs/reachability.md).

The documentation applications are separate hosts. They load published static
snapshots and explicitly query PDOK, Amsterdam and RIVM for selected neighborhood
or address context. Playground and free-analysis recovery stay in the browser.
View links contain public research settings, never imported datasets or saved
project contents. Downloads are user-initiated. See the data source guides for
per-source provenance and request contracts.
[Feature locks](docs/feature-locks.md) are editor interaction policy, not access
control: applications must enforce authorization on their server and validate data
they receive from users.
