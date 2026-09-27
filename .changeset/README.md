# Changesets

Use `npm run changeset:add` to describe a package change and select its semver
bump. Use `npm run changeset:status` to inspect the pending plan. The reviewed
version PR runs `npm run changeset:version` to update private package versions
and changelogs. No command in this workflow publishes packages; package
`private` flags stay enabled and private package tags are disabled.

See [release and API report guidance](../docs/releasing.md) for when a changeset
is required and how to review generated API reports.
