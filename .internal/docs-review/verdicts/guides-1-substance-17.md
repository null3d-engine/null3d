# guides-1-substance-17

## Finding as given

- page: guides/baked-light-data
- anchor: "Both calls throw [E1434](../errors/E1434.md) ..." (line 137)
- category: structure; severity: medium
- claim: The error paragraph follows 'Needle light maps', so 'Both calls' reads as the Needle loader; it means loadLightProbeGrid and loadLightMap. The Needle section is about glTF and splits 'Load a file' from 'Save a grid'.
- evidence: docs/guides/baked-light-data.md:126-137, 157-170; packages/engine/src/errors/codes.ts:543-548.
- proposedEdit: Move line 137 to open 'What the loader checks': "loadLightProbeGrid and loadLightMap throw E1434 for a file they cannot read, and the message names the fault:". Move 'Needle light maps' after 'Limits' or to the glTF page.

Verdict: partly

## Evidence

- docs/guides/baked-light-data.md:126-137: line 137 ("Both calls throw E1434") sits as the last paragraph under "## Needle light maps". The two calls it means are named only in "## Load a file" (lines 103, 108, 120, 122). Under the Needle heading the only actor is the glTF loader, so "Both calls" has no clear subject.
- packages/engine/src/errors/codes.ts E1434: the cause names only assets.loadLightProbeGrid() and assets.loadLightMap(). No glTF source (packages/engine/src/scene/gltf.ts, gltf-parse.ts) throws E1434. So a reader can wrongly think a bad Needle extension throws E1434. The claim holds.
- Lines 137 and 157-170 overlap: the version fault, the payload count fault and the cut-short download all appear again in the "What the loader checks" list. Folding line 137 into that section removes the repeat.
- The Needle section (glTF extension) splits the two sections about the JSON file's own calls (Load a file, Save a grid). That holds too.

## What does not hold

- "or to the glTF page": no glTF guide page exists in docs/. docs/api/assets.md:95 links to `../guides/baked-light-data.md#needle-light-maps`. Moving the section off this page breaks that link. Moving it within the page, with the same heading, keeps the anchor.

## Corrected edit

1. Delete line 137. Merge it into the opening of "What the loader checks" (line 159): "`assets.loadLightProbeGrid` and `assets.loadLightMap` throw [E1434](../errors/E1434.md) for a file whose contents do not agree with its own members. The message names the fault:". Keep the list as it is.
2. Move "## Needle light maps" (lines 126-135) to the end of the page, after "Limits", and keep its heading unchanged so the link from docs/api/assets.md still resolves. Optionally open it with one sentence that says this path does not read a baked light file and does not throw E1434.
