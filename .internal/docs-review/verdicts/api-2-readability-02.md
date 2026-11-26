# Verdict: api-2-readability-02

## Finding as given

- page: api/quality
- anchor: ### Moment transparency, lines 65-71
- category: structure
- severity: high
- claim: quality.set, the page's main call, has no heading of its own. Its paragraph (line 71) and an unrelated anti-aliasing link (line 69) sit under the H3 'Moment transparency', so a reader who scans for how to change a setting finds nothing.
- evidence: line 65 '### Moment transparency'; line 69 '[GPU tiers and backends]... compares the anti-aliasing modes'; line 71 '`quality.set(settings)` changes the settings it gets and keeps the others.'
- proposedEdit: Add '## Changing settings during play' before line 71, with quality.set as a short list: what it takes, when it applies, what throws E1213. Move the anti-aliasing link to the end of '## Settings'. Keep Moment transparency as the last part of Settings, or fold it into two sentences that link to the materials page.

Verdict: partly

## Evidence

- docs/api/quality.md:65 is `### Moment transparency`. Lines 69 (anti-aliasing link) and 71 (the `quality.set` paragraph) come after it, and the next heading is `## Switching presets` at line 73. So in the rendered outline the `quality.set` text sits under "Moment transparency". The structure claim holds. `setPreset`, `setBudget` and `onChange` each have a heading; `set` has none.
- The claim that a scanning reader "finds nothing" goes too far. The note at line 11 says `quality.set` takes every setting that changes during play and links to [Settings](#settings). The first code sample (line 25) calls `quality.set`. Line 94 and line 125 call it again. The reference page documents it (packages/engine/src/sketch/quality.ts:256-262). A reader finds the call. What the reader does not find is the section that explains its rules, because it hides under the wrong heading. This makes the page clearly harder to use, but it does not mislead. That is medium, not high.
- The code agrees with the paragraph: packages/engine/src/sketch/quality.ts:487-506 checks the settings, throws E1213 for minRenderScale above maxRenderScale, and lets a floor raise the lowest tier's cap unless the sketch set its own cap.
- Line 71 lists two E1213 cases that `quality.set` never throws: "an option of `createEngine` with a value that its setting does not take, and a preset name that `createEngine` does not know". Those come from the page's `createEngine` checks (packages/engine/src/quality/presets.ts:1082-1130, packages/engine/src/page/engine.ts). The proposed "what throws E1213" list must not copy them over as `set` errors.
- Other pages link to #settings for `quality.set` (docs/api/engine.md:99, 100), and so does the note at line 11. The new heading leaves those links working, but they would then point to the wrong part of the page.

## Corrected claim

The `quality.set` paragraph (line 71) and the anti-aliasing link (line 69) sit under the "Moment transparency" heading, so the call's rules have no heading of their own. The call itself shows in the top note and code samples. Severity: medium.

## Corrected edit

Add `## Changing settings during play` after Settings and put the `quality.set` paragraph under it, as the finding proposes. Then also:
1. Keep only the E1213 cases that `set` throws: a setting that is fixed at the start, a value out of range, and a `minRenderScale` above `maxRenderScale`. Move the `createEngine` option and preset-name cases to "Choosing the preset on the page".
2. Put the lowest-tier rule (a floor raises the tier's cap, a cap the sketch set itself throws) in a `<details>` block with the summary "Technical details: the render scale in the lowest quality tier".
3. Point the note at line 11 and the links at docs/api/engine.md:99-100 to `#changing-settings-during-play`.
4. Move the anti-aliasing link to the end of Settings, or into the `antialias` row of the options table at line 49.
