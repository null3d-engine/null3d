# api-1-readability-30

## Finding as given

```json
{
 "page": "api/features",
 "anchor": "## Scene resources (lines 131-133); ## Published outputs (line 145)",
 "category": "unclear",
 "severity": "low",
 "claim": "'No pass makes a normals target today' and 'A custom material reads the scene's depth now' read as notes on a moving project, not as present facts. Line 131 repeats the 'normals' row at line 124.",
 "evidence": "features.md:124 'No pass makes them'. :131 'No pass makes a normals target today'. :133 'A custom material reads the scene's depth now'.",
 "proposedEdit": "Cut lines 131-133 to one sentence: 'The first four resources are the scene inputs that a custom material can also declare (SceneInput); FeatureResource adds history and shadowAtlas.' Put the motion-pass rule in the motionVectors row. Rewrite line 145 as one present fact about where a compute pass's texture goes.",
 "generatedSource": "",
 "id": "api-1-readability-30",
 "slice": "api-1",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The claim holds. docs/api/features.md:124 says of normals "No pass makes them". Line 131 says it again: "No pass makes a normals target today". Line 133 says "A custom material reads the scene's depth now". The words "today" and "now" hint at later work. AGENTS.md, "Writing docs", says a page states its limits as present facts and promises no later feature.
- The proposed edit adds an error. It says the first four resources are scene inputs "that a custom material can also declare". The type does list all four (packages/engine/src/scene/features.ts:57). But the check in packages/engine/src/scene/resources.ts (checkSceneInputs, near line 3835) throws E1217 for any scene input other than 'sceneDepth': "which custom materials do not read yet". So a custom material can declare only the scene depth. The page's present line 131 says this correctly ("A custom material declares 'sceneDepth'"), and the proposed sentence would lose it.
- The proposed edit also cuts line 133's link to the materials page and its sentence on when the engine binds a feature's reads. The link appears again in the table at line 299, but the binding sentence appears nowhere else on the page.
- Line 145 has no time words. It opens with a negative ("No adapter binds a registered output to a texture"). A rewrite that states where the texture goes is fair polish, but the claim gives no reason for it.
- The page is hand-written, not generated, so no other source needs an edit.

## Corrected claim

Lines 131-133 repeat the normals row at line 124 and use "today" and "now", which read as notes on unfinished work. Line 145 is correct but opens with a negative. Any merged sentence must keep the fact that a custom material declares only 'sceneDepth'.

## Corrected edit

Normals row (line 124): keep "No pass makes them, so a feature that reads them gets the neutral value."

motionVectors row (line 125): "How far each pixel's surface moved since the last frame. The motion pass runs only while a reader wants them."

Replace lines 131-133 with:

"The first four are the scene inputs (`SceneInput`). `FeatureResource` adds `'history'` and `'shadowAtlas'` to them. Of the scene inputs, a custom material declares only `'sceneDepth'` ([Materials](materials.md#the-scene-behind-a-surface)). The engine binds a feature's reads when it places the feature in the frame."

Line 145: "A compute pass publishes the texture that its description names, and a material reads it through `textures.fromPass`. The engine checks the declared neutral default and keeps it."
