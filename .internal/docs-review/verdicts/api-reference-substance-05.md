# api-reference-substance-05

## Finding as given

- Page: api/reference/engine
- Anchor: engine.md:17 `CapabilityReport`; engine.md:620 `adapterInfo`; engine.md:130, :618 `directDraws`
- Category: contradiction. Severity: high.
- Claim: CapabilityReport says the engine "never decides from browser or GPU names", and adapterInfo says "the engine reads no meaning from it". The same page says the draw-path probe runs only on an Apple GPU in WebKit, and that it detects a software renderer. The engine finds both from the adapter's reported names.
- Evidence given: packages/engine/src/page/capabilities.ts:121,176,186; packages/engine/src/shared/webkit.ts:60-76; packages/engine/src/shared/software.ts:1-13.
- Proposed edit: Rewrite the CapabilityReport summary: "The engine picks its build and GPU path from these feature tests, and its quality preset from the device hints. It reads a device name in two cases only: to find an Apple GPU in WebKit, where it measures the draw path, and to find a software renderer." Rewrite adapterInfo to match.
- Generated source: packages/engine/src/page/capabilities.ts

Verdict: partly

## Evidence

The contradiction is real, and it is wider than the finding says.

- engine.md:17 (source capabilities.ts:184-186): "It never decides from browser or GPU names."
- engine.md:620 (capabilities.ts:121-124) for `adapterInfo`, and engine.md:599 (capabilities.ts:175-178) for `WebGL2Report.renderer`: "The engine reads no meaning from it".
- GPU names are read:
  - gpu/webgpu/draw-path-probe.ts:94-95 skips the probe from the adapter's names: software renderer, then `appleGpuInWebKit` (shared/webkit.ts:60-76 tests vendor, architecture and description for "apple").
  - page/limits.ts:482 sets `softwareRenderer` from `softwareRenderer(report)`, which reads `report.webgpu.adapterInfo` AND `report.webgl2.renderer` (shared/software.ts). So the `renderer` field at engine.md:599 is contradicted too, which the finding misses. The flag also keeps the whole render scale once a smaller step failed (software.ts header), so it is not only a draw-path matter.
- Browser names (the user agent) are read too, so "never decides from browser names" is false in three places, not one:
  - page/browser-check.ts:20-31 refuses Apple WebKit before Safari 18 (E1306) from the user agent.
  - gpu/webgpu/indirect-arguments.ts:35-38 copies indirect draw arguments in every Apple WebKit, by user agent.
  - shared/webkit.ts:75 uses the user agent to tell WebKit from Chrome on the same Mac.
- AGENTS.md rule 14 (line 115-121) records these same exceptions, so the code is intended; the doc comments are what is wrong.

## What is wrong with the finding

1. It misses the second "reads no meaning" claim, on `WebGL2Report.renderer` (engine.md:599, capabilities.ts:175-178). The software-renderer test reads it.
2. The proposed summary still implies the engine reads names in "two cases only". It omits the user-agent checks: the Safari version check at start and the WebKit indirect-argument workaround. A reader who trusts "two cases only" is misled again.
3. "The engine finds both from the adapter's reported names" is only half right for the Apple case: the GPU comes from adapter names, but WebKit comes from the user agent. The software renderer also comes from the WebGL2 renderer string.
4. Side note on the same rewrite: engine.md:618 (capabilities.ts:112-116) cites "(D-174)", a decision record number, which published docs must not hold. The rewrite of `directDraws` should drop it.

## Corrected claim

CapabilityReport says the engine never decides from browser or GPU names, and both `adapterInfo` and `WebGL2Report.renderer` say the engine reads no meaning from them. The code reads names in several places: the adapter's names (and the WebGL2 renderer) to find a software renderer, which keeps the current draw path and the full render scale; the adapter's names plus the user agent to find an Apple GPU in WebKit, the only place the draw-path probe runs; and the user agent alone to refuse Safari before 18 and to copy indirect draw arguments in WebKit.

## Corrected edit (in packages/engine/src/page/capabilities.ts)

CapabilityReport summary:

"What the browser and device can do, as plain JSON. The engine picks its build and GPU path from these feature tests, and its quality preset from the device hints. It reads browser and GPU names only for a few known faults and limits: see `adapterInfo` and `webgl2.renderer`."

Then a collapsible block under it (keeps the dense detail for implementers):

<details>
<summary>Technical details: where the engine reads names</summary>

- A software renderer, found from the WebGPU adapter's names or the WebGL2 renderer string, keeps the engine's current draw path, and keeps the full render scale once a smaller step failed.
- The draw-path probe runs only on an Apple GPU, found from the adapter's names, in Apple's WebKit, found from the user agent.
- The user agent refuses Apple WebKit before Safari 18 (E1306), and turns on a copy of indirect draw arguments in WebKit.

</details>

`adapterInfo` and `WebGL2Report.renderer`:

"The device's reported names. The engine reads them to find a software renderer (and, for the adapter, an Apple GPU for the draw-path probe), and compares them with an earlier start's to tell whether a stored preset check came from the same GPU."

`directDraws` (capabilities.ts:112-116): drop "(D-174)".
