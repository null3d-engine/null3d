# Changelog

## 0.1.2 - 2026-11-28

### Features

#### @null3d/vite-plugin

- Ship the shaders of one GPU path in a build ([#594](https://github.com/null3d-engine/null3d/pull/594), [3db752932](https://github.com/null3d-engine/null3d/commit/3db752932b02c6b768b302030a60a9bc3fab3d50))

### Bug fixes

#### @null3d/vite-plugin

- Keep a shader list's words from a dropped table ([#595](https://github.com/null3d-engine/null3d/pull/595), [b457df29b](https://github.com/null3d-engine/null3d/commit/b457df29bf894111cca55d8274a3457aaa380b99))

### Documentation

#### Docs and skills

- Keep a content page's taps on its subject on every device ([#598](https://github.com/null3d-engine/null3d/pull/598), [ba5a3c94c](https://github.com/null3d-engine/null3d/commit/ba5a3c94c26c6524ff7ff33cc5976a54ea13f1ca))
- Reveal a content page's scene at its first frame while stages build ([#597](https://github.com/null3d-engine/null3d/pull/597), [2c1aa49a4](https://github.com/null3d-engine/null3d/commit/2c1aa49a4eb58321b5c79f7f16ddb8c82c8dbc59))
- Give the agent skills short install links ([#596](https://github.com/null3d-engine/null3d/pull/596), [7e4adcd3d](https://github.com/null3d-engine/null3d/commit/7e4adcd3dd898c08a1ef46ce87ad8469da04e641))

**Full changelog**: https://github.com/null3d-engine/null3d/compare/0.1.1...0.1.2

## 0.1.1 - 2026-11-27

### Features

#### @null3d/engine

- Add a lens shift to perspective and orthographic cameras ([#586](https://github.com/null3d-engine/null3d/pull/586), [47488a89a](https://github.com/null3d-engine/null3d/commit/47488a89a3c55c11e252cefe84b56eba957bd851))
- Give the sketch's setup start data from the page ([#584](https://github.com/null3d-engine/null3d/pull/584), [f618bff93](https://github.com/null3d-engine/null3d/commit/f618bff935a394d1f1b86b3c5563ebdfb2788ac8))

#### @null3d/vite-plugin

- Copy only the shader builds of a project's recorded words ([#583](https://github.com/null3d-engine/null3d/pull/583), [46ed60384](https://github.com/null3d-engine/null3d/commit/46ed60384a22f4c7575ba4f7c488fc78e10dd531))

#### Other parts

- **stats:** Put the stats overlay at the canvas's bottom right on request ([#577](https://github.com/null3d-engine/null3d/pull/577), [b4fdcda21](https://github.com/null3d-engine/null3d/commit/b4fdcda212f0ac6ed1b92bc5712be73cf1d256bf))

#### Repository and tooling

- Warn on a long paragraph in the docs style check ([#588](https://github.com/null3d-engine/null3d/pull/588), [4fc59a101](https://github.com/null3d-engine/null3d/commit/4fc59a101d3a0c5db667527d3dabec17c84f5a59))

### Bug fixes

#### Repository and tooling

- Pin sibling packages at the release version ([#585](https://github.com/null3d-engine/null3d/pull/585), [c6fba70fe](https://github.com/null3d-engine/null3d/commit/c6fba70fef1f13af7fd65c918d72beaaf1a5dcfa))
- Build the npm job from the shader caches, and add a publish-only run ([#580](https://github.com/null3d-engine/null3d/pull/580), [a4fcf784d](https://github.com/null3d-engine/null3d/commit/a4fcf784df16a0ba1ed1326845ed8c2f137522c1))
- Push the tag with the release App, and let a rerun land nothing ([#578](https://github.com/null3d-engine/null3d/pull/578), [7f9ced939](https://github.com/null3d-engine/null3d/commit/7f9ced93954fae37391b82be0f9bb2ad0625425f))

### Performance

#### @null3d/engine

- Build the first frame's light and culling pipelines only when it draws them ([#590](https://github.com/null3d-engine/null3d/pull/590), [954185f14](https://github.com/null3d-engine/null3d/commit/954185f1455994fc44e6ce0ff1458aa62a5da8d1))

### Documentation

- Link each page to its demo ([#592](https://github.com/null3d-engine/null3d/pull/592), [4285335cc](https://github.com/null3d-engine/null3d/commit/4285335cc377ae20add3e0d74597a5115569b497))
- Show screenshots beside the pages they explain ([#593](https://github.com/null3d-engine/null3d/pull/593), [23effa480](https://github.com/null3d-engine/null3d/commit/23effa4805be6fd3b967712501d1274168103e3b))
- Restructure the docs and add the reviewed content ([#579](https://github.com/null3d-engine/null3d/pull/579), [d0cf8a720](https://github.com/null3d-engine/null3d/commit/d0cf8a720c87ca16586b8834d7c169f43a6dcb84))
- Give the start's measured download sizes, and say that a three.js port is a rewrite ([#581](https://github.com/null3d-engine/null3d/pull/581), [c64cff52e](https://github.com/null3d-engine/null3d/commit/c64cff52ef65bc1b8e3829641a838f67a9421cea))

### Build and tooling

#### Repository and tooling

- Reuse CI's shader caches and the packed shader set ([#576](https://github.com/null3d-engine/null3d/pull/576), [bb90bcdfa](https://github.com/null3d-engine/null3d/commit/bb90bcdfa3f3f3fbbd297d16a793b974fe9af3d9))

#### Across the project

- Retune the browser shards to 52 at a 12-minute target ([#591](https://github.com/null3d-engine/null3d/pull/591), [d87e84e64](https://github.com/null3d-engine/null3d/commit/d87e84e648147b19fa60206ab10a0f8b0910a029))

**Full changelog**: https://github.com/null3d-engine/null3d/compare/0.1.0...0.1.1

## 0.1.0 - 2026-11-26

### Breaking changes

#### @null3d/engine

- Call a 3D scene a sketch, and rename the game APIs to match ([#11](https://github.com/null3d-engine/null3d/pull/11), [fb819c95d](https://github.com/null3d-engine/null3d/commit/fb819c95da58b6ae5ee2a86f80933b36a99e506f))

#### Across the project

- The 0.2 release work for level of detail, effects, add-ons and vegetation ([#549](https://github.com/null3d-engine/null3d/pull/549), [5b6006ebb](https://github.com/null3d-engine/null3d/commit/5b6006ebbb60964cddb3199f21b50c598ec6fa3e))

### Features

#### @null3d/engine

- Maths entry and createMath for simulations, input-off switch, onStop, replay demo ([#557](https://github.com/null3d-engine/null3d/pull/557), [1be201004](https://github.com/null3d-engine/null3d/commit/1be201004c552b19bf34e093e82e4197372654b9))
- Land the engine's rendering, assets, animation and device work ([e7df2a293](https://github.com/null3d-engine/null3d/commit/e7df2a293b77e5e19521318583a38c5cc91292ae))
- Land the work pushed directly to main since the last pull request ([e27d69055](https://github.com/null3d-engine/null3d/commit/e27d69055de19a7b1402c5d1975fd7537062b0ce))
- Let game code turn a skinned object's joints on top of its clips ([#516](https://github.com/null3d-engine/null3d/pull/516), [a150d94b4](https://github.com/null3d-engine/null3d/commit/a150d94b41f9d56aeb8f8404788318d6df0f4f47))
- Levels of detail picked by screen error on both GPU paths ([#519](https://github.com/null3d-engine/null3d/pull/519), [16a710a2f](https://github.com/null3d-engine/null3d/commit/16a710a2f2ab2fe9e46658b6464545a0f93f0641))
- Draw point and spot lights in scene and reflection passes ([#499](https://github.com/null3d-engine/null3d/pull/499), [3044ed4ba](https://github.com/null3d-engine/null3d/commit/3044ed4baf2becfbf756d25c12dd2a78e2b830cd))
- Start custom material templates at 128, leaving 64-127 to the engine ([#512](https://github.com/null3d-engine/null3d/pull/512), [ec8f5cca7](https://github.com/null3d-engine/null3d/commit/ec8f5cca78f267d791795f5c583c17f2a1a5b751))
- Give custom materials the inputs of three.js shader materials ([#505](https://github.com/null3d-engine/null3d/pull/505), [9093bad7f](https://github.com/null3d-engine/null3d/commit/9093bad7f174cbd29d0923cac0ad56e4c8748db7))
- Turn software occlusion culling off on every WebGL2 preset ([#501](https://github.com/null3d-engine/null3d/pull/501), [a295ecf4e](https://github.com/null3d-engine/null3d/commit/a295ecf4e5f82ab8030bdc5f85e6467f2d2ea09b))
- Give a sketch's own systems budgets that the governor scales ([#496](https://github.com/null3d-engine/null3d/pull/496), [741ce5a91](https://github.com/null3d-engine/null3d/commit/741ce5a91f4e4744682a383c1272d662bc86532c))
- Read glTF files with Draco compression ([#492](https://github.com/null3d-engine/null3d/pull/492), [8415f4a85](https://github.com/null3d-engine/null3d/commit/8415f4a8551f7432d5ac895e693d7a89daeeedeb))
- Warn on compare-exchange, and record the rejected workgroup counts in culling ([#493](https://github.com/null3d-engine/null3d/pull/493), [999cb5ef9](https://github.com/null3d-engine/null3d/commit/999cb5ef98b46ae3e46cdf82cec5ec9c74b7210e))
- Draw each batch row's colour and give rows values that shaders read ([#481](https://github.com/null3d-engine/null3d/pull/481), [f662b3de8](https://github.com/null3d-engine/null3d/commit/f662b3de85c73c6f484dc89c8afcf61b935e3382))
- Light surfaces with hemisphere lights ([#478](https://github.com/null3d-engine/null3d/pull/478), [1e6fbef71](https://github.com/null3d-engine/null3d/commit/1e6fbef71988670055f7729841fcdb39e0263b65))
- Instance batches cast and receive shadows ([#472](https://github.com/null3d-engine/null3d/pull/472), [1855fd2a4](https://github.com/null3d-engine/null3d/commit/1855fd2a454f1a83af634fcfb7ed64b355d4e6eb))
- Let pages defend the display's full frame rate, and show it in the stats overlay ([#474](https://github.com/null3d-engine/null3d/pull/474), [6b04b6e61](https://github.com/null3d-engine/null3d/commit/6b04b6e61e2a4e04b9a6021df11e7365685c80d3))
- Add transmission, so glass and water let the light behind them through ([#473](https://github.com/null3d-engine/null3d/pull/473), [e9a45c81d](https://github.com/null3d-engine/null3d/commit/e9a45c81da92c9d9b6385f44ea21a7226a13d9bf))
- Add depth of field, with autofocus and camera focal lengths ([#453](https://github.com/null3d-engine/null3d/pull/453), [ea4df4b37](https://github.com/null3d-engine/null3d/commit/ea4df4b37f5ec4d9f67576547a62f5a9b65f0d76))
- Add planar reflections for water and polished floors ([#452](https://github.com/null3d-engine/null3d/pull/452), [ea5cb60eb](https://github.com/null3d-engine/null3d/commit/ea5cb60eb5e843cf9f30006cd77cd1fe1b15dadb))
- Light scenes from the generated sky, and add a time-of-day helper ([#450](https://github.com/null3d-engine/null3d/pull/450), [08177b22e](https://github.com/null3d-engine/null3d/commit/08177b22e28cc6a7c2ed335afbf7c04e1f1a512c))
- Make color grading tables from numbers with assets.lutFromData ([#449](https://github.com/null3d-engine/null3d/pull/449), [227a575fb](https://github.com/null3d-engine/null3d/commit/227a575fbccf488e66bb4ec89cf881e100746ce4))
- Show the stats overlay from any page, with memory, triangles, objects and GPU time ([#448](https://github.com/null3d-engine/null3d/pull/448), [dacc2ecbd](https://github.com/null3d-engine/null3d/commit/dacc2ecbd3f770e51aa6cf4eec635f075128a7e3))
- Draw the scene from other cameras into textures that materials show ([#427](https://github.com/null3d-engine/null3d/pull/427), [a778980db](https://github.com/null3d-engine/null3d/commit/a778980db5e1ad357397186cb05e8dc9a8a523e2))
- Skip still poses in WebGPU skinning, and store skinned normals in 8 bits ([#424](https://github.com/null3d-engine/null3d/pull/424), [a366a5b29](https://github.com/null3d-engine/null3d/commit/a366a5b298f440be4d9346dcce271a2c65ae4778))
- Grow the scene's object tables when a scene needs more objects ([#423](https://github.com/null3d-engine/null3d/pull/423), [6975e9911](https://github.com/null3d-engine/null3d/commit/6975e9911b619e270e1965babf40a31ad051e5f6))
- Join custom effects into fewer passes, and fold the last into the final pass ([#408](https://github.com/null3d-engine/null3d/pull/408), [5d9ff4f55](https://github.com/null3d-engine/null3d/commit/5d9ff4f55843b9fbd2c8f612868c0847ce27e59f))
- Hold textures under each preset's memory budget ([#346](https://github.com/null3d-engine/null3d/pull/346), [8dea3d232](https://github.com/null3d-engine/null3d/commit/8dea3d2321ea1320d064399fced9d0bb725e2a29))
- Keep a stopped engine's shared memory for the page's next engine ([#412](https://github.com/null3d-engine/null3d/pull/412), [6a1d0dd25](https://github.com/null3d-engine/null3d/commit/6a1d0dd254b91ab54950745382cbf6dd5fb73697))
- Add alpha to coverage, alpha hash, two-pass glass and cut-out shadows ([#399](https://github.com/null3d-engine/null3d/pull/399), [9b736da89](https://github.com/null3d-engine/null3d/commit/9b736da89c566353e591a70baf3db4d9a4d32954))
- Draw the depth prepass on WebGL2 at every quality preset ([#398](https://github.com/null3d-engine/null3d/pull/398), [94a30dfe9](https://github.com/null3d-engine/null3d/commit/94a30dfe9c11c06887bdb706941181da41bd81e5))
- Cache transcoded KTX2 textures, so repeat visits skip the transcoder ([#407](https://github.com/null3d-engine/null3d/pull/407), [535533f2c](https://github.com/null3d-engine/null3d/commit/535533f2c65ec8cf032e19a33b027f8df072ce9a))
- Move the vignette before the tone curve and dither last ([#404](https://github.com/null3d-engine/null3d/pull/404), [649ffaa4c](https://github.com/null3d-engine/null3d/commit/649ffaa4cb6acda3e1b447b9fddf4da51b42870a))
- Draw sky, environment and cube map backgrounds ([#397](https://github.com/null3d-engine/null3d/pull/397), [9a87f365b](https://github.com/null3d-engine/null3d/commit/9a87f365b61cab8f97b216ad106410a4d2da166a))
- Warn when grid cells run out, and test camera flights far from the origin ([#373](https://github.com/null3d-engine/null3d/pull/373), [ee7942853](https://github.com/null3d-engine/null3d/commit/ee7942853d2e645f9682043c24ab02732fdcb5cc))
- Keep four texture units free in the WebGL2 standard material ([#389](https://github.com/null3d-engine/null3d/pull/389), [873b0f602](https://github.com/null3d-engine/null3d/commit/873b0f6027f9c7ebb332d8e254cf0be7e525f6db))
- Hit sprites, points and lines with raycasts and pointer events ([#382](https://github.com/null3d-engine/null3d/pull/382), [f9ea4c400](https://github.com/null3d-engine/null3d/commit/f9ea4c4000b2a9576515eebdfe45403d7e05c819))
- Add a test switch for vertex shaders that read instance data by index ([#378](https://github.com/null3d-engine/null3d/pull/378), [8833dee5c](https://github.com/null3d-engine/null3d/commit/8833dee5cb0a40dc8bd4d0c94d2203f4f8c43d66))
- Wait about 45 s for memory that the browser refuses, and report memory-wait ([#386](https://github.com/null3d-engine/null3d/pull/386), [73abc0739](https://github.com/null3d-engine/null3d/commit/73abc07398a5c529e1a0d158c2a7fa4669c6e8bd))
- Load WebP, AVIF and UASTC HDR textures in models and KTX2 files ([#381](https://github.com/null3d-engine/null3d/pull/381), [eff499ea4](https://github.com/null3d-engine/null3d/commit/eff499ea40a45d2f00562cb2f665a738417adcb1))
- Add custom post effects and custom tone curves ([#351](https://github.com/null3d-engine/null3d/pull/351), [df80eb926](https://github.com/null3d-engine/null3d/commit/df80eb926365b1744c5da516a1e4144ef4e9d8d5))
- Cull objects that marked occluders hide on WebGPU, in two phases on the GPU ([#379](https://github.com/null3d-engine/null3d/pull/379), [0f50026db](https://github.com/null3d-engine/null3d/commit/0f50026dbe620b410613eeed52602c920ef4ead9))
- Add mesh.destroy() and prefab.destroy(), and free what a failed load made ([#376](https://github.com/null3d-engine/null3d/pull/376), [507ca9b08](https://github.com/null3d-engine/null3d/commit/507ca9b082dd358081b32ba3bb97480c11326707))
- Store shadow cascades in 16-bit depth, with a bias floor per cascade ([#377](https://github.com/null3d-engine/null3d/pull/377), [80a97ab51](https://github.com/null3d-engine/null3d/commit/80a97ab5167652fae83ee819e7a5a4aedea0a936))
- Add native fog by distance from the camera, with height fog and a sun glow ([#374](https://github.com/null3d-engine/null3d/pull/374), [07a8fcc2a](https://github.com/null3d-engine/null3d/commit/07a8fcc2a7733eef6b5fad8ffee521df241824b3))
- Load decoders through one on-demand loader, and start workers from a CDN ([#340](https://github.com/null3d-engine/null3d/pull/340), [f364302c4](https://github.com/null3d-engine/null3d/commit/f364302c424bccd849505de94023d4478388b078))
- Load HDR and EXR files as environments, filtered on the GPU at load ([#339](https://github.com/null3d-engine/null3d/pull/339), [146f21880](https://github.com/null3d-engine/null3d/commit/146f21880229c08888db52d30fd800c09e4b0724))
- Blend shadow cascades where they meet, and fit each box to what receivers pick ([#343](https://github.com/null3d-engine/null3d/pull/343), [cbdeeffb5](https://github.com/null3d-engine/null3d/commit/cbdeeffb5521953f8866064f5deec56d39e13cb2))
- Morph vertex colors from color targets on every GPU tier ([#341](https://github.com/null3d-engine/null3d/pull/341), [36de70577](https://github.com/null3d-engine/null3d/commit/36de70577ce1031850f808f219d3473194fa6f82))
- Read KHR_materials_specular and KHR_materials_ior into the standard material ([#331](https://github.com/null3d-engine/null3d/pull/331), [32f387b8d](https://github.com/null3d-engine/null3d/commit/32f387b8d5fe027a07f5621637fa1c783e25e449))
- Draw point clouds as sprites of one size, as three.js's Points draws them ([#337](https://github.com/null3d-engine/null3d/pull/337), [55dbec719](https://github.com/null3d-engine/null3d/commit/55dbec7193e39356b63c2b8afc7df69dac1fb9d2))
- Refuse to start in Safari before 18, with error E1306 ([#333](https://github.com/null3d-engine/null3d/pull/333), [1c5de5c43](https://github.com/null3d-engine/null3d/commit/1c5de5c43d29b2b861498e897ee80c7e035aa5a7))
- Add clip start times, clip weights and phase-synced 1D blends to the animator ([#330](https://github.com/null3d-engine/null3d/pull/330), [479f5453b](https://github.com/null3d-engine/null3d/commit/479f5453b39cec94a5fac32606184b1bef4d7823))
- Make the built-in room whole at load, in one GPU submit ([#323](https://github.com/null3d-engine/null3d/pull/323), [89bbceee9](https://github.com/null3d-engine/null3d/commit/89bbceee93a826cd177933c219856fc8ff83cfa1))
- Packaging fixes, and shader files that load on first use with preloading ([#306](https://github.com/null3d-engine/null3d/pull/306), [492365df0](https://github.com/null3d-engine/null3d/commit/492365df0e4ec8e6783bfc06bb6c2a17947b8232))
- Apply the exposure to the lights, and add light units and ev100 ([#303](https://github.com/null3d-engine/null3d/pull/303), [91c7d279d](https://github.com/null3d-engine/null3d/commit/91c7d279d4ebe9a9b016d91ec77e0f69cf79d474))
- Draw bloom through a mip chain, with three.js and pmndrs settings mapped onto it ([#304](https://github.com/null3d-engine/null3d/pull/304), [bfe511764](https://github.com/null3d-engine/null3d/commit/bfe51176413340df75a6daff52155fbd2013a30e))
- Light scenes with environment maps, as three.js's scene.environment does ([#283](https://github.com/null3d-engine/null3d/pull/283), [961260942](https://github.com/null3d-engine/null3d/commit/961260942b7705cd9dc5ee5ff055df412d712d5e))
- Add crisp outlines around chosen meshes, mapped from three.js's OutlinePass ([#280](https://github.com/null3d-engine/null3d/pull/280), [62add54fd](https://github.com/null3d-engine/null3d/commit/62add54fdd829d66b3e9aff1efdc9f43cf02f78e))
- Add morph targets, with weights from code and glTF clips on every GPU tier ([#291](https://github.com/null3d-engine/null3d/pull/291), [8262726fa](https://github.com/null3d-engine/null3d/commit/8262726fadc38db87fa50c6d6e3ad04b4052b8a3))
- Add pointer events on objects with object.on, cast from the frame on screen ([#285](https://github.com/null3d-engine/null3d/pull/285), [40734aed8](https://github.com/null3d-engine/null3d/commit/40734aed8cbbf350e76a4414452a05ab4a8bbde4))
- Add ambient occlusion, with three.js's GTAOPass steps at half resolution ([#288](https://github.com/null3d-engine/null3d/pull/288), [68263ef0d](https://github.com/null3d-engine/null3d/commit/68263ef0d1c792b780aa535b14334ff80ef96d3b))
- Draw lines of any width in batches, as three.js's Line2 draws them ([#282](https://github.com/null3d-engine/null3d/pull/282), [dc1783798](https://github.com/null3d-engine/null3d/commit/dc1783798bd9457965b6b00f7f818cdd93472356))
- Hide objects behind blockers on WebGL2 with software occlusion culling ([#279](https://github.com/null3d-engine/null3d/pull/279), [e75ec03e1](https://github.com/null3d-engine/null3d/commit/e75ec03e1315e7569f81e345ff06360c83451e50))
- Draw the depth prepass on WebGL2 with each material's own vertex shader ([#278](https://github.com/null3d-engine/null3d/pull/278), [fe137a6bc](https://github.com/null3d-engine/null3d/commit/fe137a6bcc7996b605317574d4c47d7bd7327284))
- Sample textures in custom materials, and add material.destroy() ([#281](https://github.com/null3d-engine/null3d/pull/281), [340d98e06](https://github.com/null3d-engine/null3d/commit/340d98e060385911fa0f1d0f2a1ed9e574628b5f))
- Add HTML labels that follow objects in the frame on screen ([#274](https://github.com/null3d-engine/null3d/pull/274), [f019515fa](https://github.com/null3d-engine/null3d/commit/f019515fa16ff69588cd7243f0041e380ff3d5c9))
- Read skins, clips and morph targets from glTF files, and add debug.skeleton ([#273](https://github.com/null3d-engine/null3d/pull/273), [36a1ba727](https://github.com/null3d-engine/null3d/commit/36a1ba727f99ceb72a8848824561fa4c9f589e83))
- Add largeWorld mode and batch origins, for scenes the size of a planet ([#275](https://github.com/null3d-engine/null3d/pull/275), [b33fa21f5](https://github.com/null3d-engine/null3d/commit/b33fa21f56011a486055cfd27e5b89a903e84005))
- Draw sprites in batches that face the camera, as three.js's Sprite draws them ([#270](https://github.com/null3d-engine/null3d/pull/270), [554db274b](https://github.com/null3d-engine/null3d/commit/554db274b44917e7c4076ca37560f2b748aec38e))
- Skin characters on WebGL2 with the shared joint texture ([#267](https://github.com/null3d-engine/null3d/pull/267), [4e7e53c5b](https://github.com/null3d-engine/null3d/commit/4e7e53c5b3e3ceea40a16f99a9984a47890ae037))
- Load glTF files with meshopt compression, and download the decoder only for them ([#263](https://github.com/null3d-engine/null3d/pull/263), [9335e40fd](https://github.com/null3d-engine/null3d/commit/9335e40fdeb44289cde2546b5b79ce6b1b60e0c4))
- Skin characters on WebGPU in a compute pass, with a vertex-shader path behind a switch ([#264](https://github.com/null3d-engine/null3d/pull/264), [dcc8447ed](https://github.com/null3d-engine/null3d/commit/dcc8447ed8fca86b95b32f869b62751a40745d66))
- Add camera.screenToRay and worldToScreen, with rays from the frame on screen ([#256](https://github.com/null3d-engine/null3d/pull/256), [ada291d7c](https://github.com/null3d-engine/null3d/commit/ada291d7c3c9b68c64be026eb3162457a7beec17))
- Add color grading tables and a vignette to the final pass, as three.js draws them ([#261](https://github.com/null3d-engine/null3d/pull/261), [a70f34e9f](https://github.com/null3d-engine/null3d/commit/a70f34e9f7713a8c2986d92e976fad9fcc39fea0))
- Add raycasts and overlap queries that test triangles, with batches on the job workers ([#253](https://github.com/null3d-engine/null3d/pull/253), [b0c9d55a8](https://github.com/null3d-engine/null3d/commit/b0c9d55a89433ec4391a153483b8c8249b8bb807))
- Load glTF files into prefabs with assets.loadGltf, and instantiate them in one batch ([#254](https://github.com/null3d-engine/null3d/pull/254), [f980a7540](https://github.com/null3d-engine/null3d/commit/f980a7540b72dcfe2f6ece45e464ad0c71a5213c))
- Take glTF's 8-bit and 16-bit vertex types, and joints and weights ([#247](https://github.com/null3d-engine/null3d/pull/247), [944689f78](https://github.com/null3d-engine/null3d/commit/944689f786df95199cfe10f38738948d9319263f))
- Type a custom material's uniforms from its WGSL, so a wrong name fails the type check ([#255](https://github.com/null3d-engine/null3d/pull/255), [99eecef13](https://github.com/null3d-engine/null3d/commit/99eecef13aa2ac413c2053075500dfa2b9ec762f))
- Add bloom, with three.js's UnrealBloomPass steps, before the final pass ([#251](https://github.com/null3d-engine/null3d/pull/251), [926dde991](https://github.com/null3d-engine/null3d/commit/926dde991bbded0d38b8639c8b2de6d12840151b))
- Play, fade, layer, mask and add animation clips with object.animator() ([#252](https://github.com/null3d-engine/null3d/pull/252), [cf673ad67](https://github.com/null3d-engine/null3d/commit/cf673ad67139e84dc853004473a02c228a41f9f2))
- Add the BVHs that raycasts and spatial queries will use, and a stored mesh tree format ([#249](https://github.com/null3d-engine/null3d/pull/249), [9e6c22c9b](https://github.com/null3d-engine/null3d/commit/9e6c22c9bc61601caa99ac5cb89d161c14bf016e))
- Sample, blend and compose animation clips on the job workers ([#243](https://github.com/null3d-engine/null3d/pull/243), [a2b206be4](https://github.com/null3d-engine/null3d/commit/a2b206be44c1a9a3582f9e8a1ad6406884dfd706))
- Add cube textures, 3D textures and the rgb9e5ufloat format to both replay loops ([#242](https://github.com/null3d-engine/null3d/pull/242), [69b252bd3](https://github.com/null3d-engine/null3d/commit/69b252bd34da5ddbee21d753f24123b5dea7d897))
- Set shadow cascades and map size per preset, and tune shadow presets ([#215](https://github.com/null3d-engine/null3d/pull/215), [fa26014bb](https://github.com/null3d-engine/null3d/commit/fa26014bb4abbd2e1301f523cde07ecf7070e7f7))
- Do the scene shaders' color math at half precision with ?half=on ([#213](https://github.com/null3d-engine/null3d/pull/213), [495f0ddca](https://github.com/null3d-engine/null3d/commit/495f0ddca58a2a51a35f46443552ab591e911d44))
- Draw the opaque objects' depth first with the depthPrepass option ([#208](https://github.com/null3d-engine/null3d/pull/208), [c6e483bc1](https://github.com/null3d-engine/null3d/commit/c6e483bc141d9bfbb5a38fde648756e68f3b558c))
- Lower the shadow settings after the render scale when frames run long ([#210](https://github.com/null3d-engine/null3d/pull/210), [617feba4c](https://github.com/null3d-engine/null3d/commit/617feba4ce4b401d9b463b8fe87dc33fbd8dd0cb))
- List each cluster's lights on the GPU on the WebGPU path ([#207](https://github.com/null3d-engine/null3d/pull/207), [5d4af8749](https://github.com/null3d-engine/null3d/commit/5d4af87496ab3f827fa51eeaaaf543fbd0e0d89f))
- Cast point light shadows into six tiles of the shadow atlas ([#202](https://github.com/null3d-engine/null3d/pull/202), [0d0511fea](https://github.com/null3d-engine/null3d/commit/0d0511fea2d2504b92e2fe2aefea29604b6900ae))
- Cast spot light shadows into tiles of a shadow atlas ([#199](https://github.com/null3d-engine/null3d/pull/199), [406ef38cb](https://github.com/null3d-engine/null3d/commit/406ef38cb53abe48c37089fb82289f2342e71aaa))
- Keep shadow edges still as the camera turns, and draw far cascades in turn ([#198](https://github.com/null3d-engine/null3d/pull/198), [79b993813](https://github.com/null3d-engine/null3d/commit/79b9938139e20af9d428d798ddc9e3f63ea4d1a3))
- Draw the scene's normals, depth, overdraw or wireframe with debug.view ([#201](https://github.com/null3d-engine/null3d/pull/201), [ca45f93c3](https://github.com/null3d-engine/null3d/commit/ca45f93c334bb21bbc8992c1bfdb0e9cf051ec63))
- Show a stats overlay, and give sketches their frame figures ([#197](https://github.com/null3d-engine/null3d/pull/197), [446727d48](https://github.com/null3d-engine/null3d/commit/446727d48a7eb7caf200f1e8277f784fcd6e8609))
- Draw custom materials with full shaders of their own ([#154](https://github.com/null3d-engine/null3d/pull/154), [35d3caae5](https://github.com/null3d-engine/null3d/commit/35d3caae5edf7a0fff65bcc19f8a3168fe96f8ae))
- Give custom materials the built-in values frame, camera and object ([#151](https://github.com/null3d-engine/null3d/pull/151), [59dfceec2](https://github.com/null3d-engine/null3d/commit/59dfceec284ee685842e6ce40e493a5b9bdf8494))
- Light standard materials with the point and spot lights of their cluster ([#146](https://github.com/null3d-engine/null3d/pull/146), [30d17f19e](https://github.com/null3d-engine/null3d/commit/30d17f19e672db652f324db533781a90c328cc96))
- Draw the directional light's shadows on WebGL2 ([#175](https://github.com/null3d-engine/null3d/pull/175), [970043800](https://github.com/null3d-engine/null3d/commit/9700438006e4037ac73db94eb8ca84c16268fcba))
- Add dynamic resolution, a render scale that follows frame times ([#167](https://github.com/null3d-engine/null3d/pull/167), [04847e286](https://github.com/null3d-engine/null3d/commit/04847e2860011306928748136798bb9de5f02d8d))
- Let custom materials move their vertices with a vertex offset ([#150](https://github.com/null3d-engine/null3d/pull/150), [cded05c04](https://github.com/null3d-engine/null3d/commit/cded05c041f40c4e8c369bddbf8aff672648e03c))
- Give custom materials uniforms that set() changes ([#144](https://github.com/null3d-engine/null3d/pull/144), [5f53abf97](https://github.com/null3d-engine/null3d/commit/5f53abf979e9a0b1ea1565d00d9a96610505dc87))
- Add custom materials with WGSL surface functions ([#143](https://github.com/null3d-engine/null3d/pull/143), [c230ccf81](https://github.com/null3d-engine/null3d/commit/c230ccf81ad37b772e9925b36c963c6398d3709d))
- Load KTX2 textures in the compressed format that the device supports ([#152](https://github.com/null3d-engine/null3d/pull/152), [dc09955b4](https://github.com/null3d-engine/null3d/commit/dc09955b44001accdc46e64c6d779db6a67b7d8a))
- Blend materials, and draw them back to front in a transparent pass ([#157](https://github.com/null3d-engine/null3d/pull/157), [d870cc5c7](https://github.com/null3d-engine/null3d/commit/d870cc5c7746238b970cda87c9f07d2c9d051f24))
- Check the chosen preset after the first frame, and switch presets with setPreset ([#147](https://github.com/null3d-engine/null3d/pull/147), [a112de808](https://github.com/null3d-engine/null3d/commit/a112de8084998ffa37a954fb51e47179f8987aa9))
- Draw a texture behind the scene with scene.setBackground(texture) ([#170](https://github.com/null3d-engine/null3d/pull/170), [baa53f1de](https://github.com/null3d-engine/null3d/commit/baa53f1de270c2584c29c8de64e3dad2f153feb3))
- Draw the directional light's shadows in cascades on WebGPU ([#134](https://github.com/null3d-engine/null3d/pull/134), [76d0464d2](https://github.com/null3d-engine/null3d/commit/76d0464d2f4e26af72a207f2796cb82b381ce94b))
- Add FXAA and no anti-aliasing beside MSAA, chosen by the preset or createEngine ([#165](https://github.com/null3d-engine/null3d/pull/165), [cd866c94d](https://github.com/null3d-engine/null3d/commit/cd866c94d2fb1ddec8e557978edfa9a570d24022))
- Draw scene color in HDR and tone map it in a final pass ([#96](https://github.com/null3d-engine/null3d/pull/96), [9c9f499a0](https://github.com/null3d-engine/null3d/commit/9c9f499a0e35705deca5618c7d6d0b91b626cdf4))
- Give the standard material texture maps, and the unlit material a map ([#153](https://github.com/null3d-engine/null3d/pull/153), [94ddee51a](https://github.com/null3d-engine/null3d/commit/94ddee51ad2570448c2f8e606fc93aacf898ccd1))
- Add sketchThread: 'main', which runs the sketch and the core on the page's thread ([#133](https://github.com/null3d-engine/null3d/pull/133), [b931d029d](https://github.com/null3d-engine/null3d/commit/b931d029d64795a631066450c998ffeaebf519c1))
- Add scene fog with three.js's formulas, and let materials turn it off ([#138](https://github.com/null3d-engine/null3d/pull/138), [e4f6248b8](https://github.com/null3d-engine/null3d/commit/e4f6248b842603b6e05011b6ffc66a4cef95ec54))
- Add the mask alpha mode, depth write and depth test options, and depth bias ([#142](https://github.com/null3d-engine/null3d/pull/142), [b5b1c6e3c](https://github.com/null3d-engine/null3d/commit/b5b1c6e3ca894a4d57119d859ab2cdfcc2800e93))
- Apply the preset's anisotropy cap and texture upload budget ([#137](https://github.com/null3d-engine/null3d/pull/137), [5e608e424](https://github.com/null3d-engine/null3d/commit/5e608e424e94f193ea9ebf42f1c7799a181c76ba))
- Skip the still objects of grid cells out of view before culling each object ([#92](https://github.com/null3d-engine/null3d/pull/92), [99be9caab](https://github.com/null3d-engine/null3d/commit/99be9caab46d53ea16a1c76092fe25b68f1c4547))
- Give the standard material metalness and roughness, shaded as three.js shades them ([#126](https://github.com/null3d-engine/null3d/pull/126), [4d2117ac7](https://github.com/null3d-engine/null3d/commit/4d2117ac77604503c4253765df37f6369ea1b621))
- Assign point and spot lights to a grid of view clusters on the job workers ([#131](https://github.com/null3d-engine/null3d/pull/131), [dd8826a74](https://github.com/null3d-engine/null3d/commit/dd8826a7433a6b1708b6062c3b1f9dda2f359847))
- Load only the shaders of the device's GPU path and fixed bits ([#107](https://github.com/null3d-engine/null3d/pull/107), [e976be423](https://github.com/null3d-engine/null3d/commit/e976be423d050689b83557494141cc143fe48faf))
- Add engine.capture(), a PNG image of the next frame that the engine draws ([#123](https://github.com/null3d-engine/null3d/pull/123), [f217c8689](https://github.com/null3d-engine/null3d/commit/f217c86893a2dae1f308f98e9af544ddff597ced))
- Add quality presets, their chooser, a crash marker, and ctx.quality ([#86](https://github.com/null3d-engine/null3d/pull/86), [e9dbaea9a](https://github.com/null3d-engine/null3d/commit/e9dbaea9a5982e7f0710945d52a8a259be5103f2))
- Fit shadow cascades to the camera, and draw into each layer of an array target ([#120](https://github.com/null3d-engine/null3d/pull/120), [28c954031](https://github.com/null3d-engine/null3d/commit/28c954031ccf37a8e2aa2102fdc29176bb8ba06b))
- Make lights scene objects, and add point, spot and hemisphere lights ([#115](https://github.com/null3d-engine/null3d/pull/115), [b313c0fd7](https://github.com/null3d-engine/null3d/commit/b313c0fd7d3442a0f7b32c015a489917fc008d89))
- Build pipelines without blocking, and wait for them with scene.warmUp() ([#99](https://github.com/null3d-engine/null3d/pull/99), [8349157bd](https://github.com/null3d-engine/null3d/commit/8349157bdd38a6be2b2511226a8b9185c3752e64))
- Add orthographic cameras, drawn with reversed depth on every tier ([#82](https://github.com/null3d-engine/null3d/pull/82), [c04a0de69](https://github.com/null3d-engine/null3d/commit/c04a0de6908c60d94726d814bb5ee6819a26f26c))
- Add fixed steps, a late update, time.dt and ctx.engine to sketches ([#79](https://github.com/null3d-engine/null3d/pull/79), [e700b90fa](https://github.com/null3d-engine/null3d/commit/e700b90fa4d52f3ce9eaf85d4bc0fcda7dbaf2d7))
- Draw debug lines, boxes, spheres, arrows, axes, grids, frustums and lights ([#87](https://github.com/null3d-engine/null3d/pull/87), [9cbac4f86](https://github.com/null3d-engine/null3d/commit/9cbac4f8691d0a4a51e71b8ef270dc75f88b4fad))
- Add loadTexture, textures from images and data, preloads and progress ([#114](https://github.com/null3d-engine/null3d/pull/114), [5c26824d1](https://github.com/null3d-engine/null3d/commit/5c26824d18b44691795d6b002976f52dddef8a8b))
- Hold new frames while two wait on the GPU, and track every frame's completion ([#111](https://github.com/null3d-engine/null3d/pull/111), [b16ca09a0](https://github.com/null3d-engine/null3d/commit/b16ca09a0cac1e7fd7d9fc807c7c137eb8e447b9))
- Add the rest of the 0.1 object calls, keepWorld parents, bounds and scene.find ([#84](https://github.com/null3d-engine/null3d/pull/84), [59658a9c3](https://github.com/null3d-engine/null3d/commit/59658a9c3db86cd6d364a7ac371be4e9dcb335a9))
- Add the eight modules of the WGSL shader library, checked on the GPU on both paths ([#106](https://github.com/null3d-engine/null3d/pull/106), [337ab53cf](https://github.com/null3d-engine/null3d/commit/337ab53cf191dac7f73867582f4b1454f6fa3a03))
- Report changes to a static object that skip its setters, in development builds ([#93](https://github.com/null3d-engine/null3d/pull/93), [8f9d71d68](https://github.com/null3d-engine/null3d/commit/8f9d71d688177a941352d9305039df28ae7a45fb))
- Give hold mode's result the held frame's figures, and save them with each shot ([#94](https://github.com/null3d-engine/null3d/pull/94), [dd54bb4b9](https://github.com/null3d-engine/null3d/commit/dd54bb4b9abdad7448475547f167453a46d47b5c))
- Add the GPU side of textures: arrays, mip levels, samplers and budgeted uploads ([#76](https://github.com/null3d-engine/null3d/pull/76), [54b83b0ce](https://github.com/null3d-engine/null3d/commit/54b83b0ce92cce7f3c6269b93f67a9ce2ddee3e4))
- Compile sketch WGSL in the Vite plugin, with errors at file, line and column ([#81](https://github.com/null3d-engine/null3d/pull/81), [9c26fd790](https://github.com/null3d-engine/null3d/commit/9c26fd790af4c3deff300581fef153530bd62719))
- Add render layers, so each camera draws the objects on its layers ([#77](https://github.com/null3d-engine/null3d/pull/77), [85c687e86](https://github.com/null3d-engine/null3d/commit/85c687e8628ac138bc49c4aa0859beb132bbcc68))
- Add seven geometry generators that match three.js, with texture coordinates ([#80](https://github.com/null3d-engine/null3d/pull/80), [432cf87ec](https://github.com/null3d-engine/null3d/commit/432cf87ec11dca55ecfdf9b6b3018265cc9a3712))
- Cache pipelines by their full key, and build a shader variant for each permutation ([#75](https://github.com/null3d-engine/null3d/pull/75), [93e0f6aa9](https://github.com/null3d-engine/null3d/commit/93e0f6aa9237744d1945451b87fe20351f9893a1))
- Give input.pointer the movement of drags and the scroll of trackpad pinches ([#71](https://github.com/null3d-engine/null3d/pull/71), [9a25687c8](https://github.com/null3d-engine/null3d/commit/9a25687c85bcb145c3c19b8a9bf82dca709bf22a))
- Let a page set the engine's memory maximum, from 256 to 4096 MiB ([#69](https://github.com/null3d-engine/null3d/pull/69), [00307d0ba](https://github.com/null3d-engine/null3d/commit/00307d0ba6f6b3da6ef60e5cec671f3619957730))
- Keep positions relative to grid cells, so scenes far from the origin draw precisely ([#55](https://github.com/null3d-engine/null3d/pull/55), [751e8e60e](https://github.com/null3d-engine/null3d/commit/751e8e60e651861ed493262788483cb924846df4))
- Add vertex formats, and geometry.fromArrays for meshes of any size ([#52](https://github.com/null3d-engine/null3d/pull/52), [5fefcdbe5](https://github.com/null3d-engine/null3d/commit/5fefcdbe5faa5eee452492ec90e9b497b8d8ee53))
- Draw WebGL2 depth with EXT_clip_control where the browser has it ([#47](https://github.com/null3d-engine/null3d/pull/47), [954e59e0a](https://github.com/null3d-engine/null3d/commit/954e59e0ac1386bdd43a0d991bc8cf7ccb7795ef))
- Add ctx.input for pointer, keyboard, touch and gamepad input, with action maps ([#54](https://github.com/null3d-engine/null3d/pull/54), [32588f51b](https://github.com/null3d-engine/null3d/commit/32588f51bb364e48aed421434d4493deced4c2b2))
- Add math helpers for vectors, rotations, matrices, colors and seeded random numbers ([#56](https://github.com/null3d-engine/null3d/pull/56), [84d63e676](https://github.com/null3d-engine/null3d/commit/84d63e676a3aa87143a5763a26275602e3a0ba48))
- Draw both frame builders through the render graph, with culling per view ([#48](https://github.com/null3d-engine/null3d/pull/48), [104ea3182](https://github.com/null3d-engine/null3d/commit/104ea318235a7a869d645a5f4fe7c54a2390f3ed))
- Add a WebAssembly shader compiler for build tools, with errors at line and column ([#45](https://github.com/null3d-engine/null3d/pull/45), [162c9dd12](https://github.com/null3d-engine/null3d/commit/162c9dd1257ee986270f0175cb1811579ee87830))
- Add samplers, texture arrays and views, viewports, scissors, copies and image uploads ([#43](https://github.com/null3d-engine/null3d/pull/43), [394bafb2c](https://github.com/null3d-engine/null3d/commit/394bafb2c7ab3339d259b9080aae49a7f78185ae))
- Add a render graph that orders passes and plans their render passes and textures ([#42](https://github.com/null3d-engine/null3d/pull/42), [e2bf40c89](https://github.com/null3d-engine/null3d/commit/e2bf40c89405ff2a70801897e2c8fd9f2f08ab47))
- Add hold mode, which steps a sketch to a set time and reads that one frame back ([#41](https://github.com/null3d-engine/null3d/pull/41), [0de1b1afa](https://github.com/null3d-engine/null3d/commit/0de1b1afa35afa8af5c15e8c78b2f0c67891637d))
- Test float targets, count visible objects on WebGL2, and check devices before a run ([#32](https://github.com/null3d-engine/null3d/pull/32), [b01b80e9b](https://github.com/null3d-engine/null3d/commit/b01b80e9bb70d8415609d00e2072c7d0e2e5db2c))
- Hold a frame rate with ?fps, and test frame skipping, resizing and non-isolated pages ([#31](https://github.com/null3d-engine/null3d/pull/31), [2c4d90d56](https://github.com/null3d-engine/null3d/commit/2c4d90d56bb0297d6f9c546e0b407f9ee1a4d79c))
- Draw scenes on WebGL2 ([#20](https://github.com/null3d-engine/null3d/pull/20), [a5e552318](https://github.com/null3d-engine/null3d/commit/a5e55231899194e7d4ef47fd8051b5e3f648c305))
- Count pipeline builds, and document how the engine batches and builds pipelines ([#16](https://github.com/null3d-engine/null3d/pull/16), [5cd9bad02](https://github.com/null3d-engine/null3d/commit/5cd9bad0293630f7c58c51c6dc44fe79ee739476))
- Tell sketches when the user prefers reduced motion, and add an accessibility guide ([#15](https://github.com/null3d-engine/null3d/pull/15), [e647fb1af](https://github.com/null3d-engine/null3d/commit/e647fb1afb3dc3847dd19e87e8e8693c8ac73db8))
- Choose the GPU with powerPreference, and follow pixel ratio changes ([#14](https://github.com/null3d-engine/null3d/pull/14), [3c25eaf59](https://github.com/null3d-engine/null3d/commit/3c25eaf59226e83052b1d62a28d4e484aeb240f9))
- Keep an engine across views with detach and attach, and let handlers be removed ([#13](https://github.com/null3d-engine/null3d/pull/13), [bd9f7586d](https://github.com/null3d-engine/null3d/commit/bd9f7586d531fb9ae83e6c4e2025b40861c4fb6b))
- Let scenes grow to the device's GPU limit, and report a memory shortage as E1109 ([#12](https://github.com/null3d-engine/null3d/pull/12), [d98e9abb3](https://github.com/null3d-engine/null3d/commit/d98e9abb375b1f10c2bcb7d0f874c38cf35b220f))
- Call a 3D scene a sketch, and rename the game APIs to match ([#11](https://github.com/null3d-engine/null3d/pull/11), [fb819c95d](https://github.com/null3d-engine/null3d/commit/fb819c95da58b6ae5ee2a86f80933b36a99e506f))
- Count the frames the GPU finishes, and measure the display and the page's thread ([#7](https://github.com/null3d-engine/null3d/pull/7), [f0d3e2cc8](https://github.com/null3d-engine/null3d/commit/f0d3e2cc89b2bd5c2084645c7f451a75709f1e3e))
- Recover from a lost GPU and draw the whole scene again ([#6](https://github.com/null3d-engine/null3d/pull/6), [bb272c910](https://github.com/null3d-engine/null3d/commit/bb272c910c14884c533c17f06cd1d4336f31b4d4))

#### @null3d/cli

- Convert models to glTF and make ORM and normal maps from other maps ([#513](https://github.com/null3d-engine/null3d/pull/513), [4f3f6f172](https://github.com/null3d-engine/null3d/commit/4f3f6f1721ecd6616927779b1b5ce127dbe19c3f))
- Bake normal map detail into roughness mip levels in assets optimize ([#419](https://github.com/null3d-engine/null3d/pull/419), [8e334cde6](https://github.com/null3d-engine/null3d/commit/8e334cde6a574b487317a03f2a226b1e3bf4832e))
- Plan levels of detail by error and merge equal model parts ([#385](https://github.com/null3d-engine/null3d/pull/385), [d54aaa2a6](https://github.com/null3d-engine/null3d/commit/d54aaa2a662db5796fb6c223f6666b195dac4a41))
- Store clips at the engine's key rate, so they load with a copy ([#342](https://github.com/null3d-engine/null3d/pull/342), [8443c5481](https://github.com/null3d-engine/null3d/commit/8443c548101825f25f775361659b153d111dff06))
- Blocker meshes and stored trees from the asset tool ([#287](https://github.com/null3d-engine/null3d/pull/287), [3aadcee0a](https://github.com/null3d-engine/null3d/commit/3aadcee0a03173c31171d3535c03a1e07d4bf380))
- Add assets env, which prefilters HDR images into KTX2 environment maps ([#276](https://github.com/null3d-engine/null3d/pull/276), [7ab688ea1](https://github.com/null3d-engine/null3d/commit/7ab688ea19e03a9a8e1f950354db12ba0fcbfa0e))
- Add assets optimize, which quantizes meshes and encodes KTX2 textures the same everywhere ([#272](https://github.com/null3d-engine/null3d/pull/272), [a8bf5ed36](https://github.com/null3d-engine/null3d/commit/a8bf5ed3672f40382f1feffc6611a653ad1176a2))
- Add the test command, which runs a project's type check, lint and image tests ([#101](https://github.com/null3d-engine/null3d/pull/101), [71d648d76](https://github.com/null3d-engine/null3d/commit/71d648d76709aaf5aacd468ff6dce7d5673d21cb))
- Add the bench command, which measures the engine on a production build of a project ([#110](https://github.com/null3d-engine/null3d/pull/110), [6211b0f7a](https://github.com/null3d-engine/null3d/commit/6211b0f7a73396736562c2d41e9b24446538b0a3))
- Add the shot command, which draws a held frame of a project's page in a headless browser ([#78](https://github.com/null3d-engine/null3d/pull/78), [7a7f0dafb](https://github.com/null3d-engine/null3d/commit/7a7f0dafb1a09d2a92ed97f22ed0119a9e78c651))

#### @null3d/controls

- Add fly and first-person controls, and engine.requestPointerLock() ([#441](https://github.com/null3d-engine/null3d/pull/441), [b169db89c](https://github.com/null3d-engine/null3d/commit/b169db89cfb659ed208aae64bff80ff78c6f5637))
- Add orbit and map controls that reach three.js's camera poses ([#119](https://github.com/null3d-engine/null3d/pull/119), [cc5074173](https://github.com/null3d-engine/null3d/commit/cc5074173b1703347d47387c2d3f8c0baf50e278))

#### @null3d/geometry

- Add the @null3d/geometry package and mesh.updateVertices ([#511](https://github.com/null3d-engine/null3d/pull/511), [e6153d5b5](https://github.com/null3d-engine/null3d/commit/e6153d5b52a0012acc17e902fa676874ff8fa0e5))

#### @null3d/sound

- Add positional sound and play it in the showcase scenes ([#564](https://github.com/null3d-engine/null3d/pull/564), [9e48b5e83](https://github.com/null3d-engine/null3d/commit/9e48b5e83b72c909bbffff9726552f085c0cb299))

#### @null3d/vite-plugin

- List the build's files by feature, so a game's service worker can play offline ([#418](https://github.com/null3d-engine/null3d/pull/418), [c78dc6104](https://github.com/null3d-engine/null3d/commit/c78dc6104e1578393eb2678814b7567b67710336))
- Send changed WGSL to the running page, and compile on worker threads ([#344](https://github.com/null3d-engine/null3d/pull/344), [efead8b5d](https://github.com/null3d-engine/null3d/commit/efead8b5d7a036dccae8a9ff11e67536c9cf72ac))

#### Examples

- Build a new Creek, a garden on a cliff above the clouds ([#561](https://github.com/null3d-engine/null3d/pull/561), [78b7f5e1d](https://github.com/null3d-engine/null3d/commit/78b7f5e1dd9622ad99f394b4b8693b87aa86e6ed))
- Add the Creek showcase scene ([#520](https://github.com/null3d-engine/null3d/pull/520), [22997a3f2](https://github.com/null3d-engine/null3d/commit/22997a3f2408fcb880853b6a83b57cba5df99828))
- Add the Battle comparison with three.js ([#517](https://github.com/null3d-engine/null3d/pull/517), [89c75a029](https://github.com/null3d-engine/null3d/commit/89c75a02923a817ca82b88e6a18ccc2a602e4b1e))
- Add the comparison page and the Factory scene against three.js ([#480](https://github.com/null3d-engine/null3d/pull/480), [e06b0daba](https://github.com/null3d-engine/null3d/commit/e06b0daba9bf099d1e4b1fec71219ef9e6c19206))
- Add five feature demos: time of day, walk and fly, lens, points, morph targets ([#479](https://github.com/null3d-engine/null3d/pull/479), [de4cf46b6](https://github.com/null3d-engine/null3d/commit/de4cf46b602741ed26a29bb742f817bbabadd234))
- Give eight more feature demos a richer look ([#466](https://github.com/null3d-engine/null3d/pull/466), [c421978d2](https://github.com/null3d-engine/null3d/commit/c421978d2774a9533c76647f38741370931a98a7))
- Give six more feature demos a richer look ([#458](https://github.com/null3d-engine/null3d/pull/458), [dc2d9349b](https://github.com/null3d-engine/null3d/commit/dc2d9349b16fb2431b24815e600f5c766e6eaf7a))
- Give the math, instances and generators demos a rich look, and regroup the demos ([#456](https://github.com/null3d-engine/null3d/pull/456), [6201d501b](https://github.com/null3d-engine/null3d/commit/6201d501b51604a0eeef2a00de47d83d7196a1d9))
- Make every demo interactive: turn, zoom and pan at any time, and steer it ([#446](https://github.com/null3d-engine/null3d/pull/446), [3768936a5](https://github.com/null3d-engine/null3d/commit/3768936a5cbd950528e1e9efb085ef3166594888))
- List the demos in a sidebar, with a drawer on phones and a link to each demo's code ([#445](https://github.com/null3d-engine/null3d/pull/445), [545dd038d](https://github.com/null3d-engine/null3d/commit/545dd038d786849c4d9e56d6a08aa1ac1cb514b3))
- Build the demos for production, for a clone and for a website's own layout ([#444](https://github.com/null3d-engine/null3d/pull/444), [3252be180](https://github.com/null3d-engine/null3d/commit/3252be180b736c488000b4886b291b9783a20d4f))
- Add a security camera demo, which shows a scene pass on a monitor ([#431](https://github.com/null3d-engine/null3d/pull/431), [ac4a3a20c](https://github.com/null3d-engine/null3d/commit/ac4a3a20c68582532734c3e100005bd8149009cf))
- Add demos of models, characters, picking, environments, effects, sprites and worlds ([#422](https://github.com/null3d-engine/null3d/pull/422), [26b6a1074](https://github.com/null3d-engine/null3d/commit/26b6a10745f49bd656a82096abd478e3716ea3ac))

#### Other parts

- **showcase:** Finish the island demo's models, sea, life and near detail ([#562](https://github.com/null3d-engine/null3d/pull/562), [cbdd718e4](https://github.com/null3d-engine/null3d/commit/cbdd718e4f0288959f81a24a36d2db84b10dd4ab))

#### Repository and tooling

- Add the showcase plan, the pages in the smoke plan and soaks of named scenes ([#495](https://github.com/null3d-engine/null3d/pull/495), [9ad6b97a8](https://github.com/null3d-engine/null3d/commit/9ad6b97a831c518ea7f27e370f6ca201d1b4477f))
- Store S6's towers as one mesh per material, with exact corners ([#439](https://github.com/null3d-engine/null3d/pull/439), [c93bbaf5d](https://github.com/null3d-engine/null3d/commit/c93bbaf5d08e51c3ea8845bbc1d0310fcd770ded))
- Guard GPU time with a comparison rule, a check before merge and a nightly run ([#442](https://github.com/null3d-engine/null3d/pull/442), [a5476fe44](https://github.com/null3d-engine/null3d/commit/a5476fe44f8ea79b64c867d64262ee9e79c2e6ea))
- Time S6 with software occlusion culling off and on ([#437](https://github.com/null3d-engine/null3d/pull/437), [16ef22436](https://github.com/null3d-engine/null3d/commit/16ef22436d7943f0f71186d942918c442f4e75d2))
- Add S6, the city, with its three.js twin ([#426](https://github.com/null3d-engine/null3d/pull/426), [112a2c062](https://github.com/null3d-engine/null3d/commit/112a2c06234d1ec592b8bb8c821f6f8c6adc39b4))
- Add S5, the crowd of animated characters, with its three.js twin ([#289](https://github.com/null3d-engine/null3d/pull/289), [a1168724b](https://github.com/null3d-engine/null3d/commit/a1168724bc5fff3749540375327dfe478e4bfb00))
- Fetch the pinned sample content into a shared cache, and check what tests name ([#236](https://github.com/null3d-engine/null3d/pull/236), [41851dbfc](https://github.com/null3d-engine/null3d/commit/41851dbfc17727c4a2d23f36fa7ef2307a17552b))
- Add S4, the phone scene, with a trace of each second's frame rates ([#158](https://github.com/null3d-engine/null3d/pull/158), [4a93a7c15](https://github.com/null3d-engine/null3d/commit/4a93a7c150f76936809ee95519fe5f7920be1b79))
- Add S3, 20,000 still boxes lit by 256 moving point lights, with a three.js twin ([#149](https://github.com/null3d-engine/null3d/pull/149), [d748e9866](https://github.com/null3d-engine/null3d/commit/d748e9866b7c0ec46bc8358b122c04a851fc922c))
- Run the benchmarks on a production build, as developers ship the engine ([#98](https://github.com/null3d-engine/null3d/pull/98), [209f04940](https://github.com/null3d-engine/null3d/commit/209f049403a0cccf941ed48cb0af073014f36f83))
- Compare each commit's speed with the one before it on GitHub's Mac machine ([#67](https://github.com/null3d-engine/null3d/pull/67), [027db358b](https://github.com/null3d-engine/null3d/commit/027db358b0025ffe798772259f260f03d4e93d5d))
- Time cold and warm starts of the engine on phones and tablets in every thread mode ([#50](https://github.com/null3d-engine/null3d/pull/50), [e8e757270](https://github.com/null3d-engine/null3d/commit/e8e757270f4ffb0f78ce0f8d2571177bdec9ad83))
- Profile the sketch worker and name the engine core's functions ([#40](https://github.com/null3d-engine/null3d/pull/40), [194d93ff6](https://github.com/null3d-engine/null3d/commit/194d93ff6171654eb65e61501704b7aee3b2db72))
- Report the engine's JavaScript size, ship the GPU layer once, and soak test the workers ([#34](https://github.com/null3d-engine/null3d/pull/34), [419fff4b3](https://github.com/null3d-engine/null3d/commit/419fff4b3a9986385794385b97840c590aecbd65))
- Run bench plan pages for longer with --seconds ([#36](https://github.com/null3d-engine/null3d/pull/36), [68856030b](https://github.com/null3d-engine/null3d/commit/68856030b676c52b0f1e2b4e8f314ddeaa32ce60))
- Count how many engines fit at once at each shared memory maximum ([#35](https://github.com/null3d-engine/null3d/pull/35), [f8fad93fa](https://github.com/null3d-engine/null3d/commit/f8fad93faa7a9b8c1cdc53db8034573f796e6bc8))
- Pick the device runner's bench pages and scenes ([#29](https://github.com/null3d-engine/null3d/pull/29), [3e68f5a18](https://github.com/null3d-engine/null3d/commit/3e68f5a1854beedcd692b690fa1f9ba9ef9e99f7))
- Show each benchmark page's name above its scene ([#28](https://github.com/null3d-engine/null3d/pull/28), [44ddbae8b](https://github.com/null3d-engine/null3d/commit/44ddbae8baf4592c88735f57db1f6d921a165083))
- Give each copy of the repository its own dev server ports with NULL3D_PORT ([#27](https://github.com/null3d-engine/null3d/pull/27), [b27f8f318](https://github.com/null3d-engine/null3d/commit/b27f8f318dfcbe179e9d13f14c609bba179777a0))
- Measure job worker counts, memory maximums and latency modes on any device ([#26](https://github.com/null3d-engine/null3d/pull/26), [475e91a2f](https://github.com/null3d-engine/null3d/commit/475e91a2fcbb3242326d8cd86ffd99f075b7c111))
- Profile how the render worker's replay splits between engine code and browser calls ([#23](https://github.com/null3d-engine/null3d/pull/23), [bdcd2a71a](https://github.com/null3d-engine/null3d/commit/bdcd2a71a5435580d5ac36530ebe87111558b497))
- Distribute the agent skills as a Claude Code plugin and as release zips ([#18](https://github.com/null3d-engine/null3d/pull/18), [b054dfb5c](https://github.com/null3d-engine/null3d/commit/b054dfb5c1ed8b9a60d1436c0924dc21775d34a1))

#### Across the project

- Add the live scene inspector and the MCP server ([#571](https://github.com/null3d-engine/null3d/pull/571), [597bc44f6](https://github.com/null3d-engine/null3d/commit/597bc44f6e863d1721fbb3a9774191715dd900b2))
- The 0.2 release work for level of detail, effects, add-ons and vegetation ([#549](https://github.com/null3d-engine/null3d/pull/549), [5b6006ebb](https://github.com/null3d-engine/null3d/commit/5b6006ebbb60964cddb3199f21b50c598ec6fa3e))
- Package the engine, Vite plugin and controls for npm, tested in a fresh project ([#248](https://github.com/null3d-engine/null3d/pull/248), [b1848a889](https://github.com/null3d-engine/null3d/commit/b1848a889e95323fbff191d82e837329beb39561))
- Rename to null3D, cut releases through pull requests, and write docs for engine users ([#2](https://github.com/null3d-engine/null3d/pull/2), [f50a9a6e9](https://github.com/null3d-engine/null3d/commit/f50a9a6e9e1da940b726e6a46948f0e5d71d961c))
- The engine core, tuned for desktop speed ([#1](https://github.com/null3d-engine/null3d/pull/1), [d5c9d03ce](https://github.com/null3d-engine/null3d/commit/d5c9d03ce654129dae33b737e6613975652ff8f5))

### Bug fixes

#### @null3d/engine

- Draw custom-material batches in WebGL2 reflections ([#515](https://github.com/null3d-engine/null3d/pull/515), [a511ca5b9](https://github.com/null3d-engine/null3d/commit/a511ca5b90d534110bf40ae4c21cea6b8b48a9d8))
- Size a reflection's texture to the render scale ([#509](https://github.com/null3d-engine/null3d/pull/509), [a9dece5f0](https://github.com/null3d-engine/null3d/commit/a9dece5f05e3b9dfb733ab3743b2360fed5e214a))
- Keep the host's functions out of effect pieces so WebGL2 folds build ([#506](https://github.com/null3d-engine/null3d/pull/506), [e204ef124](https://github.com/null3d-engine/null3d/commit/e204ef124629744637c667cd8c49799263ca9d33))
- Export the option types of reflection passes ([#490](https://github.com/null3d-engine/null3d/pull/490), [6a7c801da](https://github.com/null3d-engine/null3d/commit/6a7c801dae9b86a65bb706845e2240fee16f47ca))
- Light the night sky from the moon, and fade into it from the sunset ([#476](https://github.com/null3d-engine/null3d/pull/476), [958538f0c](https://github.com/null3d-engine/null3d/commit/958538f0c19caef679d216658275eeeb098adf06))
- Fail with E1402 when the core was built from other Rust sources ([#475](https://github.com/null3d-engine/null3d/pull/475), [bbb6154cb](https://github.com/null3d-engine/null3d/commit/bbb6154cb0409bda0eb1fe9a39ec9f83c2278567))
- Test the KTX2 background, check static batch rows, time the first-frame warm-up ([#470](https://github.com/null3d-engine/null3d/pull/470), [75e3c06e8](https://github.com/null3d-engine/null3d/commit/75e3c06e804704c97559d48572cfeb141bda882d))
- Give each connected part of a blocker mesh its own place in the occlusion order ([#464](https://github.com/null3d-engine/null3d/pull/464), [41a9ce57a](https://github.com/null3d-engine/null3d/commit/41a9ce57a13958bcd8df331bbc3f48008041c090))
- Publish the memory figures in the first frame that samples them ([#454](https://github.com/null3d-engine/null3d/pull/454), [18563cf00](https://github.com/null3d-engine/null3d/commit/18563cf00aa5a566c4d6f5b262ce3711c8d1e27c))
- Carry ?fps= to the sketch thread once, and say which three.js renderer blending matches ([#438](https://github.com/null3d-engine/null3d/pull/438), [1933dbbf7](https://github.com/null3d-engine/null3d/commit/1933dbbf78fe5ee31a3ab9af2e8376baa8f6c439))
- Sample each texture map directly on WebGPU, so MSAA draws stay fast ([#434](https://github.com/null3d-engine/null3d/pull/434), [42bb0cdec](https://github.com/null3d-engine/null3d/commit/42bb0cdecb1d89ec932d5d5369820365b366ef7f))
- Keep effects' pipelines when a material goes, and bind occlusion to the new depth ([#425](https://github.com/null3d-engine/null3d/pull/425), [809ce8ce4](https://github.com/null3d-engine/null3d/commit/809ce8ce4dba9199566876b8f90e9f8e1d1cd4db))
- Import a sketch module that did not load once more before E1410 ([#420](https://github.com/null3d-engine/null3d/pull/420), [7837ecf8f](https://github.com/null3d-engine/null3d/commit/7837ecf8fd6ced45b44145642248e96f3e3efddd))
- Keep ambient occlusion's dark dots off the image's bottom row and right column ([#414](https://github.com/null3d-engine/null3d/pull/414), [ebd64cc21](https://github.com/null3d-engine/null3d/commit/ebd64cc21e165cabc4935d481125fad984a55036))
- Keep the channels between the engine's threads until the engine stops ([#401](https://github.com/null3d-engine/null3d/pull/401), [ed205301e](https://github.com/null3d-engine/null3d/commit/ed205301e13065c5229d886ea5532f3f95a787ac))
- Share one probe answer between the engine starts of a page ([#400](https://github.com/null3d-engine/null3d/pull/400), [756fd28e9](https://github.com/null3d-engine/null3d/commit/756fd28e9c16850dae21b47fe3a5a781bd3231de))
- Try a second probe worker after a stall, and say why the page draws instead of a worker ([#393](https://github.com/null3d-engine/null3d/pull/393), [f1f775982](https://github.com/null3d-engine/null3d/commit/f1f77598201349a492ad64d9def6f8852fcbcba4))
- Keep far objects in place and captures whole on the Galaxy S25's WebGPU ([#384](https://github.com/null3d-engine/null3d/pull/384), [bf13d1bba](https://github.com/null3d-engine/null3d/commit/bf13d1bba9e6a3b177f830f76e4617182d1cb4af))
- Name worker-src for a sketch that Firefox blocks on a CDN ([#387](https://github.com/null3d-engine/null3d/pull/387), [3766f8756](https://github.com/null3d-engine/null3d/commit/3766f87564f38630e099c1fcc70d4a391c7a76ae))
- Place skinned meshes by their joints at rest, in prefab bounds and instance batches ([#383](https://github.com/null3d-engine/null3d/pull/383), [b4f925ce4](https://github.com/null3d-engine/null3d/commit/b4f925ce4d81d01a57102bab62d0533c12b7343b))
- Work out the sun's receiver plane from the normal in one product ([#371](https://github.com/null3d-engine/null3d/pull/371), [74d5f4956](https://github.com/null3d-engine/null3d/commit/74d5f4956fed263bf258c2bc7425701aa7390607))
- Copy indirect draw arguments only in Apple's WebKit, where Safari 26 needs them ([#365](https://github.com/null3d-engine/null3d/pull/365), [33f4a5c9f](https://github.com/null3d-engine/null3d/commit/33f4a5c9fafcaf0c4252c5ee78d2b041f21fb9b8))
- Run the sun's cascade lookup once per cascade, not a fixed four times ([#364](https://github.com/null3d-engine/null3d/pull/364), [2c76cf222](https://github.com/null3d-engine/null3d/commit/2c76cf22261d5dd861442d55213514ef8b7cb4f2))
- Keep moving shadows under their casters on Low ([#359](https://github.com/null3d-engine/null3d/pull/359), [8311f9ee2](https://github.com/null3d-engine/null3d/commit/8311f9ee20df83cde1b4e64f15c13f94b93a237d))
- Read WebGL2's shadow maps at their own level, which Apple's GPUs run faster ([#360](https://github.com/null3d-engine/null3d/pull/360), [e9734b72e](https://github.com/null3d-engine/null3d/commit/e9734b72ed4ae37b02d4cf9d2a51a86361d160a9))
- Start a new engine on the canvas of a destroyed one on WebGL2 ([#336](https://github.com/null3d-engine/null3d/pull/336), [8699fab4e](https://github.com/null3d-engine/null3d/commit/8699fab4ed794758fe8f28ade3e6a7914fd99162))
- Give each indirect draw of a pass its own arguments, which Safari 26 hangs on otherwise ([#353](https://github.com/null3d-engine/null3d/pull/353), [ef275814a](https://github.com/null3d-engine/null3d/commit/ef275814a9a3514c4d42a006fbdd40ec771a4024))
- Compare frame numbers and image ids by their order around the 32-bit count ([#357](https://github.com/null3d-engine/null3d/pull/357), [2aa1447f1](https://github.com/null3d-engine/null3d/commit/2aa1447f12e45e17580d1f48f5fe7fc731e8aab3))
- Let captures wait for the frame loop's next frame, and name readback failures ([#356](https://github.com/null3d-engine/null3d/pull/356), [70ddb46f0](https://github.com/null3d-engine/null3d/commit/70ddb46f01fb99199d18499293f9081db9e55b22))
- Let Safari free the memory of engines whose drawing worker stays with the canvas ([#352](https://github.com/null3d-engine/null3d/pull/352), [55ab8d736](https://github.com/null3d-engine/null3d/commit/55ab8d7366d84df013945dff4af5d6f0cb76ba93))
- Make the room and GPU times right in Firefox on the Mac ([#350](https://github.com/null3d-engine/null3d/pull/350), [156c0621d](https://github.com/null3d-engine/null3d/commit/156c0621d413cd31d442faf4a2542c54f1bbe355))
- Store each callback's interval in the refresh meter's tick, so it allocates nothing ([#347](https://github.com/null3d-engine/null3d/pull/347), [fdf14a284](https://github.com/null3d-engine/null3d/commit/fdf14a28492d450327c699e021e63a5b4f66053a))
- Let the governor see Safari's slow frames when the page draws ([#338](https://github.com/null3d-engine/null3d/pull/338), [01e0b0b1a](https://github.com/null3d-engine/null3d/commit/01e0b0b1a666a33d74e8ee3aa7db845987d50f6e))
- Keep the governor's times in 32-bit integers, so it allocates nothing ([#335](https://github.com/null3d-engine/null3d/pull/335), [782669ff2](https://github.com/null3d-engine/null3d/commit/782669ff21c88b3d546289ec12c851769486e380))
- Skin formats without a tangent with a build that has no tangent code ([#329](https://github.com/null3d-engine/null3d/pull/329), [fd315a2e0](https://github.com/null3d-engine/null3d/commit/fd315a2e0ccc64782ca2512378196643638cc2b3))
- Keep arrays out of the environment's values, which Adreno WebGL2 copies empty ([#322](https://github.com/null3d-engine/null3d/pull/322), [d83350b76](https://github.com/null3d-engine/null3d/commit/d83350b761429afb57e71e54b570064245ca3f0d))
- Keep the governor's grace after a stall, and fix the late skinning test's scale ([#325](https://github.com/null3d-engine/null3d/pull/325), [f323af667](https://github.com/null3d-engine/null3d/commit/f323af6672d06ea2b65f561b6ce93fe90137858d))
- Report frozen or leaking failures, and restart on a destroyed engine's canvas ([#318](https://github.com/null3d-engine/null3d/pull/318), [3a768c307](https://github.com/null3d-engine/null3d/commit/3a768c307998fffe8f65ca6f176010e174ab72f4))
- Keep the limit of two frames in flight when the first frame takes seconds ([#319](https://github.com/null3d-engine/null3d/pull/319), [4b778734f](https://github.com/null3d-engine/null3d/commit/4b778734f00a82d7674ed9a778bd29b555cdd9ed))
- Link a WebGL2 program again after Safari's random Metal fault ([#312](https://github.com/null3d-engine/null3d/pull/312), [a2e45c84b](https://github.com/null3d-engine/null3d/commit/a2e45c84bd596c93d07e8679dc6bab1ebd23540b))
- Send texture images to the drawing thread once its renderer exists ([#311](https://github.com/null3d-engine/null3d/pull/311), [62ab95e1b](https://github.com/null3d-engine/null3d/commit/62ab95e1bf81746e90836fd7d57565bafb2ce524))
- Redraw only the shadow tiles that a change reaches, and cap tile redraws per frame ([#310](https://github.com/null3d-engine/null3d/pull/310), [505b0e036](https://github.com/null3d-engine/null3d/commit/505b0e036c3865b3546f518009e8ce43c8c80290))
- Compare each shadow map texel with its own depth, to clear Low's stripes ([#313](https://github.com/null3d-engine/null3d/pull/313), [d95cec027](https://github.com/null3d-engine/null3d/commit/d95cec027563e8e3a8ad14c779ab3c042b4d6ddf))
- Win back S4's GPU time at Low after the gate's iPad comparison ([#307](https://github.com/null3d-engine/null3d/pull/307), [53ab2803f](https://github.com/null3d-engine/null3d/commit/53ab2803fb732ddb4f75f2e6aae4bfd1ad53d497))
- Check every file's limits before the loaders allocate ([#309](https://github.com/null3d-engine/null3d/pull/309), [9ae0b5fe4](https://github.com/null3d-engine/null3d/commit/9ae0b5fe4ddd4a12edc48a3fd5cf1a272a4e23f0))
- Grow the draw list, fail frames whole, and split GPU skinning by device limits ([#292](https://github.com/null3d-engine/null3d/pull/292), [1533939f3](https://github.com/null3d-engine/null3d/commit/1533939f3a7b1e55aa0b531f6fa18de3b5886584))
- Queries refuse bad input in every build, skip empty tree slots and see late moves ([#298](https://github.com/null3d-engine/null3d/pull/298), [683afcf75](https://github.com/null3d-engine/null3d/commit/683afcf75f23cc05cac6f2b40590a62da8165d95))
- Keep HDR color within 16-bit floats and hues at half precision, lower arrays for Mali ([#295](https://github.com/null3d-engine/null3d/pull/295), [5ab17ec11](https://github.com/null3d-engine/null3d/commit/5ab17ec119135c9b96b2ca18304b023d2a118d8b))
- Start the shader file's download right after the GPU probe ([#296](https://github.com/null3d-engine/null3d/pull/296), [bf0dfa7bc](https://github.com/null3d-engine/null3d/commit/bf0dfa7bc669ea06d7dd04e877fb044e4356fe61))
- Loop fractal noise a fixed number of passes, for the Adreno 830's WebGPU driver ([#277](https://github.com/null3d-engine/null3d/pull/277), [715bfb209](https://github.com/null3d-engine/null3d/commit/715bfb209d15a8306790909060bc7852f14f1f64))
- Take a click's ray from the setup's camera while a setup frame is on screen ([#269](https://github.com/null3d-engine/null3d/pull/269), [17811c43d](https://github.com/null3d-engine/null3d/commit/17811c43d9645ddf8fc84230a6f485f203a20dd4))
- Write large WGSL numbers in exponent form, so shadowed shaders build in Safari 26 ([#265](https://github.com/null3d-engine/null3d/pull/265), [9ef7c7ad0](https://github.com/null3d-engine/null3d/commit/9ef7c7ad0130dbc4b9ff5d0e4ba3824727fad8a4))
- Step fractal noise octaves by exact powers of 2, for the Adreno 830 ([#262](https://github.com/null3d-engine/null3d/pull/262), [3243c0ec9](https://github.com/null3d-engine/null3d/commit/3243c0ec93e7231668aadbaabbe97bd1915ba6df))
- Step down below 95% of the target rate, and wait longer after a late failed step up ([#260](https://github.com/null3d-engine/null3d/pull/260), [21de365f6](https://github.com/null3d-engine/null3d/commit/21de365f6fc72978c6709bb613e169a37d889da4))
- Keep flat casters such as pavements from shadowing their own lit tops ([#257](https://github.com/null3d-engine/null3d/pull/257), [2ab66e2ed](https://github.com/null3d-engine/null3d/commit/2ab66e2ed13bb3daa5edfd2f3561093384f6f8a5))
- Keep shadows against the base of the objects that cast them ([#250](https://github.com/null3d-engine/null3d/pull/250), [3b79b9da5](https://github.com/null3d-engine/null3d/commit/3b79b9da5540bc21ad663d727049c1e13a552e8c))
- Draw WebGL2 mip levels and array copies through a spare texture, for Adreno 830 ([#244](https://github.com/null3d-engine/null3d/pull/244), [cde351f22](https://github.com/null3d-engine/null3d/commit/cde351f221c6e53667cba14ef9a5333e93d21c4a))
- Copy 2D textures into 3D slices through a buffer, which Safari needs ([#245](https://github.com/null3d-engine/null3d/pull/245), [b3014898f](https://github.com/null3d-engine/null3d/commit/b3014898f9bb3295b6f342d7f982013cbb1f8650))
- Keep per-frame allocation in S4 within budget on both GPU paths ([#241](https://github.com/null3d-engine/null3d/pull/241), [ce48c00b1](https://github.com/null3d-engine/null3d/commit/ce48c00b1ef9ecad57f4d90a9c9b4cda25a219b5))
- Keep moving casters' shadows on them, and give shadow biases in meters ([#227](https://github.com/null3d-engine/null3d/pull/227), [deb77723e](https://github.com/null3d-engine/null3d/commit/deb77723e5de5b2125730fa3793cfbdc59eed301))
- End the job workers' waits when the page leaves, so Safari frees the memory ([#223](https://github.com/null3d-engine/null3d/pull/223), [aace3d77b](https://github.com/null3d-engine/null3d/commit/aace3d77bc23b52f3b888c15eda76263820068a8))
- Fill local GLSL arrays element by element, which Mali GPUs need ([#224](https://github.com/null3d-engine/null3d/pull/224), [ded34c656](https://github.com/null3d-engine/null3d/commit/ded34c65666780d81e5e9b7a73024bfdd04dcb00))
- Let the governor see Safari's slow frames and its room at the full rate ([#222](https://github.com/null3d-engine/null3d/pull/222), [b0ef67efe](https://github.com/null3d-engine/null3d/commit/b0ef67efee2e10085b0965ce3bc07d3da0853f93))
- Keep the drawing buffer within each GPU path's limit, and correct three audit findings ([#220](https://github.com/null3d-engine/null3d/pull/220), [996248145](https://github.com/null3d-engine/null3d/commit/9962481451488fe34dc949841843e51dbd7256c3))
- Give the middle distance finer shadow texels with a split that leans less near ([#211](https://github.com/null3d-engine/null3d/pull/211), [bd2de2da0](https://github.com/null3d-engine/null3d/commit/bd2de2da03575bf579cf4669aa076091084b3529))
- End a start at once when the render worker fails, sketch on the main thread ([#209](https://github.com/null3d-engine/null3d/pull/209), [813072af0](https://github.com/null3d-engine/null3d/commit/813072af026405f2eee596da4648eb5fb4c869e4))
- Stop the frame failing when the last see-through object goes away ([#200](https://github.com/null3d-engine/null3d/pull/200), [bdf035edd](https://github.com/null3d-engine/null3d/commit/bdf035edd276a98ed7e68c0105702e51977000b9))
- Keep a canvas that no CSS sizes from growing until it cannot draw ([#191](https://github.com/null3d-engine/null3d/pull/191), [3c6d2b55b](https://github.com/null3d-engine/null3d/commit/3c6d2b55bdef51c589884b343456693096987d43))
- Free the canvas's display buffers when the engine stops ([#190](https://github.com/null3d-engine/null3d/pull/190), [9107b9a61](https://github.com/null3d-engine/null3d/commit/9107b9a61f486006212b9580065b0c8e96b40cca))
- Hold two frames in flight when the GPU's frame times vary ([#187](https://github.com/null3d-engine/null3d/pull/187), [9c1d2047c](https://github.com/null3d-engine/null3d/commit/9c1d2047c50c4a701e2d4abcb36a533f042bef2f))
- Keep the limit of two frames in flight on a slow GPU ([#180](https://github.com/null3d-engine/null3d/pull/180), [bea3dd4db](https://github.com/null3d-engine/null3d/commit/bea3dd4dbd10f10500498429a08800ffb25af56e))
- Free the GPU device of the worker that draws when the engine stops ([#182](https://github.com/null3d-engine/null3d/pull/182), [71b36e950](https://github.com/null3d-engine/null3d/commit/71b36e950db9445b3ecdafc3aaed28208ff90c51))
- Reject createEngine when a thread fails during the start, instead of hanging ([#183](https://github.com/null3d-engine/null3d/pull/183), [4daa2bce4](https://github.com/null3d-engine/null3d/commit/4daa2bce479965d10b23d695a7d7af441f13da96))
- Run in pipelined mode when low latency asks a worker that cannot draw ([#166](https://github.com/null3d-engine/null3d/pull/166), [5abde9e99](https://github.com/null3d-engine/null3d/commit/5abde9e99deec31a2dc8c7494cc8f65a5d35e7e6))
- Make the views of engine memory again after every call that can grow it ([#173](https://github.com/null3d-engine/null3d/pull/173), [dadac9fdd](https://github.com/null3d-engine/null3d/commit/dadac9fdd1ee9273da452b24666dc0064494979b))
- Accept setBounds and setMesh in onLateUpdate without a false E1110 ([#164](https://github.com/null3d-engine/null3d/pull/164), [8e0cf547c](https://github.com/null3d-engine/null3d/commit/8e0cf547cc2db00ba8f60de2aa2462296735f68b))
- Keep the render loop's frame times in typed arrays, so drawing a frame allocates less ([#162](https://github.com/null3d-engine/null3d/pull/162), [4ebf9340e](https://github.com/null3d-engine/null3d/commit/4ebf9340e5c750bbf8cd90cfe5d7768456994349))
- Wake the threads with messages in browsers without Atomics.waitAsync ([#161](https://github.com/null3d-engine/null3d/pull/161), [fa1ed61cd](https://github.com/null3d-engine/null3d/commit/fa1ed61cd178259f483a79d9d5adea0c27ca6e33))
- Keep a press that follows a release for the next frame, so no frame joins two drags ([#171](https://github.com/null3d-engine/null3d/pull/171), [23a7781cf](https://github.com/null3d-engine/null3d/commit/23a7781cfc51e4d80c0c1ab2d4d93aa65b4dd7da))
- Keep calls on destroyed lights, objects and batches away from their successors ([#163](https://github.com/null3d-engine/null3d/pull/163), [9b36a31c0](https://github.com/null3d-engine/null3d/commit/9b36a31c0e27fce6f5428b7e8a978e0b162f075e))
- Build main again after the render layers and the geometry generators merged together ([#90](https://github.com/null3d-engine/null3d/pull/90), [0ec731389](https://github.com/null3d-engine/null3d/commit/0ec73138907e020d1e4f7d6685662d70c07af5dc))
- Warn in development past the rows that every device of the page's GPU path draws ([#83](https://github.com/null3d-engine/null3d/pull/83), [5efb4597c](https://github.com/null3d-engine/null3d/commit/5efb4597cdd7773bda99a62a9bec71d278678c95))
- Make Material.set change only the options it gets, and correct docs to match the code ([#68](https://github.com/null3d-engine/null3d/pull/68), [3bdede03f](https://github.com/null3d-engine/null3d/commit/3bdede03fcedc2cdd5b2ac36a14ea1c7abda428f))
- Keep job scratch within its size however the chunks fall ([#63](https://github.com/null3d-engine/null3d/pull/63), [c1a1d1782](https://github.com/null3d-engine/null3d/commit/c1a1d1782f60a0d92999c80aa11c685ea8bf4d2a))
- Start each worker once, as Safari reruns a worker's file when another file imports it ([#58](https://github.com/null3d-engine/null3d/pull/58), [9d2878c31](https://github.com/null3d-engine/null3d/commit/9d2878c3156fbbb8733855c7b67b5c0006c71919))
- Try again when the browser refuses a new engine's shared memory for a moment ([#53](https://github.com/null3d-engine/null3d/pull/53), [bdcdcb9bc](https://github.com/null3d-engine/null3d/commit/bdcdcb9bcec108ce8d7c9bfe4237cfe3b7547f3c))
- Make instanceof EngineError and each message's fix work in production builds ([#44](https://github.com/null3d-engine/null3d/pull/44), [b7ff67135](https://github.com/null3d-engine/null3d/commit/b7ff67135e37d57e0db5cc8ce581a0987db28fa6))
- Let a page start the engine again after it stops, without Safari keeping its memory ([#33](https://github.com/null3d-engine/null3d/pull/33), [536e397a4](https://github.com/null3d-engine/null3d/commit/536e397a49da4233e8ac0b7cfba55f8da9901111))
- Draw with multi-draw in Safari at full speed ([#30](https://github.com/null3d-engine/null3d/pull/30), [2c573e878](https://github.com/null3d-engine/null3d/commit/2c573e878702128e208d77e99bbf33fd1e5c1444))
- Show WebGL2 frames on the canvas, and draw with the faster GPU by default ([#21](https://github.com/null3d-engine/null3d/pull/21), [3e3b743cc](https://github.com/null3d-engine/null3d/commit/3e3b743cc91e6dcea3e46939d632db38c165b670))
- Stay within the GPU's storage limit, and refuse oversized scenes with E1501 ([#8](https://github.com/null3d-engine/null3d/pull/8), [e2c1f02fc](https://github.com/null3d-engine/null3d/commit/e2c1f02fc86b4ffe755c53d96604939149634f03))
- Steady time after pauses, released input, and GPU-loss reports ([#5](https://github.com/null3d-engine/null3d/pull/5), [7eb549ada](https://github.com/null3d-engine/null3d/commit/7eb549ada77c9d8bbca3b32cd834721acb8e17eb))
- Make production builds work, and test one in CI ([#4](https://github.com/null3d-engine/null3d/pull/4), [37b133bc9](https://github.com/null3d-engine/null3d/commit/37b133bc9e4a00b451b67843d4232a907e63b5df))

#### Repository and tooling

- Land the version commit with a GitHub App, and print the shader archive's progress ([#574](https://github.com/null3d-engine/null3d/pull/574), [c5ac49c41](https://github.com/null3d-engine/null3d/commit/c5ac49c418bb78e8f59d6d636993c8c31e211412))
- Measure the texture arrays' steady play once their pipelines are built ([#573](https://github.com/null3d-engine/null3d/pull/573), [fe2492dfb](https://github.com/null3d-engine/null3d/commit/fe2492dfbe7fad1843101938cece0f48e2509f54))
- Wait for the display's rate before the stats target checks ([#570](https://github.com/null3d-engine/null3d/pull/570), [3524b6918](https://github.com/null3d-engine/null3d/commit/3524b69186bd2b7a6626e1dc73a511a3c810a6c9))
- Pass a stop signal from the cloud command on to its device runner ([#532](https://github.com/null3d-engine/null3d/pull/532), [ef59ff24c](https://github.com/null3d-engine/null3d/commit/ef59ff24ccf3294e9b129faf18ec20de761e9da5))
- Balance CI's Safari shards by page time and bound the fresh-project browser ([#531](https://github.com/null3d-engine/null3d/pull/531), [2e221f2fe](https://github.com/null3d-engine/null3d/commit/2e221f2fe9fb30bd8dd558699463a0868e133c02))
- Let a dev server in a worktree see its own edits ([#528](https://github.com/null3d-engine/null3d/pull/528), [26979f233](https://github.com/null3d-engine/null3d/commit/26979f23397154f7ae4e5d6cfc8e899561f58bb9))
- Give the split renderers' drawing step its allocation budget again ([#461](https://github.com/null3d-engine/null3d/pull/461), [b32d4eb0f](https://github.com/null3d-engine/null3d/commit/b32d4eb0f2438d4312a6edf6b64018106cc86f8a))
- Pass S6's occlusion test its scene and page kind apart ([#443](https://github.com/null3d-engine/null3d/pull/443), [0e83c3100](https://github.com/null3d-engine/null3d/commit/0e83c310079181d5b6abbe7be307218b33d57708))
- Make the destroy test draw the scene that destroys meshes ([#410](https://github.com/null3d-engine/null3d/pull/410), [8524ad48c](https://github.com/null3d-engine/null3d/commit/8524ad48c0950e8da6bfbf4e965fcf077f94e213))
- Accept page switches whose names hold hyphens ([#354](https://github.com/null3d-engine/null3d/pull/354), [493b175a0](https://github.com/null3d-engine/null3d/commit/493b175a021c59f422d600dd9f5d9fedeb018dca))
- Judge short pages on 0.05 ms and every page on its rounds' noise ([#345](https://github.com/null3d-engine/null3d/pull/345), [ce0d5144b](https://github.com/null3d-engine/null3d/commit/ce0d5144b20378a112870bf07956dfe49f48e99c))
- Let small files grow by under 64 bytes with no size trailer ([#332](https://github.com/null3d-engine/null3d/pull/332), [be3897a7c](https://github.com/null3d-engine/null3d/commit/be3897a7cc155675b39473d487998afbf8f459b2))
- Wait for cloud pages' frames, and make WebGL2 whole numbers highp ([#320](https://github.com/null3d-engine/null3d/pull/320), [03a1ad198](https://github.com/null3d-engine/null3d/commit/03a1ad1987f1cb85cfd82d486fc0cb95d4d25132))
- End cloud sessions that stop answering, and count a timed-out answer as none ([#299](https://github.com/null3d-engine/null3d/pull/299), [9543fdb7c](https://github.com/null3d-engine/null3d/commit/9543fdb7c58465dec9980f7e82ba1cb2eaf99c1d))
- Pass Edge's certificate warning on Android cloud devices ([#297](https://github.com/null3d-engine/null3d/pull/297), [72b78a225](https://github.com/null3d-engine/null3d/commit/72b78a225231aa6e2f18c5554b8e604f8222be70))
- Compress the dev server's answers to cloud devices, so their pages finish in time ([#294](https://github.com/null3d-engine/null3d/pull/294), [8a77d6de7](https://github.com/null3d-engine/null3d/commit/8a77d6de7e0c8fbd3f50d91ae1954c4b3947f118))
- Set aside the browser's code installs in the allocation check ([#271](https://github.com/null3d-engine/null3d/pull/271), [5309dba54](https://github.com/null3d-engine/null3d/commit/5309dba54dc9a510e6cc1c746da7428b668c9579))
- Draw the shader library one module at a time, and name the GPU's error ([#235](https://github.com/null3d-engine/null3d/pull/235), [d69b2cd46](https://github.com/null3d-engine/null3d/commit/d69b2cd4622d6e9bc5565b1338f7fb4a4231bc41))
- Sample allocations twice, and judge each place by the sample where it allocated less ([#168](https://github.com/null3d-engine/null3d/pull/168), [3fba4182c](https://github.com/null3d-engine/null3d/commit/3fba4182ca6491ce8f77bf805e0d1fd641ec6b96))
- Budget the sketch thread's frame wait in the runner's file, where its loop now lives ([#160](https://github.com/null3d-engine/null3d/pull/160), [4bd85c305](https://github.com/null3d-engine/null3d/commit/4bd85c305372ca1d19da83701580d0b8d4c6fde8))
- Leave the shader library's internal modules off its page without failing the docs check ([#113](https://github.com/null3d-engine/null3d/pull/113), [a65fa5f03](https://github.com/null3d-engine/null3d/commit/a65fa5f03e5c99f05bbba2213f8421c3df2c841f))
- Stop the servers a tool started when the tool is stopped ([#62](https://github.com/null3d-engine/null3d/pull/62), [bc6c5682d](https://github.com/null3d-engine/null3d/commit/bc6c5682dee6bbcac3a70265d3573dd07648af35))
- Give the allocation and profile tools each checkout's own debugging port ([#57](https://github.com/null3d-engine/null3d/pull/57), [6cfac7c83](https://github.com/null3d-engine/null3d/commit/6cfac7c83d9cb3a6d0fd9674c99dda225875459b))
- Accept a scene-code run whose code is faster than the timer ([#38](https://github.com/null3d-engine/null3d/pull/38), [a98dca7da](https://github.com/null3d-engine/null3d/commit/a98dca7da5afa02e7eb00dbeb19ffd95e8744a64))
- Profile the phone's own page, and warm up the allocation sampler by frames ([#25](https://github.com/null3d-engine/null3d/pull/25), [3d3d7c7f2](https://github.com/null3d-engine/null3d/commit/3d3d7c7f2bcd3f209be972304dcc85a549c1b3e8))

#### Across the project

- Keep wheel scroll after a drag, and steady pointer and controls tests on slow runners ([#301](https://github.com/null3d-engine/null3d/pull/301), [354b2992b](https://github.com/null3d-engine/null3d/commit/354b2992bc391baf74d86a5ecae85813cae0ad21))

### Performance

#### @null3d/engine

- Make Low's bloom base 64 texels ([#510](https://github.com/null3d-engine/null3d/pull/510), [62bd443d0](https://github.com/null3d-engine/null3d/commit/62bd443d022d9ef98f99e7c350784fe3e06cd138))
- Keep the frame's upload list from overflowing, and end shadow tile checks early ([#487](https://github.com/null3d-engine/null3d/pull/487), [540d38cff](https://github.com/null3d-engine/null3d/commit/540d38cfff77faa29569d2ba8496a442e2c126d3))
- Stop updating objects under a hidden object until it shows again ([#483](https://github.com/null3d-engine/null3d/pull/483), [383fa1237](https://github.com/null3d-engine/null3d/commit/383fa1237ca8f9c5d2106ac87b628db43d92c493))
- Start the job workers as the work grows, and run no core in the render worker ([#471](https://github.com/null3d-engine/null3d/pull/471), [810965f5d](https://github.com/null3d-engine/null3d/commit/810965f5d855c85df03b14378fe7c8be3e903c43))
- Split the sky light refresh into smaller steps for phones ([#460](https://github.com/null3d-engine/null3d/pull/460), [3b6cd82ba](https://github.com/null3d-engine/null3d/commit/3b6cd82ba2de8a14f061a48eac66c128f052ace1))
- Download only the renderers of the GPU path a page draws with ([#457](https://github.com/null3d-engine/null3d/pull/457), [dc0bce314](https://github.com/null3d-engine/null3d/commit/dc0bce31452c024103212e1d394fa36bd75e6db5))
- Start the core's download before the page's own scripts run ([#321](https://github.com/null3d-engine/null3d/pull/321), [89a1d6295](https://github.com/null3d-engine/null3d/commit/89a1d6295f5d354175f958f05ef29ab30016fc0a))
- Skip the preset check on repeat visits with its stored result ([#234](https://github.com/null3d-engine/null3d/pull/234), [fd878de90](https://github.com/null3d-engine/null3d/commit/fd878de90daf5dacf849d491bbabf7e0ced50b3b))
- Stop Safari's WebGL2 path from waiting for the GPU at uniform and texture writes ([#212](https://github.com/null3d-engine/null3d/pull/212), [f8521a29f](https://github.com/null3d-engine/null3d/commit/f8521a29f15edbb0d016cfdb79719bcc2260b95d))
- Start the workers, the core's loader and the renderer while the core downloads ([#100](https://github.com/null3d-engine/null3d/pull/100), [3dca26496](https://github.com/null3d-engine/null3d/commit/3dca26496e2ba21f873a69e6e1c62c445c605f83))
- Write the control block's slots and the metrics' names as plain numbers ([#95](https://github.com/null3d-engine/null3d/pull/95), [e6cdea583](https://github.com/null3d-engine/null3d/commit/e6cdea583c518332bb3b19af83f04e06865b26be))
- Check the core's functions in development builds only ([#91](https://github.com/null3d-engine/null3d/pull/91), [38d5c1c0a](https://github.com/null3d-engine/null3d/commit/38d5c1c0a4c0b7a70f07254023a0909e54e9fa3e))
- Download the sketch module with the core in single-threaded mode ([#72](https://github.com/null3d-engine/null3d/pull/72), [5e0c7ddd1](https://github.com/null3d-engine/null3d/commit/5e0c7ddd132a19c159a966091a864669e6b66d30))
- Time each WebGPU pass, replay draw bundles, and hold worker frames to the display rate ([#49](https://github.com/null3d-engine/null3d/pull/49), [5b8e221eb](https://github.com/null3d-engine/null3d/commit/5b8e221eb1feda48f46d70b3d98191a2f163d0ce))
- Ship the error text once, and load the sketch runner only in single-threaded mode ([#39](https://github.com/null3d-engine/null3d/pull/39), [e54f4436e](https://github.com/null3d-engine/null3d/commit/e54f4436e9ca14e8626053c3ae3726acaa184be4))
- Start faster, report progress and the first frame, and let a start be cancelled ([#10](https://github.com/null3d-engine/null3d/pull/10), [6dcf50233](https://github.com/null3d-engine/null3d/commit/6dcf502336e3fd6e3b056bcde23aa6c26d8e2384))
- Show, hide and pool objects without rebuilding the draw tables ([#9](https://github.com/null3d-engine/null3d/pull/9), [53f42fe12](https://github.com/null3d-engine/null3d/commit/53f42fe12689c975cf0152c53db545c358c48119))

#### Repository and tooling

- Split the GPU check into a prepare step and a measure step ([#514](https://github.com/null3d-engine/null3d/pull/514), [14343933a](https://github.com/null3d-engine/null3d/commit/14343933add11750dd3360093da9b4bacf2ee194))

#### Across the project

- Start the engine, the demos and apps faster ([#567](https://github.com/null3d-engine/null3d/pull/567), [e06b8b5ce](https://github.com/null3d-engine/null3d/commit/e06b8b5ce8259a3a3994d9c140d7ae51ed1da742))

### Refactors

#### @null3d/engine

- Dither the output with the shader library's to_unit ([#174](https://github.com/null3d-engine/null3d/pull/174), [7d47c444d](https://github.com/null3d-engine/null3d/commit/7d47c444d719ddc797a9d7ee2e266b0c8f0559c1))
- Give the WebGL2 per-frame bind group room for ten bindings ([#139](https://github.com/null3d-engine/null3d/pull/139), [ae1aa489e](https://github.com/null3d-engine/null3d/commit/ae1aa489e3116a01c660abfa4b39611d730776ec))
- Give each material a row of 32 values, kept in a data texture on WebGL2 ([#112](https://github.com/null3d-engine/null3d/pull/112), [2b0e3d8ac](https://github.com/null3d-engine/null3d/commit/2b0e3d8acf01d5624494cec55e0595b72fd10f90))

#### Across the project

- Unpublish the vegetation add-on, revert to blender models ([#558](https://github.com/null3d-engine/null3d/pull/558), [64046897e](https://github.com/null3d-engine/null3d/commit/64046897edc4d4314d8ce8707769d4c8e64b9f4f))

### Documentation

#### @null3d/engine

- Say that E1405 also reports an error that the sketch's setup threw ([#141](https://github.com/null3d-engine/null3d/pull/141), [c673ca310](https://github.com/null3d-engine/null3d/commit/c673ca31058a0d3137841b54985ed4db953ebdfa))

#### Docs and skills

- Mark unbuilt calls and fix the skills' wrong facts ([#497](https://github.com/null3d-engine/null3d/pull/497), [5d7f4dd45](https://github.com/null3d-engine/null3d/commit/5d7f4dd45ba2bfc35718544211d590752c006f65))
- Check both skills against 0.1 and pin their evaluations to it ([#219](https://github.com/null3d-engine/null3d/pull/219), [043ab0909](https://github.com/null3d-engine/null3d/commit/043ab0909dbbde4e40ac7e0c4840903f626514f5))
- Tell the develop skill that sketchThread: 'main' lets the sketch reach the DOM ([#156](https://github.com/null3d-engine/null3d/pull/156), [c253e507a](https://github.com/null3d-engine/null3d/commit/c253e507a4d9556cfc498f6ee5afff04a13b61ea))
- Show the standard material's built options, the presets and the custom material form ([#145](https://github.com/null3d-engine/null3d/pull/145), [9f19cf5b9](https://github.com/null3d-engine/null3d/commit/9f19cf5b91f2bcd60ffc0990ea2b6c8827b4d5c3))
- Check the develop skill's API reference against the engine, and mark unbuilt parts ([#127](https://github.com/null3d-engine/null3d/pull/127), [b432e759e](https://github.com/null3d-engine/null3d/commit/b432e759e645b9521b607497445e11bc4a982c76))
- Mark the versions in the port skill's main file, loop and React references ([#140](https://github.com/null3d-engine/null3d/pull/140), [a4ce5b0f9](https://github.com/null3d-engine/null3d/commit/a4ce5b0f99e6cf0cd7726d5e48ed5391bd172b05))
- List the sketch context's assets, textures and debug fields, which are built ([#135](https://github.com/null3d-engine/null3d/pull/135), [cf3bd1845](https://github.com/null3d-engine/null3d/commit/cf3bd1845514f7a4123d35cf974d66c1b601a3b3))
- Check the develop skill's performance, shader and testing references ([#132](https://github.com/null3d-engine/null3d/pull/132), [eb05d7237](https://github.com/null3d-engine/null3d/commit/eb05d723762e427666dd27c8003d68975a810977))
- Add texture memory, touch input and device debugging to the phones guide ([#129](https://github.com/null3d-engine/null3d/pull/129), [e18d948af](https://github.com/null3d-engine/null3d/commit/e18d948af2503ee7067a4357bf8bbb72394c5f9d))
- Mark the port skill's references with the version of each null3D call ([#128](https://github.com/null3d-engine/null3d/pull/128), [48fbf74c8](https://github.com/null3d-engine/null3d/commit/48fbf74c857f1111267db2c5f27217a38f3f5fb4))
- Write the debugging guide ([#125](https://github.com/null3d-engine/null3d/pull/125), [5b7f1a31c](https://github.com/null3d-engine/null3d/commit/5b7f1a31c3273706fe0cefa28b23ae48bc9959c6))
- Write the audio and physics guides ([#121](https://github.com/null3d-engine/null3d/pull/121), [3569a0d60](https://github.com/null3d-engine/null3d/commit/3569a0d60c3f13cf7c0400f8e816cd3dd2be6a87))

#### Repository and tooling

- Build the core sky's volumetric cloud tier ([9369b1380](https://github.com/null3d-engine/null3d/commit/9369b13809f084a8bd9f0ab6b9cb8416117a000e))
- Build the temporal resolve first and the API features early ([175980bee](https://github.com/null3d-engine/null3d/commit/175980beeeab6bcb2180d3440ecbcd8d86298ede))
- Record the cloud iPad 10 smoke run and two iPhone bloom runs of 12 October ([#535](https://github.com/null3d-engine/null3d/pull/535), [d20db9e2a](https://github.com/null3d-engine/null3d/commit/d20db9e2aaaeb51d950d2ef368f15434be9f0297))
- Record the Pixel 9 and Galaxy Tab A9+ cloud reruns of 12 October ([#529](https://github.com/null3d-engine/null3d/pull/529), [d3933c294](https://github.com/null3d-engine/null3d/commit/d3933c29467c75bc7535c9ae94e97ec82eccad9b))
- Record the cloud iPhone 17 and Galaxy S25 runs of 12 October ([#527](https://github.com/null3d-engine/null3d/pull/527), [b174558b5](https://github.com/null3d-engine/null3d/commit/b174558b5ce4f64f31d428e88aa9af603ea655e2))
- Time frame rates in a visible window, never headless ([#526](https://github.com/null3d-engine/null3d/pull/526), [f27f5bfc7](https://github.com/null3d-engine/null3d/commit/f27f5bfc77e8d64ed2eec57b7e0fc4bda75da7d3))
- Never keep a view of the shared memory across a growth ([#525](https://github.com/null3d-engine/null3d/pull/525), [463e00ba6](https://github.com/null3d-engine/null3d/commit/463e00ba6aeefad7910dbb6e5523439f67d62144))
- Record the owner's iPad passing the restart pages in removed frames ([#524](https://github.com/null3d-engine/null3d/pull/524), [0ad9d7449](https://github.com/null3d-engine/null3d/commit/0ad9d74493f892a3c729603fb98f360d5e3a2e1e))
- Record the tier A smoke run on BrowserStack Automate ([#521](https://github.com/null3d-engine/null3d/pull/521), [8ca99a92b](https://github.com/null3d-engine/null3d/commit/8ca99a92b4fd0b8e307bfccb573f43ddb8d5925f))
- Record eleven more techniques and the rulings of 11 October ([#503](https://github.com/null3d-engine/null3d/pull/503), [60daaefc7](https://github.com/null3d-engine/null3d/commit/60daaefc70e81420197acdadface7a7dc4a2f7ed))
- Record the owner's iPad runs of bloom, AO, skinning and environments ([#502](https://github.com/null3d-engine/null3d/pull/502), [89997a9a6](https://github.com/null3d-engine/null3d/commit/89997a9a6d020070b00ccb5d37f5e999cf18e981))
- Record the owner's ruling on temporal anti-aliasing in the record ([#500](https://github.com/null3d-engine/null3d/pull/500), [51d03334f](https://github.com/null3d-engine/null3d/commit/51d03334f0e15f6dd875dd7a69e3d198fb4bea32))
- Record the temporal anti-aliasing prototype's figures ([#494](https://github.com/null3d-engine/null3d/pull/494), [17004225c](https://github.com/null3d-engine/null3d/commit/17004225c5df59e83507f501e9e9a3c465ce6248))
- Bring the records up to date with rulings and device figures ([#488](https://github.com/null3d-engine/null3d/pull/488), [fdef1db38](https://github.com/null3d-engine/null3d/commit/fdef1db38b96aee0da7e86ab911b0204c921c9ea))
- Record the owner's look bar and the showcase features of 11 October ([#485](https://github.com/null3d-engine/null3d/pull/485), [0789bdba8](https://github.com/null3d-engine/null3d/commit/0789bdba8c677fb854bb4f5d46f66d0c07d5d369))
- Give the allocation job's measured time, about 4 minutes ([#468](https://github.com/null3d-engine/null3d/pull/468), [75c422384](https://github.com/null3d-engine/null3d/commit/75c422384e4cf27f685d4521323dd2f67de777b1))
- Check helper agents every 10 minutes, and record how quiet windows pass on ([#463](https://github.com/null3d-engine/null3d/pull/463), [2f541755b](https://github.com/null3d-engine/null3d/commit/2f541755b53935700affe1221d3cfe57e8741bf2))
- Say the moving shadow tests' time follows CI's machine, not #457 ([#462](https://github.com/null3d-engine/null3d/pull/462), [79f6d4acb](https://github.com/null3d-engine/null3d/commit/79f6d4acbbae9014cc82cf29bb42b446545aa1f9))
- Record cloud phone runs of sky lighting, reflections and depth of field ([#455](https://github.com/null3d-engine/null3d/pull/455), [b42ff7999](https://github.com/null3d-engine/null3d/commit/b42ff799913c19cc8164f07e58acf855976ca381))
- Move the showcase scenes' engine features before 1.0, as the record ([#447](https://github.com/null3d-engine/null3d/pull/447), [2a706b793](https://github.com/null3d-engine/null3d/commit/2a706b79343765b3c3215113de451368a602bd31))
- Record the owner's rulings of 8 October ([#433](https://github.com/null3d-engine/null3d/pull/433), [02df80918](https://github.com/null3d-engine/null3d/commit/02df80918a31089ff22fb47d40c86ae69e392184))
- Replace the phone estimates with the S25 and Pixel 9 runs ([#430](https://github.com/null3d-engine/null3d/pull/430), [bb518e014](https://github.com/null3d-engine/null3d/commit/bb518e014356e96a4361c6b3ff7a6edab331f213))
- Give the record the Pixel 9's and the Pixel 11's skinning figures ([#429](https://github.com/null3d-engine/null3d/pull/429), [6157cae59](https://github.com/null3d-engine/null3d/commit/6157cae59231cde4edfbdfd72cb27ba1162b9937))
- Record prototype G1 on the Mac, which keeps GPU occlusion culling off on desktops ([#416](https://github.com/null3d-engine/null3d/pull/416), [e5dc8fb8a](https://github.com/null3d-engine/null3d/commit/e5dc8fb8a35c071e57c1efe50186ebfb2e2a310f))
- Record the whole Safari plan on the owner's Mac with new runner pages ([#405](https://github.com/null3d-engine/null3d/pull/405), [ef2e6b028](https://github.com/null3d-engine/null3d/commit/ef2e6b0285c88264eb2296852731ab55bf0fd50c))
- Correct what the records say about Safari's removed-frame memory ([#390](https://github.com/null3d-engine/null3d/pull/390), [62a125187](https://github.com/null3d-engine/null3d/commit/62a1251878703e63517959fc9c619878998a2fd4))
- Record the device runs and findings of 7 October 2026 ([#388](https://github.com/null3d-engine/null3d/pull/388), [3e13df3c8](https://github.com/null3d-engine/null3d/commit/3e13df3c83de66a811dd9ddda349ce14cc27b331))
- Record the gate's results, reruns, final pass and the owner's rulings ([#348](https://github.com/null3d-engine/null3d/pull/348), [b911fc7f0](https://github.com/null3d-engine/null3d/commit/b911fc7f0b2f2824b1d72d243e10c1b79ca21376))
- Record the owner's iPad check of the shadow trail fix ([#370](https://github.com/null3d-engine/null3d/pull/370), [1facd5592](https://github.com/null3d-engine/null3d/commit/1facd559290358a4287632a8d8867add707312fc))
- Record the cloud and phone runs of 4 and 5 October 2026 ([#327](https://github.com/null3d-engine/null3d/pull/327), [69f0f7570](https://github.com/null3d-engine/null3d/commit/69f0f7570f87b46efaeffd2da6e1b61b3705a76a))
- Record the owner's browser, gate and rulings of 5 October 2026 ([#326](https://github.com/null3d-engine/null3d/pull/326), [94cd0095a](https://github.com/null3d-engine/null3d/commit/94cd0095a80961a8f3f17814442202e18c3cb5b9))
- Add a benchmark results page, and keep each benchmark run's figures in bench/results ([#290](https://github.com/null3d-engine/null3d/pull/290), [7f272ddd2](https://github.com/null3d-engine/null3d/commit/7f272ddd2f2b6c5d404e674ecd2bf4d33c141feb))
- Record the owner's technique, add-on and device rulings of 4 October 2026 ([#286](https://github.com/null3d-engine/null3d/pull/286), [f20b833cb](https://github.com/null3d-engine/null3d/commit/f20b833cb4fabb0c04e887a91cb53342680bcddb))
- Record intent parity with three.js and the three-compat add-on ([#284](https://github.com/null3d-engine/null3d/pull/284), [f06d9f5f8](https://github.com/null3d-engine/null3d/commit/f06d9f5f856649352760ce8a8f936366e8baf7e8))
- Record the iPad timings of the animation step ([#246](https://github.com/null3d-engine/null3d/pull/246), [64b3055a7](https://github.com/null3d-engine/null3d/commit/64b3055a7726e19c245d5897b63ee0408a80236b))
- Bring the records up to date, with how three.js handles each ([#231](https://github.com/null3d-engine/null3d/pull/231), [5bdea5dcf](https://github.com/null3d-engine/null3d/commit/5bdea5dcf2b4ccbd1ffa5330e7aac67fa1acec1f))
- Test devices on BrowserStack Live, and name Windows PCs and Chromium forks in records ([#237](https://github.com/null3d-engine/null3d/pull/237), [f9dbbe591](https://github.com/null3d-engine/null3d/commit/f9dbbe591f2ab55730d71756a6eba0e306be5bcc))
- Decide the WebGPU part: half precision gives no gain on the iPad ([#226](https://github.com/null3d-engine/null3d/pull/226), [51aa9ad0b](https://github.com/null3d-engine/null3d/commit/51aa9ad0bf68d23f7f9966ab735509eb63fefb8d))
- Record the reasons and figures behind recent engine and CI choices ([#216](https://github.com/null3d-engine/null3d/pull/216), [8a4c1ff28](https://github.com/null3d-engine/null3d/commit/8a4c1ff2876984ef7d780df6ea9746de96269f9b))
- Add a guide to pull requests and parallel work ([#176](https://github.com/null3d-engine/null3d/pull/176), [b41716cf6](https://github.com/null3d-engine/null3d/commit/b41716cf675603b38890494451ccd3e8f6d96c36))

#### Across the project

- Bring the docs, the skills and the guides in line with the code ([#572](https://github.com/null3d-engine/null3d/pull/572), [032e60034](https://github.com/null3d-engine/null3d/commit/032e600348f4ebacca3ac0942e7ca9de8ed1dd71))
- Lead with speed and device reach, write the missing pages, and close the small gaps ([#568](https://github.com/null3d-engine/null3d/pull/568), [685e8f86e](https://github.com/null3d-engine/null3d/commit/685e8f86e4d5f42ec959ecfd483ced7a67064006))
- Show how an Electron app runs the threaded build ([#556](https://github.com/null3d-engine/null3d/pull/556), [4c42d53fc](https://github.com/null3d-engine/null3d/commit/4c42d53fcc567fead2b66a7627f5097f265b6389))
- Fix the API pages that no longer matched the engine ([#498](https://github.com/null3d-engine/null3d/pull/498), [a3db1191d](https://github.com/null3d-engine/null3d/commit/a3db1191d34f2d0e4ddf883c1581262dad9c3c29))
- Open each page's note with its roadmap step and its first release ([#489](https://github.com/null3d-engine/null3d/pull/489), [7cafb639c](https://github.com/null3d-engine/null3d/commit/7cafb639cf1f6f4e0f49ee26feda5e07bb6af722))
- Mark the three.js mapping's unbuilt targets and fix its wrong workarounds ([#491](https://github.com/null3d-engine/null3d/pull/491), [9f86774f4](https://github.com/null3d-engine/null3d/commit/9f86774f40ef8f566a3dfda9efb9ec3b5670acb0))
- Add the cookbook's tested recipes, and bring the concept pages and guides up to date ([#440](https://github.com/null3d-engine/null3d/pull/440), [6de1e3adb](https://github.com/null3d-engine/null3d/commit/6de1e3adb2eae177fe9c5d8153e501426c2bb28d))
- Make 1.0 the first release, with no release before it ([#258](https://github.com/null3d-engine/null3d/pull/258), [f98f7131a](https://github.com/null3d-engine/null3d/commit/f98f7131a16ac390b90e02c68c275f5cc45b3a14))
- Ship the install page, and match the three.js mapping and page notes to the code ([#228](https://github.com/null3d-engine/null3d/pull/228), [4365f6cfa](https://github.com/null3d-engine/null3d/commit/4365f6cfacb1944191e122100bfc0ecf606a4515))
- Describe the frame's passes, shadows, lights and the prepass as 0.1 builds them ([#218](https://github.com/null3d-engine/null3d/pull/218), [544a20dc8](https://github.com/null3d-engine/null3d/commit/544a20dc8fd6dcf44a1598aa692f9e90c6a4b047))
- Raise the engine's JavaScript budget to 100 KB, as the owner decided ([#177](https://github.com/null3d-engine/null3d/pull/177), [9cc39e8c2](https://github.com/null3d-engine/null3d/commit/9cc39e8c23c18c24cf06c1502c53e21a02dbfc3e))
- Raise the engine's JavaScript budget to 80 KB, as the owner decided ([#169](https://github.com/null3d-engine/null3d/pull/169), [eab9b231f](https://github.com/null3d-engine/null3d/commit/eab9b231f7009642739ce1d526121186657443ad))
- Add grid cells, presets, lights and textures to the concept pages and performance guide ([#148](https://github.com/null3d-engine/null3d/pull/148), [2eef0521c](https://github.com/null3d-engine/null3d/commit/2eef0521c339a293ec7c82ceb7a5ac03bd0bdf60))
- List every call that rebuilds the draw tables, and every error that stops the start ([#124](https://github.com/null3d-engine/null3d/pull/124), [47f5ae2bb](https://github.com/null3d-engine/null3d/commit/47f5ae2bbceff6c9ac6a22d2f7487408bbe0b6cd))
- Record the owner's decisions on frames in flight and the JavaScript budget ([#122](https://github.com/null3d-engine/null3d/pull/122), [aea234e6a](https://github.com/null3d-engine/null3d/commit/aea234e6aa85d32d7b92a22d39edf58eaca405e0))
- Describe where the sketch runs, color and anti-aliasing on each tier, and phone figures ([#118](https://github.com/null3d-engine/null3d/pull/118), [5d72db29e](https://github.com/null3d-engine/null3d/commit/5d72db29e17696ce572c6c3f2a63dc96e46b9740))
- Record what the development checks cost the benchmarks, measured on production builds ([#109](https://github.com/null3d-engine/null3d/pull/109), [049fbc5e9](https://github.com/null3d-engine/null3d/commit/049fbc5e9ddd4b951b35a145067b3439d30694fe))
- Propose how the engine's JavaScript stays within its 60 KB budget ([#104](https://github.com/null3d-engine/null3d/pull/104), [c26e36c33](https://github.com/null3d-engine/null3d/commit/c26e36c3379443b9671f729ba7f5cb9cea9d038e))
- Record the owner's decisions on WebGL2 depth and time to first frame ([#88](https://github.com/null3d-engine/null3d/pull/88), [c31df0090](https://github.com/null3d-engine/null3d/commit/c31df00908a4334ec08b427b618e1d77c59f7537))
- Say that WebGL2 devices can draw fewer than 2,097,152 objects and instance rows ([#73](https://github.com/null3d-engine/null3d/pull/73), [113ac47a0](https://github.com/null3d-engine/null3d/commit/113ac47a09c4c20bb459ff00fda82d2ecc029217))
- Add the iPad Brave row to the depth record ([#66](https://github.com/null3d-engine/null3d/pull/66), [9871cba53](https://github.com/null3d-engine/null3d/commit/9871cba533d0151c4d28ea9f297cb19707fec7ce))
- Give each list of the parallel draw-list recorder room for a whole recording ([#65](https://github.com/null3d-engine/null3d/pull/65), [e1db8610d](https://github.com/null3d-engine/null3d/commit/e1db8610d2b0c060f87f7fdc471651e11f540857))
- Mark the pages of merged features as shipping in 0.1 ([#60](https://github.com/null3d-engine/null3d/pull/60), [3ee844834](https://github.com/null3d-engine/null3d/commit/3ee844834933a6e0ec41e1f2e5c2303c6838bf31))
- Record the phone and tablet results for depth and the phone target ([#61](https://github.com/null3d-engine/null3d/pull/61), [2ac17b60a](https://github.com/null3d-engine/null3d/commit/2ac17b60a0ebc5ff19fb3a0940a8104ff7988954))
- Track the decision records in the maintainer guides ([#59](https://github.com/null3d-engine/null3d/pull/59), [4ca2f5582](https://github.com/null3d-engine/null3d/commit/4ca2f558239d9aec765d348c12c555b539f9410b))
- Move the long contributor notes out of AGENTS.md into guides ([#37](https://github.com/null3d-engine/null3d/pull/37), [b40924830](https://github.com/null3d-engine/null3d/commit/b409248309c954f00a3c678f76562bf9deaa4b7a))
- Write the engine's name as null3D ([#22](https://github.com/null3d-engine/null3d/pull/22), [9b792d0b7](https://github.com/null3d-engine/null3d/commit/9b792d0b7697a90bae77f7c1ea486e91dee96f0b))
- Show every command with Bun, and run the command line tool as bunx @null3d/cli ([#19](https://github.com/null3d-engine/null3d/pull/19), [99af952b4](https://github.com/null3d-engine/null3d/commit/99af952b4aba5f765eda4c5625310c14f4b532ab))
- Guidance for 3D scenes on content pages, and a checklist before release ([#17](https://github.com/null3d-engine/null3d/pull/17), [d1f815543](https://github.com/null3d-engine/null3d/commit/d1f81554343cbc4574669ff87254a4537a6926c3))

### Tests

#### @null3d/engine

- Build every shader once per test run, not once per test ([#486](https://github.com/null3d-engine/null3d/pull/486), [f854dd72d](https://github.com/null3d-engine/null3d/commit/f854dd72d6672d1a14471bd66ec529cfc1f81ad8))
- Keep the object growth test at full render scale ([#482](https://github.com/null3d-engine/null3d/pull/482), [7bb369111](https://github.com/null3d-engine/null3d/commit/7bb369111b204cfc788cd39a9d0584a812923978))
- Take the room light test's dark sample before the page asks for the room ([#469](https://github.com/null3d-engine/null3d/pull/469), [bd99e8a27](https://github.com/null3d-engine/null3d/commit/bd99e8a27f6c41836f9f664713c9f9ea8fdcc06e))
- Wait for the overlay to show a GPU time before the stats test reads it ([#451](https://github.com/null3d-engine/null3d/pull/451), [cb471d355](https://github.com/null3d-engine/null3d/commit/cb471d355734ef09efd4554857cd3f358090f28f))
- Count a marked thread only while the test that marked it holds the counter ([#172](https://github.com/null3d-engine/null3d/pull/172), [a59a6cbd5](https://github.com/null3d-engine/null3d/commit/a59a6cbd5859144f4aa39be7fbc10c15cf19f869))
- Check the job system's order of events, so a busy machine cannot fail its tests ([#89](https://github.com/null3d-engine/null3d/pull/89), [b2e5db46e](https://github.com/null3d-engine/null3d/commit/b2e5db46e6ddcb335b55fa64ba361fafe2a9c0c0))

#### Examples

- Add a demo of parents that keep an object's place in the world ([#117](https://github.com/null3d-engine/null3d/pull/117), [b108db6bb](https://github.com/null3d-engine/null3d/commit/b108db6bbc794237d87ce970a71d4facc8d303a3))
- Add demos of the geometry generators and render layers ([#108](https://github.com/null3d-engine/null3d/pull/108), [3f1bbb2ee](https://github.com/null3d-engine/null3d/commit/3f1bbb2ee29d9d786785532b80503235a06b6a67))
- Add feature demos that run live and as hold-mode image tests ([#85](https://github.com/null3d-engine/null3d/pull/85), [7d78f3638](https://github.com/null3d-engine/null3d/commit/7d78f3638f716263310b8860d2aa2a555836ded3))

#### Docs and skills

- Type check and hold every sketch the skills show, and make the recipes run ([#130](https://github.com/null3d-engine/null3d/pull/130), [70f4c07a6](https://github.com/null3d-engine/null3d/commit/70f4c07a676fcc311907afc29a30934197c494df))
- Pin both skills' evaluations to engine 0.1 ([#136](https://github.com/null3d-engine/null3d/pull/136), [cb598220b](https://github.com/null3d-engine/null3d/commit/cb598220be490dca30c353cddc9799ea800a3de2))

#### Repository and tooling

- Fix the cloud runner's status reads and CI's test splits ([#523](https://github.com/null3d-engine/null3d/pull/523), [be8606696](https://github.com/null3d-engine/null3d/commit/be86066962b426cdfb27f2ddd8841604187bac7d))
- Pack compiled shaders per module and split the shaders page for Safari ([#507](https://github.com/null3d-engine/null3d/pull/507), [b26e91ef6](https://github.com/null3d-engine/null3d/commit/b26e91ef6912e5de5de0e88d1c7c7575461a0efd))
- Give each phone scene's page tests a browser of their own ([#436](https://github.com/null3d-engine/null3d/pull/436), [16668a023](https://github.com/null3d-engine/null3d/commit/16668a023349c372cbb40e9975026b199b10e876))
- Run S6's three.js WebGL page on real GPUs only ([#435](https://github.com/null3d-engine/null3d/pull/435), [3f9dae7fe](https://github.com/null3d-engine/null3d/commit/3f9dae7fec2b0516a5eb07eaf2af0581efb982e4))
- Add the object-growth plan, which times object table growths on devices ([#428](https://github.com/null3d-engine/null3d/pull/428), [bfa89e005](https://github.com/null3d-engine/null3d/commit/bfa89e0054d2365f4e97c028650e2ab36e2931fc))
- Record that Safari's fast-slot hold came from the test page ([#403](https://github.com/null3d-engine/null3d/pull/403), [99deea7d3](https://github.com/null3d-engine/null3d/commit/99deea7d3de0f36be541917ac5691a4c766d29d7))
- Budget the canvas texture's view in the WebGPU allocation check ([#402](https://github.com/null3d-engine/null3d/pull/402), [9ef42748d](https://github.com/null3d-engine/null3d/commit/9ef42748d7adba48c02cbdab039f09355fc01371))
- Record the Safari test guards and the clean memory repros ([#396](https://github.com/null3d-engine/null3d/pull/396), [3931ea5cd](https://github.com/null3d-engine/null3d/commit/3931ea5cdc636eb5ea173a1cc6b5f71744de9a99))
- Wait on progress in the shader compile test, and for pass times after GPU loss ([#394](https://github.com/null3d-engine/null3d/pull/394), [07effe740](https://github.com/null3d-engine/null3d/commit/07effe7404e4fb2be6469bd6455065ab4bfa355f))
- Keep Safari's held memory from failing runs: new runner pages, reruns and a note ([#392](https://github.com/null3d-engine/null3d/pull/392), [0d87424d2](https://github.com/null3d-engine/null3d/commit/0d87424d2496368ce4a3a0bcd00d793defdf64c2))
- Retry SwiftShader short runs that count no frame, and wait for frames after GPU loss ([#391](https://github.com/null3d-engine/null3d/pull/391), [52b705fc4](https://github.com/null3d-engine/null3d/commit/52b705fc4308fb2d8a5171db2f0b427837a087d7))
- Run frame restart pages in runner pages of their own ([#380](https://github.com/null3d-engine/null3d/pull/380), [3ca165cc3](https://github.com/null3d-engine/null3d/commit/3ca165cc337625ba79bf6f36a04249dc2965e7d2))
- Ask again when Safari refuses a room count, before accepting it ([#375](https://github.com/null3d-engine/null3d/pull/375), [e27ef7a48](https://github.com/null3d-engine/null3d/commit/e27ef7a4804d02f9bb3b000bb6ea37f82a1d4096))
- Count the room for shared memory only up to a cap, so later pages keep theirs ([#366](https://github.com/null3d-engine/null3d/pull/366), [90729ce39](https://github.com/null3d-engine/null3d/commit/90729ce3960d472512d1d898e47d1ebcc3962377))
- Lighter SwiftShader loads for S5 and the moving shadow tests, and new shard weights ([#368](https://github.com/null3d-engine/null3d/pull/368), [460f5f713](https://github.com/null3d-engine/null3d/commit/460f5f7135a30bdf178273f5ac412d33bdf7ebb7))
- Park the Chrome window of the timing tools past the screen's left edge ([#369](https://github.com/null3d-engine/null3d/pull/369), [5b2f84cd8](https://github.com/null3d-engine/null3d/commit/5b2f84cd85ea835e8df9e4e3fa09cdc44f21a3c9))
- Park Safari's and Firefox's runner window past the screen's left edge ([#367](https://github.com/null3d-engine/null3d/pull/367), [8317b7a24](https://github.com/null3d-engine/null3d/commit/8317b7a24ff7cbfe8a2da2b80088b9098c078dcc))
- Keep the memory check, CPU profiler and README animation from taking focus ([#363](https://github.com/null3d-engine/null3d/pull/363), [0eb721634](https://github.com/null3d-engine/null3d/commit/0eb7216341c674dea20ff4d342b0dc2c6bf0d47d))
- Give focus back after the timing tool's Chrome starts or opens a page ([#362](https://github.com/null3d-engine/null3d/pull/362), [41e6dffbf](https://github.com/null3d-engine/null3d/commit/41e6dffbfa7678535b574b61da2a73a4cafcd98a))
- Open Mac browser apps in the background, with a small corner window ([#361](https://github.com/null3d-engine/null3d/pull/361), [367ffac2c](https://github.com/null3d-engine/null3d/commit/367ffac2cc82a0a77184086191b1703e5b8f5681))
- Run timing and allocation checks alone, and work out the shard weights from CI times ([#358](https://github.com/null3d-engine/null3d/pull/358), [9b5376cd9](https://github.com/null3d-engine/null3d/commit/9b5376cd917dd35062165f81e7f0f454d2246241))
- Leave out the engine page's frame-rate checks on a software GPU ([#349](https://github.com/null3d-engine/null3d/pull/349), [ac786d519](https://github.com/null3d-engine/null3d/commit/ac786d519a11418ea56e1c13262e9dd7600dd786))
- Let the layers and no-waitAsync tests wait for frames on a busy runner ([#334](https://github.com/null3d-engine/null3d/pull/334), [9c523f566](https://github.com/null3d-engine/null3d/commit/9c523f5666e98b31ec83a579e5463880cd619931))
- Link a shader again after Safari's Metal fault on the shaders page ([#328](https://github.com/null3d-engine/null3d/pull/328), [9a6d65624](https://github.com/null3d-engine/null3d/commit/9a6d65624c3594588552906d5806e69df9d45ec9))
- Check the committed WGSL declarations with the shader compiler's tests ([#259](https://github.com/null3d-engine/null3d/pull/259), [f3f5571e6](https://github.com/null3d-engine/null3d/commit/f3f5571e6b19223744a056af7a39896ec476a2e4))
- Give S2's shadow runs 2 s to measure, and warm up from the first frame ([#240](https://github.com/null3d-engine/null3d/pull/240), [cc11e51de](https://github.com/null3d-engine/null3d/commit/cc11e51de21311bd51b839805aed7b3309cd5243))
- Compare the feature scenes with three.js twins in bun run parity ([#203](https://github.com/null3d-engine/null3d/pull/203), [074d2123e](https://github.com/null3d-engine/null3d/commit/074d2123ea6b91924724dfd40fc329831c153b53))
- Note each step of the texture arrays page and the engine's frame counters ([#159](https://github.com/null3d-engine/null3d/pull/159), [9cbe11c2c](https://github.com/null3d-engine/null3d/commit/9cbe11c2cce8e40624d0106cb386f789b7dafcf9))

#### Across the project

- Keep phones at 60 Hz in device runs: show timed pages, measure on a moving screen ([#324](https://github.com/null3d-engine/null3d/pull/324), [df9130987](https://github.com/null3d-engine/null3d/commit/df9130987471ff0aaaefb2a98bc5761666b2caf8))
- Drop frame-rate checks from the engine tests that do not test the frame loop's pace ([#300](https://github.com/null3d-engine/null3d/pull/300), [84bd67efc](https://github.com/null3d-engine/null3d/commit/84bd67efced829b466c284f6efb4b60fad5b85b0))
- Count raycast job workers over all frames, and drop frame-rate checks from the download test ([#293](https://github.com/null3d-engine/null3d/pull/293), [c244b48c4](https://github.com/null3d-engine/null3d/commit/c244b48c41a7af413845129344f25452914224c4))
- Run the device tiers on BrowserStack Automate with one command ([#238](https://github.com/null3d-engine/null3d/pull/238), [62148c11d](https://github.com/null3d-engine/null3d/commit/62148c11d52e82a16badefc4968fac6d9a6174b6))
- Run the restarts again when Safari loses room once, so only held memory fails ([#239](https://github.com/null3d-engine/null3d/pull/239), [add0e622a](https://github.com/null3d-engine/null3d/commit/add0e622a6f2f1b457b76af8ee424c9269e6faf0))
- Run the Mac part of the 0.1 exit gate in one command, and soak and sample S4 ([#232](https://github.com/null3d-engine/null3d/pull/232), [a12472631](https://github.com/null3d-engine/null3d/commit/a124726317a07ac24c6840e9a4c794f38e1f688b))
- Measure shadow stability and edge quality in tests and device benchmarks ([#230](https://github.com/null3d-engine/null3d/pull/230), [850e2d55d](https://github.com/null3d-engine/null3d/commit/850e2d55dd178e6faf5a8f9817338e307d1240c4))
- Skip the pages for GPU paths a device lacks, by the capabilities report ([#229](https://github.com/null3d-engine/null3d/pull/229), [cfa4fea8e](https://github.com/null3d-engine/null3d/commit/cfa4fea8ef52ade2b96b6aefd7663cf18e04d74a))
- End a browser's turn when it keeps refusing memory, and mark runs at a wrong refresh rate ([#221](https://github.com/null3d-engine/null3d/pull/221), [bfbb206de](https://github.com/null3d-engine/null3d/commit/bfbb206de85655745bad3c765c7f2047c9e6d4e7))
- Keep a record of tested devices, and print its row after each device run ([#225](https://github.com/null3d-engine/null3d/pull/225), [c006a992f](https://github.com/null3d-engine/null3d/commit/c006a992f31bd979679dd83d582723639d9aacb9))
- Add device plans for tab memory, GPU loss soaks and warm-up times, with their results ([#214](https://github.com/null3d-engine/null3d/pull/214), [3afd3e25d](https://github.com/null3d-engine/null3d/commit/3afd3e25d020ba66f055b8466ad7296dcbfb4c51))
- Measure two ways to skin characters on WebGL2, and decide to skin in every pass ([#206](https://github.com/null3d-engine/null3d/pull/206), [e746e1157](https://github.com/null3d-engine/null3d/commit/e746e11573755b77436511e4d780b7ff65246cdd))
- Show a grid of each page's result on the device runner page ([#205](https://github.com/null3d-engine/null3d/pull/205), [fdc9e3036](https://github.com/null3d-engine/null3d/commit/fdc9e30364a0da15e046624348635ff6ca907728))
- Draw the device checks at the presets that their references use ([#196](https://github.com/null3d-engine/null3d/pull/196), [195113a4e](https://github.com/null3d-engine/null3d/commit/195113a4ee5b3f4c00b9ca27eeff750d7adbbe9e))
- Send a runner page's request again when Safari loses it ([#193](https://github.com/null3d-engine/null3d/pull/193), [1dced3b8c](https://github.com/null3d-engine/null3d/commit/1dced3b8c1a5e94e1f9de5baed8dc53d4611255a))
- Refuse results from a runner page that a newer one replaced ([#192](https://github.com/null3d-engine/null3d/pull/192), [6dc07ce34](https://github.com/null3d-engine/null3d/commit/6dc07ce349c97da391cc6993ccb17c85824ab981))
- Replace a runner page that stops answering in a Mac browser, and keep evidence of the stop ([#184](https://github.com/null3d-engine/null3d/pull/184), [a4cbf31a8](https://github.com/null3d-engine/null3d/commit/a4cbf31a8ca2784c8173be5fa8a07f95880fcb7d))
- Keep the dev and preview servers up when a page leaves during its report upload ([#116](https://github.com/null3d-engine/null3d/pull/116), [15c41b887](https://github.com/null3d-engine/null3d/commit/15c41b8875b47c4eeac1f8daff28b93c7fa86fce))
- Wait for Safari to free stopped engines' memory before the restart checks judge ([#105](https://github.com/null3d-engine/null3d/pull/105), [c29371658](https://github.com/null3d-engine/null3d/commit/c293716587b65c2631287f0e01ce355e316eb3a6))
- Run every image test from one manifest in every environment, and review new images ([#46](https://github.com/null3d-engine/null3d/pull/46), [21bcf4623](https://github.com/null3d-engine/null3d/commit/21bcf4623154019d59ad8ac864e511b60f1af189))
- Compare the benchmark scenes with reference images on every GPU tier ([#24](https://github.com/null3d-engine/null3d/pull/24), [1785e5131](https://github.com/null3d-engine/null3d/commit/1785e5131ab8bb9f8a608d35a38cd3600a363342))

### Build and tooling

#### Other parts

- **repo:** Carry the evidence lines that the squash flattened ([0d3d561fe](https://github.com/null3d-engine/null3d/commit/0d3d561fe98598b95e12739d53d827264ca43052))

#### Repository and tooling

- Start the website's sync after each release ([#575](https://github.com/null3d-engine/null3d/pull/575), [86e6717ea](https://github.com/null3d-engine/null3d/commit/86e6717ea8836f6234b6f8b06115d310e6097a7d))
- Fetch each compared build's own sample content ([#484](https://github.com/null3d-engine/null3d/pull/484), [12ce11b06](https://github.com/null3d-engine/null3d/commit/12ce11b066d42fdfdab72b384e58a83bef3ed248))
- Build generated files instead of keeping them in git ([#413](https://github.com/null3d-engine/null3d/pull/413), [c4fbcb9eb](https://github.com/null3d-engine/null3d/commit/c4fbcb9eb7f1864f43ac11edbcabf5057e05c62a))
- Keep the record of tested devices as one file per run ([#395](https://github.com/null3d-engine/null3d/pull/395), [20c6394b5](https://github.com/null3d-engine/null3d/commit/20c6394b5377e54c501204b1c16dda0b872967c6))
- List decision records from the records themselves ([#372](https://github.com/null3d-engine/null3d/pull/372), [39d0211df](https://github.com/null3d-engine/null3d/commit/39d0211df0dd18ca892a7f44c3357f6a5e713856))
- Measure main once an hour on its newest commit, not on every push ([#317](https://github.com/null3d-engine/null3d/pull/317), [9c9749982](https://github.com/null3d-engine/null3d/commit/9c9749982f1fd7f51520e1c1715cdb6b3f5580af))
- Budget a page's start at 140 KB and each first-use file at 16 KB ([#268](https://github.com/null3d-engine/null3d/pull/268), [b05c9e044](https://github.com/null3d-engine/null3d/commit/b05c9e0445e6effe2b29e3492879fd58ba9cc541))
- Run main's benchmark jobs one at a time, against the last commit that passed ([#70](https://github.com/null3d-engine/null3d/pull/70), [200893d7a](https://github.com/null3d-engine/null3d/commit/200893d7afb9b5e6fb7e40c277e81d8a015aec70))

#### Across the project

- Ready the docs for the first public release and remove the vegetation add-on ([#563](https://github.com/null3d-engine/null3d/pull/563), [81ee63388](https://github.com/null3d-engine/null3d/commit/81ee633889272ab3fe54d6d36570681980ab2ded))
- Record the engine's growth and the work behind it ([2c5887719](https://github.com/null3d-engine/null3d/commit/2c5887719463f6a71234abcfdb2bb4f1dd91e317))
- Stop each job at 20 minutes, keeping 15 as the most a job should take ([#533](https://github.com/null3d-engine/null3d/pull/533), [2e62d08a6](https://github.com/null3d-engine/null3d/commit/2e62d08a647a7cfed94c61e39f9fce454d19b914))
- Run Safari and Firefox in 5 shards each, at most 15 minutes per job ([#530](https://github.com/null3d-engine/null3d/pull/530), [3f8825965](https://github.com/null3d-engine/null3d/commit/3f882596534dca1181677c912351bbfed6da0ade))
- Run the glTF parity tests in the first bench shard to balance the shards ([#508](https://github.com/null3d-engine/null3d/pull/508), [3ef1107eb](https://github.com/null3d-engine/null3d/commit/3ef1107ebc1b143dffa1033bdeae3632cd197723))
- Run only the docs checks on a pull request that changes only docs files ([#504](https://github.com/null3d-engine/null3d/pull/504), [bdcfa752a](https://github.com/null3d-engine/null3d/commit/bdcfa752ad3f25cb352e0cfd5ba320c62856332c))
- Run the per-frame allocation check on S1 with each GPU path ([#467](https://github.com/null3d-engine/null3d/pull/467), [cce62175e](https://github.com/null3d-engine/null3d/commit/cce62175e0f56336f08ade9b77b6301d881d6b9b))
- Run the browser tests in nine shards, with weights from the richer demo runs ([#459](https://github.com/null3d-engine/null3d/pull/459), [414e2dbfe](https://github.com/null3d-engine/null3d/commit/414e2dbfece287a550c3ef1902b803eca68bea09))
- Rebalance the browser shards after the latest merges ([#432](https://github.com/null3d-engine/null3d/pull/432), [061177262](https://github.com/null3d-engine/null3d/commit/06117726267e7199ca381b43a232146a41fb3687))
- Stop the leftover apt process before the second Chromium install ([#421](https://github.com/null3d-engine/null3d/pull/421), [0c9c06b8d](https://github.com/null3d-engine/null3d/commit/0c9c06b8dfe910e544b1ef978e67a6dafd2f2bd3))
- Give up on a stalled package mirror when installing Chromium ([#415](https://github.com/null3d-engine/null3d/pull/415), [9348b7731](https://github.com/null3d-engine/null3d/commit/9348b773185e6e2a8fd4c6276c03a5a0cf352970))
- Give the Rust test job 25 minutes ([#411](https://github.com/null3d-engine/null3d/pull/411), [5288a69be](https://github.com/null3d-engine/null3d/commit/5288a69be0d293d9b233f5d07ce8eabbd6a03135))
- Let a newer merge to main cancel main's older run in progress ([#409](https://github.com/null3d-engine/null3d/pull/409), [b83f603e9](https://github.com/null3d-engine/null3d/commit/b83f603e93b5113ba6cbcd7182ac7e7ea5c779fb))
- Run every job on ready pull requests and on main, with no merge queue ([#406](https://github.com/null3d-engine/null3d/pull/406), [3d41c5294](https://github.com/null3d-engine/null3d/commit/3d41c529469c792094078888bdfad3e086760e67))
- Run the browser and benchmark page shards only in the merge queue, and slim main's runs ([#355](https://github.com/null3d-engine/null3d/pull/355), [7630ddb5d](https://github.com/null3d-engine/null3d/commit/7630ddb5ddd6c177d718960c2a2c1447f44c9e59))
- Split the slow jobs, test Rust with nextest, and move Firefox to Linux ([#308](https://github.com/null3d-engine/null3d/pull/308), [fd681ea56](https://github.com/null3d-engine/null3d/commit/fd681ea569d7dbd685330c466e396b1dba7f91e3))
- Count every finished benchmark run as measured, and mark changed measurements ([#233](https://github.com/null3d-engine/null3d/pull/233), [0905eaa15](https://github.com/null3d-engine/null3d/commit/0905eaa15febc099509a7fd76d0ca7c613b9ec4b))
- Compare queue sizes with the group's base, and pin the benchmark comparison's preset ([#217](https://github.com/null3d-engine/null3d/pull/217), [af18715bb](https://github.com/null3d-engine/null3d/commit/af18715bb979b643356aa350b6ff2516459c939f))
- Fail a pull request whose image test lacks a reference ([#204](https://github.com/null3d-engine/null3d/pull/204), [57b2e876b](https://github.com/null3d-engine/null3d/commit/57b2e876b300d04404476c0ebec96e2d7d07a7bd))
- Let the build job's Rust cache keep the native shader build ([#195](https://github.com/null3d-engine/null3d/pull/195), [27de04e6a](https://github.com/null3d-engine/null3d/commit/27de04e6af6b6c5f819362e89afb4bffb598f867))
- Build the shader modules on demand instead of keeping them in git ([#194](https://github.com/null3d-engine/null3d/pull/194), [3d265d6c3](https://github.com/null3d-engine/null3d/commit/3d265d6c37fb921afb7ba6906a79c209118875da))
- Split the long CI jobs into shards of about 5 minutes, and build the WebAssembly once ([#181](https://github.com/null3d-engine/null3d/pull/181), [b1a4c6b11](https://github.com/null3d-engine/null3d/commit/b1a4c6b112adb27b82c48de5c3681c103ab331e0))
- Add a ci-passed job that passes only when every other CI job passed ([#179](https://github.com/null3d-engine/null3d/pull/179), [61a5b15a6](https://github.com/null3d-engine/null3d/commit/61a5b15a60457b92ce739941324a234ea21ec298))
- Cancel replaced CI runs, and test Safari and Firefox only in the merge queue ([#102](https://github.com/null3d-engine/null3d/pull/102), [10100e522](https://github.com/null3d-engine/null3d/commit/10100e522c1dc535696cee81d0f107054c632b17))
- Test pull requests in GitHub's merge queue ([#97](https://github.com/null3d-engine/null3d/pull/97), [13f836b0c](https://github.com/null3d-engine/null3d/commit/13f836b0cf87c1f2f6092e8a01762192cda348d9))
- Split the Safari and Firefox job into one job per browser that share one build ([#74](https://github.com/null3d-engine/null3d/pull/74), [37fba180f](https://github.com/null3d-engine/null3d/commit/37fba180fddcc2ef729befa2285762eaee35ae25))
- Compare download sizes with main's own build ([#64](https://github.com/null3d-engine/null3d/pull/64), [804663cf2](https://github.com/null3d-engine/null3d/commit/804663cf29ab7885dea5663ca518100589ad9fbc))
- Skip npm versions that are already published ([#3](https://github.com/null3d-engine/null3d/pull/3), [795117966](https://github.com/null3d-engine/null3d/commit/7951179664901ccb81700f1dc6311d7bccc4d9d9))
- Start the repository ([99e879f05](https://github.com/null3d-engine/null3d/commit/99e879f05f2a6463cfda20d1c46603c25c3edda8))

### Other

- Let the permutation recorder start a game page ([#559](https://github.com/null3d-engine/null3d/pull/559), [bb882f565](https://github.com/null3d-engine/null3d/commit/bb882f565b695d5a6812b333a23cba244bcb2432))

**Full changelog**: https://github.com/null3d-engine/null3d/commits/0.1.0
