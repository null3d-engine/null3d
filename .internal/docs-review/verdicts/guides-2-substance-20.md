# guides-2-substance-20

## Finding as given

- page: guides/performance
- anchor: line 13: 'it beats three.js in five of its six benchmark scenes'
- category: missing-content
- severity: medium
- claim: The page never names the scene that null3D loses. It shows that scene's figures (S1-static, line 192) without saying it is the loss. A reader who builds a scene of still objects needs to know.
- evidence: docs/index.md:13 'The engine loses one scene, in which 100,000 boxes stand still'; bench/lib/report.test.ts:290 (s1-static 'is not faster than three.js's faster renderer at these object counts').
- proposedEdit: After line 13: 'It loses S1-static, in which 100,000 boxes stand still, to three.js's fastest renderer at some object counts ([Moving objects cost uploads](#moving-objects-cost-uploads)).' Add the reason in one sentence if one is known.

Verdict: partly

## Evidence

- docs/guides/performance.md:13 says "five of its six benchmark scenes" and never names the sixth. The page mentions S1-static only at line 192 (section "Moving objects cost uploads", line 190) and line 241. Neither says it is the lost scene, and the page gives no three.js figure for it. The page has no link to docs/porting/threejs-overview.md. So the omission holds.
- The loss is named elsewhere, but not on this page or in a page it links for this point: docs/index.md:13 ("The engine loses one scene, in which 100,000 boxes stand still"), docs/porting/threejs-overview.md:38-40 (S1-static: null3D 0.20 ms, three.js 0.07 ms; "Any WebGPU frame costs about 0.075 ms of CPU time in Chrome, even an empty one"), README.md:156-160 (same table and reason).
- The finding's code evidence is weak. bench/lib/report.test.ts:282-290 is a unit test of the report formatter with made-up numbers (0.1 ms, 0.27 ms and so on). It does not show a real result. So "at some object counts" in the proposed edit has no real source. The published figures compare one count: 100,000 boxes, against three.js's WebGL renderer.
- The reason is known: a fixed CPU cost of about 0.075 ms for any WebGPU frame in Chrome, against about 0.07 ms for three.js's WebGL renderer on the still boxes (README.md:159, threejs-overview.md:40).
- Side point: line 192 gives S1-static 0.07 ms (WebGPU) and 0.05 ms (WebGL2) in a production build. The comparison table on threejs-overview.md gives null3D 0.20 ms. Without a note, a reader who sees both may not know which figure loses. The new sentence should say which figure it compares.
- Severity: medium is fair at most. The gap is a fraction of a millisecond and does not block a reader. But the opening makes a claim and hides the one exception, so it is right to add it.

## Corrected claim

The performance guide says null3D wins five of six benchmark scenes, but never names the one it loses (S1-static, 100,000 still boxes) or why. The loss and its reason are on docs/index.md and docs/porting/threejs-overview.md, which this page does not link for this point. The finding's code evidence (bench/lib/report.test.ts) is a formatter test with made-up numbers, so "at some object counts" is not supported.

## Corrected edit

Put the exception in the section that already shows the S1-static figures, so the opening paragraph does not grow. At the end of the S1-static paragraph in "Moving objects cost uploads" (line 192), add:

"S1-static is the one benchmark scene that three.js wins. Any WebGPU frame in Chrome costs about 0.075 ms of CPU time, even an empty one, and three.js's WebGL renderer draws the still boxes in about 0.07 ms. [Porting from three.js](../porting/threejs-overview.md) has the full comparison."

Then change line 13 to point to it: "...and it beats three.js in five of its six benchmark scenes ([the one it loses](#moving-objects-cost-uploads))."

Use the link text that the target page's title gives.
