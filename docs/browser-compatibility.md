# Firefox and WebKit investigation

The first cross-engine investigation exercises the installed area workspace with
real browser controls. Local runs on **macOS 26.6.2 arm64** passed in Playwright
**Firefox 157.0** and **WebKit 27.2**, using **Playwright 1.64.1**, **MapLibre 6.15.0**
and the published **0.1.0-beta.0** archive. The same workflows also passed against
the locally packed candidate. No library changes were needed for these scenarios.

This is evidence for the workflows below. The existing
[Chromium beta qualification](beta-budgets.md) remains the supported test profile.
Playwright uses patched Firefox and WebKit builds; its WebKit is not the shipping
Safari application. See [Playwright's browser descriptions](https://playwright.dev/docs/browsers#webkit).

## Measured scope

| Browser | Local production acceptance | Development server | Evidence |
| --- | --- | --- | --- |
| Chromium 156.0.8078.4 | 14 scenarios, including existing CDP touch emulation | Draw, render, pick and export | Existing regression control; candidate run passes |
| Firefox 157.0 | 13 desktop scenarios | Draw, render, pick and export | Candidate and published archive pass locally |
| WebKit 27.2 | 13 desktop scenarios | Draw, render, pick and export | Candidate and published archive pass locally |

The desktop scenarios cover drawing and actual rendered map picking, safe names,
mouse vertex drags, cancellation, keyboard group edits, Undo/Redo, save/reload,
appearance changes, session locks, deletion and empty-workspace persistence,
markers, typed GeoJSON identities and atomic rejection, storage quota errors,
corrupt-data recovery and conflicts between two tabs. Tests assert no page errors,
failed HTTP requests or external map requests. MapLibre's worker is bundled by
the real consuming application in both build modes.

The touch scenario uses Chromium's CDP and is explicitly excluded from Firefox
and WebKit reports. It is not replaced with synthetic DOM events.
[Playwright CDP sessions](https://playwright.dev/docs/api/class-browsercontext#browser-context-new-cdp-session)
are Chromium-only. Cross-engine latency/heap budgets, physical touch/pen devices,
mobile layouts and the complete library geometry-operation suite are outside this
investigation. Shipping Firefox/Safari versions and additional OS/GPU combinations
still need qualification before expanding support claims.

## Reproduce

From the repository root:

```sh
npm ci
npm ci --prefix website
npx playwright install chromium firefox webkit
npm run test:compatibility
npm run test:compatibility:published -- firefox webkit
```

`test:compatibility` packs the current checkout and runs all three engines against
an isolated installed consumer. The published command downloads the exact
version/integrity pin from `examples/workspace/published-release.json`. Both accept
an optional list of engine names; for example `npm run test:compatibility -- webkit`.
These are functional checks and do not run or relax the existing Chromium budgets.
Run `npm run check` for the complete candidate release checks.

For a visible browser, use `GEO_COMPAT_HEADED=1`. Linux CI uses a virtual display:

```sh
npx playwright install --with-deps firefox webkit
GEO_COMPAT_HEADED=1 xvfb-run -a npm run test:compatibility -- firefox webkit
```

The **Browser compatibility** workflow runs Firefox and WebKit on Ubuntu 24.04
and macOS 15, checking both candidate and published archives. It is separate from
the established release/Pages pipeline while qualification is in progress.
Hosted results must be read for the actual PR/commit; local macOS success is not
evidence of Linux success. The workflow does not hide failures with retries or
`continue-on-error`.

## Reports and diagnosis

Candidate runs retain a fresh directory under `artifacts/browser-compatibility/`;
published runs keep their archive and nested compatibility reports under
`artifacts/published-workspace/run-*/`. CI uploads both for 14 days, including on
failure. Each browser/build mode gets JSON with version, WebGL information,
completed scenarios, exclusions and errors. Failures also attempt a screenshot.
The aggregate report records OS, architecture, Node, package versions, checkout
identity and archive SHA-256. Any failed phase exits nonzero after recording the
remaining selected browsers/phases, so one failure does not conceal another.

The [local published-release baseline](browser-evidence/2026-10-31-macos/verification.json)
records a passing run during development of this harness; its per-phase files retain the actual observations.
Browser privacy protections can mask the WebGL renderer and user-agent platform,
so these fields must not be treated as exact hardware or OS identification.

If a run fails, first distinguish missing browser/system dependencies, WebGL
initialization, worker/bundler loading and an actual interaction regression.
Preserve the report and reproduce the failing control sequence before changing
test waits or adding engine-specific runtime workarounds.
