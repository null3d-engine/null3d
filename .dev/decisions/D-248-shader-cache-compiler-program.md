# D-248: The compiler's bytes choose the per-entry shader cache folder

Status: decided. Built: the folder choice by the program's fingerprint, in the tools and in CI's cache keys. Task: M3-R22.

Summary: The per-entry shader cache chooses its folder by a hash of the compiled `shader-build` program's bytes, not of the compiler's source files. A source change that leaves the program identical reuses every entry: 0 compiled and 79 reused, in 19 s. Keyed by a hash of the source, a comment or a layout constant would change the key. All 68,382 variants would then compile again for 50 to 70 minutes. The program holds no path of the checkout that built it, so two checkouts of one compiler share every entry. An entry's key reads its sources without comments or the white space between tokens. An edit that leaves every token in place therefore reuses the entry.

## Question

`compilerStamp` hashes every file of the shader crate and of each crate it reaches by path, together with the workspace's Cargo files. When that stamp names both the cache folder and the compiler part of each entry's key, a one-line change rebuilds every entry. A layout constant in `crates/null3d-gpu/src/drawlist.rs` is such a change, though it cannot alter any generated shader. The rebuild holds the machine-wide lock that every other helper waits on. What identifies a compiler closely enough to reuse its entries, without ever reusing the output of another compiler?

## Rule

- A cache key names exactly what decides its output. That is the compiler's code, the entry's source, its manifest table, and the contents of each library module that the entry reads. It reads a source as the program does: every token, and only the line breaks that can make a directive.
- Never reuse an entry across a different compiler. A wrong reuse is worse than a slow build.
- Do not narrow the stamp by leaving dependency crates out: a dependency may legitimately change generated WGSL.

## Data

| Measure | Result |
| --- | --- |
| A full rebuild of every entry on this Mac | 50 to 70 min, holding `shader-modules.lock` |
| `shader-build` programs of the source stamps `380d3d5b…` (20:51) and `979c3102…` (21:18) | identical, SHA-256 `eb2e96fa…` |
| Entries that `380d3d5b…` holds, built by that same program | 79, every manifest entry |
| Two more source stamps, `4a85207e…` and `fcdd50de…` | the same program `447a9d1d…`, although their stamps differ |
| The kept programs of two checkouts, each 6,956,064 bytes | differ in 112,482 bytes, and in one string: the checkout's own path, compiled in as the default root |
| Comment added to `crates/null3d-gpu/src/drawlist.rs`, then `shader-build --entries-shard 0/1` | 0 entries compiled, 79 reused, 19 s |
| The same source state, then `bun tools/shaders.ts` | 0 entries compiled, 79 reused, modules byte-identical, 150 s of which nearly all is the module set's 2.8 GB copy |
| `timer_mark.wgsl` changed from `@workgroup_size(1)` to `(2)`, then `bun tools/shaders.ts` | 1 entry compiled, 78 reused |

How the data was produced: SHA-256 of the kept `program/shader-build` of each cache folder. Also the `compiled N entries and reused M` line of the build's report, and the wall time that the machine's job queue reported for each run. Also a SHA-256 of the sorted SHA-256s of every generated module, before and after.

## Decision

- The identity of a compiler is the SHA-256 of the bytes of the compiled `shader-build` program. Comments, `#[cfg(test)]` code and code that the linker drops do not reach those bytes; code that can change a generated shader must.
- The program holds no absolute path of the checkout that built it. Its default root is the working directory, and every tool passes `--root`. A compiled-in root made the bytes differ between two checkouts of one compiler. Five cache folders held five program hashes, and the two programs of one size differed only in that string. Every checkout then compiled every entry again. That is the opposite of what one folder per compiler is for. The gate's build in another checkout reported 97 compiled and 0 reused for this reason. The compiler had not changed.
- Each entry folder records that fingerprint in a file named `compiler`. The tools keep the program under the source stamp, because that stamp decides when cargo must run. The program's bytes then choose the folder. `compilerEntryFolder` reads every folder's recorded fingerprint. The matching folder with the most entries serves, so all checkouts share one set.
- A folder without a `compiler` file takes its fingerprint from its kept program, which is the compiler that wrote its entries. The tools write it beside them, so such a folder joins the rule without a rebuild.
- The source stamp names a new folder and forms CI's cache keys, which a run reads before it builds the program. When a folder of that name already holds another compiler's entries, the new compiler takes `<stamp>-<fingerprint>`, because entries share a key when their folder names match.
- An entry's key names exactly what decides its output. That is the cache format, the folder (one compiler), the entry's name and file, its manifest table, and the listed permutation words. Its source enters without comments and without the white space between tokens. Its stored dependencies name the library modules that its builds read, each by the same canonical text.
- The canonical text keeps every token in order. It keeps a line break only where one can make a directive. That is before a `#` token, or before a WGSL directive word at the start of a line. It also keeps the break that ends such a line. Every other line break reads as a space. So a comment line, a blank line or a wrapped statement leaves the key.
- The key cannot name a compiler program whose bytes change but whose output does not. Whether such a program writes the same shader is undecidable without compiling. Such a change therefore compiles every entry. A wrong reuse ships a stale shader, which is worse than a rebuild.

## Where the key-named entry came from

The entry file named for its key, the shared text table and the folder pruning landed on main at `e27d69055`. That landing took the work of the historical branch `fix/build-cache-hardening` (commit `232f2d25f`). The branch holds nothing beyond main, and it does not decide the compiler's folder or the entry's source text. Its cache format is the base that this change extends.

## Verification

- Two builds of this branch's `shader-build`, one in a worktree and one in a copied tree at another path, have the same bytes: SHA-256 `f27e3e2d…`. The two kept programs of the compiler before this change differed in one string only, the checkout path.
- The cache and command tests compile the same sources with the old and the new key path. They compare the modules byte for byte: `a_warm_cache_writes_the_same_modules_as_a_cold_build`, `a_warm_cache_gives_the_same_output_as_a_cold_build`, and `a_comment_that_changes_no_token_reuses_every_entry`.
- The two settings that no key names, `NULL3D_SHADER_THREADS` and `NULL3D_SHADER_COMPOSER_BUILDS`, leave the modules byte-identical. `the_threads_and_the_composer_reset_do_not_change_the_modules` checks this.
- A change to a token, a manifest table, a listed word set or a library module compiles the entries it reaches. A change to a compiler program reads a folder that program wrote. The tests `a_change_to_a_token_or_to_a_directive_line_changes_the_key`, `a_manifest_change_recompiles_the_entry_it_names`, `a_narrowed_build_does_not_reuse_the_entry_of_another_list`, `changing_a_library_module_compiles_only_its_importers` and the folder tests of `tools/lib/shader-modules.test.ts` check these.

## The GPU line

`tools/hooks/check-gpu-ack.ts` names `crates/null3d-shaders/(src|wgsl)/` as GPU-bearing. A change to this cache therefore asks for a `GPU-Checked:` line, although it cannot change what the GPU draws. It changes which stored entry a build reads and removes a path from the compiler program. The line comes from `bun run bench:gpu-check` at the branch's head in a prepared checkout. It is a timed check, and the comparison of generated modules above is not a substitute for it.

## CI keys

- **Field names.** `--cache-keys` prints `key`, `branch-keys`, `stamp-keys`, `stamp`, `inputs`, `modules-dir` and `entries-dir`, and also `any-stamp-keys`, a cache prefix of the runner's system alone. `--entry-folder` prints `folder=<path>`, the entry folder that a build read or would write.
- **Where entries live.** Each entry folder is `<entries-dir>/<stamp>`, where the stamp is the source state that first wrote it, and its `compiler` file records the program's fingerprint. A run whose source stamp differs but whose program has the same bytes reads and writes that earlier stamp's folder. It does not create a folder of its own.
- **Restores across stamps.** Only with `any-stamp-keys` in `restore-keys`, which `.github/actions/shaders` and the `shader-entries` job add last. The first two prefixes find an exact stamp first. A restore can then bring an earlier stamp's folder, and the tools reuse it. The action prunes to the folder that the build used, not to the current stamp's, and the build job passes that folder to the shader tests. The shard download targets `<entries-dir>/<stamp>`; when a shard wrote new entries into an earlier folder, the build job compiles those few entries again, and the unchanged set is reused.

## Consequences

- `tools/lib/shader-modules.ts` holds the fingerprint, the marker and the folder choice. `buildEntriesShard` returns the folder that it filled as well as the files that it stored.
- Cargo compiles the program after any compiler source change, which takes seconds, and `sccache` usually shortens it further. That compile does not decide whether the entries are valid.
- A change to the generated WGSL of one entry compiles that entry. A change to a library module compiles the entries that import it.
- A comment, a blank line or a reflowed statement compiles nothing, in an entry or in a library module. The canonical text is the same, and so is the key.
- This change compiles every entry once for each cache root on a machine. Both the program's bytes and the entry key change. Every build after it reuses the entries of every checkout at that path.
- CI has the same reuse. The action's restore ends with a key prefix that names no source stamp, so a stamp change restores the newest entries of any stamp. The build reads the folder whose recorded program matches that compiler. The action keeps and saves that folder rather than the current stamp's, and the build job names it for the shader tests.
- A source change that changes the program's bytes rebuilds every entry. That is the price of never reusing another compiler's output.
- The module set is keyed, as the entry folders are, by the compiler program's bytes together with the manifest, the WGSL files and the listed words. A comment therefore reads the set that an earlier source state wrote, instead of writing a set of 2.8 GB of its own, and a checkout that reads it copies those modules into place. A change to the program's bytes or to a shader gives another key, and a set in a folder of its own.
