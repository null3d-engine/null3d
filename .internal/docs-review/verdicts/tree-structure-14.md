# tree-structure-14

## Finding as given

```json
{
 "page": "api/scene",
 "anchor": "## The environment",
 "category": "split-page",
 "severity": "medium",
 "claim": "api/scene (8,672 words, 28 long paragraphs) holds the whole environment API beside object creation.",
 "evidence": "api/scene sections: The environment | The light probe grid | Reflection probes | Fog | Time of day, between 'Multiple views' and 'Lights'.",
 "proposedEdit": "Split those five sections into api/environment NEW in the 'Scene and objects' group, with @category api/environment on their symbols.",
 "generatedSource": "tools/lib/docs.ts (PAGES); @category tags in packages/engine/src",
 "id": "tree-structure-14",
 "slice": "tree",
 "role": "structure"
}
```

Verdict: partly

## Evidence

- docs/api/scene.md is a hand-written page (registered in PAGES at tools/lib/docs.ts:52). Size and long-paragraph count are from stats.json and hold.
- The five sections exist in the order given: The environment (line 327), The light probe grid (343), Reflection probes (414), Fog (454, with Volumetric fog at 490), Time of day (516), then Lights (553). Together they are about 3,170 words.
- The split boundary is incomplete. Under "The camera and the background" (113) sit "Environments, cube maps and the sky" (131), "The physical sky" (204) and "Sky layers" (250), about 2,460 more words. They describe the sky, atmosphere and environment backgrounds. "The environment" uses `assets.skyEnvironment`, whose map follows the sky background; "Time of day" passes `day.sky` and `day.atmosphere` to `setBackground`. Moving only the five sections would split the sky from the code that drives it, and the new page would link back to api/scene for every example.
- There is no "Scene and objects" group. AREAS (tools/lib/docs.ts:59-69) has one API heading, "API reference" (area `api`); a page with id `api/environment` goes there.
- `@category` tags mark exports, not class members. The calls `setBackground`, `setEnvironment`, `setFog`, `setLightProbeGrid` and the probe call are methods of the `Scene` class (packages/engine/src/scene/scene.ts:3603), so they stay on reference/scene. The option and result types live in their own files (scene/background.ts, environment.ts, fog.ts, light-probes.ts, probes.ts, time-of-day.ts) and can be retagged, so a reference/environment page is feasible for them.

## Corrected claim

api/scene (8,672 words, 28 long paragraphs) holds the whole environment API beside object creation: the sky and environment backgrounds (lines 131-299) and the five sections from "The environment" to "Time of day" (327-552), about 5,600 words in all.

## Corrected edit

Create docs/api/environment.md (title "Sky, environment and fog") and add it to PAGES in tools/lib/docs.ts next to api/scene, in the "API reference" area. Move into it the three sky subsections under "The camera and the background" (keep color and texture backgrounds in api/scene) and the sections "The environment", "The light probe grid", "Reflection probes", "Fog" (with "Volumetric fog") and "Time of day". In api/scene, keep one short paragraph under "The camera and the background" that says `setBackground` also takes a sky, an atmosphere or an environment and links to the new page; update both PAGES summaries and the Related pages lists. Add `@category api/environment` to the exports of scene/background.ts (sky and atmosphere types), environment.ts, fog.ts, light-probes.ts, probes.ts and time-of-day.ts. The `Scene` methods stay on reference/scene; the new page links to them there.
