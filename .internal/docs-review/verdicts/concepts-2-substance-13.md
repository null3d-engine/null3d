# concepts-2-substance-13

## Finding as given

```json
{
 "page": "concepts/quality-presets,concepts/post-processing,concepts/static-dynamic",
 "anchor": "\"hold mode\": quality-presets lines 85, 124, 287, 317; post-processing 178, 400; static-dynamic 74",
 "category": "term-before-definition",
 "severity": "medium",
 "claim": "These pages use \"hold mode\" with no definition and no link. Only the testing guide explains it.",
 "evidence": "docs/guides/testing.md defines hold mode; docs/api/page.md.",
 "proposedEdit": "At the first use on each page: \"[hold mode](../guides/testing.md), which draws one fixed frame for image tests,\".",
 "generatedSource": "",
 "id": "concepts-2-substance-13",
 "slice": "concepts-2",
 "role": "substance"
}
```

Verdict: survives

## Evidence

- Every line the finding names uses "hold mode": concepts/quality-presets.md:85, 124, 287, 317; concepts/post-processing.md:178, 400; concepts/static-dynamic.md:74.
- None of the three pages links to guides/testing.md or api/page.md. A search for those link targets in the three pages finds nothing. None of the pages defines the term.
- Some context exists, but it does not define the term. quality-presets.md:287 says hold mode is there "so tests draw the same image on every run". post-processing.md:400 says "Hold mode, and so the image tests". A reader can guess that the mode is for tests, but not what it does.
- The definition is at guides/testing.md:52-80, in the "Hold mode" section. api/page.md:88 has a short "Hold mode" section that links to the testing guide.
- Other pages link the term at its first use. Examples are cookbook/index.md:19 (`[hold mode](../guides/testing.md)`), guides/custom-passes.md:308 (`[hold mode](testing.md#hold-mode)`) and guides/physics.md:123. So the three concept pages do not follow the docs' own pattern.
- These pages are hand-written, so there is no generated source to edit.

## Corrections to the proposed edit

- Link to the section, not only the page: `../guides/testing.md#hold-mode`, as custom-passes.md does.
- "draws one fixed frame" is not quite right. Hold mode steps the sketch from time 0 to a set time with fixed steps and draws the last frame. It sometimes draws one or two more frames at that time (testing.md:66-76). Use "steps the sketch to a set time and draws the same frame on every run".
- At quality-presets.md:85 the term starts a sentence. Write "[Hold mode](../guides/testing.md#hold-mode), which ..., and the `?preset=` switch leave the note alone." An insert that long in a list of two subjects reads badly. A short gloss is better there: "Hold mode, which draws a fixed frame for image tests ([Testing your sketch](../guides/testing.md#hold-mode)), ...". Or make the link in the earliest sentence that reads well.
- At post-processing.md:178 the first use is "hold mode's one frame". Link it there: "[hold mode](../guides/testing.md#hold-mode)'s one frame". Line 400 already says "and so the image tests", so the link there gives enough context.
- static-dynamic.md:74 is a long paragraph. Add only the link there, "[Hold mode](../guides/testing.md#hold-mode) stops at it, so a test fails at once." Do not add a clause.

Corrected edit: at the first use on each page, link the term to `../guides/testing.md#hold-mode`. Where the sentence has room, add a short gloss: "which steps the sketch to a set time and draws the same frame on every run, for image tests". Keep the gloss off the static-dynamic paragraph, which is already long.
