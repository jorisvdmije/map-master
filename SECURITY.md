# Security policy

Map Master (`@jorisvdmije/map-master`) is maintained by
[@jorisvdmije](https://github.com/jorisvdmije).

## Reporting a vulnerability

The designated confidential channel is
[GitHub Private Vulnerability Reporting](https://github.com/jorisvdmije/map-master/security/advisories/new).
On the repository, choose **Security → Advisories → Report a vulnerability**.
Do not disclose vulnerability details, exploit code, credentials or sensitive
geometry in public issues or feature requests.

**Setup status (2026-10-28):** the public repository exists and GitHub's API
confirms private vulnerability reporting is enabled. On this date the maintainer
confirmed configuring repository security alerts and email notifications.
Actual notification delivery has not been tested; no test vulnerability report
has been sent. A synthetic vulnerability report is not required for release.
If the form is unavailable, do not post the report publicly;
a public issue may request activation of the private channel without including
any vulnerability details.

Include the affected package version or source commit, a minimal reproduction
using synthetic data, expected versus observed behavior, potential impact and
relevant browser/MapLibre versions. Submit only information needed to reproduce
the issue. The maintainer will coordinate investigation and disclosure through
the private advisory. No guaranteed response time or paid support SLA is offered.

## Supported versions

No npm version has been publicly released yet. Reports about the current source
and the prepared `0.1.0-beta.0` candidate are welcome once the private channel is
operational. During beta, security fixes target the latest published beta;
earlier candidates and unpublished snapshots receive no backport commitment.
Applications should upgrade to the fixed candidate when one is released.

## Ordinary bugs and feature requests

Use [GitHub Issues](https://github.com/jorisvdmije/map-master/issues) for
non-sensitive bugs and feature requests.
Feature locks are editor interaction policy; applications must enforce their
own server-side authorization and protect stored geometry.
