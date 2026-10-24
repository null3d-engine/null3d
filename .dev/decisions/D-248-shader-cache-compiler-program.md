# D-248: The compiler's bytes choose the per-entry shader cache folder

Status: decided. Date: 24 October 2026. Task: M3-R22.

Summary: The per-entry shader cache chose its folder by a hash of every source file of the compiler and of each crate that it depends on by path. A comment, a test or a layout constant could not change one generated WGSL line, but it changed that hash. Then all 68,382 variants compiled again. That took 50 to 70 minutes on the Mac, and it held the machine-wide lock that every other helper waits on. The folder is now chosen by a hash of the compiled `shader-build` program's bytes. A source change that leaves the program identical reuses every entry: 0 compiled and 79 reused, in 19 s. A change to one shader compiles that entry and reuses the rest.

## Question

`compilerStamp` hashes every file of the shader crate and of each crate it reaches by path, together with the workspace's Cargo files. The build passed that stamp to `shader-build`. The stamp named both the cache folder and the compiler part of each entry's key. A one-line change to a layout constant in `crates/null3d-gpu/src/drawlist.rs` could not alter any generated shader, but it rebuilt every entry. On 24 October 2026 that happened twice. What identifies a compiler closely enough to reuse its entries, without ever reusing the output of another compiler?

## Rule

- A cache key names exactly what decides its output. That is the compiler's code, the entry's source, its manifest table, and the contents of each library module that the entry reads.
- Never reuse an entry across a different compiler. A wrong reuse is worse than a slow build.
- Do not narrow the stamp by leaving dependency crates out: a dependency may legitimately change generated WGSL.

## Data

| Measure | Result |
| --- | --- |
| A full rebuild of every entry on this Mac, before the change | 50 to 70 min, holding `shader-modules.lock` |
| `shader-build` programs of the source stamps `380d3d5b…` (20:51) and `979c3102…` (21:18) | identical, SHA-256 `eb2e96fa…` |
| Entries that `380d3d5b…` holds, built by that same program | 79, every manifest entry |
| Two more source stamps, `4a85207e…` and `fcdd50de…` | the same program `447a9d1d…`, although their stamps differ |
| Comment added to `crates/null3d-gpu/src/drawlist.rs`, then `shader-build --entries-shard 0/1` | 0 entries compiled, 79 reused, 19 s |
| The same source state, then `bun tools/shaders.ts` | 0 entries compiled, 79 reused, modules byte-identical, 150 s of which nearly all is the module set's 2.8 GB copy |
| `timer_mark.wgsl` changed from `@workgroup_size(1)` to `(2)`, then `bun tools/shaders.ts` | 1 entry compiled, 78 reused |

How the data was produced: SHA-256 of the kept `program/shader-build` of each cache folder. Also the `compiled N entries and reused M` line of the build's report, and the wall time that the machine's job queue reported for each run. Also a SHA-256 of the sorted SHA-256s of every generated module, before and after.

## Decision

- The identity of a compiler is the SHA-256 of the bytes of the compiled `shader-build` program. Comments, `#[cfg(test)]` code and code that the linker drops do not reach those bytes; code that can change a generated shader must.
- Each entry folder records that fingerprint in a file named `compiler`. The tools keep the program under the source stamp, as before, because that stamp still decides when cargo must run. The program's bytes then choose the folder. `compilerEntryFolder` reads every folder's recorded fingerprint. The matching folder with the most entries serves, so all checkouts share one set.
- A folder that an earlier build made records no fingerprint. Its kept program is the compiler that wrote its entries, so its fingerprint is read from that program and written beside them. That is how the existing cache joined the rule without a rebuild.
- The source stamp still names a new folder and still forms CI's cache keys, which a run reads before it builds the program. When a folder of that name already holds another compiler's entries, the new compiler takes `<stamp>-<fingerprint>`, because entries share a key when their folder names match.
- An entry's key therefore stays the entry's source, its manifest table and the compiler's fingerprint. Nothing in the Rust cache changes: `--stamp` is the folder's name, and the folder holds one compiler's entries.

## Consequences

- `tools/lib/shader-modules.ts` gains the fingerprint, the marker and the folder choice. `buildEntriesShard` returns the folder that it filled as well as the files that it stored.
- Cargo still compiles the program after any compiler source change, but that is seconds, and `sccache` usually shortens it further. It no longer decides whether the entries are valid.
- A change to the generated WGSL of one entry still compiles that entry. A change to a library module still compiles the entries that import it.
- CI needs no change. A run's jobs start with an empty entries folder unless the Actions cache matches. That cache's key includes the source stamp, so each run writes the folder that `--cache-keys` prints, as before.
- A source change that changes the program's bytes still rebuilds every entry. That is the price of never reusing another compiler's output.
- The module set is still keyed by the source stamp. So the same change copies a module set of 2.8 GB under the new input hash. It writes no module byte, because the set is identical. That copy, not the shader build, is most of the 150 s in the table.

