# api-3-substance-30

## Finding as given

- page: api/water, api/scene
- anchor: water line 213 "the weather example add-on"; scene line 298 "The aurora example add-on in `examples/addons/aurora/`"
- category: missing-prerequisite
- severity: low
- claim: The reader does not know what the weather example add-on is or where it is. The aurora path is plain text with no link to it or to its demo.
- evidence: examples/addons/weather and examples/addons/aurora exist; demo 'aurora' in examples/demos.ts.
- proposedEdit: Water: drop the sentence or link https://github.com/null3d-engine/null3d/tree/main/examples/addons/weather. Scene: link the aurora add-on and the aurora demo https://github.com/null3d-engine/null3d/tree/main/examples/aurora/.

Verdict: partly

## Evidence

- docs/api/water.md:213 says "The rings follow the wet surface of the weather example add-on." The page names no folder and has no link. Nothing else in water.md says what the add-on is. stats.json lists no example links for api/water. The only other place that names it is docs/getting-started/third-party-notices.md:88, which the water page does not link.
- docs/api/scene.md:298 names `examples/addons/aurora/` as code text, with no link. The page links other demos in the same way the contract wants (scene.md:549 atmosphere, :551 time-of-day), so a link here fits the page.
- examples/demos.ts:315-324: the 'aurora' demo has no `code` value, so its link is examples/aurora/ under the contract. The proposed scene URL is correct.
- examples/addons/weather/ exists (README.md, wet.wgsl, rain.ts). wet.wgsl:1 opens "The wet surface of the weather add-on", so the water page's claim about the code is right.
- No demo shows the water rain rings with the weather add-on. Demos that call createWater: water, showcase/creek, showcase/island. None calls setRain or imports the weather add-on. So no demo link fits the water sentence.

## What does not hold

- "Drop the sentence" is the wrong option. The sentence tells an implementer that the rings match the add-on's wet surface, which helps them use both together. Keep it.
- The water link https://github.com/null3d-engine/null3d/tree/main/examples/addons/weather is not a demo link under the website contract: no demo or comparison has that code. Other pages name add-on folders as code text (guides/car-paint.md:28, guides/screens.md:26, cookbook/index.md:538). This is the format the docs already use.

## Corrected claim

The water page names the weather add-on but does not say where it is. The scene page names the aurora add-on folder but does not link the aurora demo that shows it.

## Corrected edit

- Water line 213: keep the sentence and name the folder, as the other pages do: "The rings follow the wet surface of the weather example add-on in `examples/addons/weather`." Do not drop the sentence. Do not add a demo link, because no demo shows these rings with the add-on.
- Scene line 298: keep the folder name and add the demo link: "The aurora example add-on in `examples/addons/aurora/` draws one over a frozen lake that reflects it, in the [aurora demo](https://github.com/null3d-engine/null3d/tree/main/examples/aurora/)."
