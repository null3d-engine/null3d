# Shot and demo-link verdicts: api/textures

## Shots

- canvas-screen: KEEP. The reference file exists in all three tiers (webgpu, compat, webgl2) and shows the demo's default view: three wall panels with readings and bars, and the console wave below. The demo paints its panels on OffscreenCanvas objects through the screens add-on, which calls textures.fromCanvas. Note: the reference is only 320 x 180, so it is small on a docs page.
- ktx2: DROP. The source is wrong: it is not a scripted shot. A reference already exists at tests/image/references/chrome-real-gpu/webgpu/ktx2.png. But the picture does not help this section. It is a test grid of checkerboards (a PNG beside ETC1S and UASTC files at three sizes, and a color ramp). A reader cannot tell which square is which without a long key, and the section's points (formats, memory, flip and mip rules) do not show in a picture. The alt text is too vague to describe it.
- mipmaps-on-off: KEEP, with a corrected source and alt text. A reference exists at tests/image/references/chrome-real-gpu/webgpu/texture-mipmaps.png, so it is a reference shot, not scripted. The alt text is wrong: the floors are not "with and without mip levels". The picture shows a checkerboard drawn smaller and smaller, with mip levels in the top row (small squares fade to gray) and without them in the middle row (stray texel patterns). The two floors at the bottom both have mip levels; the right one adds anisotropic filtering. A still picture cannot show shimmer. Suggested alt: "A checkerboard drawn smaller and smaller: with mip levels the small copies fade to gray, without them they break into stray texels. Below, two receding floors; the right one uses anisotropic filtering and stays sharp further away." It fits "Mip levels"; its floors also support "Sampling".
- texture-budget: DROP. A reference exists at tests/image/references/chrome-real-gpu/webgpu/texture-budget.png, so the source would be "reference", not scripted. But the captured frame shows only flat color quarters (the state after the largest levels dropped). Without the full checker beside it, a reader sees plain colored squares and cannot see that anything dropped.
- transcoder-download: DROP. A Network panel screenshot only repeats the text's size figure, and file names and sizes change with each transcoder build, so it goes stale. The source file is also wrong: the transcoder worker starts in packages/engine/src/shared/helper-workers.ts and packages/engine/src/scene/ktx2.ts, not scene/textures.ts.

## Demo links

- Canvas textures -> canvas-screen/: KEEP. The code exists in examples/demos.ts, and the demo shows canvas textures with per-panel refresh rates and rectangle refreshes. The canvas code lives in the screens add-on (examples/addons/screens/index.ts), which the demo imports.
- glTF textures -> gltf-model/: DROP. The demo exists (no code field, so gltf-model/ is right), but it loads a model with assets.loadGltf. It shows nothing of the texture options table. The only glTF point under "Options" is that glTF textures use flipY false, which the demo does not show. The link fits the Assets page better.

## Concepts said to have no demo

- video textures: CONFIRMED. No demo calls textures.fromVideo or engine.registerVideo.
- textures.fromData: NOT CONFIRMED. security-camera/ makes its ground maps with textures.fromData: an sRGB color map with mip levels and anisotropy 8, and a linear metalness-roughness map. layers, hold-mode and camera-lens also use it.
- texture arrays: CONFIRMED. Only the texture-arrays image test page exercises them; no demo shows them.

## Missed link

- security-camera/ also shows textures.fromPass: a scene pass draws the camera view into a texture that a monitor shows. Link it under "Textures of render passes".
