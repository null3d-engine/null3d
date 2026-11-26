# Verdict: concepts-2-readability-16

## The finding as given

- id: concepts-2-readability-16 (slice concepts-2, role readability)
- page: concepts/quality-presets
- anchor: long paragraphs at lines 63, 85, 111, 120, 124, 128, 137, 163, 178, 184, 200, 202, 204, 212, 218-226, 237, 252, 287, 300, 313, 315, 317, 321, 323, 333
- category: long-paragraph; severity: medium
- claim: 29 paragraphs pass the limit. Most mix a rule with device figures. Examples: the iPad heat story in 'How the engine chooses a preset' (63), check timings (124), repeat-visit times (128), and the iPad tab-crash point (184).
- evidence: stats.json longParagraphs for concepts/quality-presets, 29 entries (file line = stats line + 7).
- proposedEdit: 63: keep 'tablets start at Medium; name Low for a steady rate' plus the code, and move the iPad figures into <details><summary>Technical details: tablets that heat up</summary>. 85: list the crash-note rules. 120 and 124: split into 'what the target does' and 'what the check skips', with the timings in a block. 128 and 137: move the figures and the 'below 60' rule into a block. Other paragraphs are covered by the anti-aliasing, prepass, moment and split findings.

Verdict: partly

## Evidence

- The count and the lines are right. stats.json has 29 long paragraphs for this page. Each stats line plus 7 gives the finding's file line, and each file line holds the paragraph that stats.json names (for example, file 63 opens "A tablet slows down as it heats up", file 184 opens "The texture memory budget caps").
- "Most mix a rule with device figures" is wrong. Only 4 of the 29 carry figures from named devices: 63 (11-inch iPad Pro heat, 45 and 60 fps, 298 of 299 seconds), 124 (0.8 s on a MacBook Pro, 1 s on an iPad Pro), 128 (iPad Pro, 1 to 2.4 s and 0.25 to 0.52 s) and 184 (2,016 MiB iPad Pro tab close). The other 25 are chains of rules with no device figures: 85 (crash note), 111 and 120 (target frame rate), 137 (when a stored result is kept), 163, 178 (texel sizes), 200, 202, 237, 252, 300, 313, 315, 317, 321, 323, 333, and the prepass, moment and anti-aliasing paragraphs.
- The edit for "120 and 124" does not match line 120. Line 120 is about `targetFps: 90`, the address switch, the 60 default before the display is measured, and the stats overlay. "What the check skips" is line 124. Line 111 (the default target, 87 words) gets no edit at all.
- Line 184 is one of the claim's four examples, but the edit gives it nothing. Its figure is the reason for a rule (phones and tablets cap at half of 2,016 MiB), so it can stay in the main text, but the paragraph still needs a break: budget purpose, the phone and tablet cap, then the option and `quality.set`.
- "Other paragraphs are covered" holds only in part. In findings/concepts-2-readability.md: finding 9 covers 212 (moment block), finding 13 covers 218 to 226 (prepass), finding 19 covers 287 (cut to three sentences). Finding 1 gives 204 its own heading but does not shorten it. Finding 7 (split page) moves 241 to 333 to a new page, which does not shorten any paragraph. No finding proposes a break for 111, 163, 178, 184, 200, 202, 237, 252, 300, 313, 315, 317, 321, 323 or 333.
- Line 63 says "In the S4 benchmark". Finding 10 flags that name as unexplained. Moving the sentence into a block as it stands keeps the term the reader cannot know.
- Line 128 repeats line 124: both say the check takes about 1 second for each preset on an 11-inch iPad Pro.
- Line 137 holds the rule "no stored result below a 60 fps target", which explains why a power-saving display re-runs the check. That is a behavior rule, not a figure. It is reasonable to keep it in the main text and move only the reason into a block.

## Corrected claim

29 paragraphs pass the limit (stats.json). Four of them (63, 124, 128, 184) mix a rule with figures from named devices, and those figures can go into technical details blocks. The other 25 are dense chains of rules. They need list or paragraph breaks, not blocks. About half of them are not handled by any other finding.

## Corrected edit

- 63: Main text: "A tablet slows down as it heats up, so Medium and High can fall below 60 frames per second after a few minutes. A cool tablet passes the preset check at Medium, so the engine starts tablets there. When a steady rate matters more than sharp shadows and edges, name Low:" plus the code. Move the iPad Pro figures into `<details><summary>Technical details: an iPad Pro as it heats up</summary>`, and describe the scene in plain words or link the performance guide, not "S4".
- 85: Make it a list: a named preset also counts crashes; `?preset=` ignores them; `engine.mode.crashedStarts`; refused storage; hold mode and `?preset=` leave the note alone; the note's scope.
- 111: Break after "at most 60 frames per second". Keep the 120 Hz example as its own short paragraph.
- 120: Split into what `targetFps` does (a number caps it, never above the display, a higher target costs quality) and how to set and see it (the address switch, the 60 default before measuring, the stats overlay).
- 124: Split into which starts skip the check, and how long it takes and when to hide the loading screen. Move the MacBook Pro and iPad Pro timings into a block.
- 128 and 137: Remove the iPad timing that repeats line 124. Move the first-visit and repeat-visit times into `<details><summary>Technical details: first and repeat visit times</summary>`. Keep the "below 60" rule in the main text, as a bullet beside the match list, and put only its reason (power-saving displays) in the block.
- 184: Break into three short parts: what the budget protects; the phone and tablet cap with its reason; the option and `quality.set`.
- 163, 178, 200, 202, 237, 252, 300, 313, 315, 317, 321, 323, 333: Either add them to this finding with a break for each, or name them as left for the split page. Good candidates: 178 as a list of what takes shadow memory, 200 as a list of which textures can drop levels, 313 as a list of the governor's step rules, 323 as a list of the tier's live settings.
