# concepts-2-substance-11

## The finding as given

- Page: concepts/post-processing, api/post
- Anchor: bloom table lines 83-89; ambient occlusion table lines 235-243; reflections table lines 284-289
- Category: duplication. Severity: medium.
- Claim: The concept page repeats the settings tables of the post API page, and the copies have started to differ. The API page says reflections fade over the last fifth of maxDistance. The concept page says they fade as a ray nears maxDistance.
- Evidence: docs/concepts/post-processing.md:83-89, 235-243, 284-289, 292; docs/api/post.md:131-133, 163-169, 205-207.
- Proposed edit: Keep the settings tables on the API page, and link to them from the concept page ("The post-processing API lists the settings."). If they stay, put each in `<details><summary>Technical details: the settings and their defaults</summary>` and make the wording agree.

Verdict: partly

## Evidence

- The duplication is real. The concept page has settings tables for bloom (lines 83-89), ambient occlusion (235-243) and reflections (284-289). The API page has the same settings with the same defaults (docs/api/post.md:126-133, 163-169, 203-207).
- The concept page is not consistent with itself. For depth of field (line 134), automatic exposure (170), outlines (348), color grading (362) and sharpening (373) it already writes "The post-processing API lists the settings" and has no table. Only bloom, ambient occlusion and reflections repeat the table. So the proposed link follows the page's own pattern.
- The claimed difference is not a difference. The API page says reflections "fade out over the last fifth" of maxDistance (post.md:205). The concept page says the reflection fades where a ray "nears maxDistance" (post-processing.md:292). The second is less exact, but it does not contradict the first. The shader agrees with both: `near_enough = 1.0 - smoothstep(settings.z * 0.8, settings.z, hit.x)` in crates/null3d-shaders/wgsl/lib/ssr.wgsl:50 fades from 80% to 100% of the distance.
- The two copies do differ in a few places, but by extra detail, not by contradiction. Only the concept table says that with `'add'` and `'screen'` the bloom intensity is a factor on the glow (line 85). Only the concept table says that ambient occlusion `samples` gives 3 directions below 30 and 5 from 30 (line 242). Deleting the concept tables without moving these facts would lose useful detail.
- No reader is misled today, because every default and range agrees. The cost is drift risk, plus a page that is longer than it needs to be. That makes this low to medium, not a clear medium.

## Corrected claim

The concept page repeats the settings tables of bloom, ambient occlusion and screen-space reflections from the post-processing API page. Its other sections already link to the API page for their settings. The copies agree today: "nears maxDistance" and "the last fifth" describe the same fade, which runs from 80% to 100% of the distance in the shader. Only the concept tables hold two small facts: how the bloom intensity acts with the add and screen blends, and how many directions ambient occlusion's samples use.

## Corrected edit

Delete the three settings tables from docs/concepts/post-processing.md. In their place write "[The post-processing API](../api/post.md#bloom) lists the settings." (with `#ambient-occlusion` and `#screen-space-reflections` for the other two), as the page already does for depth of field. Before that, move the two facts that only the concept page has into the API page: in docs/api/post.md, `bloom.intensity` gets "With `'add'` and `'screen'`, a factor on the glow." and `ao.samples` gets "3 directions below 30, and 5 from 30." On the concept page, the reflections bullet at line 292 can say "or passes four fifths of `maxDistance`" so it matches the API page. Do not keep duplicate tables inside a `<details>` block: that hides the copy but keeps the drift risk.
