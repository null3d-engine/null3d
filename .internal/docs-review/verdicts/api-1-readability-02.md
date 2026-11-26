# Verdict on api-1-readability-02

## The finding as given

- Page: api/engine
- Anchor: ## The running engine (lines 161-184)
- Category: wall-of-text
- Severity: high
- Claim: There are 22 bullets, several over 100 words. The rule for which failures stop the frames is buried in the middle of the onFailure bullet. Lines 178-182 describe memory reuse, Safari and the back-forward cache, not calls. stats.json does not count bullets, so this wall does not show in the paragraph counts.
- Evidence: engine.md:163 (onFailure, about 150 words, 11 sentences), :173 (inspect, about 110 words), :176 (requestPointerLock, about 150 words), :178-182 (80-120 words each, no call named).
- Proposed edit: Replace the list with a Call | What it does table, one sentence per row. Add an H3 'Failures after the start' with a table Code | What happens next: E1302, E1404 and E1424 stop the frames; E1405 is a job worker that did not start; E1304, E1305 and E1307 drop the failed objects and draw on. Follow it with two sentences on handler order. Add an H3 'Destroy and start again' for lines 177-179. Put lines 180-182 in a details block "Technical details: memory and the GPU when a page goes away". Shorten requestPointerLock to one row that links to controls.md#pointer-lock.

Verdict: partly

## Evidence

- docs/api/engine.md:161-182 holds 22 bullets. This holds. stats.json lists only lines 29 and 142 as long paragraphs for this page, so the wall does not show there. This holds.
- Word counts (wc -w): line 163 has 189 words, not about 150. Line 164 has 96, 173 has 105, 176 has 148, 178 has 146, 179 has 119, 180 has 64, 181 has 95 and 182 has 97. So "80-120 words each" for 178-182 is wrong at both ends. The point still stands: the section is close to 1,900 words of bullets.
- The stop rule is split, not only buried. Line 163 says the frames stop after E1404 or E1424, but leaves E1302 out of that sentence. Line 164 (onStop) names all three: E1302, E1404 and E1424. A reader of line 163 alone can miss that a lost GPU (E1302) also ends the frames. A code table fixes this. The table the finding proposes matches the page and the source: codes.ts E1404 says the thread stops its loop and the engine draws no new frames; E1405 is a worker that failed to start.
- "Lines 178-182 ... not calls, no call named" is wrong for 178 and 179. Line 178 names `destroy({ release: true })` and tells the reader when to call it. Line 179 is about starting a new engine after `destroy()` (StrictMode, E1419). The finding's own edit already moves 177-179 under a "Destroy and start again" heading, so the edit is right there, but the claim is not.
- Line 180 ends with an action for the reader: "remove the canvas from the page once you are done with it." Line 182 ends with the reason a heavy page on a small phone fails (E1307). If all of 180-182 goes into a closed block, the action in 180 is hidden. The main text must make sense with every block closed, so that sentence must stay outside.
- "One sentence per row" cuts correct detail that the request says to keep in a block. Examples: line 167 (measure in a development build adds to CPU times), line 170 (captureFrame draws again offscreen; hold mode; premultiplied alpha), line 173 (inspect exists only in a development build, so check for it with `engine.inspect?.(...)`), line 162 (detach keeps threads, GPU resources and the scene). These are not in a linked page in the same form.
- requestPointerLock: docs/api/controls.md:203-224 covers the click-handler rule, E1426, `input.pointer.locked`, Esc, `document.exitPointerLock()` and the end at destroy. It names E1425 only in a code comment, with no link. It does not cover `{ unadjustedMovement: true }`, nor that destroying an engine started with `input: false` leaves the page's own lock. A one-row link loses those facts. Also, controls.md:205 links back to engine.md#the-running-engine for this call, so the call must keep its full entry here or in a block.
- Five pages link to engine.md#the-running-engine. New H3 headings under it keep that anchor, so the links still work.
- Severity: the facts on the page are correct, and onStop restates the stop rule one bullet later. Nothing misleads. The wall makes the page clearly harder to use, which is medium, not high.

## Corrected claim

The section has 22 bullets, about 1,900 words, and stats.json does not show it. The onFailure bullet (189 words) names only E1404 and E1424 as codes that stop the frames; E1302 shows up as a stop only in the next bullet. Lines 178-179 are about `destroy()` and the next engine. Lines 180-182 are about Safari memory and the back-forward cache. Severity medium.

## Corrected edit

- Keep the list, or a Call | What it does table, but keep each call's short facts that a user acts on. Move dense detail into one details block per call where it is long: "Technical details: how captureFrame reads a frame", "Technical details: the inspection calls", "Technical details: pointer lock in edge cases" (keep `unadjustedMovement`, the E1425 link and the `input: false` case there). Do not cut them to one sentence.
- Add the H3 "Failures after the start" with the Code | What happens next table as proposed (E1302, E1404, E1424 stop the frames, destroy and start again; E1405 a job worker that did not start; E1304, E1305, E1307 draw on without the failed objects). Then state the handler order: onFailure before onStop, and a late first handler still gets an unheard failure.
- Add the H3 "Destroy and start again" for lines 177-179, with `destroy({ release: true })` in the main text.
- Keep the last sentence of line 180 in the main text: "In Safari, remove the canvas from the page once you are done with it, or it keeps the engine's memory." Put the rest of 180, and 181-182, in a details block "Technical details: memory and the GPU when a page goes away".
