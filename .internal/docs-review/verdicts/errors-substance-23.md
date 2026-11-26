# errors-substance-23

## Finding as given

- page: errors/index
- anchor: "Every error the engine throws is an `EngineError` with a code."
- category: missing-content
- severity: low
- claim: Add-ons own the codes from 2000 to 9999, but the index never says so. A reader with an E2xxx code finds nothing. The table also skips numbers (E1210-E1212, E1427-E1429) and does not say why.
- evidence: fixes.ts:70. docs/guides/add-ons.md:33. errors/engine-error.ts:35 (the code list).
- proposedEdit: Add to the index intro: 'Codes from E2000 to E9999 belong to add-ons, and each add-on documents its own. Numbers missing here are not in use.'
- generatedSource: tools/lib/docs.ts

Verdict: partly

## Evidence

- The add-on range is real. packages/engine/src/scene/namespaces.ts:47 and :77-80 set codes 2000 to 9999 for add-ons; fixes.ts:70 (E1225 fix) and docs/guides/add-ons.md:33 say the same.
- Add-on codes are thrown today. The engine's own add-ons claim ranges: splats 2100-2199 (packages/splats/src/system.ts:47), water 2200-2299, wind 2400-2499, sound 2500-2599. splatsError (packages/splats/src/format.ts:36) and soundError (packages/sound/src/errors.ts:7) throw a plain Error with a message such as "splats E2101: ...". These are not EngineErrors and carry no docs link.
- The index never names the range or add-ons as code owners. Its intro is a fixed string in errorIndexPage (tools/lib/docs.ts:463-483). Its rows hold E1101 to E1506 only. A reader who sees "splats E2101" and opens Error codes finds no row and no pointer.
- Each add-on documents its own codes: docs/api/splats.md:238-242 has a code table; docs/api/sound.md:77 and :121 name errors 2504 and 2501 inline. So "each add-on documents its own" is true, and links can be given.
- The gaps are real: the CODES list (packages/engine/src/errors/engine-error.ts:35) and codes.ts jump from E1209 to E1213 and from E1426 to E1430. But a gap misleads no reader: nobody gets a code that is not thrown. Saying why numbers are missing is polish with no real cost to a reader. That half of the finding is taste.

## Corrected claim

The index does not say that codes from E2000 to E9999 belong to add-ons, which throw them as plain errors such as "splats E2101", or where those codes are listed. A reader with an add-on code finds nothing. The gaps in the numbers cost a reader nothing and need no note.

## Corrected edit

In errorIndexPage (tools/lib/docs.ts), add after the intro paragraph:

"Codes from E2000 to E9999 belong to add-ons. An add-on's message starts with its name, such as `splats E2101`, and the add-on's page lists its codes: [Gaussian splats](../api/splats.md), [Sound](../api/sound.md)."

Use the real titles of the add-on pages. Leave out the sentence about missing numbers.
