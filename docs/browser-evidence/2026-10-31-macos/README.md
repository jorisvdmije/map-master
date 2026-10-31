# Local published-package browser evidence

Command: `npm run test:compatibility:published -- firefox webkit`.

These reports were captured on macOS 26.6.2 arm64 with Node 22.23.1 and
Playwright 1.64.1. Firefox 157.0 and WebKit 27.2 each pass 13 production workspace
scenarios and one development render/pick smoke, with no reported page/network
errors. The library is the published `0.1.0-beta.0` archive, SHA-256
`b8c160be659b0757ee8aecaab115af070b840aa7f379a9809e4ec796f72702da`.

The harness was under development on top of `87e99f9`; `checkoutDirty: true`
records this honestly. It does not identify the library bytes, which are verified
by the archive hash. Per-phase reports identify the launched browser and WebGL
information. `verification.json` records the package/OS context and aggregate.
These are local investigation results, not final hosted or shipping-browser
qualification. See the [scope and remaining gaps](../../browser-compatibility.md).
