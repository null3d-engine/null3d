# api-3-substance-04

## Finding as given

```json
{
 "page": "api/render",
 "anchor": "### State between runs, lines 403-404: \"The 8192 by 8192 side that the device allows would take 2 GiB\"",
 "category": "wrong-claim",
 "severity": "medium",
 "claim": "A pass's size is capped by textures.maxSize, which is 4096 at most, so an 8192 side is impossible. The largest history pass, 4096 by 4096, takes 512 MiB.",
 "evidence": "packages/engine/src/sketch/runner.ts:957-963 (Render gets textures.maxSize); packages/engine/src/scene/render.ts:1160-1168 (checkSize caps at maxSize); packages/engine/src/scene/textures.ts:1359-1364 ('4096 texels, or less on a WebGL2 device'); docs/api/textures.md:230.",
 "proposedEdit": "\"The largest side, 4096 by 4096, would take 512 MiB on the WebGPU paths, which no page should choose by accident.\"",
 "generatedSource": "",
 "id": "api-3-substance-04",
 "slice": "api-3",
 "role": "substance"
}
```

Verdict: survives

## Evidence

- docs/api/render.md:403-404 says "The 8192 by 8192 side that the device allows would take 2 GiB on the WebGPU paths".
- docs/api/render.md:47 on the same page says a pass's `size` runs "from 1 to `textures.maxSize`". So the page contradicts itself.
- packages/engine/src/sketch/runner.ts:957-964: the render object gets `textures.maxSize` as its size limit.
- packages/engine/src/scene/render.ts:1158-1174: the size check throws E1220 for any side above that limit.
- packages/engine/src/scene/textures.ts:1359-1365: `maxSize` is "4096 texels, or less on a WebGL2 device that allows less".
- The value comes from the Rust core. crates/null3d-gpu/src/caps.rs:106-125 sets the shared budget's 2D texture size to 4096. crates/null3d-render/src/gpu_driven/mod.rs:1148-1155 builds the texture store with that budget. crates/null3d-render/src/cpu_culled/mod.rs:772-780 uses the smaller of the device limit and that budget. Neither path goes past 4096.
- 8192 shows up only in packages/engine/src/page/limits.ts:545, the WebGPU limit for the canvas's drawing buffer. Pass textures do not use that limit. The docs line probably mixed the two up.
- docs/api/textures.md:230 also says a texture is at most 4096 texels wide and tall.
- The arithmetic holds. The page uses 32 bytes per texel of one state on the WebGPU paths at `rgba16float`, and its own examples agree (128 x 128 gives 512 KiB). So 4096 x 4096 x 32 = 536,870,912 bytes = 512 MiB. On WebGL2 the same pass takes 384 MiB.

## Corrected edit

The proposed edit is right. A slightly tighter version names the limit, so the reader can find it:

"The largest pass, 4096 by 4096 (the most that `textures.maxSize` allows), would take 512 MiB on the WebGPU paths, which no page should choose by accident."
