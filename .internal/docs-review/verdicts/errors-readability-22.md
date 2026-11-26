# errors-readability-22

## Finding as given

```json
{
 "page": "errors/E1424",
 "anchor": "page line 13",
 "category": "technical-details-block",
 "severity": "medium",
 "claim": "The cause is 138 words in 7 sentences, with sentences of 29 and 33 words. It explains file naming for each GPU path before it says that the engine stops drawing.",
 "evidence": "stats.json E1424: line 6 (138, 7). codes.ts line 491.",
 "proposedEdit": "Cause: 'A file that holds a custom shader's builds did not download, so the engine draws no new frames. The server answered with an error, sent another file in its place, or the connection broke off.' Details block 'Technical details: the shader build files' for the material-*.js, effect-*.js and curve-*.js names and when each one downloads.",
 "generatedSource": "packages/engine/src/errors/codes.ts (E1424)",
 "id": "errors-readability-22",
 "slice": "errors",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The page says what the finding claims. docs/errors/E1424.md line 13 is one paragraph of 7 sentences (stats.json: 138 words, 7 sentences). The 29-word sentence ("The null3D Vite plugin builds ...") and the 33-word sentence ("A page downloads its device's file ...") are there. The effect on the reader ("The engine then draws no new frames.") is the last sentence.
- The problem is worse than the finding says. The cause field's own contract in packages/engine/src/errors/codes.ts line 13 is "What went wrong, in one or two sentences." E1424 breaks it. The same text is also copied into the page's front-matter summary (tools/lib/docs.ts line 442, page line 6) and into the E1424 row of the error index table (tools/lib/docs.ts line 466, docs/errors/index.md line 77). So the long text makes the index harder to scan too.
- The proposed edit cannot be made in the named source alone. The error page renders the cause field three times: in the front-matter summary, in "What happened", and in an index table cell (tools/lib/docs.ts lines 436-469). A details block put in the cause string would land in a YAML summary and in a table cell, where it breaks. ErrorEntry (codes.ts lines 10-21) has no field for extra detail, and errorPage has no place to render one.
- The file-name detail already exists in a linked-to-be guide. docs/guides/custom-shaders.md lines 170-181 say what material-*.js, effect-*.js and curve-*.js files the build writes and how many. docs/getting-started/hosting.md line 284 says these files go in the start group. The fix text on the error page (fixes.ts line 131-132) already names all three file patterns, so the reader still sees them with the block closed.

## Corrected claim

The cause of E1424 is 138 words in 7 sentences. The field is meant to hold one or two sentences, and the same text also fills the page summary and the E1424 row of the error index. The file-naming detail comes before the effect on the reader. A details block is right for that detail, but the error table needs a new optional field for it, because the cause field cannot hold a block.

## Corrected edit

Sources to edit: packages/engine/src/errors/codes.ts (ErrorEntry and E1424) and tools/lib/docs.ts (errorPage).

1. Cause (codes.ts, E1424): "A file that holds a custom shader's builds did not download, so the engine draws no new frames. The server answered with an error, sent another file in its place, such as a web page, or the connection broke off."
2. Add an optional field to ErrorEntry for dense detail, for example `details?: { summary: string; body: string }`. In errorPage, when the field is set, render it under "What happened", after the cause paragraph:

```
<details>
<summary>Technical details: the shader build files</summary>

The null3D Vite plugin builds each custom material, effect and tone curve for every GPU path. It puts the builds in files of their own beside the sketch's files. A material's files are named material-*.js: one for each GPU path, each kind of device, and the builds that skin meshes. An effect's and a tone curve's files are named effect-*.js and curve-*.js: one for each GPU path. A page downloads its device's file when the sketch first uses the shader. It downloads another material file when a pipeline needs it, such as the skinning builds for the first skinned mesh. See [Custom shaders](../guides/custom-shaders.md) for the full list.

</details>
```

Do not render the field into the front-matter summary or the index table. The main text and the fix still make sense with the block closed, because the fix names all three file patterns.
