# Verdict on api-2-readability-07

## The finding as given

- Page: api/post
- Anchor: bullet lists under Automatic exposure, Bloom, Ambient occlusion, Screen-space reflections, Depth of field, Outlines, Vignette
- Category: duplication. Severity: medium.
- Claim: Four notes repeat in nearly every effect section: left-out settings keep their values, post.set allocates nothing, the HDR and compatibility-mode note, and on/off adds passes and downloads shaders. The repeats make each list longer and hide the facts that differ between effects.
- Evidence: 'keeps its value' appears 11 times (lines 112, 141, 174, 218, 262, 299, 392, 415...); 'allocates nothing' appears 9 times; the HDR note is at lines 111, 143, 261; the passes note at lines 175, 219, 263.
- Proposed edit: Add '## How post.set works' after the intro, with four bullets for the shared rules. Remove the repeats from each effect section, and keep only what is particular to that effect.

Verdict: partly

## Evidence

Two of the four notes are shared rules. Two are not.

Shared, and safe to move:
- "A setting that a call leaves out keeps its value, also while it is off. `post.set({ x: {} })` turns it on with the values it had." The same sentence is at lines 37, 112, 141, 174, 218, 262, 299, 328 (`lutIntensity`), 353 (grading table cell), 392 and 415. Only the key name changes.
- "`post.set` allocates nothing" is at lines 58, 113, 144, 175, 219, 263, 299 and 328. Line 58 is already a section of its own ("Changing the exposure during play", lines 56-70) with the code pattern for calling `post.set` every frame.

Not shared. A single shared bullet would be wrong:
- HDR color. The source (packages/engine/src/scene/post.ts:1063-1072, `needsHdr`) lists bloom, depth of field, automatic exposure, custom effects and custom tone curves. Ambient occlusion and screen-space reflections are not in that list. The page agrees: ambient occlusion (line 173) needs float render targets and the depth prepass, and screen-space reflections stay on the 8-bit path in compatibility mode and read display color there (line 217). Grading, the vignette and sharpening draw on every path (lines 370, 394). So "turning it on moves the engine to HDR color with FXAA" is true for three effects only. The three lines that the finding cites (111, 143, 261) are exactly those three. The note is the same there, but it is a per-effect fact, not a rule of `post.set`.
- On/off cost. Outlines differ: turning them on or off rebuilds the draw tables, so it must happen on a click, not each frame (line 300). Ambient occlusion and screen-space reflections add passes that take a few frames (lines 175, 219). Shader downloads happen for bloom, depth of field, automatic exposure and ambient occlusion (post.ts:854, 941, 969, 1008), but the page mentions them only for automatic exposure, screen-space reflections and depth of field. A blanket bullet "on/off adds passes and downloads shaders" would be wrong for outlines and would hide the outline warning.
- A blanket "so a sketch can change it every frame" also needs care. Changing a setting every frame is fine. Turning an effect on or off every frame is not (outlines, and the passes that take a few frames).

Placement. The page already has a section for the "allocates nothing" rule (lines 56-70). A second new section after the intro would split the same rule over two places. The better home is that section, renamed.

Cost to a reader. This is a reference page. Readers jump straight to one effect by its anchor, so each section must still say where the shared rules are. A one-line link in each section keeps that.

## Corrected claim

Two notes repeat word for word in the effect sections and are rules of `post.set` itself: a left-out setting keeps its value (also while the effect is off, so `{}` turns it on with its old values), and `post.set` allocates nothing, so settings can change every frame. They can move to one place. The HDR note and the on/off cost note are per-effect facts. They differ between effects (ambient occlusion and screen-space reflections do not need HDR color; outlines rebuild draw tables on toggle), so they must stay in each section.

## Corrected edit

- Rename "Changing the exposure during play" to "Changing settings during play" (or "How post.set works") and keep it where it is. Open it with two bullets: a left-out setting keeps its value, also while its effect is off, and `post.set({ effect: {} })` turns an effect on with the values it had; `post.set` allocates nothing, so a sketch can change settings every frame. Keep the existing code example. Add one sentence: turning an effect on or off can cost more, and each effect's section says how much.
- In each effect section, remove the "keeps its value" and "allocates nothing" bullets. Where a section needs the reminder, end the list with one short link: "Settings carry over between calls ([Changing settings during play](#changing-settings-during-play))."
- Keep the HDR bullets for automatic exposure, bloom and depth of field, and the per-effect notes for ambient occlusion, screen-space reflections and outlines. These may be shortened, for example "It needs HDR color, as bloom does ([devices without HDR color](../concepts/post-processing.md#effects-on-devices-without-hdr-color))", but not merged into one shared rule.
- Keep each effect's on/off cost in its own section, and keep the outline warning (rebuilds draw tables, do it on a click) as it is.
