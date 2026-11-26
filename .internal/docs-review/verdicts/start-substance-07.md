# start-substance-07

## The finding as given

- page: cookbook/index
- anchor: line 21 "The recipes that load files name them as a project serves them from its public folder"
- category: missing-prerequisite
- severity: medium
- claim: Four recipes load /models/knight.glb, /models/morph-cube.glb or /env/sunset.hdr. The page links three large sources, but it does not say which file goes at which address. Two recipes also hide node names, such as 1H_Sword, that exist only in the Knight file.
- evidence: tests/lib/skill-sketches.ts:89-93 (knight.glb is kaykit-knight/Knight.glb, morph-cube.glb is AnimatedMorphCube, sunset.hdr is venice_sunset_2k.hdr).
- proposedEdit: Replace the sentence with a table of address, file and source: /models/knight.glb is Knight.glb from KayKit Adventurers; /models/morph-cube.glb is AnimatedMorphCube.glb from the Khronos glTF sample assets; /env/sunset.hdr is venice_sunset_2k.hdr from Poly Haven. Say that the weapon names belong to the Knight file.

Verdict: partly

## Evidence

- Four recipes load files: the third-person camera (line 168, knight.glb), the crowd (line 252, knight.glb), the loading screen (lines 284-289, knight.glb and sunset.hdr) and the morph targets (line 318, morph-cube.glb). This part holds.
- The address-to-file map in tests/lib/skill-sketches.ts (the recipe-files table) is as the finding says.
- Two of the three mappings can already be worked out from line 21. "KayKit Knight" plainly goes with knight.glb. The Poly Haven link points at the venice_sunset page itself, so the sky file is named; only the resolution is left open, and any resolution works.
- The real gap is the morph file. Line 21 links only the root of the Khronos sample repository and says "a Khronos glTF sample model". That repository holds many models. The morph recipe (line 319) then looks up a node by the exact name "AnimatedMorphCube" and casts the result to a mesh, so with any other model the sketch fails. A reader cannot tell which model to download without guessing from the address.
- The weapon-name part does not hold. The third-person recipe already says at line 152, in a comment above the list, "The Knight file holds every weapon of the set." The crowd recipe (line 238) calls them "The weapons of the set". Both recipes look up each name with an optional call (`find(name)?.setVisible(false)` and the same style), so with another model the names do nothing and nothing breaks.

## Corrected claim

Line 21 does not say which Khronos sample model goes at /models/morph-cube.glb. The morph recipe needs AnimatedMorphCube by name, so a reader who picks another model gets a broken sketch. The Knight and sky files can be worked out from the link text. The weapon names are already tied to the Knight file in the recipe's own comment.

## Corrected edit

Keep line 21's first two sentences. Replace the third with a short list or a three-row table (address, file, source), for example:

| Address | File | Source |
| --- | --- | --- |
| `/models/knight.glb` | `Knight.glb` | [KayKit Adventurers](https://kaylousberg.itch.io/kaykit-adventurers) (CC0) |
| `/models/morph-cube.glb` | `AnimatedMorphCube.glb` | [Khronos glTF sample assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/AnimatedMorphCube) |
| `/env/sunset.hdr` | `venice_sunset_2k.hdr` | [Poly Haven](https://polyhaven.com/a/venice_sunset) (CC0) |

Introduce it with one sentence: "The tests serve these files at those addresses." Drop the part of the proposal about weapon names; the recipe comment already covers it. Severity stays medium only for the morph file; low if judged across all three.
