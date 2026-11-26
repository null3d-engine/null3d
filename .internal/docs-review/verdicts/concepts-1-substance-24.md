# concepts-1-substance-24

## Finding as given

```json
{
 "page": "concepts/culling,concepts/architecture",
 "anchor": "culling line 159 \"in S6, its benchmark city\"; line 196 \"The benchmark scene S1-cells\"; architecture line 124 \"In the S1 benchmark\"",
 "category": "unclear",
 "severity": "low",
 "claim": "The pages cite benchmarks by code name only. A reader learns nothing from 'S1' or 'S6'. The S1-cells sentence gives no figure at all.",
 "evidence": "architecture.md:124; culling.md:159, :196.",
 "proposedEdit": "Describe each benchmark where it is cited, such as 'the engine's S1 benchmark, 100,000 moving boxes'. Delete the S1-cells sentence or move it into a block.",
 "generatedSource": "",
 "id": "concepts-1-substance-24",
 "slice": "concepts-1",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- architecture.md:124 "In the S1 benchmark on an iPad Pro with WebGPU, it showed about a third fewer frames than pipelined mode." The page never says what S1 is. This part holds. The description exists only in guides/performance.md:46 ("S1 has 100,000 boxes, and its `onUpdate` moves every box in every frame"), and architecture.md does not link there from this sentence.
- culling.md:159 "The engine measured it in S6, its benchmark city, on three Android phones and an iPad". The sentence already says what S6 is: a city. So "code name only" is wrong here. It could still say the city's size, but the cost to a reader is small.
- culling.md:196 "The benchmark scene S1-cells spreads 100,000 still boxes over 8 x 8 cells and flies the camera low over them." The sentence describes the scene in full, so it is not a bare code name. The finding is right that it gives no result: the reader learns the setup but not what the cells saved. The figures exist in guides/performance.md:241-246 (section "Large worlds": WebGL2 CPU time 0.21 ms to 0.07 ms, visible list 1,517 to 79 entries; WebGPU culling pass 0.039 ms to 0.025 ms). culling.md does not link to that section (its only performance link is at :38).
- The proposed fix for :196 is weak. Deleting the sentence drops the only pointer from the concept page to the measured gain. A block would hold one sentence with no dense detail. A link to the figures that already exist is the better fix and follows the docs rule to link, not repeat.
- The code names S1 to S6 are the engine's public benchmark names, used across guides/performance.md, phones.md and loading-screens.md. They are not internal process words, so keeping the name beside a short description is fine.

## Corrected claim

architecture.md:124 cites the S1 benchmark by code name with no description and no link. culling.md:159 already names S6 as the benchmark city. culling.md:196 describes the S1-cells scene but gives no result and does not link to the figures in the Performance guide's "Large worlds" section.

## Corrected edit

- architecture.md:124: "In the S1 benchmark, 100,000 boxes that move in every frame, on an iPad Pro with WebGPU, ..." and optionally link to ../guides/performance.md#where-frame-time-goes.
- culling.md:196: keep the sentence and add "The [Performance guide](../guides/performance.md#large-worlds) gives what the cells saved in it." Do not delete it, and do not put it in a block.
- culling.md:159: no change needed. Optionally add the city's size if the source has it.
