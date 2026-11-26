# Verdict: api-1-readability-28

## The finding as given

```json
{
 "page": "api/engine",
 "anchor": "## What the engine reports (lines 155-157)",
 "category": "wall-of-text",
 "severity": "low",
 "claim": "The capabilities bullet (about 110 words) and the mode bullet (about 130 words) each list about eight fields in prose. A reader looking for maxInstances or renderFallback must read the whole bullet.",
 "evidence": "engine.md:155 names tier, hdr, maxInstances, directDraws, drawPath and halfPrecision. :156 names about ten mode fields.",
 "proposedEdit": "Make two tables, Field | What it gives, one for engine.capabilities and one for engine.mode. Keep engine.report as one sentence. Put the direct-draw measurement (Apple GPU in Safari) in a details block.",
 "generatedSource": "",
 "id": "api-1-readability-28",
 "slice": "api-1",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- docs/api/engine.md:155 is one bullet of 119 words that names about eleven fields of `engine.capabilities`. Line 156 is one bullet of 141 words that names about twelve fields of `engine.mode`. Line 157 is one short sentence. The problem holds: a reader who looks for one field must read the whole bullet. The finding's word counts are a little low.
- The proposed tables already exist. docs/api/reference/engine.md:113-130 is a Member | Description table for `EngineCapabilities`, with one row for each field, `maxInstances` and `directDraws` among them. Lines 144-162 are the same kind of table for `EngineMode`, with `renderFallback` and `keepTextureCopies` among them. Two more tables on the guide page would repeat the generated reference. Readers would then have two places to check, and the copies could drift apart.
- The bullets do not link to those tables. The only link is the general "API reference" line at the end of the page. So a reader is not sent to the place that already answers "what is maxInstances".
- The direct-draw note is one sentence (line 155). reference/engine.md:78 and :130 already explain the probe and every `drawPath` reason. A details block for one sentence adds markup and no detail. Moving the sentence to the reference, or cutting it, is better.

## Corrected claim

The two bullets are long field lists in prose and are hard to scan. The fix is not new tables. Each field is already in a Field | Description table on the API reference page, and the bullets do not link there.

## Corrected edit

Shorten each bullet to what the object is for, and link to its reference table:

- `engine.capabilities` gives the GPU path that the engine chose and what that path offers: its tier, its features and limits, HDR, depth, and the most objects it draws. [EngineCapabilities](reference/engine.md#enginecapabilities) lists every field. [GPU tiers and backends](../concepts/backends.md) explains each.
- `engine.mode` gives how the engine runs on this device: its build, its threads, its quality preset and its memory maximum. [EngineMode](reference/engine.md#enginemode) lists every field.

Keep only the usage notes that the reference does not give, as short sentences after the mode bullet. These are: `presetCheck` is null while a check runs during play, `engine.presetChecked` resolves when the check is done, and the job workers start as the work grows (with the Architecture link). Drop the direct-draw sentence and the per-field sentences for `drawPath`, `halfPrecision`, `keepTextureCopies` and `renderFallback`, because the reference rows hold them. No details block is needed. The source is hand-written, docs/api/engine.md.

Note outside this finding: reference/engine.md:618 has "(D-174)", a decision record number, in a published page. Its source is the doc comment of the capability report's `directDraws` field in packages/*/src.
