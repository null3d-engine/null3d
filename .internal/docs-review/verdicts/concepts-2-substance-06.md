# concepts-2-substance-06

## Finding as given

```json
{
 "page": "concepts/shadows",
 "anchor": "## Where the cascades split, line 194; ## Blending between cascades, line 226",
 "category": "wrong-claim",
 "severity": "medium",
 "claim": "Both say \"With the default settings\", then use cascades that end at 200 m. The default distance is 'auto', so no fixed 200 m exists, and a reader who works out texel sizes from the table gets wrong numbers.",
 "evidence": "docs/concepts/shadows.md:145, 155 (\"than a fixed 200 m\"), 194-200, 226; packages/engine/src/scene/scene.ts:705-713 ('auto', the default).",
 "proposedEdit": "Line 194: \"With distance: 200, the other defaults, a 60 degree view and a 16:9 canvas, ...\". Line 226: \"With distance: 200 and three cascades, the first cascade blends into the second from about 21.6 m to 24 m.\"",
 "generatedSource": "",
 "id": "concepts-2-substance-06",
 "slice": "concepts-2",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- docs/concepts/shadows.md:194 says "With the default settings, a 60 degree view and a 16:9 canvas", and every row of the table at 198-200 ends the last cascade at 200 m. Line 226 says "With the default settings, the first cascade blends into the second from about 21.6 m to 24 m", which is 0.9 x 24 m, the 65% split over 0.1 to 200 m with three cascades.
- The settings table at docs/concepts/shadows.md:145 and packages/engine/src/scene/scene.ts:705-713 give `'auto'` as the default `distance`. crates/null3d-core/src/lights.rs:159-168 confirm it: `SHADOW_DISTANCE_AUTO` is the default, and the ladder starts at 1 m and rises by 1.25 per step. 200 m is not on that ladder (1.25^23 is about 169 m, 1.25^24 is about 212 m). So a scene with receivers in view never gets 200 m from the defaults. The main claim holds.
- One part of the claim is too strong. crates/null3d-core/src/lights.rs:167-168 define `AUTO_FALLBACK = 200.0`: "The distance that an auto light's shadows reach while the view sees no receiver." So the default does give 200 m, but only when no receiver is in view, the one case where shadow texels do not matter. The page does not say this. Line 155 ("than a fixed 200 m") reads as if 200 m were an earlier fixed default.
- The proposed edit for line 194 is still not exact. "The other defaults" includes the cascade count and map size, which come from the quality preset. packages/engine/src/quality/presets.ts:401-410 give `shadowCascades` [2, 3, 3, 4] and `shadowMapSize` [1024, 2048, 2048, 4096]. The table shows three cascades, and 23 cm for the 57 to 200 m cascade fits a 2,048 map. That is a sphere about 470 m across, divided by 2,048. On Low (two cascades, 1,024) or Ultra (four cascades, 4,096), the table's splits and texel sizes are wrong. So the edit must name three cascades and a 2,048 map. The line 226 edit is right as proposed: the blend band depends on the distance, the cascade count and the blend share, not on the map size.

## Corrected claim

Both sections say "With the default settings", but they use a fixed 200 m distance, three cascades and (for the texel table) a 2,048 map. The default distance is `'auto'`, which follows the farthest receiver in view. It falls back to 200 m only when no receiver is in view. The cascade count and map size come from the quality preset, so the default differs between presets. A reader who works out texel sizes for their own scene from this table gets wrong numbers.

## Corrected edit

- Line 194: "With `distance: 200`, three cascades, a 2,048 map (the Medium and High presets), a 60 degree view and a 16:9 canvas, one texel of each cascade covers this much of the ground:"
- Line 226: "With `distance: 200` and three cascades, the first cascade blends into the second from about 21.6 m to 24 m."
- Optional, line 155: change "than a fixed 200 m" to "than a fixed distance of 200 m", or say that 200 m is the distance `'auto'` uses while no receiver is in view. Then the number has a source.
