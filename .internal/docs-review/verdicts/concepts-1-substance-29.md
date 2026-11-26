# concepts-1-substance-29

## Finding as given

- Page: concepts/large-worlds
- Anchor: ## Limits, line 116 "A city of 20,000 objects per square kilometer reaches that most at about 420 km²"
- Category: wrong-claim
- Severity: low
- Claim: 420 km² at 20,000 objects per km² is 8.4 million objects, the most that only a device with large storage bindings holds. A device with WebGPU's default limits holds 2,097,152, which is about 105 km². The sentence does not say which device it means.
- Evidence: backends.md:138-144 (2,097,152 by default; 8,388,480 at most; 1,048,576 on the smallest WebGL2 textures).
- Proposed edit: "A city of 20,000 objects per square kilometer reaches a device's limit long before it fills the cells: at about 105 km² with WebGPU's default limits, and about 420 km² on a device that allows the most."

Verdict: partly

## Evidence

- docs/concepts/large-worlds.md:116 says "the most objects and rows that a scene can draw" and gives "about 420 km² of flat ground: about 420 cells". It names no device and does not link to the limits.
- docs/concepts/backends.md:138 gives 2,097,152 objects and rows with WebGPU's default limits. Line 140 gives at most 8,388,480 on a device with larger storage bindings. Line 144 gives 1,048,576 on WebGL2 with the smallest textures.
- 20,000 x 420 = 8,400,000, which is about 8,388,480. So the page's number is the best case, not the default. 2,097,152 / 20,000 = about 105 km². The finding's arithmetic holds.
- Additional error: large-worlds.md:30 and packages/engine/src/generated/core.ts:34 give cells 1,024 m wide, so one cell is about 1.05 km². 8,388,480 / 20,000 = 419 km², which is about 400 cells, not 420. At the default limit, 105 km² is about 100 cells.
- Problem in the proposed edit: "long before it fills the cells" is wrong for the best case. 512 cells cover about 537 km², and 420 km² is not far below that.

## Corrected claim

The sentence gives the best-case limit (about 8.4 million, on a device with large storage bindings) as if it held on every device. With WebGPU's default limits, the city reaches the limit at about 105 km² (about 100 cells). The cell count "about 420 cells" is also wrong: cells are 1,024 m wide, so 420 km² is about 400 cells.

## Corrected edit

Line 116, replace the second sentence with:

"A city of 20,000 objects per square kilometer reaches that most at about 105 km² of flat ground (about 100 cells) on a device with WebGPU's default limits, and at about 420 km² (about 400 cells) on a device that allows the most. `engine.capabilities.maxInstances` gives the number for the device ([The portable budget](backends.md#the-portable-budget))."
