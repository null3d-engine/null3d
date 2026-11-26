# Verdict for api-2-substance-12

## Finding as given

```json
{
 "page": "api/quality",
 "anchor": "### Moment transparency (lines 65-71)",
 "category": "structure",
 "severity": "medium",
 "claim": "The main paragraph on quality.set (line 71) and a line about anti-aliasing (69) sit under the 'Moment transparency' heading. A reader looking for quality.set will not find it under Settings.",
 "evidence": "docs/api/quality.md:59-71; stats.json headings for api/quality.",
 "proposedEdit": "Move line 71 up under ## Settings, after line 63, with a short example. Reduce Moment transparency to one entry in the fixed-settings row of the options table (line 50), with its link.",
 "generatedSource": "",
 "id": "api-2-substance-12",
 "slice": "api-2",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- docs/api/quality.md:59-71. Under `## Settings` the only subheading is `### Moment transparency` (line 65). Below it come the moment transparency paragraph (67), a one-line link about anti-aliasing modes on each GPU path (69), and the only paragraph that defines `quality.set` (71). The structure problem is real. The table of contents shows "Moment transparency" as the only child of Settings, so a reader who scans it does not guess that `quality.set` is defined there.
- Small overstatement: `quality.set` is still inside the `## Settings` section, because a `###` is a child of the `##`. The issue is the misleading subheading, not a missing Settings section.
- Nothing is lost if the subsection becomes a table entry. docs/concepts/quality-presets.md:208-210 covers the option, the `?moments=on|off` switch, that every preset leaves it off, and why. docs/api/materials.md:680-692 covers the layer and its cost. The `?moments=` switch is not in this page's switch table, but the linked section names it.
- The "short example" part is redundant. The page already shows `quality.set` at line 25 (top example) and line 94 (render scale example), and line 125 shows `quality.set({ governor: false })`. A third example adds length and no new information.
- The edit does not say where line 69 goes. It is about the `antialias` setting, so it does not belong after the `quality.set` paragraph either.
- stats.json puts the `quality.set` paragraph at 121 words and 7 sentences (stats line 64 = page line 71). Moving it unchanged keeps a long paragraph. Its last four sentences are edge cases: the `minRenderScale` above `maxRenderScale` rule, the bad `createEngine` option and preset name cases, and the lowest-tier cap rule. They suit a collapsible block.

## Corrected claim

The `### Moment transparency` subheading is the only subheading under Settings. It also holds the one paragraph that defines `quality.set` (line 71) and an unrelated anti-aliasing link (line 69). A reader who scans the headings does not find `quality.set`.

## Corrected edit

1. Delete the `### Moment transparency` heading and its paragraph (lines 65-67). In the options table row at line 50, link `momentTransparency` to [Quality presets](../concepts/quality-presets.md#moment-transparency). That section names the `?moments=` switch.
2. Move the anti-aliasing link (line 69) into the `antialias` row of the options table (line 49), for example "Replaces the preset's anti-aliasing mode: [GPU tiers and backends](../concepts/backends.md#color-and-anti-aliasing-on-each-tier)."
3. Put the `quality.set` paragraph directly after line 63, under `## Settings`. Add no new example, because the top example and the render scale example already show the call. Keep the first three sentences in the main text: what `quality.set` changes, when the change applies, and that a bad setting or value throws E1213 and changes nothing. Put the edge cases in a block after it:

```md
<details>
<summary>Technical details: other calls that throw, and the render scale's range</summary>

E1213 is also thrown for a `minRenderScale` above `maxRenderScale`, for a `createEngine` option with a value that its setting does not take, and for a preset name that `createEngine` does not know. To move both ends of the render scale's range past each other, give both in one call. In the [lowest quality tier](../concepts/quality-presets.md#the-lowest-quality-tier), a `minRenderScale` above the tier's cap on the scale raises the cap to it instead. Only a `maxRenderScale` that the sketch set itself throws.

</details>
```

The page is hand-written (docs/api/quality.md), so there is no generated source to edit.
