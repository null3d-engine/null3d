# api-3-readability-25

## Finding as given

- page: api/textures
- anchor: ## KTX2 files (line 74); Texture arrays (220), From texels to GPU (232), Mip levels (240), Both GPU paths (262)
- category: scan-order
- severity: low
- claim: Right after Options the reader meets two format tables and six transcoding bullets. That section is longer than Images, Canvases, Videos and Data together. GPU-internal sections then sit between user topics.
- evidence: stats.json headings for api/textures.
- proposedEdit: Order: Options, Images, Canvases, Videos, Data, Textures of render passes, KTX2 files, Updating and destroying, Sampling, Color spaces, GPU memory, then one H2 'How textures reach the GPU' that holds From texels to GPU, Mip levels, Texture arrays, Both GPU paths and the lost-device section. In KTX2 files keep the first paragraph and the mip, color-space and row-order bullets, and put the format tables and device bullets in <details><summary>Technical details: which compressed format each device gets</summary>.

Verdict: partly

## Evidence

- Size claim is wrong. Word counts of the page (docs/api/textures.md): KTX2 files, lines 74-107, about 695 words. Images (109-120) 115, Canvases (122-153) 410, Videos (155-176) 285, Data (178-189) 162: about 972 together. KTX2 is the longest user section, but it is about 70% of those four together, not longer.
- "Two format tables" is wrong: KTX2 has one format table (lines 85-89) and six device bullets (91-96). The second table on the page is in Data (182-185).
- The current order is not random: it follows the intro list at lines 26-30 (loadTexture, fromImageBitmap, fromCanvas, fromVideo, fromData), and KTX2 is a loadTexture topic, as Options is. Moving KTX2 later is defensible but partly taste.
- The ordering point holds for the GPU-internal sections: Texture arrays (220), From texels to GPU (232) and Mip levels (240) sit between Updating and destroying and Sampling/Color spaces, which are user options. Grouping them later is a fair low-severity fix. Anchors that other pages use (#ktx2-files, #texture-arrays, #gpu-memory, #canvases, #when-the-browser-takes-the-gpu-away) keep the same slug as H3, so links do not break.
- Texture arrays is not purely internal. Line 226 (use a few common sizes) and line 228 (WebGL2 six-map limit and which maps drop) are advice a user acts on. Line 230 (maximum size 4096, textures.maxSize, E1208) is a user limit and does not belong in a GPU-internals group.
- The proposed details block takes too much. Line 95 (sides not a multiple of 4 fall back to rgba8unorm at 4-8 times the memory; fix with `bunx @null3d/cli assets optimize`) and line 96 (texture.format and texture.bytes) are user-facing and must stay in the main text. The edit is also silent on lines 103-105 (E1412 and E1208 limits) and line 107 (the transcoder download, host files, E1406); "keep the first paragraph and the mip, color-space and row-order bullets" reads as if those go too. They describe errors a user meets and must stay visible.

## Corrected claim

The KTX2 section is the longest user section on the page (about 695 words, one format table and six device bullets) and sits right after Options. Three GPU-internal sections (Texture arrays, From texels to GPU, Mip levels) sit between user topics. It is not longer than Images, Canvases, Videos and Data together.

## Corrected edit

- In KTX2 files, move the format table (lines 83-89) and the bullets at lines 91-94 into
  `<details><summary>Technical details: which compressed format each device gets</summary>` ... `</details>`.
  Keep in the main text: the first paragraph and code (76-81), one sentence such as "The engine picks the best compressed format the device supports; `texture.format` says which one it got, and `texture.bytes` its GPU memory", the multiple-of-4 bullet (95), all option and limit bullets (100-105) and the transcoder paragraph (107).
- Keep KTX2 files where it is, or move it after Data; either works.
- Move the maximum-size paragraph (230) to Options or Updating and destroying. Then group Texture arrays, From texels to GPU, Mip levels, Both GPU paths and the lost-device section under one later H2 (for example "How textures reach the GPU"), as H3s. Keep the size advice (226) and the WebGL2 map limit (228) visible in that group, not in a block.
