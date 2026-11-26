# start-readability-30

## The finding as given

- Page: cli/null3d
- Anchor: "### The JSON file (lines 84 and 389)"
- Category: technical-details-block
- Severity: low
- Claim: Two field-by-field tables of 10 and 8 rows break the flow from "what it prints" to the failure cases. Readers who script against the JSON want them; readers who run the command do not.
- Evidence: cli/null3d.md lines 86 to 100 and 391 to 400.
- Proposed edit: Replace each heading and table with one sentence ("shot also writes a JSON file beside the image, with the frame's facts and what the page logged.") followed by `<details><summary>Technical details: the fields of the JSON file</summary>` holding the table, with no heading inside.
- Generated source: none (hand-written page)

## Verdict: partly

## Evidence

- The page is hand-written (docs/cli/null3d.md), so no generated source applies.
- Lines 84 to 100 (shot) and 389 to 400 (bench) are field references. A person who runs the command does not need them. A person who parses the file does. This fits the owner's request for collapsible technical blocks.
- No page or skill links to the "the-json-file" anchors, so removing the two headings breaks no link.
- The core idea holds. Three parts of the proposed edit do not:
  1. For shot, the new sentence repeats the text that is already there. The sample output at line 78 says "Saved shot.png, and the frame's facts and what the page logged in shot.json". Line 82 says "The JSON file holds every line." Line 60 names the file. A fourth sentence that says the same thing adds nothing.
  2. The bench table needs its own sentence. The proposed sentence names shot and the image. bench writes no image. Its file is `bench.json` or the `--out` file (line 361).
  3. The `stats` row (line 96) holds a warning that changes how a reader reads the numbers. The held frame is the first frame, so it builds every pipeline and uploads the whole scene. If this warning is hidden in a closed block, a reader can take the draw calls, uploads and pipelines in the summary (line 77) as steady-state figures. This warning must stay in the main text.
- The bench `environment` row says "as for `shot`". With both tables closed, that pointer leads into another closed block. Give the two values directly.

## Corrected claim

The two JSON field tables are reference detail for scripts. Each one can go into a closed block under the section before it. Remove the "The JSON file" headings. Keep the first-frame warning in the main text. Add no new sentence for shot. Add one sentence for bench that names its own file.

## Corrected edit

shot: Delete the heading "### The JSON file" (line 84). After line 82, add one sentence to the main text: "The figures are those of the first frame, so it builds every pipeline and uploads the whole scene." Then put the table in `<details><summary>Technical details: the fields of the JSON file</summary>`. In the block, the `stats` row keeps only "The frame's figures in the form that `engine.measure()` returns: CPU time by thread and phase, draw calls, uploads and pipelines". Place the block before "### When it draws no frame".

bench: Delete the heading "### The JSON file" (line 389). After line 387, add "`bench` also writes every figure to `bench.json`, or to the file that `--out` names." Then put the table in a `<details>` block with the same summary. In the `environment`, `browser` row, change "as for `shot`" to "`chrome-real-gpu` or `chromium-swiftshader`". Put no headings inside either block.
