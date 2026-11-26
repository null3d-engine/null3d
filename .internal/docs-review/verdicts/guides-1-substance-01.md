# Verdict: guides-1-substance-01

## The finding as given

```json
{
 "page": "guides/first-use-shaders",
 "anchor": "the 'taa' row: \"a prototype for measuring only (D-206)\"",
 "category": "internal-note",
 "severity": "high",
 "claim": "The row names a decision record (D-206) and calls the feature a prototype for measuring. Readers cannot follow D-206, the rules forbid decision record numbers in docs, and the reader cannot tell if 'taa' is a feature to preload.",
 "evidence": "docs/guides/first-use-shaders.md:31; tools/lib/first-use-docs.ts:25; docs/data/threejs-mapping.json:1762 says TAA is a prototype that does not ship.",
 "proposedEdit": "Change the taa text to \"when `post.set` turns the temporal resolve on. The resolve is not part of any quality preset, and a page that never turns it on downloads none of it\". Remove \"(D-206)\". Add a style check that fails on D-<number> in generated rows.",
 "generatedSource": "tools/lib/first-use-docs.ts",
 "id": "guides-1-substance-01",
 "slice": "guides-1",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- The row is real. docs/guides/first-use-shaders.md:31 reads "when `post.set` turns the temporal resolve on, a prototype for measuring only (D-206)". Its source is tools/lib/first-use-docs.ts:25.
- D-206 is a decision record in `.dev/decisions/`. Public docs never link there, so a reader cannot look it up. The reviewer brief bans decision record numbers in docs/. The "a prototype for measuring only" wording is also process talk.
- No style check catches it today. tools/lib/docs-style.ts:147 defines a pattern for D-numbers, but only the commit subject check (around line 491) and the release notes use it. The checks for docs pages (lines 371-405) catch `.dev/` links and milestone words, not D-numbers.
- The proposed edit has a flaw. It still tells the reader that `post.set` turns the resolve on. That option is not public. packages/engine/src/scene/post.ts:531-535 marks `taa` on the post settings as `@internal` ("A prototype of temporal anti-aliasing ... for measuring only"). Its settings type is internal too (line 538). The API reference does not list it. Only the `preload` feature name type lists `'taa'` (docs/api/reference/engine.md:515). So a reader who follows the new text looks for an option that the docs never show.
- The other parts of the new text are correct. No quality preset turns `taa` on: only post.ts and the GPU files mention it. The shaders download only when the option is on and HDR effects are on (post.ts:978).
- The proposed check is too narrow. D-numbers appear on three more published pages: docs/porting/threejs-mapping.md:255 (D-206, from docs/data/threejs-mapping.json, the "aa-passes" notes), docs/shaders/library.md:608 (D-79) and docs/api/reference/engine.md:618 (D-174). A check on "generated rows" alone would miss the written pages and the mapping notes.
- Severity: medium, not high. The row does not block a newcomer. Its cost is a reference the reader cannot follow, and no clear answer to "should I preload this?"

## Corrected claim

The 'taa' row cites a decision record (D-206) that readers cannot reach, and it uses process wording ("a prototype for measuring only"). It also does not tell the reader that the option that turns it on is internal and missing from the public API, so they cannot tell whether to preload `'taa'`. Severity medium.

## Corrected edit

In tools/lib/first-use-docs.ts, set the taa text to: "only by an internal test option of temporal anti-aliasing, which the public API does not offer. No quality preset turns it on, so a page never downloads these shaders, and preloading `'taa'` only adds to the download". This follows the pattern of the `texcoords` and `instance_index` rows.

For the check: in tools/lib/docs-style.ts, add an error for D-numbers (the existing D-number pattern) to the checks for pages written for users. It then covers every page under docs/, generated or written. Fix the other three pages in the same change: the mapping notes in docs/data/threejs-mapping.json ("aa-passes"), the source of docs/shaders/library.md:608 in tools/lib/shader-library.ts or the shader comments, and the TSDoc comment behind docs/api/reference/engine.md:618.
