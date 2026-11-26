# start-substance-04

## Finding as given

- page: cookbook/index
- anchor: ## Hide what walls hide (lines 620-656), "cull them on desktops without a mark"
- category: wrong-claim
- severity: high
- claim: The intro says the engine skips hidden objects. On WebGL2, every preset leaves software occlusion off. Only the page's createEngine option turns it on, and the recipe is a sketch, so it culls nothing there. On WebGPU, only High and Ultra on desktops cull. "Without a mark" is unclear.
- evidence: docs/concepts/culling.md:159, culling.md:164, culling.md:172.
- proposedEdit: Rewrite the intro: "On WebGPU, the High and Ultra presets on a desktop cull hidden objects on the GPU, and pick the occluders themselves. On WebGL2, culling is off on every preset. Mark large blockers with `occluder: true`, and pass `softwareOcclusion: true` to `createEngine` on the page." Add the page line as a second code block. Say that the recipe alone shows no culling on WebGL2.

Verdict: partly

## Evidence

- docs/cookbook/index.md:622 already states the facts the finding says are missing. "On WebGPU, High and Ultra cull them on desktops without a mark, and `createEngine`'s `gpuOcclusion` option turns it on or off. On WebGL2, mark the wall with `occluder: true`, and `createEngine`'s `softwareOcclusion` option turns the culling on." The first sentence ("the engine skips those") is a general lead-in, and the next two sentences qualify it per backend. So the page does not make a wrong claim.
- The WebGPU part matches docs/concepts/culling.md:91 (High and Ultra on desktops; phones and tablets off) and the source: packages/engine/src/quality/presets.ts:837 and packages/engine/src/page/engine.ts:2666 (choice by device kind and the page option).
- The WebGL2 part matches culling.md:159 and presets.ts:853 ("Every preset leaves it off, and the `softwareOcclusion` option ..."). "turns the culling on" already implies it is off by default.
- "Without a mark" is the same phrase culling.md:72 uses, and on the cookbook page it contrasts directly with "mark the wall with `occluder: true`" in the next sentence. A reader can follow it; rewording is polish.
- What holds: the recipe is a sketch (lines 624-655) and never shows the `createEngine({ ..., softwareOcclusion: true })` call. A reader who runs only the sketch on WebGL2, or on a WebGPU phone or tablet, or on Medium/Low, sees no culling, and the page does not say so. It also does not say that the option goes on the page, not in the sketch. That makes the recipe harder to use, but nothing on the page is false.
- Severity: medium, not high. Category: missing context, not wrong claim.

## Corrected claim

The intro is accurate, but the recipe does not show where the WebGL2 switch goes. The sketch sets `occluder: true`, yet culling on WebGL2 needs `softwareOcclusion: true` on `createEngine` in the page code, which the recipe omits. The page also does not say that, run as shown, the sketch culls nothing on WebGL2, on WebGPU phones and tablets, or on presets below High.

## Corrected edit

Keep the intro sentences (they are correct, and they name `gpuOcclusion`, which the proposed rewrite drops). After the sketch, add one short paragraph and a second code block:

"The sketch alone culls nothing on WebGL2, because every preset leaves software occlusion off. Turn it on where you create the engine:

```ts
const engine = await createEngine({ canvas, sketch, softwareOcclusion: true });
```

On WebGPU, the sketch culls only on desktops at High or Ultra, unless you pass `gpuOcclusion: true`."

Optionally replace "without a mark" with "with no `occluder` mark" for clarity.
