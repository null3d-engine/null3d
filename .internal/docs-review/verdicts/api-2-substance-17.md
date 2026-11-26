# Verdict on api-2-substance-17

## The finding as given

```json
{
 "page": "api/lights,api/materials,api/particles,api/impostors,api/quality,api/page",
 "anchor": "page-wide: no GitHub example links (stats.json exampleLinks empty)",
 "category": "missing-content",
 "severity": "medium",
 "claim": "Demos exist for nearly every feature on these pages, but the pages link none of them. materials.md:203 names 'the translucency demo' in plain text with no link.",
 "evidence": "examples/demos.ts: area-lights, spot-cookies, hero-shadow, contact-shadows, time-of-day; coat-and-sheen, iridescence-and-anisotropy, translucency, subsurface, decals, relief, weighted-transparency, shader-inputs, water; particles; impostors, forest; showroom. stats.json; docs/api/materials.md:203.",
 "proposedEdit": "Under each section heading, add one sentence with a link of the form https://github.com/null3d-engine/null3d/tree/main/examples/<code>, as the shotsAndDemos lists give them. For example: 'The [area lights demo](.../examples/area-lights) lights a wet street with shop windows and a neon sign.'",
 "generatedSource": "",
 "id": "api-2-substance-17",
 "slice": "api-2",
 "role": "substance"
}
```

Verdict: partly

## Evidence

What holds:
- stats.json gives an empty example-link list for all six pages. 30 of 227 pages do have such links, among them api/sound (line 138) and api/post (lines 489-490), so these six pages break a pattern that other API pages follow.
- None of lights.md, particles.md, quality.md or page.md names a demo at all.
- materials.md:203 says "the translucency demo" in plain text, with no link. The demo exists (examples/demos.ts:373, code `translucency/`).
- The demos named in the evidence exist in examples/demos.ts with code values: area-lights (711), spot-cookies (723), hero-shadow (539), contact-shadows (523), coat-and-sheen (338), iridescence-and-anisotropy (350), translucency (373), subsurface (385), shader-inputs (410), water (422), weighted-transparency (446), relief (458), decals (496), particles (687), forest (952), impostors (970), showroom (222). time-of-day (485) has no code, so its link uses `time-of-day/`.
- These pages are written by hand (docs/api/*.md, not docs/api/reference/), so no generated source is needed.

What does not hold:
- impostors.md does point to its demo. Line 13 names the demo "Impostors" and its folder `examples/impostors`, line 240 names its L key, and line 248 names `examples/impostors/forest.ts`. The gap there is only that the folder is code text, not a link. That is low severity on this page, not missing content.
- page.md and quality.md have no demo made to show their API. Demos use page messages and quality calls only in passing: showroom/sketch.ts:46 posts a loading message and :58 sets quality; forest/sketch.ts:71 listens for quality changes; weighted-transparency/sketch.ts:83-113 posts its on-screen panel. "Demos exist for nearly every feature" is not true for these two pages. A link there is optional, and would need a sentence that says what to look for in the demo's code.
- The proposed edit, "under each section heading, add one sentence with a link", goes too far. materials.md has about 40 sections, and many have no matching demo: Ranges, Limits, Destroying a material, Changing a material, Depth bias, Color, Texture coordinate transform. A link sentence under every heading would add filler and repeat. The "shotsAndDemos lists" the edit names do not exist in the repository.

## Corrected claim

lights.md, materials.md and particles.md have matching demos but link none of them. materials.md:203 names the translucency demo without a link. impostors.md names its demo and folder in code text (lines 13, 248) but does not link them. page.md and quality.md have no demo made for their API, so a link there is optional.

## Corrected edit

Link a demo only in a section that the demo shows, using https://github.com/null3d-engine/null3d/tree/main/examples/<code>:
- lights.md: Spot light maps -> spot-cookies; Area lights -> area-lights; Shadows -> hero-shadow and contact-shadows; Light from the sky -> time-of-day/ (it has no code value).
- materials.md: turn "the translucency demo" at line 203 into a link to translucency. Link one demo each in Light under the surface (subsurface), Clear coat and sheen (coat-and-sheen), Iridescence and anisotropy (iridescence-and-anisotropy), Decals (decals), Relief (relief), Weighted blending (weighted-transparency), Custom materials (shader-inputs) and Mirrors, polished floors and water (water).
- particles.md: one sentence near the top that links particles and says what it shows: a campfire with flipbook flames, embers, smoke, falling leaves and fireflies, all moved on the GPU.
- impostors.md: make `examples/impostors` at line 13 a link, and the same at line 248.
- page.md, quality.md: optional. One sentence at most, for example "The [showroom demo](https://github.com/null3d-engine/null3d/tree/main/examples/showroom) sets its own quality settings at start". Do not add a link under every heading.

Or follow api/post.md and put one short "Demos" list before "Related pages" on each page, one line per demo saying what it shows.
