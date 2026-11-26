# Verdict for api-1-substance-02

## The finding as given

```json
{
 "page": "api/features",
 "anchor": "## The fields rows outputs and provides (77-78); ## Scene resources (124, 131, 133); ## Published outputs (145); ## Lighting slots (149)",
 "category": "contradiction",
 "severity": "high",
 "claim": "The table says outputs are published to materials, effects and passes, and that provides gives lighting slots. Later the page says no adapter binds an output, no part of the engine reads a slot, and no pass makes normals. Lines 11, 131 and 133 add 'work today', 'today' and 'now', which read as a promise of later work.",
 "evidence": "docs/api/features.md:11, 77-78, 124, 131, 133, 145, 149. AGENTS.md Writing docs: 'A page describes what exists now ... It makes no promise of a later feature.'",
 "proposedEdit": "Fields table: outputs 'Names and neutral defaults that the registry keeps unique. No adapter binds them; a compute pass publishes its own texture.' provides 'Slots that the registry keeps to one owner. The engine reads no provider.' Drop 'today'/'now' at lines 11, 131, 133; line 11 ends 'A registration checks the shape, and the adapters place the work of each kind.'",
 "generatedSource": "",
 "id": "api-1-substance-02",
 "slice": "api-1",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- The page is hand-written (docs/api/features.md, not under api/reference). The same wording is also in the TSDoc at packages/engine/src/scene/features.ts:255 and :330, so a fix should change both.
- The outputs row is true for compute features. The compute adapter takes exactly one output, and that output names the pass's storage texture (packages/engine/src/scene/render.ts:1306-1321, :275). Materials, effects and passes all read that texture through `textures.fromPass` (render.ts:3, :62, :339; effects.ts:66). So "publishes to materials, effects and passes" is not false. Line 145 says the same thing: the registry entry is not bound, but the compute pass publishes the texture. The two do not contradict each other. The proposed row text, "No adapter binds them", hides the one real path and is less accurate than the current text.
- The provides row is weaker. `FeatureRegistry.provider()` (features.ts:1139) is only a lookup. No code outside tests calls it. The full-screen adapter refuses any slot (feature-effects.ts:132-136). "The lighting slots that the feature provides" makes a reader expect an effect on lighting, and only line 149 corrects that. This part holds.
- Line 124 ("No pass makes them") is a present limit stated as fact, which the writing rule allows. It does not contradict the table, because the table does not list resources.
- Wording that points at time: line 11 "work today", line 131 "today" and line 133 "now" do imply a change before or after (AGENTS.md:230). This part holds as low polish.
- Severity: the page states each limit plainly in its own section (lines 145 and 149), so a reader is not misled for long. Medium fits better than high.
- Missed on the same page: line 11 opens with "Roadmap step 0.3", which is an internal plan word that docs/ must not contain. Also, the example at lines 37-61 declares `kind: 'fullscreen'` with `outputs: { flare: ... }`. `post.addFeatureEffect` refuses a full-screen feature that has outputs (feature-effects.ts:127-131), so the example cannot become the effect that line 11 describes.

## Corrected claim

The provides row says a feature "provides" a lighting slot, but no part of the engine reads the slot's owner (features.ts:1139 has no callers outside tests). Only the Lighting slots section says this. The outputs row is correct for compute features, whose one output is a texture that materials, effects and passes read through `textures.fromPass`. It does not contradict line 145. The words "today" at lines 11 and 131 and "now" at line 133 imply change over time. Severity: medium.

## Corrected edit

- outputs row (and the TSDoc at features.ts:330): "The textures that the feature publishes, by name, each with a neutral default. A compute pass publishes its one output as a texture that materials, effects and passes read through `textures.fromPass`."
- provides row (and the TSDoc at features.ts:336): "The lighting slots that the feature claims. The registry keeps one owner for each slot, and no part of the engine reads the owner."
- Line 11: remove "Roadmap step 0.3," and end with "A feature's preset settings, budget, GPU scope and stats work as the feature host describes."
- Line 131: "No pass makes a normals target, and the motion pass runs only while a reader wants the motion vectors."
- Line 133: "A custom material reads the scene's depth ([Materials](materials.md#the-scene-behind-a-surface))."
- Example: drop the `outputs` line from the full-screen description, or change the example to a compute feature.
