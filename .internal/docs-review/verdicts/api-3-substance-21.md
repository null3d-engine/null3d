# Verdict on api-3-substance-21

## The finding as given

```json
{
 "page": "api/water",
 "anchor": "lines 34, 86, 160, 188, 213, 241, 274, 285, 443, 459",
 "category": "long-paragraph",
 "severity": "medium",
 "claim": "Ten long paragraphs. The waterfall prose at 274-296 reads as art direction rather than what to set; the reflection bullet at 443 mixes cadence, governor, lowest tier and stats overlay.",
 "evidence": "stats.json api/water (27, 79, 153, 181, 206, 234, 267, 278, 437, 453 in its count).",
 "proposedEdit": "Cut line 34 to a list of what the package draws. Put 285-296 in <details><summary>Technical details: how the fall is shaped and lit</summary>. Split the reflection bullet into cadence, governor and stats overlay.",
 "generatedSource": "",
 "id": "api-3-substance-21",
 "slice": "api-3",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- The page is hand-written (docs/api/water.md, not under docs/api/reference/), so no generated source applies. The finding's line numbers are the stats.json lines plus the 7 lines of front matter. They match the file.
- Ten long paragraphs: a fact from stats.json.
- The reflection bullet (443-453) does mix the preset cadence, the moving-camera override, the lowest tier, the governor, the stats overlay and resource notes. The facts are correct: packages/water/src/cadence.ts:11 caps the wait at 16 frames, cadence.ts:55 and water.ts:597 give the lowest tier's every-16th-frame draw. The order is wrong for a reader: the lowest tier comes before the governor that it overrides. The sentence "`reflectionEvery` replaces the preset's cadence" (452) repeats the options table at line 134.
- The waterfall: the art direction sits mostly in 274-283 (tongue, ropes, lobes, wisps, a quarter of the lip's width, mist four times as wide). The proposed block covers only 285-296, so the most decorative paragraph stays in the main text. 285-296 also holds the one fact a user needs from this prose: the fall costs the CPU nothing in a frame (286), which appears nowhere else on the page. The `setLight` part (293) repeats the member table at 360. The particles link (296) repeats line 40 and the `spray` row at 347, and line 296 says "depends on" where line 40 says "peer dependency".
- Line 34: "cut to a list" would lose facts that appear nowhere else on the page. A grep finds "finer than a pixel", "soft edge" and "stays glassy" (for the surface) only at line 34.
- The proposal gives no edit for six of the ten paragraphs: 86, 160, 188, 213, 241 and 459.

## Corrected claim

The page has ten long paragraphs. The waterfall's look is described in 274-283 more than in 285-296. 285-296 mixes the shape and light of the column with one fact users need (no per-frame CPU cost). The reflection bullet at 443 mixes cadence, the moving camera, the governor, the lowest tier and the stats overlay, and it repeats the options table.

## Corrected edit

- Line 34: make it a short lead sentence and a list of what the package draws (river and lake from one shape, waves and ripples, caustics, foam, a shore that fades, a reflection, the view from below). Keep the mirror-softening and soft-bank facts. Put them in the reflection list item, or in a block "Technical details: how the mirror softens".
- Waterfalls (274-296): keep in the main text the first sentence of 274, "Spray froths at the lip, and a plume of mist rises at its foot", and "The sheet's material moves each streak from the sketch's time alone, so the fall costs the CPU nothing in a frame." Move the look of 274-283 and the shape and light of 286-295 into one block, `<details><summary>Technical details: how the fall is shaped and lit</summary>`. Drop the last sentence of 296, because line 40 and the `spray` row already cover the particles package.
- Reflection bullet (443): split it into three bullets. (1) Cadence: every other frame on Low and Medium, every frame on High and Ultra, and every frame while the camera moves or turns. (2) Limits: the governor doubles the wait up to every 16th frame, and the lowest tier draws every 16th frame at rest. (3) The stats overlay: `reflectionEvery`, the GPU time and share, and memory. Drop "`reflectionEvery` replaces the preset's cadence", because the options table says it.
- Line 86: keep the first four sentences. Move 89-92 (the 3 m blend, the flat surface, the shared current, the small map) into `<details><summary>Technical details: how the meeting blends</summary>`.
- Line 160: split it after "stops the call". The trail formula can go in a short block.
- Line 188: split it after "one flat tilt of the whole surface."
- Line 241: split it into how the tint works (241-245) and the two examples (245-250).
- Line 459: drop the list of the four particle systems, or put it in a block. Keep the triangle count and the advice to lower `spray`.
- Line 213 (69 words, 5 sentences) is low priority. It can stay.
