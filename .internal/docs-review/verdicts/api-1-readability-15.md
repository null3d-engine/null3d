# Verdict on api-1-readability-15

## The finding as given

- page: api/debug
- anchor: long paragraphs at lines 24, 66, 70, 138, 158, 209, 215, 234, 310, 401, 427, 446
- category: long-paragraph
- severity: medium
- claim: Twelve paragraphs are too long. The worst are line 310 (146 words, 10 sentences), 215 (120 words) and 24 (104 words), which is the first paragraph a reader meets and ends with a hold-mode rule.
- evidence: stats.json lines 17, 59, 63, 131, 151, 202, 208, 227, 303, 394, 420, 439.
- proposedEdit: Line 24: keep the first three sentences, make the camera-relative drawing a second paragraph, and move the hold-mode sentence to a details block. Line 209: split after '...from either side.', and move the message cost and the refresh rate to a 'Cost' bullet. Line 215: make the keys a list, and move the header format to 'The target'. Line 70: split after '...do nothing.' Line 310 goes to a details block. Split the others at the change of subject.
- generatedSource: "" (correct: docs/api/debug.md is hand-written, not under api/reference)

Verdict: partly

## Evidence

- The twelve paragraphs and their counts match stats.json. The stats lines are body lines; the page lines are those plus the seven lines of front matter. The page is hand-written, so no generated source applies.
- Line 24 holds the claim as stated. The last sentence (hold mode) is a test-only rule with no link, in the first paragraph of the page. A details block suits it. The camera-relative drawing is also shown by the Mermaid chart just above, so it can go in the same block.
- Line 209: the split point is wrong. The sentence after "...from either side." starts with "So the sketch's `debug.stats(false)` hides ...". It is the example of the first sentence and depends on it. A split there leaves a paragraph that starts with "So". Split after "...one that the sketch showed." instead. The page has a "### Cost" section (line 330), so a bullet there for the message per call and the four refreshes a second is valid.
- Line 215: "The target" exists as a bold-led paragraph at line 226. It already gives both header examples (`120 Hz ≥60 fps · 16.7 ms` and `120 fps · 8.3 ms`). So the header format in 215 is a repeat. Moving it into 226 would make 226 longer (it already has eight sentences). Cut the repeat from 215 and point to "The target" instead.
- Line 310: moving the whole paragraph into a details block breaks the rule that the main text must make sense with every block closed. The paragraph holds facts a reader needs to read the tab: why the whole-page line differs from the bar total, the `measuring` label, and the public export `measurePageMemory()` from `@null3d/engine/stats`. Only the mechanics (how the browser counts shared memory per thread, when it answers, the idle job workers, one measurement at a time) are dense detail. Also, line 314 ("Some browsers offer the measurement but never answer it ...") is about the same line but sits after the "Memory by system" paragraph (312). It belongs beside 310.
- Line 70 split after "...do nothing." is fine. The next sentence stands alone.
- "Split the others" is fair for 66, 138, 234, 401 and 427. Lines 158 (67 words), 446 (68 words) and 70 (71 words) are flagged only by sentence count. They keep to one subject in short sentences. Splitting 158 and 446 is taste and gains little.

## Corrected claim

Twelve paragraphs pass the length limits, as stats.json says. The ones that cost the reader most are 310 (146 words, 10 sentences), 215 (120 words, and it repeats the header format that "The target" gives) and 24 (the first paragraph, which ends with a test-only hold-mode rule). Lines 158 and 446 are long by sentence count only and can stay.

## Corrected edit

- Line 24: keep the first three sentences. Put the camera-relative drawing (64-bit move, one draw after opaque objects, precision far from the origin) and the hold-mode sentence in one details block, "Technical details: how the lines draw". Link "hold mode" to ../guides/testing.md#hold-mode.
- Line 209: split after "...one that the sketch showed." Keep "Options add up ..." as its own paragraph. Move "Each `debug.stats` call sends a message ..." and "The page draws the overlay and updates it four times a second." to a bullet in "### Cost".
- Line 215: make the tab keys (click, arrow keys, Home and End) a short list. Replace the header-format sentence with "The card's header shows the mode, the display and the target on every tab, as "The target" below explains." Do not add text to "The target".
- Line 310: keep in the main text: the bar total, why the whole-page line is separate, the `measuring` label and `measurePageMemory()`. Move the rest (shared memory counted per thread, when the browser answers, the idle job workers, one measurement at a time) into a details block, "Technical details: how the page memory is measured". Move line 314 up to follow 310, before "Memory by system".
- Line 70: split after "...do nothing."
- Lines 66, 138, 234, 401, 427: split at the change of subject. Line 427's Chrome flag sentence can go in a details block. Leave 158 and 446 as they are.
