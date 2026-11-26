# Verdict: guides-1-readability-06

## The finding as given

- Page: guides/assets-pipeline
- Anchor: line 257 ('warning' row), line 264, line 278
- Category: duplication. Severity: medium
- Claim: Line 278, under '## The shader list', repeats the 'warning' row of the report table. Line 264 (file size limits and how to split a scene) sits under the budget report but is about what the command refuses to write.
- Evidence: line 257 'Each quality preset whose texture memory budget the model's textures pass'; line 278 'It warns for each quality preset whose texture memory budget the model's textures pass.'; line 264 'The command writes no model that the engine would refuse to load.'
- Proposed edit: Fold line 278's two new facts (phones take ETC2/ASTC bytes, computers BC7; models add together) into one sentence under the report table and delete line 278. Move line 264 to the end of '## Optimize a model'.

Verdict: partly

## Evidence

- docs/guides/assets-pipeline.md:257 and :278 do say the same thing about the warning, almost word for word. The duplication is real.
- Line 278 has four sentences, not two. Its first sentence, "The report ends with the list and the pipeline keys it gives", is correct and links the shader list section to the report. The code confirms the order: in packages/cli/src/assets/report.js, `reportLines` pushes `shaderLines` last, and `shaderLines` (lines 566-584) prints the shader permutations, the first-use shader files, the draw buckets and then the warnings. So deleting all of line 278 drops a correct bridge sentence.
- The new facts in line 278 are correct. `budgetWarnings` (report.js:353-371) tests the first two presets (Low, Medium) against the ETC2/ASTC bytes and the others (High, Ultra) against the BC7 bytes. Line 250 already names devices (phones, tablets and Macs against Windows PCs), but not presets. So the preset mapping is new detail that the warning row needs.
- Line 264 is about the command's refusal to write a model that passes the file limits (docs/concepts/assets.md:99 "Limits on each file" exists). It is not a figure of the report, so it does not belong under "## The budget report". Moving it to the end of "## Optimize a model" (after the options table at line 68) is a fair place. This part holds.
- Severity: one repeated sentence and one misplaced paragraph make the page a little harder to scan. They do not mislead. Low fits better than medium.

## Corrected claim

Line 278 repeats the warning row at line 257 in its second sentence, and its preset-to-format facts belong with the report table. Its first sentence, that the report ends with the shader list and the pipeline keys, is correct and belongs in the shader list section. Line 264 is about the command's file limits, not the report. Severity: low.

## Corrected edit

- Line 278: keep only "The report ends with the list and the pipeline keys it gives." in "## The shader list".
- Line 257, the `warning` row: "Each quality preset whose texture memory budget the model's textures pass, with the memory that passes it. Low and Medium count the ETC2 and ASTC bytes, as phones and tablets run them. High and Ultra count the BC7 bytes, as computers run them."
- Below the table, after line 262: "The warning is a guide: a scene that loads several models adds their texture memory together."
- Move line 264 to the end of "## Optimize a model", after the options table.
