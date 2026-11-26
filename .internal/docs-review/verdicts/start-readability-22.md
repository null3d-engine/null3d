# start-readability-22

## The finding as given

```json
{
 "page": "getting-started/hosting",
 "anchor": "## Offline play (lines 269 to 346)",
 "category": "example-placement",
 "severity": "low",
 "claim": "The service worker code (line 301) comes after the file list JSON, four bullets, a five-row table and a 117-word paragraph. The reader wants the code first.",
 "evidence": "hosting.md lines 284 to 297 sit between the JSON at 273 and the service worker at 301.",
 "proposedEdit": "Order: short intro; service worker; registration; then ### The file list with the JSON, the bullets and the feature table; then the cache.addAll notes. Put the line 297 detail in a details block.",
 "generatedSource": "",
 "id": "start-readability-22",
 "slice": "start",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The layout claim is correct. In the generated page, the file list example starts at line 273. The four bullets are at lines 284 to 287, the feature table at 289 to 295, the 117-word paragraph at 297, and the service worker code at 301. stats.json lists the paragraph as 117 words and 7 sentences. Its line number there is 290, because stats.json counts lines in a different way. It is the same paragraph.
- The reorder does not hold. The service worker code uses the file list directly. It reads the list's `version`, `start` and `features` fields (lines 317 to 324). Its feature names at line 303 come from the feature table. If the code comes first, the reader meets those fields and names before the page explains them. The current order is input first, then the code that uses it, and that order is correct for a page like this. The intro at line 271 also ends on the file list. So the file list example follows on from the intro.
- The reorder also splits up the notes that explain the code. Lines 342 to 346 explain the code and the registration: the connection sharing, adding `public/` files to the list that `cache.addAll` takes, and the update on the next visit. In the proposed order, the new "The file list" heading sits between the code and those notes. A reader would then find notes about the code under a heading about the file list.
- The details block for line 297 holds. That paragraph is correct, dense detail: shader variants for each GPU path and setting, shader files for two features, and cache sizes. A reader does not need it to write the service worker. The text before it and after it still makes sense with the block closed. So it fits the new collapsible block.

## Corrected claim

The order of the Offline play section is correct: the file list, then the service worker that reads it, then the notes about that code. Do not reorder it. The one real cost is the 117-word paragraph on shader variants and cache sizes at line 297. It slows the path from the feature table to the code.

## Corrected edit

Keep the current order. Move the line 297 paragraph into a block placed straight after the feature table:

```
<details>
<summary>Technical details: shader files and cache size</summary>

Each feature's shaders come in a file for each GPU path and each device's settings. ...(paragraph unchanged)... With compression, the downloads are about a fifth of that.

</details>
```

You can also shorten the bullet at line 285, which is about both GPU paths' renderers, to its first two sentences. Its sentence about a benchmark page can go in the same block.
