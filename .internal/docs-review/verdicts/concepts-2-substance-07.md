# concepts-2-substance-07

## Finding as given

- page: concepts/quality-preset-tables, concepts/quality-presets
- anchor: ## Settings of each preset: rows depthPrepass (line 85), gpuOcclusion (line 86), bloom (line 64)
- category: unclear; severity: medium
- claim: "Depth prepass: no (WebGL2: yes)" reads as no prepass on WebGPU. But bounce light (on by default at High and Ultra) and contact shadows turn it on, so a desktop at High draws it in every scene. "GPU occlusion culling: yes" on High and Ultra holds for desktops only. "Bloom: yes" reads as "presets turn bloom on", but the row only allows the bloom that post.set turns on, and the lowest tier clears it.
- proposedEdit: notes under the table for depth prepass and GPU occlusion; rename the bloom row "Bloom allowed (bloom)" with a note on post.set and the lowest tier.
- generatedSource: packages/engine/src/quality/preset-docs.ts, tools/lib/docs.ts

Verdict: partly

## Evidence

- The code claims are right. presets.ts:243-251 sets `depthPrepass` false on every WebGPU preset and says effects draw the prepass anyway. chooser.ts:57-68 (`gpuOcclusionChoice`) and engine.ts:2661-2666 force GPU occlusion off on phones and tablets unless the page asks. presets.ts:174-181 says the `bloom` setting is true "while the sketch draws bloom's glow, which it turns on through `post.set`".
- The depth prepass and GPU occlusion parts are already handled on the page that the table page names as its explainer. The tables page opens with "[Quality presets](quality-presets.md) explains these tables" (quality-preset-tables.md:11). quality-presets.md:220 says that ambient occlusion, contact shadows, bounce light and screen-space reflections turn the prepass on, "So High and Ultra draw it on WebGPU outside compatibility mode". quality-presets.md:237 says "High and Ultra turn it on for desktops. Phones and tablets keep it off on every preset." The proposed notes copy those sentences.
- The table values are also correct as setting values: `quality.settings.depthPrepass` stays false on WebGPU. The "Starting preset of each device" table on the same page shows phones and tablets never start at High. So the rows mislead only a reader who reads the table alone and forces a phone to High. That is medium at most for these two rows, and low given the explainer link.
- The bloom part holds. No page explains that the `bloom` row only permits bloom that the sketch turns on. quality-presets.md mentions bloom only at lines 305, 321 and 323 (governor and lowest tier). post-processing.md:97-107 covers `post.set({ bloom })` and `bloomSize`, not the quality flag. Only the API reference (api/reference/quality.md:158) says it.
- The bloom note about the lowest tier is not needed in the table. The lowest tier also turns off sun shadows, lowers the render scale floor and reflection scale (quality-presets.md:321), and the table notes none of those either. The table lists preset values; the tier has its own section.
- The rows are generated from SETTING_DOCS in packages/engine/src/quality/preset-docs.ts. The table renderer (tools/lib/docs.ts, section at line 291) has no per-row note field, so "notes under the table" need new generator code. A label or print change in preset-docs.ts is the smaller fix.

## Corrected claim

The bloom row "Bloom (`bloom`) yes" reads as "every preset turns bloom on", but the setting only lets bloom draw after the sketch turns it on with `post.set`, and no docs page except the API reference says so. The depth prepass and GPU occlusion rows are correct as setting values, and the linked explainer (quality-presets.md:220 and 237) already states the effects that draw the prepass on WebGPU and the desktop-only rule for GPU occlusion. Severity: low.

## Corrected edit

In packages/engine/src/quality/preset-docs.ts:
- Change the bloom label to "Bloom, when the sketch turns it on" (or "Bloom allowed"). Drop the lowest-tier note: the tier has its own section.
- Optionally change the GPU occlusion label to "GPU occlusion culling (WebGPU, desktops)", which needs no new generator code.
- Optionally add one generated line under the settings table: "The effects that read depth draw the depth prepass on WebGPU too, and phones and tablets keep GPU occlusion culling off: [the depth prepass](quality-presets.md#the-depth-prepass), [GPU occlusion culling](quality-presets.md#gpu-occlusion-culling)." Do not repeat the explainer's sentences in full.
