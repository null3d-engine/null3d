# Verdict on api-1-substance-13

## The finding as given

```json
{
 "page": "api/animation",
 "anchor": "### Load cost line 52; ### Limits of skinning line 446",
 "category": "term-before-definition",
 "severity": "medium",
 "claim": "'the S5 benchmark' appears with no explanation, and 'the engine's test page' names no test or machine. AGENTS.md asks docs to name the benchmark when citing a figure.",
 "evidence": "docs/api/animation.md:52, 446; docs/porting/threejs-overview.md:36 ('S5: 500 animated characters with shadows').",
 "proposedEdit": "Line 446: 'In the S5 benchmark (500 animated knights with shadows, see the porting overview), a knight takes ...'. Line 52: name the machine and the measurement, or say 'On a desktop with two job workers'.",
 "generatedSource": "",
 "id": "api-1-substance-13",
 "slice": "api-1",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- docs/api/animation.md:446 says "a knight of the S5 benchmark takes 20 bytes per vertex, so its 500 knights of about 5,000 vertices take about 50 MB". S5 is not defined or linked on this page. But the same sentence already gives what the memory figure needs: 500 knights of about 5,000 vertices. Only the label "S5" is opaque. The rule in AGENTS.md:231 ("Name the engine's benchmarks when you cite a figure") is met here, because the benchmark is named. The proposed edit repeats "500 knights" in one sentence. Shadows do not change this memory figure.
- The only place a reader can learn what S5 is: docs/porting/threejs-overview.md:36, in the benchmark table of "What gets faster". The same unlinked label is on docs/guides/performance.md:210.
- docs/api/animation.md:52 says "On the engine's test page, the KayKit Knight's 76 clips took 16.5 ms on two job workers". This figure names no benchmark and no machine, so the AGENTS.md:231 point holds for this line. The worker count is already there. So the fallback edit "On a desktop with two job workers" adds only the vague word "desktop". The source measurement (an internal record of the asset tool) does not give the machine either. So the writer must find it or say what kind of computer it was.
- The same figure and the same phrase are on docs/guides/assets-pipeline.md:105. "The engine's test page" is also on getting-started/hosting.md:267 and guides/start-time.md:58, 134 and 320, and no page defines it. A fix on this page alone leaves the other pages inconsistent.
- Severity: medium is too high. Neither line misleads a reader or makes the page clearly harder to use. Line 446 explains itself in the same sentence. Line 52 is a side figure in a section whose point (optimized files load faster) is clear without it. Low (polish) fits.

## Corrected claim

Low severity. Line 446 names the S5 benchmark but does not link it. The sentence already gives the knight and vertex counts, so the only gap is the opaque label. Line 52 cites a timing from "the engine's test page" with no machine named. That breaks the rule to name the benchmark or measurement behind a figure. The same gaps are on guides/assets-pipeline.md:105 (same figure) and guides/performance.md:210 (S5 label).

## Corrected edit

- Line 446: link the label and do not repeat the count: "With `?skinning=compute`, a knight of the [S5 benchmark](../porting/threejs-overview.md#what-gets-faster) takes 20 bytes per vertex, so its 500 knights of about 5,000 vertices take about 50 MB." Make the same link on guides/performance.md:210.
- Line 52 and guides/assets-pipeline.md:105: name the computer and browser of the measurement, as the porting overview does ("in Chrome on a MacBook Pro"). Keep "two job workers". Do not use the vague "On a desktop".
