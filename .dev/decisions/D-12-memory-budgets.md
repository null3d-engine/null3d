# D-12: Memory budgets per preset

Status: decided for the texture budgets, 2026-10-03. The iPad's WebAssembly row is pending. Task: M1-L3. Test: T-25.

## Question

How much GPU texture memory may each quality preset plan for, and how large a WebAssembly memory maximum may it declare? Phone and tablet browsers close a tab that uses too much memory. The presets' values must keep a scene well below that point on the weakest device that each preset serves.

## Rule

Each preset's texture budget and WebAssembly maximum stay under half the lowest failure point measured on the weakest device that the preset serves. [D-04](D-04-memory-maximum.md) sets the default maximum at 1024 MiB, and lets a page ask for up to 4096 MiB.

## Data

The device runner's `tab-memory` plan grows one kind of memory in one tab, in steps of 32 MiB, until something gives. Each step allocates and fills its memory with data that does not compress, and waits until the GPU has taken it. After each step that lived, the page posts its progress to the dev server. So the run keeps the last step when the browser closes the tab. [Device sessions](../devices.md#the-tab-memory-plan) describes the plan.

The failure point of a growth is the step after the last that lived. Each growth ran once, alone, in a new page.

| Growth | iPad Pro 11-inch, Safari 26.6 | S24+, Chrome 154 | S24+, Brave, Shields on |
| --- | --- | --- | --- |
| GPU textures, WebGPU | 2016 MiB: tab closed | no WebGPU | no WebGPU |
| GPU buffers, WebGPU | 512 MiB: the step gave no answer for a minute | no WebGPU | no WebGPU |
| GPU textures, WebGL2 | 2528 MiB: tab closed | 7296 MiB: tab closed | 7808 MiB: tab closed |
| GPU buffers, WebGL2 | 2496 MiB: tab closed | 7616 MiB: tab closed | 7808 MiB: WebGL2 context lost |
| WebAssembly memory | no result | lived to the 4096 MiB cap | lived to the 4096 MiB cap |

The lowest failure point on each device:

- iPad: 2016 MiB of GPU textures, on WebGPU. Its WebGPU buffers stalled at 512 MiB, but buffers are not a preset value (see below).
- S24+: 7296 MiB of GPU textures, on WebGL2 in Chrome.

Other findings:

- Each tab died within a minute of its first step: the iPad's in 9 to 11 s, and the S24+'s in 38 to 48 s. No growth got a refused allocation or a warning first. The browser closed the tab, or once lost the WebGL2 context.
- On the iPad, GPU textures and buffers on WebGL2 failed within 32 MiB of each other. So one limit on the tab's GPU memory seems to hold for both kinds.
- On the iPad, the WebGPU buffer growth stopped at its 16th step. The GPU never reported the step's work as done (`onSubmittedWorkDone`), and the tab stayed open. The WebGL2 buffers on the same iPad lived to 2464 MiB. The step ran one minute after a texture growth had crashed the tab, so the GPU process may not have recovered yet. One run cannot tell.
- The iPad's WebAssembly growth has no result. Safari reloaded the runner page after the first two tab crashes, but not after the third, so the run stopped before that step. [Device sessions](../devices.md#the-tab-memory-plan) says how the plan now runs on the iPad.

How the data was produced: on 2026-10-02, `bun tests/real-browsers.ts --plan tab-memory --allow-no-webgpu --android chrome`, run 20261002-184211-tab-memory. Then the same with `--android brave --shields on`, run 20261002-184858-tab-memory, and with `--lan ipad-safari`, run 20261002-185931-tab-memory. The iPad is the one of D-04, whose RAM Safari does not report. The S24+ has 12 GB.

## Decision

**Texture budgets.** Keep the planned budgets: Low 256 MiB, Medium 512 MiB, High 1024 MiB and Ultra 2048 MiB. Phones start at Low and tablets at Medium, and the preset check can lower a tablet to Low. The iPad is the weakest device measured, so it sets the limit for both presets: half its lowest point is 1008 MiB. Low uses a quarter of that, and Medium half. That leaves room for the scene's buffers, render targets and WebAssembly memory, which share the device's memory. On the S24+, every preset meets the rule (half of 7296 MiB is 3648 MiB).

High and Ultra start only on desktops, which T-25 did not measure. On the iPad, High's 1024 MiB is just over half its lowest point, and Ultra's 2048 MiB is past the point itself. A page can name either preset on a tablet.

**WebAssembly maximum.** Keep D-04's 1024 MiB on every preset. On the S24+, both browsers filled the cap of 4096 MiB, so the rule allows more than 2048 MiB there. On the iPad the rule is not checked. If the iPad's WebAssembly point is under 2048 MiB, then 1024 MiB breaks the rule for Medium and Low there.

**GPU buffers.** The presets set no buffer budget. Until a rerun shows whether the stall repeats, keep a scene's GPU buffers on the iPad's WebGPU path under 256 MiB, half the stall point.

**Shadow maps.** Pending. The shadow maps share the GPU memory that the texture budget plans for. M1-G6 sets each preset's shadow cascades and map size in pull request #215. That pull request adds each preset's shadow map memory to this record. Its rows wait for #215's device reruns. Its proposed values add at most 8 MiB on Low and 48 MiB on Medium. Both fit well inside the room under 1008 MiB.

## How three.js handles it

three.js sets no memory budget. `renderer.info.memory` counts the geometries and textures that the renderer holds, but not their bytes. An app that runs out of memory on a phone learns of it when the browser closes the tab. null3D sets each preset's WebAssembly maximum, and plans its texture budget, from the failure points above. A scene that keeps within its preset then stays under half of what the weakest measured device survived. The engine does not apply the texture budget yet (see "Consequences").

## Consequences

- `memoryMaximumMiB` in `packages/engine/src/quality/presets.ts` stays 1024 MiB on every preset. The planned `textureMemoryMiB` in `preset-docs.ts` keeps its values.
- The task that builds the texture budget caps it on phones and tablets, whatever preset a page names. The cap is 1008 MiB, under half the iPad's point. A page that sets `textureMemoryMiB` itself still gets its own value.
- Run the iPad's WebAssembly step with someone at the iPad: `bun tests/real-browsers.ts --plan tab-memory --lan ipad-safari --attended --only tab-memory-wasm-1`. Start from a Safari that was quit and opened again. If the point is under 2048 MiB, lower Medium's and Low's maximum to under half of it.
- Rerun `--only tab-memory-buffer-webgpu-1` on the iPad in the same way, to see whether its WebGPU buffer stall repeats.
- A 4 GB iPad, if one becomes available, runs the whole plan. D-04 left T-07 open for one, and it may fail at about half the iPad Pro's points.
- [Phones and tablets](../../docs/guides/phones.md#memory) gives the measured points.
- T-25 closed on 2026-10-03 with the failure points.
- The record is in the table in README.md.

## Each preset's memory (M1-G6)

M1-G6 tuned the shadow settings of each preset (D-11), and their shadow maps share the GPU memory that the texture budget plans for. The table gives each preset's planned GPU memory, and the WebAssembly maximum:

| Preset | Serves | Texture budget | Shadow maps | WebAssembly maximum | Under half the lowest point of its devices |
| --- | --- | --- | --- | --- | --- |
| Low | Phones, and tablets that the preset check lowers | 256 MiB | 8 MiB: 2 cascades of 1,024 texels | 1024 MiB | Yes: 268 of 1008 MiB on the iPad |
| Medium | Tablets | 512 MiB | 48 MiB: 3 cascades of 2,048 texels | 1024 MiB | Yes: 568 of 1008 MiB on the iPad |
| High | Desktops | 1024 MiB | 48 MiB | 1024 MiB | Not measured on desktops |
| Ultra | Desktops, when a page asks | 2048 MiB | 256 MiB: 4 cascades of 4,096 texels | 1024 MiB | Not measured on desktops |

The shadow atlas of spot and point lights holds `shadowTiles` tiles of `shadowTileSize` texels, 4 bytes each. It adds at most 4 MiB on Low, 8 MiB on Medium, 64 MiB on High and 96 MiB on Ultra. The last column counts it.

The WebAssembly column checks only on the S24+, as the iPad's step has no result yet. The texture budget stays a planned setting: the engine counts each texture's GPU memory, but no preset applies a budget to it yet. M1-G6 keeps every value above, and the cap of 1008 MiB on phones and tablets stays for the task that builds the budget.
