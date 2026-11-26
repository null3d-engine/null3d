# Verdict: guides-2-readability-17

## The finding as given

- id: guides-2-readability-17 (slice guides-2, role readability)
- page: guides/phones
- anchor: 11 long paragraphs: file lines 55, 57, 61, 73, 79, 81, 83, 91, 99, 103, 109
- category: long-paragraph, severity: medium
- claim: stats.json lists 11 long paragraphs. '## Heat' (line 91) is one paragraph of 178 words in 11 sentences that mixes advice, the governor's order and three device figures.
- evidence: stats.json guides/phones longParagraphs, line 84 (file 91).
- proposedEdit: Line 91: a list of actions (aim for about 70% of the budget; test 10-minute runs; lighten your own work in quality.onChange), one sentence on the governor with its link, and the Galaxy S24+ and iPad Pro figures in `<details><summary>Technical details: how warm devices slowed in the benchmarks</summary>`. Line 61: break after '...whose options name neither.' and give the advice its own paragraph. Line 99: break after the input.touches sentence and give touch-action: none its own short paragraph with a CSS snippet. Others: break after the third or fourth sentence.
- generatedSource: none (hand-written page)

Verdict: survives

## Evidence

- stats.json lists 11 long paragraphs for guides/phones. The stats lines are 7 lower than the file lines (front matter), and they map to file lines 55, 57, 61, 73, 79, 81, 83, 91, 99, 103 and 109. The Heat paragraph is 178 words in 11 sentences.
- docs/guides/phones.md:91 does mix three kinds of content: advice (70% of the budget, 10-minute runs), the governor's order (budgets and render scale, then shadows, bloom, ambient occlusion), and benchmark figures (warm Galaxy S24+ about 70% slower; warm iPad Pro 17 ms against 12.6 ms, about 45 fps at Medium; 60 fps at Low after 5 minutes). The claim is accurate.
- Cutting the governor's order to one sentence loses nothing. docs/concepts/quality-presets.md:289-316 gives the full order (a diagram and ten numbered steps), and the phones page's version is only a partial copy of it.
- The figures are correct, dense detail. A details block keeps them, as the user's request asks. The main text still makes sense with the block closed, because the advice and the governor link stay outside. The Galaxy S24+ figure is also in docs/guides/performance.md:76, and the iPad figures in docs/concepts/quality-presets.md:63, so the block repeats no unique fact the reader would lose.
- docs/guides/phones.md:99: touch-action: none is the one step a reader must do. docs/api/input.md:106 gives it the same weight. A separate short paragraph with a CSS snippet makes it easy to find. This edit is sound.
- docs/guides/phones.md:61: the first two sentences explain the cost; the rest is advice plus a stray fact (16-bit depth). A break after "...whose options name neither." is a natural point.
- I could not find a writing rule or website-contract point that the edit breaks. The summary text starts with "Technical details:", and the block holds no heading and no nested block.

## Notes for whoever applies the edit (not a reason to change the verdict)

- "Break after the third or fourth sentence" should mean the nearest topic change, not a fixed count. Line 73: break before "So the quality preset's texture memory budget...", or keep that "So" sentence with the two sentences before it, because it gives their result. Line 57: break before "The savings of the pixel ratio cap and the render scale multiply." Line 55 is only 64 words; a split there is optional.
- Line 81 (ASTC and ETC2 sizes, basisu -mipmap, UASTC against ETC1S) and line 83 (a second engine in a single-page app, the wait times, E1109) are dense, niche detail. Each one is a good candidate for its own details block, which would shorten the Memory section more than sentence breaks do.
- Unrelated wording to check: phones.md:91 says the onChange handlers run "after each step that follows the render scale". quality-presets.md:316 says "after each shadow step", and api/quality.md says "after each of these steps". When the Heat paragraph is rewritten, take the wording from the Quality API page.
