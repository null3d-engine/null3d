# api-2-substance-11

## Finding as given

- page: api/lights
- anchor: ## Shadows, first paragraph (line 212)
- category: unclear
- severity: medium
- claim: "'castShadows: true ... make a directional light cast shadows. The first directional light created casts them' reads as if any directional light can cast. In fact only the first one created can cast, and castShadows on a later one has no effect. The kinds table (line 38) lists castShadows for every directional light."
- evidence: docs/api/lights.md:38, 127, 212; docs/concepts/shadows.md:407; TSDoc packages/engine/src/scene/scene.ts:664-667 and 2378-2380.
- proposedEdit: "'Only the first directional light that you create can cast shadows, and only when it has castShadows: true or setCastShadows(true). The option does nothing on a later directional light.' Change both TSDoc comments to match."
- generatedSource: packages/engine/src/scene/scene.ts (DirectionalLightOptions.castShadows, setCastShadows, for docs/api/reference/lights.md)

Verdict: partly

## Evidence

- docs/api/lights.md:212 says "`castShadows: true` and `setCastShadows(true)` make a directional light cast shadows. The first directional light created casts them". The two sentences pull in different directions. A reader can take "a directional light" to mean any of them. The core point of the finding holds.
- packages/engine/src/scene/scene.ts:664-667 (castShadows option) and 2378-2380 (setCastShadows) use the same ambiguous wording. Both feed docs/api/reference/lights.md.
- The engine code confirms that only one directional light casts. crates/null3d-core/src/lights.rs:911-923: after the gather, `main = kept[0]`, and only that light's cast flag fills `frame.sun_shadow`. Fill lights (lines 925-930) get a direction and a color, and no shadow.
- The claim is too strict about which light counts as "first". crates/null3d-core/src/lights.rs:826-836 skips a light that is hidden or that shares no layer with the camera, before it keeps the directional lights in creation order (lines 504, 547-548). So the shadow light is the first-created light among the visible, layer-sharing directional lights. If the first light is hidden, destroyed or on another layer, the next one becomes the main light, and its castShadows then has effect. "castShadows on a later one has no effect" and "Only the first directional light that you create can cast shadows" are therefore wrong in those cases.
- The same page already gives the correct rule at docs/api/lights.md:127: "up to four directional lights that are visible and share a layer with the camera: the first four you created. The first one lights and casts the shadows." docs/concepts/shadows.md:407 also says it. This lowers the cost, but the Shadows section, where a reader looks first, stays unclear. Medium severity is fair.
- The kinds table (line 38) lists castShadows as an option of DirectionalLight. That is true: the option exists on every directional light. The table does not need a change.

## Corrected claim

The Shadows paragraph and both TSDoc comments do not say that only one directional light casts shadows. That light is the first one created among the directional lights that are visible and share a layer with the camera. On any other directional light, castShadows has no effect until that light becomes the first one, for example when the earlier lights are hidden or destroyed.

## Corrected edit

docs/api/lights.md, Shadows section, first sentences:

"Only one directional light casts shadows: the first one you created among those that are visible and share a layer with the camera. It casts them when it has `castShadows: true` or after `setCastShadows(true)`. On another directional light the option has no effect until that light becomes the first, for example when you hide or destroy the earlier ones. Objects need `castShadows` and `receiveShadows` of their own."

TSDoc in packages/engine/src/scene/scene.ts (castShadows option and setCastShadows):

"True makes the light cast shadows, like `setCastShadows(true)`. The default is false. Only the main directional light casts them: the first one created among those that are visible and share a layer with the camera."

Leave the kinds table at line 38 as it is.
