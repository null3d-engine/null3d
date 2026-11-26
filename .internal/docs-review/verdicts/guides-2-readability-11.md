# guides-2-readability-11

## The finding as given

- Page: guides/start-time
- Anchor: 16 long paragraphs: file lines 25, 60, 106, 138, 140, 144, 162, 166, 200, 232, 244, 246, 248, 264, 270, 292
- Category: long-paragraph. Severity: medium.
- Claim: stats.json lists 16 long paragraphs. The worst are line 248 (126 words, 7 sentences), line 270 (109 words, 7 sentences) and line 244 (107 words, 6 sentences).
- Proposed edit: Line 200: numbered steps (name the first view's files in downloads; list them in setup order), then one sentence on low priority and one on hold mode. Line 244: break after '...lowers the preset in front of the viewer.' Line 248: move whole paragraph into `<details><summary>Technical details: how the check measures</summary>`. Line 270: keep three sentences; move the list key (engine version, GPU path, shader bits, preset, canvas format) and background builds into a technical details block. Lines 60 and 106: into the block of the 'Where the time goes' finding. Others: break after the third or fourth sentence.

Verdict: partly

## Evidence

- The count holds. stats.json gives 16 long paragraphs for guides/start-time. Its line numbers count from the end of the front matter; adding the 7 front-matter lines gives the file lines in the finding, which I checked one by one in docs/guides/start-time.md. The three worst paragraphs and their counts match (stats lines 241, 263, 237).
- Line 244 (stats 237): breaking after "...lowers the preset in front of the viewer." gives two parts of three sentences each. This is right.
- Line 248 (stats 241): moving the WHOLE paragraph into a block is wrong. Its first three sentences tell a page author something they need with every block closed. The check can take many seconds on a slow tablet. It stores its rounds each time it lowers the preset, so a viewer who leaves loses nothing. The next start begins at the lowered preset. Only the last four sentences are implementer detail: how the target is set, the first round's wait of at most 4 seconds, the jump straight to Low under a quarter of the target, and the governor's lowest tier.
- Line 270 (stats 263): "keep three sentences" does not say which three. The last sentence must stay in the main text. It tells a reader that hold mode, replays and recordings skip the list, and that `?builds=fresh` turns it off. Readers act on that. The key sentence (engine version, GPU path, shader bits, preset, canvas format), the background builds partway through the first frame, and the shared identical builds are implementer detail. They fit a block.
- Line 200 (stats 193): this is one instruction with an order rule. "Name the first view's files ... in the order that the setup needs them" is one sentence. Splitting it into two numbered steps makes a two-step list out of one action. A plain break after the second sentence ("...often before the core has arrived.") works better. The scheduling detail (two at a time, low priority, up to four once a load waits) could go in a block. The hold-mode sentence and its link stay in the main text.
- Lines 60 and 106 depend on another finding. Line 60 defines the method and the "Load average" column of the two tables after it. If those tables stay in the main text, line 60 must stay with them, or the column has no meaning with the block closed. Line 106's opening sentence ("The phones start at Low and run no preset check") is also said at line 244, so its device notes (tablet check times, the creek demo's lost GPU, tunnel speed) can go in a block safely.
- Others (25, 138, 140, 144, 162, 166, 232, 264, 292): a break after the third or fourth sentence is sound for each. Several are under 90 words and are flagged only for 5 to 6 sentences (25, 138, 140, 232, 292), so the gain there is small. In line 162, the last sentence (no `sideEffects` list, measured slower) is a good one-line candidate for a block.

## Corrected claim

The 16 long paragraphs and the three worst are as stated. Most of the proposed breaks are right. Moving line 248 whole into a block hides behavior that page authors need. The line 270 edit does not say which sentences stay. The line 200 numbered list splits one instruction in two.

## Corrected edit

- Line 244: break after "...lowers the preset in front of the viewer." (as proposed).
- Line 248: keep the first three sentences in the main text (many seconds on a slow tablet; rounds stored at each step down; the next start begins at the lowered preset). Move the last four sentences (target rate, first round's wait, straight to Low under a quarter of the target, the governor's lowest tier with its link) into `<details><summary>Technical details: how the check measures</summary>`.
- Line 270: main text keeps the sentences on the stored list in `localStorage`, the builds on the next start as each shader arrives while downloads and setup run, and the hold mode / replays / `?builds=fresh` sentence with its link. Move the key (engine version, GPU path, device shader bits, preset, canvas format), the background builds partway through the first frame, and the shared identical builds into `<details><summary>Technical details: how the stored pipeline list works</summary>`.
- Line 200: no numbered list. Break after "...often before the core has arrived." The second part keeps the hold-mode sentence and link. Optionally, move the scheduling detail (two at a time at low priority; a waiting load moves its file to the front; up to four at once) into a technical details block.
- Line 60: stays next to its tables unless the whole before-and-after section moves into one block. Line 106: keep the first sentence; the device notes may go into a block.
- Others: break after the third or fourth sentence. Optionally, move line 162's last sentence into a block.
