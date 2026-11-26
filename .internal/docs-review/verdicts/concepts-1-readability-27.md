# Verdict: concepts-1-readability-27

## Finding as given

```json
{
 "page": "concepts/lod",
 "anchor": "lines 37, 99, 166-167, 178",
 "category": "duplication",
 "severity": "medium",
 "claim": "Two rules each appear several times, worded differently. The first: a measured error switches at once and fades only above about 1.5 pixels (lines 37, 166, 178). The second: an error counts as measured only with the coverage beside it (lines 99, 166).",
 "evidence": "lod.md:37, 99, 166, 178",
 "proposedEdit": "Keep both rules once, as the two bullets in 'Fading between levels' (164-167). Delete the repeat at 178. At 37 and 99, use one sentence and a link to #fading-between-levels.",
 "generatedSource": "",
 "id": "concepts-1-readability-27",
 "slice": "concepts-1",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The duplication is real. Line 166 (the first bullet under "Fading between levels") states both rules. Line 178 restates the first rule almost word for word: fades above about one and a half pixels, no cost at a small threshold or at a preset's own threshold, Low's phones. Line 99 restates the second rule.
- The finding misses one copy of the second rule. Line 98 already says "The loader reads the coverage that comes beside an error to tell a measured error from a hand-set one". So the coverage rule appears three times (98, 99, 166), not two.
- Line 37 already does what the edit asks. It gives the rule in one clause and links to `#fading-between-levels`. Only the "4 or 8 pixels" detail there could be trimmed. This part of the edit changes little.
- Line 178 holds one point that line 166 does not: the measured level fades "whatever the level says", that is, even though its own fade setting is off. The source confirms this. The glTF reader and the planner set `fade: false, measured: true` on measured levels (packages/engine/src/scene/gltf.ts:558, :858; packages/engine/src/scene/resources.ts:808). The renderer fades measured levels from a separate mask when the governed threshold is high (crates/null3d-render/src/frame.rs:2821-2826, crates/null3d-render/src/cpu_culled/layout.rs:743-746; mask packed at resources.ts:1091 and :1115-1117). The point also matters to the `fade: false` code sample right above line 178. Deleting line 178 as a whole loses it.
- Line 99 also holds content found nowhere else on the page: files that bring their own levels (Blender), which `assets optimize` keeps and converts to the base mesh's integer steps. "Use one sentence" at 99 must cover only the first two sentences, not the whole paragraph.
- The coverage rule is about how the glTF loader reads a file, so its natural home is the asset tool section (98). Keeping it in the fading bullet and cutting it from 98 would be the weaker choice. Keeping it once at 98 and linking from the fading bullet works at least as well.

## Corrected claim

The first rule (a measured level switches at once and fades only once the governor raises the threshold above about one and a half pixels) appears at 37, 166 and 178. Line 37 already gives it briefly with a link. Lines 166 and 178 are close repeats. The second rule (an error counts as measured only with the coverage beside it) appears three times, at 98, 99 and 166.

## Corrected edit

- Fading section: merge line 178 into the first bullet at 166 and delete line 178. Keep its one new point in the bullet: "This holds whatever the level's own fade setting says." Keep the cost note once: "The band then costs a second draw."
- Asset tool section: keep the coverage rule once, at line 98. At line 99, cut the first two sentences (the measured-error repeat) and keep the rest: errors given alone are hand-set and fade, and the part about Blender levels and integer steps. Add a link to `#fading-between-levels`.
- Fading bullet at 166: replace the last sentence (the coverage rule) with a short link back to `#levels-from-the-asset-tool`, or keep it there and cut it from 98. Either way, state it once.
- Line 37: no change needed beyond dropping "to 4 or 8 pixels" if wanted. It already links to the fading section.
