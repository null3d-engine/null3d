# concepts-2-substance-30

## Finding as given

```json
{
 "page": "concepts/render-layers",
 "anchor": "## Setting layers, line 66: \"throws E1207\"",
 "category": "unclear",
 "severity": "low",
 "claim": "E1207 is not linked, and \"a mask that is not a whole number of 32 bits\" is hard to understand.",
 "evidence": "docs/errors/E1207.md exists.",
 "proposedEdit": "\"In development builds, a mask that is not a whole number from -(2 ** 31) to 0xffffffff throws [E1207](../errors/E1207.md).\"",
 "generatedSource": "",
 "id": "concepts-2-substance-30",
 "slice": "concepts-2",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- docs/concepts/render-layers.md:66 reads: "In development builds, a mask that is not a whole number of 32 bits throws E1207. Negative numbers down to `-(2 ** 31)` work too, so `1 << 31`, which JavaScript makes negative, is layer 31." E1207 is plain text, not a link.
- docs/errors/E1207.md exists ("Invalid layer mask").
- Other concept pages link error codes in the same way: concepts/color-management.md:43 ([E1204](../errors/E1204.md)), concepts/backends.md:188 ([E1303]), concepts/handles.md:73 ([E1101]), concepts/architecture.md:143 ([E1415]). So the missing link is a real inconsistency.
- packages/engine/src/errors/checks.ts:56-59 (`checkLayers`): passes when `Number.isInteger(mask) && mask >= -0x8000_0000 && mask <= 0xffff_ffff`, else throws E1207. The range in the proposed edit is correct.
- The page is hand-written (not generated), so no generated source applies.

## What does not hold

The proposed edit replaces only the first sentence. The second sentence on line 66 already says that negative numbers down to `-(2 ** 31)` work. With the new range in the first sentence, the second sentence then repeats that lower bound. The edit must merge both sentences. "A whole number of 32 bits" is also only a small clarity cost: the next sentence gives the lower bound, and line 65 gives `0xffffffff` as the upper mask. So the wording half is polish; the link half is the real fix.

## Corrected edit

Replace the whole bullet on line 66 with:

"- In development builds, a mask must be a whole number from `-(2 ** 31)` to `0xffffffff`, or the call throws [E1207](../errors/E1207.md). Negative masks are allowed so that `1 << 31`, which JavaScript makes negative, names layer 31."
