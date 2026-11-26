# api-2-readability-15

## Finding as given

- page: api/lights
- anchor: ## Spot light maps bullets lines 80-83; ## Area lights bullets lines 158, 162
- category: technical-details-block
- severity: medium
- claim: The bullet at line 158 is 164 words. Lines 81 and 158 repeat the same picture limits (512 texels a side, 32 lights, tens of milliseconds). Memory and download figures break up the how-to.
- evidence: line 158 (164 words); line 81 and line 158 both say 'up to 512 texels a side ... Up to 32 lights show pictures at once'; line 82 memory figures; line 162 '19 KB'.
- proposedEdit: Split line 158 into a short paragraph 'Pictures on a rectangle light' with the painting tip. Put the shared limits once in <details><summary>Technical details: picture size, memory and timing</summary> under Spot light maps (lines 80-83), and link to it from Area lights. Put line 162 in a details block too.
- generatedSource: "" (docs/api/lights.md is hand-written)

Verdict: partly

## Evidence

- docs/api/lights.md:158 is one bullet of 164 words (wc -w) with 11 sentences. It mixes the option, the tint rule, the painting tip, the texel cap, the 32-light limit and the timing. The claim holds.
- docs/api/lights.md:81 and :158 both say "keeps the picture's detail up to 512 texels a side, in every mip level", "Up to 32 lights show pictures at once" and "takes up to a few tens of milliseconds, so set it at setup or now and then". Line 81 also says rectangle and spot lights share the 32 places. The repeat is real.
- docs/api/lights.md:82 (memory per picture, room for four, about 11 MB) and :83 second sentence (no extra texture in lit shaders, shared table) are implementer detail. They fit a details block.
- The stats file does not list these bullets as long paragraphs (it counts paragraphs only), so the 164 count is the reviewer's own. I checked it and it is correct.

## Where the edit goes too far

1. Line 162 should not move whole into a block. Its last two sentences are things a user acts on: `createEngine`'s `preload` takes `'area_lights'` to avoid area lights popping in after the first frame, and a failed download reports E1431. "The scene draws as before meanwhile" is visible behavior. With the block closed, a reader would not learn why area lights appear late or how to stop it. Only the 19 KB size and the note that shaders carry no area-light code belong in the block.
2. The timing rule ("set a picture at setup or now and then, not every frame") and the 32-light limit are usage rules, not just figures. They must stay in the main text, once, so the page makes sense with every block closed. Only the 512-texel cap, the mip note, the memory figures and the shared-table note should go into the block.

## Corrected edit

- Spot light maps: keep in the main text one short bullet: "Up to 32 lights show pictures at once, and rectangle and spot lights share those places. A new picture takes up to a few tens of milliseconds, so set it at setup or now and then." Keep the blur-with-distance sentence and the "every GPU path" sentence. Move the 512-texel cap, mip levels, the "small gobo costs less memory" sentence, line 82's memory figures and line 83's shared-table sentence into one `<details><summary>Technical details: picture size and memory</summary>` block after the bullets.
- Area lights: split line 158 into a short paragraph after the bullets: what `image` and `setImage` take, how the light varies, the tint, and the painting tip (a dark picture lights little; paint a faint glow). End it with "Pictures follow the same limits as [spot light maps](#spot-light-maps). `setImage(null)` goes back to one color." Drop the repeated 512/32/timing sentences. Keep "allocates" if wanted, in the same short form.
- Line 162: keep in the main text: "Area lights start to give light once their tables and shader builds have downloaded, and the scene draws as before meanwhile. Pass `'area_lights'` to `createEngine`'s `preload` to download them before the first frame. A failed download reports [E1431](../errors/E1431.md)." Move the 19 KB size and the note that a scene without area lights downloads nothing and carries no area-light code into `<details><summary>Technical details: what area lights download</summary>`.
