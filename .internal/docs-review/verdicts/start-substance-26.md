# start-substance-26

## The finding as given

```json
{
 "page": "cookbook/index",
 "anchor": "each recipe's closing paragraph; line 664 links only the examples folder",
 "category": "missing-content",
 "severity": "low",
 "claim": "Most recipes have a fuller demo, but the page links no demo. stats.json shows no example links.",
 "evidence": "examples/demos.ts: picking, character, morph-flowers, time-of-day, post-effects, security-camera, canvas-screen, sprites-lines, galaxy; examples/compare/comparisons.ts: battle.",
 "proposedEdit": "After each recipe's related-page link, add a \"Demo:\" link from the shotsAndDemos list, such as https://github.com/null3d-engine/null3d/tree/main/examples/picking/ for Select objects.",
 "generatedSource": "",
 "id": "start-substance-26",
 "slice": "start",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- The page (docs/cookbook/index.md, hand-written) has 13 recipes. Its only examples link is line 664, to the whole examples folder. Line 538 names `examples/addons/screens` as plain code text, not a link. stats.json gives `exampleLinks: []` for cookbook/index. So "the page links no demo" holds.
- Demo links are a normal pattern elsewhere: over 20 docs pages link a single demo folder (for example docs/api/input.md:43, docs/concepts/culling.md:227). The repository's link check (tools/lib/links.test.ts, selfRepoPath) resolves these links, so the proposed folders must exist, and they do.
- Every demo that the finding names exists in examples/demos.ts, and the battle comparison exists in examples/compare/comparisons.ts (code `compare/battle/`). Their summaries match recipes as follows:
  - Select objects -> picking (code `picking/`): hover light-up, click outline. Close match.
  - Third-person camera -> character (no code, so `character/`): a 1D blend of idle, walk and run by speed. Matches the blend, but the Knight walks a fixed circle; there is no third-person camera. Loose match.
  - Crowd of animated characters -> compare/battle/: armies of animated soldiers. Reasonable, but it is a comparison with three.js, not a plain demo.
  - Morph targets -> morph-flowers (`morph-flowers/`). Close match.
  - Sky, sun and fog -> time-of-day (`time-of-day/`). Close match.
  - Glow and a custom effect -> post-effects (code `post-effects/`): bloom and many effects. Close match.
  - Screen that shows another camera -> security-camera (code `security-camera/`). Close match.
  - Screens in the world -> canvas-screen (code `canvas-screen/`). Close match.
  - Trail behind a moving object -> sprites-lines (`sprites-lines/`): wide and dashed lines, but no trail. Loose match.
  - Field of stars -> galaxy (`galaxy/`): one points batch. Close match.
- Three recipes have no matching demo in the finding or that I found: walk to the clicked point, the loading screen, and hide what walls hide. So "after each recipe" is wrong; only some recipes can take a link.
- The proposed edit's source, "the shotsAndDemos list", does not exist in the repository (no match in docs/ or tools/). The real source is examples/demos.ts (and examples/compare/comparisons.ts).

## Corrected claim

Ten of the 13 recipes have a demo or comparison that shows the same feature at full size, but the page links none of them; it links only the examples folder (line 664). Three recipes (walk to a click, loading screen, occlusion) have no matching demo.

## Corrected edit

At the end of each matching recipe's closing paragraph, add one sentence with a demo link, using the demo's `code` from examples/demos.ts, or `<name>/` when it has none:

- Select objects: [Picking and labels demo](https://github.com/null3d-engine/null3d/tree/main/examples/picking/)
- Morph targets: [Morph targets demo](https://github.com/null3d-engine/null3d/tree/main/examples/morph-flowers/)
- Sky, sun and fog: [Time of day demo](https://github.com/null3d-engine/null3d/tree/main/examples/time-of-day/)
- Glow and a custom effect: [Post effects demo](https://github.com/null3d-engine/null3d/tree/main/examples/post-effects/)
- Screen that shows another camera: [Render to texture demo](https://github.com/null3d-engine/null3d/tree/main/examples/security-camera/)
- Screens in the world: [Screens drawn on a canvas demo](https://github.com/null3d-engine/null3d/tree/main/examples/canvas-screen/)
- Field of stars: [Points demo](https://github.com/null3d-engine/null3d/tree/main/examples/galaxy/)

Word the looser matches by what they show, not as the same recipe: the character demo for "the speed blend", the sprites-lines demo for "wide and dashed lines", and the battle comparison for "a large crowd". Add no link to the three recipes that have no matching demo.
