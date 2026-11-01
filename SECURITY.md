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

The library runs entirely in the browser. It does not fetch map tiles or send
geometry anywhere; the host application controls all network access and storage.
[Feature locks](docs/feature-locks.md) are editor interaction policy, not access
control: applications must enforce authorization on their server and validate data
they receive from users.
