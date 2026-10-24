# Native durable store locations

The project-private durable workspace uses Node Machine's
`canonicalNodeLocation` to identify an existing local SQLite store file. It
returns the file's absolute real path, resolving relative and absolute
spellings, redundant path segments, and symbolic links. Those supported path
spellings resolve to one canonical location. A missing file is still refused;
the location API does not create a store file as a side effect.

Distinct hard-linked names remain distinct canonical paths even when they
refer to the same underlying file. Do not concurrently open one SQLite
write-ahead-log (WAL) database through different hard-linked names. SQLite
derives rollback-journal and WAL sidecar names from the database pathname, so
each name can address different sidecars for the same database file. See
[SQLite's explanation of multiple links to one database file](https://sqlite.org/howtocorrupt.html#_multiple_links_to_the_same_file).
This guidance describes the current path boundary; it does not normalize file
identity by inode or promise hard-link interoperability.

This guidance applies to the project-private alpha workspace's Node SQLite
store. It does not change the public `microdelta` memory `Store` API, which is
process-local and non-durable.
