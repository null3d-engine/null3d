# api-3-readability-17

## The finding as given

- Page: api/sound
- Anchor: lines 22, 24, 71, 86, 115, 121, 134, 152
- Category: scan-order. Severity: medium.
- Claim: Line 24 explains the main thread, the worker, the shared table, the Rust mixer and messages before the reader sees bun add. The Files section (line 152) mixes address rules with MP3 encoder padding and a Safari sample count. Eight paragraphs are over the limit.
- Evidence: stats.json longParagraphs for api/sound; line 152 "Safari kept 576 at each end of a mono loop, which would dip at every join."
- Proposed edit: Line 24: keep "The sketch runs in a worker and the browser's audio runs on the page, so the add-on has a sketch half and a page half.", and put the rest in `<details><summary>Technical details: how the sketch drives the audio thread</summary>`. Line 152: keep the address rules and "A file made to loop joins its end to its start, with no gap.", and put the padding detail in `<summary>Technical details: gapless MP3 loops</summary>`. Line 86: a table Sound | Members. Line 71: two paragraphs (update timing, then starting audio). Lines 115, 121, 134: break at the fourth sentence.

Verdict: survives

## Evidence

- docs/api/sound.md is hand-written (not under docs/api/reference/), so no generated source applies.
- stats.json lists eight long paragraphs. Its line numbers count from after the front matter (offset 7). They map to file lines 22, 24, 71, 86, 115, 121, 134 and 152, so the anchor is right.
- docs/api/sound.md:24 (94 words, 6 sentences) gives the threading model, the shared table, the Rust/WebAssembly mixer and the message rule. The install command is at line 27, after it. The Mermaid diagram at lines 13-20 already shows the same flow, so most of line 24 is detail an implementer wants and a newcomer can skip. A details block fits.
- docs/api/sound.md:152 (133 words, 10 sentences) holds address resolution (sentences 1-3), then MP3 encoder padding, a Safari sample count and a 2,048-sample limit. The figures match the code: packages/sound/src/bounds.ts:13 (`PADDING_MOST = 2048`) and bounds.ts:85, and bounds.test.ts:64 notes WebKit keeps 576 at each end. "Safari kept" is also past tense, against the AGENTS.md rule that pages state what holds now. Moving it into a details block and stating it in the present is right.
- docs/api/sound.md:86 lists the members of three kinds of sound in one run. A table (sound, members) scans better.
- docs/api/sound.md:71 mixes update timing (sentences 1-3) with starting the audio (sentences 4-6). Two paragraphs split it cleanly.
- docs/api/sound.md:115 (8 sentences): sentences 1-4 cover ranking, 5-8 cover how a voice changes member. Breaking before sentence 5 gives two paragraphs of 4 sentences each.
- docs/api/sound.md:121 (5 sentences): sentences 1-3 cover the 32-voice budget and error 2501, sentences 4-5 the rest time of a freed voice. Breaking there works.
- docs/api/sound.md:134 (6 sentences): sentences 1-3 cover what loads and when, 4-6 cover failures. Breaking there works.
- The proposed blocks follow the contract: summary text starts "Technical details:", no headings, no nesting, and the main text still reads with them closed.

I could not disprove the claim. The edit has two gaps, so I give a fuller edit below.

## Corrected edit

- Line 22 is in the anchor (60 words, 5 sentences) but the proposed edit gives it no change. Join its last two sentences: "A sound can come from a place, such as a waterfall or a car, or play in both ears alike, such as wind or rain."
- Line 24: as proposed. Inside the block, write the message rule in the present tense. Example: "Where the page shares its memory with its workers, no frame sends a message and the page's thread does no work while sounds play. A shot sends one message for each play."
- Line 86: as proposed (a table with columns Sound and Members, rows loop, group, shot). Keep the two warnings after the table as plain text, not in a block: a destroyed sound's setters do nothing, and its arrays may then serve another sound, so drop them with the group.
- Line 152: as proposed. In the block, state the browser fact in the present: "Safari keeps 576 samples at each end of a mono MP3, which dips at every join of a loop."
- Lines 71, 115, 121, 134: as proposed. For 115, 121 and 134 the break goes before the fifth, fourth and fourth sentence.
