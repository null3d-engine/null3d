# Verdict: guides-2-readability-09

## The finding as given

- Page: guides/loading-screens
- Anchor: 15 long paragraphs: file lines 23, 57, 59, 61, 69, 134, 145, 153, 159, 172, 174, 194, 200, 202, 215
- Category: long-paragraph. Severity: medium.
- Claim: stats.json lists 15 long paragraphs. The worst are line 215 (182 words, 11 sentences), line 202 (175 words, 11 sentences), line 172 (164 words, 12 sentences) and line 134 (144 words, 10 sentences).
- Evidence: stats.json guides/loading-screens longParagraphs.
- Proposed edit: Line 23: numbered list matching the diagram (engine starts and files download; setup builds and posts progress; warm-up builds pipelines; first frame shows and the page removes the screen; preset check in the first moments of play). Line 57: a list of three rules (list files in setup order; name only what the first frame waits for; start the rest at engine.firstFrame) plus one sentence on priority; move the later-stage sentence to 'A later loading stage'. Line 69: break after 'Neither knows how much of the whole start is left.' and list the three rules of phases. Line 153: break after '...why the scene never came.' Lines 134, 172, 174, 202, 215: see the technical details finding. Others: break after the third or fourth sentence.

Verdict: partly

## Evidence

- The claim holds. stats.json counts body lines; the file has 7 front-matter lines, so stats lines 16, 50, 52, 54, 62, 127, 138, 146, 152, 165, 167, 187, 193, 195, 208 are file lines 23, 57, 59, 61, 69, 134, 145, 153, 159, 172, 174, 194, 200, 202, 215. The four worst counts match stats.json.
- The deferral is real: finding 10 in findings/guides-2-readability.md proposes technical details blocks for lines 134, 172, 174, 202 and 215.
- Line 23 (intro, 6 sentences): a numbered list of the start steps is a fair text twin of the diagram at lines 13 to 21. The proposed list drops two points the prose makes: the page draws the screen in HTML and hears the sketch's messages, and by default the loading screen does not wait for the preset check. Keep both.
- Line 57: the three rules are the first two sentences plus "Start the files that the first frame does not need when ... engine.firstFrame resolves". The priority sentences (two at a time, a load moves its file to the front, up to four) are already covered by the link to api/sketch.md#the-download-list, so one sentence is enough. "A later loading stage" (line 180) is about objects made during play, so the assets.preload sentence fits there.
- Line 69: the break point is right. Keep the reason with the second rule: the scene's total grows, so the page's code (Math.max at line 87) keeps the bar from falling.
- Line 153: the break point is right; the second half (createEngine's promise, either can come first, remove the screen after both) stands on its own.
- Lines 59, 145, 159, 200: a break after the third or fourth sentence lands at a natural seam (59 after "The warning names both files."; 145 after "The engine downloads and the setup runs meanwhile."; 159 after "...lowers the preset and measures again."; 200 after "...never downloads them.").
- Line 61 (5 sentences): the seam is after the second sentence. Sentences 3 and 4 ("A file that fails counts as done..." and "The failed load rejects...") belong together, so a break after the third splits them.
- Line 194 (7 sentences): the generic rule is wrong here, and finding 10 does not cover this line. Sentences 3 to 6 are one unit: an object of a new kind can need more than one pipeline, the depth prepass adds a depth pipeline, WebGPU at High and Ultra adds an occlusion pass pipeline, so engine.measure() can count 2 or 3. A break after the third or fourth sentence cuts that explanation in half. It is dense, correct implementer detail, so it suits a technical details block.

## Corrected claim

The claim holds as stated. The proposed edit holds for lines 23, 57, 69, 153, 59, 145, 159 and 200, and finding 10 covers lines 134, 172, 174, 202 and 215. It is wrong for line 194 and slightly off for line 61.

## Corrected edit

- Line 194: keep sentences 1, 2 and 7 in the main text ("scene.warmUp() builds the pipelines of every object in the scene, hidden objects too, and resolves once they are all built. The scene keeps drawing while it waits. Without a warm-up, each new object appears when its pipeline is built, which can be a few frames after the others."). Move sentences 3 to 6 into a block:

  <details>
  <summary>Technical details: how many pipelines one new object adds</summary>

  An object of a new kind can need more than one pipeline. Where the scene draws the depth prepass, the object also gets a depth pipeline. On a computer's WebGPU at High and Ultra it gets a third, for the occlusion culling's depth pass. So `engine.measure()` can count 2 or 3 pipelines for one new object ([The depth prepass](../concepts/quality-presets.md#the-depth-prepass)).

  </details>

- Line 61: break after the second sentence ("...so it grows as the scene starts more files."), and keep the failed-file sentences and the Assets link together.
- Line 23: in the numbered list, keep that the page draws the screen in HTML from the sketch's messages, and that by default the screen does not wait for the preset check.
- Line 69: in the list of phase rules, keep the reason that the page clamps the bar within a phase (the scene's total grows).
