# Verdict: api-3-readability-01

## The finding as given

- page: api/wind
- anchor: "## Reading the field in your own WGSL, lines 79-328"
- category: technical-details-block
- severity: high
- claim: Two WGSL copy blocks of about 190 lines (lines 83-224 and 226-270) sit right after the calls table. A reader must scroll past them to reach the plain explanation ('What the field is', line 330), the presets and the costs.
- evidence: line 81 'Copy both from shaders/field.wgsl in the package, or from the blocks below.'; line 328 'Tests hold the readers' blocks equal to this page's.'; stats.json 4,060 words, the concept heading follows the WGSL section.
- proposedEdit: Move '## What the field is' (lines 330-344) to come right after '## The calls'. In the WGSL section, keep lines 81, 272, 290-324 (uniforms example and vertexOffset example) in the main text. Wrap each copy block in `<details><summary>Technical details: the steady field block to copy (wind-steady)</summary>` and `<summary>Technical details: the sampling block to copy (wind-sample)</summary>`, with the `// <wind-steady>` and `// <wind-sample>` markers kept inside the fences so the block test still finds them. Change line 81 to '... or open the two blocks below.'

Verdict: partly

## Evidence

- docs/api/wind.md: headings are at lines 59 (The calls), 79 (Reading the field in your own WGSL), 330 (What the field is), 346 (Presets and the governor), 365 (Costs and limits). The two WGSL fences run from line 83 to 224 (142 lines) and from 226 to 270 (45 lines), about 187 lines in all. The claim about the layout holds.
- Line 81 already tells the reader the same code is in `shaders/field.wgsl` in the package, so folding the copies costs a reader nothing.
- packages/wind/src/grid.test.ts:7-14 finds a block with `text.indexOf('// <name>')` and `indexOf('// </name>')` over the whole page file; lines 150-151 compare the page's `wind-steady` and `wind-sample` blocks. A `<details>` wrapper around the fences does not change what the test finds, so the edit is safe for the test.
- tools/lib/docs-style.ts:191 strips HTML tags before it counts words, so the `<details>` and `<summary>` tags do not break the style check.
- Moving "What the field is" up changes no anchor, so links into the page still work.
- With both blocks closed, the main text still reads: line 272 names "the sampling function", line 294 says "then the two sampling blocks", and the vertex offset example has "// The two sampling blocks go here." These all still make sense when a reader sees only the block titles.

## What does not hold

- Severity. Nothing misleads and nothing blocks a newcomer: the install line, the starter sketch and the calls table all come before the WGSL. A reader can also jump by heading. The cost is a long scroll, so this is medium, not high.
- Line ranges in the edit. The uniforms example is the TypeScript block at lines 274-288, not inside 290-324. Lines 290-328 are prose plus the vertex offset example (296-320), and lines 326 and 328 (forest demo, other readers) must stay too. The edit should say: wrap only the two fences (83-224 and 226-270); keep every other line of the section, 272-328, in the main text.

## Corrected claim

Two WGSL copy blocks, about 187 lines (lines 83-224 and 226-270), sit between the calls table and the plain account of the field (line 330), the presets and the costs. The same code ships in `shaders/field.wgsl`, so the long inline copies make the page clearly harder to read. Severity: medium.

## Corrected edit

1. Move "## What the field is" (lines 330-344) to come right after "## The calls" (after line 77).
2. Wrap the fence at lines 83-224 in:

   <details>
   <summary>Technical details: the steady field block to copy (wind-steady)</summary>

   ...the fence, unchanged, markers inside...

   </details>

3. Wrap the fence at lines 226-270 the same way, with `<summary>Technical details: the sampling block to copy (wind-sample)</summary>`.
4. Keep all other lines of the section (81, 272-328, including the TypeScript uniforms block at 274-288 and the vertex offset block at 296-320) in the main text.
5. Change line 81's end to "Copy both from `shaders/field.wgsl` in the package, or open the two blocks below."
