# guides-1-substance-30

## Finding as given

- page: guides/first-use-shaders
- anchor: rows 'texcoords' (line 22) and 'instance_index' (line 52)
- category: unclear
- severity: low
- claim: The intro says preload takes every name in the table, but two names serve only the engine's tests. A reader may preload shaders the page never uses.
- evidence: docs/guides/first-use-shaders.md:13, 22, 52; tools/lib/first-use-docs.ts.
- proposedEdit: Mark test-only features so the generator leaves them out, or add 'Do not preload it' to their rows.
- generatedSource: tools/lib/first-use-docs.ts

Verdict: refuted

## Evidence

- The intro (docs/guides/first-use-shaders.md:13) says "`preload` option takes these names". That is a statement of what the option accepts, not advice to preload every name. It is true: preload does accept both names. The error text for a wrong preload name lists them too, as "instance_index and texcoords for the engine's own tests" (packages/engine/src/errors/codes.ts:467).
- The two rows already tell the reader that an app never needs them. Line 22 says the 'texcoords' shaders download "only in the engine's own tests". Line 52 says the same for 'instance_index'. The column is "Its shaders download", so the row says an app never downloads them. A reader who reads the row will not preload them. A reader who does not read the rows is not helped by more row text.
- The generator states its purpose: the page "lists every feature that `preload` takes" (tools/lib/first-use-docs.ts:1-4), and the note at line 11 of the page repeats it ("it lists every feature of this version"). The first proposed edit, to leave the test names out, would break that promise. The page would then list fewer names than preload accepts and than the error message names.
- The cost of the misreading is small. Each feature file is at most 128 KB after Brotli (docs/guides/loading-screens.md:202). A reader who preloads one of these names downloads one small file and gets no error.
- The second proposed edit, "Do not preload it", repeats what "only in the engine's own tests" already says. It is a matter of taste.

## Corrected claim or edit

None needed. If the maintainers want extra polish, the cheapest change is in the FIRST_USE_DOWNLOADS entries for texcoords and instance_index (tools/lib/first-use-docs.ts:72-74): "never in an app; only the engine's own tests use it, ...". Keep both rows on the page.
