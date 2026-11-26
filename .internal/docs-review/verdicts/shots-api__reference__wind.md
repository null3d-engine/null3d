# Shot and demo-link verdicts: api/reference/wind

Page: docs/api/reference/wind.md (generated). Source to edit: the doc comments in packages/wind/src, tag `@category api/wind`. `createWind` is in packages/wind/src/wind.ts. `WindReading` is in packages/wind/src/analytic.ts.

## Shots

None were proposed. None are needed. This is a reference page of signatures and member tables. The wind overview page, docs/wind.md, is the right place for a picture. The reference image tests/image/references/chrome-real-gpu/<tier>/demo-vegetation-wind.png exists in the webgpu, compat and webgl2 folders if that page wants one.

## Demo links

### createWind -> vegetation-wind/ : KEEP

- The code `vegetation-wind/` exists in examples/demos.ts (demo "Plants in wind").
- Its sketch calls `createWind(ctx, { camera, box: 160 })`. Each frame it calls `setBase` and `update`. It gives `wind.field` to the plant materials and to the grass add-on. That is the whole life of a wind object, so the demo shows this export.
- Where to add it: a line in the doc comment of `createWind` in packages/wind/src/wind.ts. The page has no example links yet.
- Limit: the demo never calls `gust`, `push`, `sample` or `read`. Do not make the link claim that it shows those calls.

## Concepts said to have no demo

### WindReading in a custom material : DISPROVED, a demo shows it

- vegetation-wind/ shows it. Its plants use the demo's own material in examples/lib/sway.ts, made by `createSway`.
- That material is a custom WGSL shader. It reads `wind.field.air` (the WindReading). It packs `base`, `gust`, `swirl` and `sent` into a small settings texture, and its WGSL function `wind_reading(base, gust, swirl, sent, time)` unpacks them.
- It uploads the settings again only when a new gust is sent, because it checks `sent[3]`. This is the "give them again when the air changes" rule from the `WindField.air` description.
- The demo link is `vegetation-wind/`. The material file is outside that folder (examples/lib/sway.ts), so the link text should say that the plant material lives in the shared helper that the sketch imports.
- Note for the page text: the `WindReading` description says "the three vectors that its shader takes", but the table lists four (`base`, `gust`, `swirl`, `sent`), and the sway shader takes all four. Fix this in the doc comment in packages/wind/src/analytic.ts.
