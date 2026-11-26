# guides-1-substance-06

## Finding as given

```json
{
 "page": "guides/audio",
 "anchor": "A mix that works, first bullet: \"The sample loops are normalized to -20 LUFS.\"",
 "category": "wrong-claim",
 "severity": "medium",
 "claim": "The repository's sound files are not normalized: they measure -44.0 to -12.9 LUFS, and the demos multiply each level by a gain. 'The sample loops' is also never introduced.",
 "evidence": "docs/guides/audio.md:127; examples/lib/sound-gain.ts:1-30 ('The generated sounds were left at the level that their generator gave them').",
 "proposedEdit": "\"Normalize the files to one loudness, such as -20 LUFS, so a level of 1 means the same for each. If you cannot change the files, multiply each sound's level by a gain that brings it there.\"",
 "generatedSource": "",
 "id": "guides-1-substance-06",
 "slice": "guides-1",
 "role": "substance"
}
```

Verdict: survives

## Evidence

- docs/guides/audio.md:127 says: "Normalize the files to one loudness, so a level of 1 means the same for each. The sample loops are normalized to -20 LUFS." The page is hand-written, not generated.
- examples/lib/sound-gain.ts:1-5 says the generated sounds "were left at the level that their generator gave them — some forty decibels apart", and that each scene multiplies its level by a gain to reach the -20 LUFS the mixes are tuned at. Lines 7-30 list measured loudness from -44.0 LUFS (leaves) to -12.9 LUFS (bus). Only rain is at -20.0.
- .dev/sample-content.md, section "The sounds": 11 of the 13 sample sounds are "played exactly as generated ... none is cut, faded or normalised here". The table gives the same spread.
- SOUND_GAIN is applied in examples/sound/sketch.ts and in the creek, island and skyway showcase sound files.
- "Sample loops" appears nowhere else on the page. The page's code uses files such as '/sounds/wind.mp3' and never says which sample set it means. docs/api/sound.md does not mention loudness or LUFS.

One small point in the claim is too broad. Two sample loops, the hover engine hum and its passing take, are cut by tools/samples/sound/loops.ts and set to -20 LUFS (loops.ts:83 sets every loop's target to -20; loops.test.ts:32 checks it). But they are 2 of 13, and the other 11 are the ones the page's own examples name (wind, waterfall, car). So the page's sentence still misleads a reader who measures or reuses the samples. This does not change the verdict.

The proposed edit keeps the advice, keeps -20 LUFS as an example target, and adds the gain fallback that the demos really use. It breaks no writing rule and no website contract rule. It needs no collapsible block: it is one short sentence.
