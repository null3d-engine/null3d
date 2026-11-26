# Verdict: api-3-readability-06

## The finding as given

- page: api/scene
- anchor: lines 71, 75, 88, 115, 117, 158, 177, 206, 208, 242, 246, 252, 296, 298, 319, 321, 323, 341, 347, 375, 412, 450, 488, 512, 518, 549, 579, 583 (stats lines minus front matter: subtract 7)
- category: long-paragraph
- severity: medium
- claim: 28 paragraphs go past 4 sentences or 90 words. The worst are line 296 (148 words, 3 sentences), 246 (157 words), 488 (185 words), 341 (166 words, 12 sentences), 375 (160 words) and 518 (154 words, 11 sentences).
- evidence: stats.json longParagraphs for api/scene.
- proposedEdit: Line 71 and 518: turn the option lists into bullets. Lines 246, 341, 412, 452, 488, 514: move the trailing error codes to an Errors table. Lines 296 and 298: keep 'The layer also shows in reflections and in the sky's light on the scene.' and put the environment-map fill detail in <details><summary>Technical details: how a sky layer reaches the environment map</summary>. Lines 319-323: three bullet groups (what a view draws, costs, leaves out), with the 8-bit path sentences in a details block. Line 347: details block 'what each probe holds'. Line 375: numbered steps for the three ray outcomes. Line 177: split, with the environment map's 16-step and start-time rule in a details block. Others: break at the fourth sentence where the topic changes (for example line 75 before 'The engine reserves the places').
- generatedSource: (none; docs/api/scene.md is hand-written)

Verdict: partly

## Evidence

- stats.json lists 28 long paragraphs for api/scene, at lines 64 to 576. The finding's lines are those plus 7, and they match the page file: line 296 of docs/api/scene.md is "The layer reaches the sky's environment map...", line 341 is "Each call sets both options...", line 488 is "`background` mixes the scene's fog...". So the line numbers are right for the file. The anchor note "subtract 7" has the direction backwards: the stats lines are 7 lower than the file lines.
- The word and sentence counts in the claim match stats.json (stats 289: 148 words, 3 sentences; 239: 157; 481: 185; 334: 166/12; 368: 160; 511: 154/11).
- Other API pages hold a "## Errors" table with linked codes (docs/api/post.md, assets.md, features.md and more). docs/api/scene.md has no such section (headings at lines 41 to 604). So an Errors table fits the site's own pattern.
- Errors in the edit's error-code list:
  - Line 246 has no error codes. It covers shader downloads, allocation and orthographic cameras. The sky's error codes are in the short paragraph at line 248.
  - Lines 452 and 514 are not long paragraphs. Line 452 is the probe limits paragraph and line 514 is the fog light's error paragraph. Moving their codes is fine, but it is outside this finding.
  - Line 323 (a long paragraph) ends with E1501, E1213 and E1203, and the list leaves it out. Line 88 has E1417 too, but that code comes with the fix ("Give createInstances one of its meshes"), so it should stay in the text.
- Line 298 is mostly what a user does: the `refresh` option and how its value sets the fill rate, and the aurora example. Only the "twenty frames, one stage a frame" and the "20 stage draws a second" figures are dense detail. The `refresh` guidance must stay in the main text, or the main text fails with the block closed.
- Line 375: the three ray outcomes (sky, back face, front face) happen at the same time for different rays. They are not a sequence, so a numbered list states an order that does not exist. A bulleted list fits.
- Line 177: the two limits of clouds in the environment map affect what users see in reflections. The block can hold the detail only if the main text keeps "The sky's environment map takes the clouds too, with two limits" and names them in short form.
- The rest of the edit holds: bullets for lines 71 and 518, the break at line 75 before "The engine reserves the places", the details blocks for lines 296 and 347, and the bullet groups for lines 319 to 323.

## Corrected claim

The 28 long paragraphs and their counts are correct, at the file lines given. The stats lines are 7 lower than the file lines, not 7 higher.

## Corrected edit

- Lines 71 and 518: turn the option lists into bullets.
- Add a "## Errors" table, as on the post and assets pages. Move into it the codes of lines 248, 323, 341, 412 (its first two sentences), 488 and, if wanted, 514. Keep E1417 with its fix at line 88. Line 246 has no codes. Split it at "Each call sets every option" and again at "An orthographic camera's view rays".
- Line 296: keep in the main text "The layer also shows in reflections and in the sky's light on the scene. None of this is the add-on's work." Put the second sentence (the second build into the cube-face shader, the nine coefficients, the asynchronous read) in a block "Technical details: how a sky layer reaches the environment map".
- Line 298: keep the `refresh` option, the value 0, the wait for the first capture and the aurora example in the main text. Put only the stage-per-frame figures in the same block.
- Lines 319 to 323: three bullet groups (what a view draws, what it costs, what it leaves out). Put the 8-bit path sentence in a block.
- Line 347: block "Technical details: what each probe holds" for the coefficients and masks.
- Line 375: a bulleted list, not numbered steps, for the three ray outcomes.
- Line 177: split it. Keep "The sky's environment map takes the clouds too, with two limits" and a short form of both limits in the main text, and put the 16-step and start-time detail in a block.
- Others: break at the fourth sentence where the topic changes.
