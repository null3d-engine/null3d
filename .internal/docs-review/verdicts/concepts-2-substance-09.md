# concepts-2-substance-09

Finding as given:

```json
{
 "page": "concepts/post-processing",
 "anchor": "## Screen-space bounce light, lines 313-337",
 "category": "missing-content",
 "severity": "medium",
 "claim": "The section never says plainly that High and Ultra draw bounce light in every scene, with no post.set call, and that this turns the depth prepass on. It never says how to turn it off. The costs appear twice (line 329: 2.475 and 1.326 ms; line 337: 2.5 and 1.3 ms). Both say Ultra with 8 rays costs half of High with 4 rays, with no reason. The top diagram and the note under the title leave bounce light out.",
 "evidence": "docs/concepts/post-processing.md:11, 13-35, 329, 337; packages/engine/src/quality/presets.ts:240-251; docs/concepts/quality-presets.md:220.",
 "proposedEdit": "Open the section with \"High and Ultra draw bounce light in every scene, and it turns the depth prepass on. quality.set({ bounceRays: 0 }) turns it off.\" Keep the figures only under ### Cost. Check the Ultra figure, and give the reason if it is right. Add a bounce light node beside ambient occlusion in the diagram.",
 "generatedSource": "",
 "id": "concepts-2-substance-09",
 "slice": "concepts-2",
 "role": "substance"
}
```

Verdict: partly

## Evidence

What holds:
- Line 41 tells readers "Turn effects on with `post.set` in the sketch", and ambient occlusion (lines 252-256) and depth of field (lines 144-148) need `post.set`. Bounce light has no `post.set` key and draws from the preset alone (presets.ts:246-251, `presets: [0, 0, 4, 8]`, `webgl2: [0, 4, 4, 8]`). The section says only "High sets 4 and Ultra 8" and "The light is part of the preset table" (lines 329, 333). It never says plainly that it is on with no sketch call, unlike every other effect on the page.
- The section never says that bounce light turns the depth prepass on. The code does: crates/null3d-render/src/frame.rs:3010-3012 ("Ambient occlusion, contact shadows, the bounce light and screen-space reflections still draw it while they run"). Only quality-presets.md:220 says so. The AO and SSR sections on this page each say it (lines 225, 274, 305).
- The costs appear twice: line 329 (2.475, 1.326, 0.825 ms) and line 337 (2.5, 1.3, 0.8 ms).
- Neither place explains why Ultra (8 rays) costs less than High (4 rays). The reason exists in the source: .dev/decisions/D-284-screen-space-bounce-light.md:140-142 says the difference "lies inside these runs' spread". So the figure is right, and the reason is measurement noise.
- The diagram (lines 13-35) has no bounce light node. The note under the title (line 11) lists AO, SSR and others, but not bounce light.

What does not hold, or needs correcting:
- "It never says how to turn it off" is overstated. Line 329 says "`bounceRays` is the number of rays each texel casts: 0 draws none", next to a `quality.set({ bounceRays: 8 })` example. The way to turn it off is there, but only by inference. A plain sentence would still help.
- The proposed sentence "High and Ultra draw bounce light in every scene" is wrong. WebGL2's Medium also draws it (4 rays). It draws nothing in compatibility mode and on the 8-bit path, in a scene with a light probe grid, or while a debug view draws (frame.rs:1961-1975; page lines 331-332). The edit must keep those limits.
- "Check the Ultra figure" is not needed: the decision record confirms the figure and gives the reason.
- The note under the title (line 11) opens with "Roadmap step 0.2", which is internal process wording. Adding bounce light to that note is fine, but the note itself breaks the writing rules. That is a separate finding, so this verdict does not depend on it.

## Corrected claim

The section never says that bounce light, unlike the page's other effects, draws from the quality preset with no `post.set` call (High 4 rays, Ultra 8, WebGL2's Medium 4). It also never says that bounce light turns the depth prepass on. The way to turn it off (`bounceRays: 0`) appears only inside a list item. The cost figures appear twice, rounded differently, and neither says why Ultra measured cheaper than High. The source gives the reason: the gap is inside run-to-run noise. The top diagram and the title note leave bounce light out.

## Corrected edit

Open the section with: "Bounce light needs no `post.set` call. The High and Ultra presets draw it, and so does Medium on WebGL2. While it draws, the depth prepass runs too. `quality.set({ bounceRays: 0 })` turns it off." Keep the limits that follow (none in compatibility mode, on the 8-bit path, or with a light probe grid).

Remove the figures from the line 329 list item and keep them only under `### Cost`, rounded (2.5 ms at High, 1.3 ms at Ultra, 0.8 ms at WebGL2's Medium). Add one sentence there: "Ultra's eight rays measured a little less than High's four. The gap is within the spread between runs, so expect about the same cost on both."

In the diagram, add `prepass --> bounce["Bounce light:<br/>a trace and a denoise<br/>at half size"]` and `bounce --> scene`. Add bounce light to the list of effects in the title note.
