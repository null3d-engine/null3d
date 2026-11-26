# Verdict on concepts-2-readability-28

## The finding as given

- Page: concepts/quality-preset-tables
- Anchor: ## Settings of each preset (lines 44-94)
- Category: structure. Severity: medium.
- Claim: 49 rows in one ungrouped table. Related rows are apart: far-animation sits among the shadow rows, bloom size comes before Bloom, and the culling rows are spread. The 'Changes' column values ('during play', 'at the start', 'before loading') are only explained on quality-presets.md line 163.
- Evidence: Lines 54-58, 63-64, 77/86/88. Row order comes from settingRows() in packages/engine/src/quality/preset-docs.ts.
- Proposed edit: Add a group to each setting's doc entry (Resolution, Anti-aliasing and transparency, Shadows, Effects, Lighting and sky, Detail and culling, Textures and memory, Animation). Print one H3 and table per group in presetSettingsTable()/presetTablesPage(). Add a one-line key: 'During play: quality.set changes it at any time. At the start: fixed while the engine runs. Before loading: fixed before the engine loads.'
- Generated source: tools/lib/docs.ts (presetTablesPage, presetSettingsTable); packages/engine/src/quality/preset-docs.ts

Verdict: partly

## Evidence

- The table has 49 rows, page lines 46-94, under one H2 and no subheadings. True.
- Far-animation updates (line 56) sits between two shadow rows (55 and 57). True.
- Bloom's largest level (line 63) comes before Bloom (line 64). True.
- GPU occlusion culling (line 86) and software occlusion culling (line 88) have morph targets (line 87) between them. True. But line 77 (depth-fitted light clusters) is a lighting row, not a culling row. The level-of-detail rows (78-80) and the depth prepass (85) are also apart from the culling rows.
- Row order is the key order of the settings docs object (SETTING_DOCS, preset-docs.ts:52). settingRows() (preset-docs.ts:182-200) maps those keys in order. presetSettingsTable() (tools/lib/docs.ts:230-239) prints one table. presetTablesPage() (tools/lib/docs.ts:267-295) puts it under the H2.
- The Changes words come from CHANGE_DOCS (preset-docs.ts:204-208). This page never explains them. quality-presets.md:163 does. The page's line 11 says that page "explains these tables", so a reader has a route, but must leave the page. The proposed key matches line 163.
- Safety of the edit: the inbound links (quality-presets.md:165, api/quality.md:61, api/scene.md:177) all point at the H2 anchor #settings-of-each-preset. H3s under it keep that anchor. The test in tools/lib/docs.test.ts:236-260 checks single rows by text, and a grouped table keeps them. The test in presets.test.ts:292 checks that the key order of the settings docs object equals the row order. A group field does not break it.

## Corrected claim

49 rows in one ungrouped table. Related rows are apart: far-animation (line 56) sits among the shadow rows, bloom size (63) comes before Bloom (64), and GPU occlusion (86) and software occlusion (88) have morph targets between them, away from the level-of-detail rows (78-80). Line 77 (light clusters) is a lighting row, not a culling row. The Changes words are explained only on quality-presets.md:163. The page links there, but gives no key of its own.

## Corrected edit

The row order is only the key order of the settings docs object in packages/engine/src/quality/preset-docs.ts. So the smallest fix is to reorder those keys so related settings sit together. To add subheadings too, give each entry a group and let presetSettingsTable() in tools/lib/docs.ts print one H3 and one table per group, under the existing H2 so its anchor stays. Put the one-line key of the Changes words in presetTablesPage(), above the first table: "During play: `quality.set` changes it at any time. At the start: fixed while the engine runs. Before loading: fixed before the engine loads."
