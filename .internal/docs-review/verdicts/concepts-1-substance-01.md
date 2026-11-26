# concepts-1-substance-01

## Finding as given

- page: concepts/lighting
- anchor: ## Time of day, line 518 "The fog takes the sky's mean light at every hour"; table rows `fog` at lines 550 and 561
- category: contradiction
- severity: high
- claim: The page says three things about the fog color. Line 518 says the fog takes the sky's mean light at every hour. Line 550 says the analytic model's fog takes the horizon color. Line 561 says the physical model's fog takes the horizon color. The code does this: the analytic model takes the horizon color by day and fades to the sky's average at dusk, and the physical model takes the mean light. So line 561 is wrong, line 518 is right only for the physical sky, and a code comment repeats the error.
- evidence: packages/engine/src/scene/time-of-day.ts:315-323 (analytic: mix(DAY_HORIZON, DAY_AVERAGE, dusk)); time-of-day.ts:619-625 (physical: scale(fogColor, SET_MEAN, sunShare)); the comment at :619-622 says 'The analytic model's fog takes the mean too', which :323 contradicts; TSDoc at :107 and :203 says horizon.
- proposedEdit: Line 518, last two sentences: 'With the analytic sky, the fog takes the color of the sky's horizon by day and fades to the sky's average color at dusk. With the physical sky, the fog takes the sky's mean light at every hour, the light that the exposure follows. A fog of the horizon's color would carry the sky's brightest band over the whole scene.' Row `fog` at line 561: 'The sky's mean light, with no glow: the aerial perspective already glows toward the sun'. Fix the `fog` TSDoc (time-of-day.ts:107) and the comment at :619-622.

## Verdict: partly

## Evidence

- docs/concepts/lighting.md:518 says the fog takes the sky's mean light at every hour. Line 550 (analytic table) says the horizon color. Line 561 (physical table) says the horizon color. The page contradicts itself. Confirmed.
- Analytic model, packages/engine/src/scene/time-of-day.ts:315-323: `dusk = smoothstep(0, -6, elevation)`, fog = mix(DAY_HORIZON, DAY_AVERAGE, dusk). Horizon by day, average from sunset to 6 degrees under. The moon sky share at :326-333 does the same mix (horizon to average), so at night the analytic fog is the average. Line 550 is right by day only; line 518 is wrong for the analytic model by day.
- Physical model, time-of-day.ts:623-625: fog = SET_MEAN * sunShare + MOON_HORIZON * moonSkyShare. The sun's sky part is the mean. But the moon sky part is the moon sky's HORIZON light (MOON_HORIZON from physicalAt at :614), not its mean. sunShare = sunLight * (1 - handover) goes to zero as night falls (:584, :617), so at night the physical fog is the moon sky's horizon light. So "the physical model takes the mean light at every hour" is not exact: it holds by day and through dusk, not at full night.
- Line 561 is wrong by day and dusk. The comment at :619-622 ("The analytic model's fog takes the mean too") is wrong; :323 shows the analytic fog takes the horizon by day.
- TSDoc at :107-108 ("the sky's color along the horizon") and :203-204 ("the fog fades into the sky's horizon") are shared by both models and are wrong for the physical model by day. The file header at :4-6 says the same for the default model, which holds by day.
- docs/concepts/lighting.md:566 ("the fog's color can match the horizon") agrees with the analytic model by day and needs no change.

## Corrected claim

The page contradicts itself about the fog color. The analytic model takes the sky's horizon color by day and fades to the sky's average color through dusk (and keeps the average at night). The physical model takes the sun's sky mean light by day and through dusk; at night, when the moon's sky takes over, it takes the moon sky's horizon light. So line 561 is wrong by day, line 518 is wrong for the analytic model, and the code comment at time-of-day.ts:619-622 and the shared `fog` TSDoc at :107 are wrong.

## Corrected edit

Line 518, replace the last two sentences with: "With the analytic sky, the fog takes the color of the sky's horizon by day and fades to the sky's average color at dusk. With the physical sky, the fog takes the sky's mean light by day and through dusk, the light that the exposure follows, so it stays as dim as the sky around it. A fog of the horizon's color would carry the sky's brightest band over the whole scene."

Row `fog` at line 561: "The sky's mean light, with no glow: the aerial perspective already glows toward the sun. At night it takes the moon sky's horizon light."

TSDoc at time-of-day.ts:107-108: "The fog's linear color and the glow toward the main light, for `scene.setFog`. With the analytic model the color is the sky's horizon by day and its average at dusk; with the physical model it is the sky's mean light." Fix :203-204 the same way. In the comment at :619-622, remove the last sentence. (Alternatively, if the intent is the mean at every hour, change :625 to add MOON_MEAN instead of MOON_HORIZON; that is a code change and is out of scope for a docs fix.)
