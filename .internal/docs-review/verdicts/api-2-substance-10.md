# api-2-substance-10

## The finding as given

- page: api/impostors
- anchor: ## Create the cards, 'Give a batch castShadows: true and a layer that the sun draws and no camera does' (line 79)
- category: missing-content
- severity: medium
- claim: The text implies that a card batch which casts must be on a layer that no camera draws. So shadows need a second batch with the same rows. The page does not say this, give the reason, or show the code. The 174-word paragraph also covers receiving, contact shadows and castsStill.
- evidence: docs/api/impostors.md:79; TSDoc packages/impostors/src/batch.ts:88-92; tests/image/manifest.ts:3290-3295 (impostor-shadow).
- proposedEdit: Give shadows a subsection with an example: a visible batch with receiveShadows, plus a second batch with the same rows, castShadows: true and a caster-only layer. Give the reason: each card turns toward the view that draws it, so the caster turns toward the sun. Move the castsStill and contact-shadow detail into <details><summary>Technical details: how cards cast and receive shadows</summary>.

Verdict: partly

## Evidence

- The gap is real. docs/api/impostors.md:79 tells the reader to put a casting batch on "a layer that the sun draws and no camera does". It never says that this is a second batch beside the visible one, and it shows no code. The only code on the page (lines 41-66) has no shadow options.
- The two-batch pattern is the intended use. The image test sketch tests/pages/sketches/impostor-shadow-sketch.ts makes a visible batch with `receiveShadows: true` and a second batch with the same rows, `layers: CASTER_LAYER` and `castShadows: true`, then scales both batches. The manifest entry (tests/image/manifest.ts, impostor-shadow) says the cards cast "through a batch that only the light draws".
- A step is missing that the finding does not name. The test sketch calls `sun.setLayers(1 | CASTER_LAYER)`. A light casts only from objects whose mask shares a bit with its own, and the engine gives no warning when it does not (docs/concepts/render-layers.md:76-81). The page says "a layer that the sun draws", but it does not say that the reader must add that layer to the sun's mask, and it does not link the render layers page. A reader who copies only the cards' options gets no shadow and no error.
- The proposed reason is wrong. "Each card turns toward the view that draws it" is true (cards.wgsl:13-14, 113-116; batch.ts:213-216), but it holds for any casting batch, one batch or two. It explains why the shadow has the crown's shape and why castsStill can stay true. It does not explain why the caster is a separate batch. The source gives a cost reason: "A card batch that only casts draws on a layer that the light sees and no camera does, so it costs nothing in the camera's view" (packages/impostors/src/batch.ts:90-92, rendered in docs/api/reference/impostors.md:292).
- Part of the reason is already on the page. Line 79 says "A card turns toward the view that draws it, so its shadow holds still while the sun does", but only to explain castsStill.
- The block proposal is sound. castsStill (batch.ts:97-103, 213-216) and the contact-shadow exclusion (batch.ts:217-219) are correct, dense detail for implementers. The main text still makes sense with them closed.

## Corrected claim

The page implies, but does not state or show, that card shadows use a second batch with the same rows, `castShadows: true` and a layer that only the sun draws. It also omits that the reader must add that layer to the sun's mask, or the cards cast nothing with no warning. The source's reason for the second batch is cost: the camera never draws the caster. It is not the card's turn toward each view.

## Corrected edit

Add a subsection "Cast and receive shadows" after line 77. Its example follows tests/pages/sketches/impostor-shadow-sketch.ts:

- a sun with `castShadows: true` and the caster layer in its mask (`sun.setLayers(1 | CASTER)` or the `layers` option);
- a visible batch with `receiveShadows: true`;
- a caster batch from the same options and rows, with `layers: CASTER` and `castShadows: true`;
- the same scale writes and `markDirty()` on both batches.

Say in the main text: the caster batch sits on a layer that no camera draws, so the camera does not pay to draw it. In the shadow pass each card turns toward the sun and cuts the crown's shape from its stored coverage. A receiving card reads shadows at the surface its stored depth shows, so it does not darken itself. Link ../concepts/render-layers.md#layers-and-shadows for the light's mask. Keep the rows of both batches in step: when you change one, write and mark the other too.

Move the castsStill rule and the contact-shadow exclusion into:

<details>
<summary>Technical details: how cards cast and receive shadows</summary>

(castsStill: the default holds the caster still while the sun stands still, so far cascades stay cached; pass false when the scene turns cards from frame to frame. Contact shadows are off for cards, because the march takes a flat card for a solid wall.)

</details>
