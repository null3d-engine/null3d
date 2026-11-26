# Verdict: errors-readability-18

## Finding as given

- page: errors/E1220
- anchor: page line 13
- category: long-paragraph
- severity: medium
- claim: The cause is 121 words in only 3 sentences, the first of 74 words. It mixes the faults of render.addPass() with those of five other render calls.
- evidence: stats.json E1220: line 6 (121, 3). codes.ts line 217.
- proposedEdit: Cause: 'A render pass call got options that it does not take, or something that is not a render pass of the kind it needs.' Then a bullet list 'render.addPass() refuses:' (including the 31-pass limit) and a list 'Other calls:' with the kind each of fromPass, setPassEnabled, setPassUniform, setPassUniforms and removePass takes.
- generatedSource: packages/engine/src/errors/codes.ts (E1220)

Verdict: partly

## Evidence

- The problem is real. docs/errors/E1220.md line 13 is one block of 121 words in 3 sentences (stats.json). The first sentence lists nine addPass faults; the third mixes five other calls and two kind rules. Source: packages/engine/src/errors/codes.ts line 217.
- The edit cannot go into the cause string as written. tools/lib/docs.ts errorPage (about line 436) uses the cause three times: the front-matter summary, the "What happened" body, and (errorIndexPage, line 466) a table cell in docs/errors/index.md. tableCell (tools/lib/api-docs.ts line 476) only escapes "|"; it keeps newlines, so a bullet list in the cause would break the E1220 row of the error index table and put a list into the summary. The ErrorEntry comment (codes.ts line 13) says the cause is "one or two sentences", and no other code's cause holds a list.
- The "Other calls" list would be incomplete. packages/engine/src/scene/render.ts also throws E1220 from render.setPassSteps (TSDoc line 890), render.resetPass (line 915), render.readPass (line 936, region and wait limits) and render.setPassEvery (line 1001; render.test.ts line 317). render.setPassUniforms also throws E1220 for a value that is not a number or for more than 32 values (line 862), not only for a pass of the wrong kind. The current cause leaves these out too, so a list of only five calls would copy the gap.

## Corrected claim

The cause paragraph is 121 words in 3 sentences and mixes addPass faults with faults of other render calls. It also leaves out several calls that throw E1220: setPassSteps, resetPass, readPass, setPassEvery, and the value checks of setPassUniforms.

## Corrected edit

Keep the cause short, because it is also the page summary and the error index cell, for example: "A render pass call got options that it does not take, or a pass of a kind it does not work on." Put the detail on the page only:

- Add an optional field to ErrorEntry (codes.ts) for page-only detail, and have errorPage in tools/lib/docs.ts render it after the cause as a collapsible block, with no headings inside:

  <details>
  <summary>Technical details: what each call refuses</summary>

  render.addPass() refuses: an unknown kind or option; no camera; a size outside 1 to the largest texture; both a size and a scale; an unknown input image; a workgroup size or dispatch that a device cannot run; a format that a compute pass does not write; a compute pass on WebGL2 with no fallback; a texture name or pass name that another pass has; a 32nd live pass.

  Other calls: textures.fromPass(), render.setPassEnabled() and render.removePass() take any render pass. render.setPassUniform() takes a full-screen pass. render.setPassUniforms() takes a compute pass and at most 32 numbers. Also list setPassSteps, resetPass, readPass and setPassEvery with the limits that their TSDoc states.

  </details>

- Leave the summary and index table on the short cause.
