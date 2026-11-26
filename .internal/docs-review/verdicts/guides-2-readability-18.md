# guides-2-readability-18

## The finding as given

- Page: guides/start-time, guides/loading-screens, guides/performance, guides/phones
- Anchor: start-time '## The preset check' and '## Pipelines on phones'; loading-screens '## The preset check', '### Repeat visits', line 134; performance line 93; phones lines 103, 111
- Category: duplication. Severity: medium.
- Claim: Each page explains the preset check, its two timings and its stored result in its own words with its own device figures. The showcase pipeline figures appear in both start-time and loading-screens, and the Galaxy Tab A9 Plus island and creek failure appears in start-time and phones. Readers read the same passage twice and figures can drift.
- Evidence: start-time line 244 and loading-screens line 159 both describe the check in the first frames of play; start-time line 270 and loading-screens line 145 both describe the stored pipeline list; loading-screens line 134 '1.8 to 5.4 seconds on a Galaxy S25' and start-time line 256; start-time 108-110 and phones 111.
- Proposed edit: One home per topic. Preset check: loading-screens 'The preset check' (with the before-play code) and concepts/quality-presets for rules; start-time keeps two sentences and a link. Pipeline builds on phones and the stored list: start-time 'Pipelines on phones'; loading-screens 'Repeat visits' keeps two sentences and a link. phones keeps one sentence per topic with links and drops the island and creek figures at line 111.

Verdict: partly

## Evidence

What holds:
- The preset check is explained in full three times, not two: start-time 242-248, loading-screens 157-178, and concepts/quality-presets 87-139. start-time line 248 (the target starts at the display's rate, never falls under the check's own load, the 4-second first round, a quarter of the target goes straight to Low, rounds stored each time it lowers) repeats concepts/quality-presets lines 93, 94, 122 and 139 almost item by item. So start-time can drop to two sentences and a link with no loss of detail.
- The stored pipeline list is described twice: start-time 270 (keyed by engine version, GPU path, shader bits, preset, canvas format; hold mode; `?builds=fresh`) and loading-screens 145-149 (same mechanism, same hold-mode and `?builds=fresh` notes). The Galaxy Tab A9 Plus figures "23.6 s" and "8.8 to 11.2 s" appear in both (start-time table after 270; loading-screens 147).
- The pipeline figures are repeated: loading-screens 134 gives "1.8 to 5.4 seconds on a Galaxy S25, 11.8 to 16.5 seconds on an iPhone 17, up to 23.5 seconds" from the start-time table at 256.
- The figures have already drifted. loading-screens 134 says the showcase first frames build "46 to 63 pipelines on a phone". start-time 264 gives the showcase demos 53 to 55, 61 to 63 and 45 to 46, so the low end is 45, not 46. This supports the drift risk.
- The island and creek failure on the tablet is told twice, nearly word for word: start-time 108-110 (the refused custom material, the retry alone, E1307, far tree cards gone, 1.1 frames a second, creek at 71 s, out of GPU memory 4 s later, E1302) and phones 107-111 (the same retry, E1307, far tree cards, 71 s, 4 s, E1302).

What does not hold:
- "Each page explains the preset check" is wrong for two of the four pages. performance line 93 gives two sentences ("checks its choice after the first frame ... lowers the preset until one holds the target") inside its quality presets summary and links to concepts/quality-presets. performance 364 is one line with a link. phones never explains the preset check at all; phones 103 is a short summary of start costs that ends with a link to start-time. Both pages already follow the "one or two sentences and a link" pattern the edit asks for. No change is needed there, apart from phones 111 (below).
- The direction of the island and creek fix is wrong. phones has the section "When the GPU's driver refuses a shader" (105-111). It is the natural home for the driver-refusal behavior and its tablet example. start-time is about start time, and its paragraphs 108-110 restate that behavior. Dropping the figures from phones leaves that section with a rule and no example, while start-time keeps an off-topic copy.
- For the stored list, the proposal makes start-time the home. That works, but start-time 270 links to loading-screens#repeat-visits for `?builds=fresh`, so that link must change. loading-screens 145-149 also has two points that start-time lacks: without the list, builds start only when the first frame asks for them, and a changed scene builds unused pipelines and stores a new list. These must move to start-time, not be cut.

## Corrected claim

The preset check is explained in full on start-time, loading-screens and concepts/quality-presets. start-time's third paragraph repeats the concepts page's rules. The stored pipeline list and its tablet figures appear on both start-time and loading-screens. The pipeline build figures are repeated on loading-screens and have already drifted ("46 to 63" against start-time's 45 to 63). The tablet's refused pipeline, with the island and creek figures, is told twice on start-time and phones. performance and phones already give the preset check only a sentence or two with links.

## Corrected edit

- Preset check: the home is loading-screens "The preset check" (with the before-play code) for the page side, and concepts/quality-presets for the rules. start-time "The preset check" keeps two sentences: the check runs in the first frames of play on a first visit, and on a Galaxy Tab A9 Plus a check before play held the loading screen 8 to 18 seconds. Then it links to both pages. Cut start-time line 248. Every point in it is already on concepts/quality-presets.
- Pipeline builds and the stored list: the home is start-time "Pipelines on phones". Move loading-screens 145's two points that start-time lacks into start-time 270, then cut loading-screens "Repeat visits" down to two sentences and a link to start-time#pipelines-on-phones. Change start-time 270's link for `?builds=fresh` so it does not point to the stub. On loading-screens 134, keep the point that a showcase scene builds dozens of pipelines and that this takes most of a phone's start. Drop the per-device figures and keep the link to start-time. This also removes the "46 to 63" mismatch.
- The refused pipeline: the home is phones "When the GPU's driver refuses a shader". Keep phones 107-111 as they are. On start-time, replace paragraphs 108-110 with one sentence that explains the "failed" cell in the table: "The Galaxy Tab A9 Plus's driver refused one custom material's pipeline in the creek demo ([When the GPU's driver refuses a shader](phones.md#when-the-gpus-driver-refuses-a-shader))." If the per-device detail at start-time 110 (1.1 frames a second at Low, the repeat visits of the island) is worth keeping, put it in a collapsible block on phones after line 111:

  <details>
  <summary>Technical details: the Galaxy Tab A9 Plus runs</summary>

  ...the island at 1.1 frames a second at Low without its far tree cards, the island's repeat visits, the creek's first frame at 71 seconds and its loss of GPU memory 4 seconds later...

  </details>

- performance 93 and 364, and phones 103: no change.
