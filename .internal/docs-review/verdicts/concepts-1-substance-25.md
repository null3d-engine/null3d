# concepts-1-substance-25

## The finding as given

- Page: concepts/lighting
- Anchor: ### Cost, line 277 "The tests of the room's generator measured these times in Chrome. The phones ran in a device cloud"
- Category: internal-note. Severity: low.
- Claim: "The tests of the room's generator" and "a device cloud" describe the maintainers' test setup. The reader needs only the conditions.
- Evidence: lighting.md:277.
- Proposed edit: "These times come from Chrome, with no shader cache." Move the table and this sentence into the cost block.

Verdict: partly

## Evidence

- lighting.md:277 reads: "The tests of the room's generator measured these times in Chrome. The phones ran in a device cloud, on a page with no shader cache. On WebGPU the map's time is the GPU's own. On WebGL2 it runs from the call until the GPU has finished."
- The core claim holds. "The tests of the room's generator" names the maintainers' test, and "a device cloud" names where they ran phones. A reader needs the conditions: Chrome, real devices, no shader cache. Low severity fits.
- The proposed sentence is wrong in two ways:
  1. It says every time comes "with no shader cache". The page says that only for the phones ("The phones ran in a device cloud, on a page with no shader cache"). The edit widens the condition to the MacBook rows, which the page does not claim.
  2. It drops the last two sentences, which define what the table's "whole map" column measures. The WebGL2 row ("20 to 27 ms, of which 16 to 17 ms on the GPU") makes no sense without them.
- "The cost block" does not exist. The page has no `<details>` block (grep finds none). The edit depends on another finding's block.
- Moving the table into a block breaks main text. The bullet at line 271 says "That frame takes longer by the map's GPU time, which the table below gives." With the block closed, that pointer leads to hidden content. The bullet at line 272 ("on a phone, the time of 3 to 7 frames") stays readable.
- Same wording elsewhere: docs/guides/performance.md:227 also says "On phones in a device cloud". That is a separate page and not part of this finding.

## Corrected claim

"The tests of the room's generator" is internal wording. "A device cloud" is test setup that the reader does not need. The conditions must stay with their correct scope: the phones ran with no shader cache. The two sentences that say what the WebGPU and WebGL2 times measure must also stay.

## Corrected edit

Replace line 277 with:

"These times come from Chrome. The phones loaded a page with no shader cache. On WebGPU the map's time is the GPU's own. On WebGL2 it runs from the call until the GPU has finished."

If the table moves into a `<details>` block (summary such as "Technical details: the room's measured times"), move this paragraph with it. Then change line 271 so it stands alone with the block closed, for example: "That frame takes longer by the map's GPU time: about 20 ms on a MacBook Pro and 48 to 107 ms on a phone."
