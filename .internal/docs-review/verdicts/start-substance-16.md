# start-substance-16

## Finding as given

- page: index
- anchor: line 13 "A scene graph of 5,096 objects costs null3D 0.35 ms of CPU time per frame, and three.js 3.18 ms."
- category: wrong-claim
- severity: medium
- claim: The writing rules ask pages to name the engine's benchmark when they cite a figure. The home page names neither S2 nor the browser and machine, and it does not name the scene it loses (S1-static).
- evidence: README.md:152 (S2 0.35 vs 3.18 ms), README.md:156 (S1-static 0.20 vs 0.07 ms); docs/guides/performance.md:13.
- proposedEdit: "In S2, the engine's benchmark scene graph of 5,096 objects, null3D takes 0.35 ms of CPU time per frame and three.js 3.18 ms, in Chrome on a MacBook Pro. null3D loses S1-static, in which 100,000 boxes stand still."

Verdict: partly

## Evidence

- docs/index.md:13 cites 0.35 ms against 3.18 ms with no benchmark name and no browser or machine. It describes the lost scene ("100,000 boxes stand still") but does not name it. So the omission is real.
- AGENTS.md "Writing docs" says: "Name the engine's benchmarks when you cite a figure." The page breaks this rule.
- The figures themselves are correct. README.md:152 and docs/porting/threejs-overview.md:34 both give S2 as 0.35 ms against 3.18 ms. So "wrong-claim" is the wrong category: nothing on the page is false. It is a rule breach and a missing context, and it misleads nobody, so it is low to medium, not a wrong claim.
- The docs already hold a named table with the conditions: docs/porting/threejs-overview.md:30-40 ("What gets faster": S1, S1-static, S2, S4, S5, Chrome on a MacBook Pro, WebGPU). The home page does not link to it. It links only to the performance guide, whose line 13 has no table.
- The proposed edit breaks the 25-word sentence rule. Its first sentence has 29 words. It also puts the bare code name "S2" first, with no link to where a reader can see the other scenes.

## Corrected claim

The home page cites the S2 figure without naming the benchmark or its browser and machine, which breaks the rule to name the benchmark. The figures are correct, so this is a rule breach (low to medium), not a wrong claim. The page should also point to the named table that already exists in the porting overview.

## Corrected edit

Replace the second and third sentences of the "Faster than three.js" item, and extend its link sentence:

"null3D beats three.js in five of its six benchmark scenes. In the S2 benchmark, a scene graph of 5,096 objects, null3D takes 0.35 ms of CPU time per frame. three.js takes 3.18 ms. Both figures come from Chrome on a MacBook Pro. null3D loses S1-static, in which 100,000 boxes stand still. [What gets faster](porting/threejs-overview.md#what-gets-faster) lists the benchmark figures, and the [performance guide](guides/performance.md) shows how to keep your own scene fast."
