# concepts-1-substance-19

## Finding as given

- page: concepts/architecture, concepts/backends, concepts/culling
- anchor: architecture line 92 "On a device that draws directly"; backends line 35 "each bucket draws directly"; culling line 38 "The probe takes the direct path"
- category: term-before-definition
- severity: medium
- claim: The architecture page is the entry page. It uses 'draws directly' with no explanation, and backends explains it only at line 118. The word 'bucket' means what the pages elsewhere call a 'group'. 'The probe' in culling means a start-up worker that only architecture names.
- evidence: backends.md:118; architecture.md:43.
- proposedEdit: Architecture line 92: 'On an Apple GPU in Safari, a start-up test can pick direct draws, where the job workers cull on the CPU as on WebGL2 ([GPU tiers and backends](backends.md#capability-flags)).' Write 'group' for 'bucket' in backends line 35 and culling line 38. Culling line 38: 'The start-up test takes the direct path...'.

Verdict: partly

## Evidence

- architecture.md:92 says "On a device that draws directly, the job workers cull on the CPU, as on WebGL2." Nothing on the page says which device that is or what a direct draw is. Line 43 says only that the probe worker "measures the two draw paths" on an Apple GPU in WebKit, and it does not name the paths. This part of the claim holds.
- backends.md:35 already brings in the term before line 118. It contrasts the default path (the engine replays recorded draws and the GPU fills in each draw's count) with "a direct-draw path ... where the job workers cull on the CPU". It links to culling. So "backends explains it only at line 118" is wrong. Line 118 gives the reason (WebKit checks each indirect draw at a fixed cost) and the device rule, but line 35 gives the meaning.
- "bucket" holds. backends.md:35 says "group" earlier in the same paragraph and then "each bucket" with no definition. culling.md:36 defines "group" ("the objects that share a mesh and a material"), and culling.md:38 then says "the WebGPU layout's own buckets" and "Each bucket". No other docs page uses "bucket".
- "The probe" holds. culling.md:38 says "a start-up measurement" and then "The probe takes the direct path". Culling never names a probe. Only architecture.md:43 names the probe worker. A reader can guess the link, but the noun changes for no reason.
- The proposed edit has a factual error. It says "On an Apple GPU in Safari". The code (packages/engine/src/gpu/webgpu/draw-path-probe.ts:59) and backends.md:118 say an Apple GPU in WebKit: Safari, or any browser on iPhone and iPad. culling.md:38 says the same. The edit drops Chrome and other browsers on iPhone and iPad. It also still does not say what a direct draw is.
- The anchor backends.md#capability-flags exists (backends.md:100, which holds line 118). It is the right target.

## Corrected claim

architecture.md:92 uses "a device that draws directly" with no definition and no link to where the term is explained. backends.md:35 defines the direct-draw path briefly, and backends.md:118 explains why it exists. backends.md:35 and culling.md:38 say "bucket" where the same paragraphs, or the paragraph before, say "group". culling.md:38 says "The probe" after it has called the same thing "a start-up measurement".

## Corrected edit

- architecture.md:92, last sentence: "On an Apple GPU in WebKit (Safari, or any browser on iPhone and iPad), a start-up test can pick direct draws instead. The CPU then gives each draw its count, so the job workers cull on the CPU, as on WebGL2 ([GPU tiers and backends](backends.md#capability-flags))."
- backends.md:35: "... where the job workers cull on the CPU and each group draws with the count they found ([Culling](culling.md#how-each-path-culls))."
- culling.md:38: "They use the WebGL2 culling on the WebGPU path's own groups. Each group then draws with its known count. The start-up measurement takes the direct path only when ..."
