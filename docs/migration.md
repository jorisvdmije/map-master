# Beta versioning and migration

There are no published versions to migrate between yet. `@geo/editor` and `0.0.0`
identify local development snapshots, not a released compatibility contract.
Keep the archive checksum or Git commit of any local version you integrate.

## Version policy

The proposed first public version is `0.1.0-beta.0`, published under npm's `beta`
tag after the [release prerequisites](releases.md) are met. Subsequent candidates
increment the prerelease number. Pin an exact candidate version in applications
and commit the application lockfile so adopting a new candidate is deliberate.

The public API is experimental throughout beta. Each candidate must record
user-visible changes, breaking behavior and required migration steps in the
[changelog](../CHANGELOG.md). Do not silently change geometry validity rules,
identity handling, event semantics, history behavior or persistence examples.
If a candidate has no required migration, say so in its release notes. A stable
1.0 compatibility/deprecation policy is a separate release gate.

## Adopting the first candidate from a local snapshot

1. Back up committed geometry using GeoJSON export. Finish or cancel drafts first.
   Record the old archive/commit and retain it for rollback.
2. Replace the local tarball dependency with the final package name and exact
   beta version once published. Update imports if the working `@geo/editor`
   identity changes. Use only the public package entry point; imports from
   `src/`, `dist/` or internal modules are unsupported.
3. Install host-owned MapLibre. The declared peer range is `^6.15.0`, but only
   6.15.0 has been measured. Start from that version and the
   [integration guide](geometry-editor.md).
4. Compile the application and exercise drawing, cancellation, selection,
   editing, property transactions, Undo/Redo, import/export and teardown with
   representative data. Test invalid imports and locked features too.
5. Verify that all required IDs, properties, holes and multipart components
   survive a GeoJSON round trip under the documented validity policy. Do not
   bypass validation to make previously unsupported geometry load.
6. Reapply host configuration, appearance and locks after creating the editor.
   Drafts, history and feature locks are not persisted in the example workspace.

`LineEditor` remains a compatibility facade for line-only integrations; migrating
to `GeometryEditor` is optional unless the application needs other geometry.
See the [line guide](line-editor.md) for that API's scope.

The example's `geo-area-workspace` envelope stays at format version 1. It is
independent of the package version, and this release preparation makes no storage
format change. Browser data belongs to an origin, including its port; moving a
demo to another origin requires export/import, not just upgrading the package.
Host applications own their storage schema, migrations and rollback strategy.
