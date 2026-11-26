# errors-substance-06

## Finding as given

- page: errors/E1203, errors/E1209, errors/E1224 (template: all 80 error pages)
- anchor: ## Example
- category: unclear; severity: medium
- claim: The example is documented as the message as printed. It shows only the detail, sometimes with part of the fix added. The printed message is 'code: detail fix See <url>', so readers cannot match their console text. Some details also repeat the fix's first sentence, so the printed message says it twice.
- evidence: codes.ts:17; engine-error-core.ts:19-23; E1203 example vs errors/checks.ts:65; debugging.md:29; programs.ts:199-202; scene.ts:5714.
- proposedEdit: In errorPage, print messageFor(code, entry.example, entry.fix) so the block matches the console exactly. Remove the fix text from the E1203 example. Remove the repeated fix sentence from the E1209 and E1224 details where they are thrown.

Verdict: partly

## Evidence

- codes.ts:17 documents `example` as "A message as the engine prints it". messageFor (engine-error-core.ts:19-23) prints `code: detail fix See <docs url>`. errorPage (tools/lib/docs.ts:436-460) prints `entry.example` alone. So no error page shows the fix or the "See" link that the console shows. Holds.
- E1203: the real detail (errors/checks.ts:65) is `setPosition() got NaN for x on "Player" (slot 12).` The example (codes.ts:115) adds "Check the value computed before this call.", the first sentence of the fix (fixes.ts:31-32). It is neither the detail nor the full message. Holds.
- E1209: the thrown detail (gpu/webgl2/programs.ts:199-202) ends "give the material fewer textures."; the fix (fixes.ts:43-44) starts "Give the material fewer textures." messageFor only skips the fix when the detail ends with the whole fix, so the console prints the sentence twice. Holds.
- E1224: the thrown detail (scene/scene.ts:5714) lists materials.standard(), unlit(), shader(), decal(); the fix (fixes.ts:67-68) lists the same four. The console says the list twice. Holds, but it is overlap of the list, not the fix's first sentence verbatim.
- A script over the error table found 79 codes, not 80. Only E1203 and E1209 examples contain the fix's first sentence; no example carries the whole fix.
- Reader cost is real but small: the code prefix and the detail still match the console, so a reader can find the page. debugging.md:29 already shows one full printed message.

## Corrected claim

Every one of the 79 error pages shows only `code: detail`, while codes.ts says the example is the message as printed; the console adds the fix and a "See <url>" link. The E1203 example also adds the fix's first sentence, which the thrown detail lacks. At run time, the E1209 detail repeats the fix's first sentence and the E1224 detail repeats the fix's list of materials, so those console messages say it twice.

## Corrected edit

The code-side parts stand: remove "Check the value computed before this call." from the E1203 example (codes.ts:115); end the E1209 detail at programs.ts:201 after "16 units." and the E1224 detail at scene.ts:5714 after "material."; then update their examples (codes.ts:159, 251) to match.

Do not render the full messageFor text in the block. It would print the whole fix twice on the page, once under "How to fix it" and again right below it. For codes with long fixes, such as E1205 and E1225, the block would grow to several lines of the same text. Instead, either (a) change the codes.ts doc comment to "The start of the message as the engine prints it: the code and the detail", or (b) add one line above the block in errorPage: "The console shows this text, then the fix above and a link to this page." Option (b) keeps each page short and tells the reader what the console shows.
