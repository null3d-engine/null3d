# guides-2-readability-23

## The finding as given

```json
{
 "page": "guides/lens-kit",
 "anchor": "## How the parts draw (lines 63-88); ## Cost (lines 100-116)",
 "category": "technical-details-block",
 "severity": "low",
 "claim": "Each mark has a bold-led paragraph, and its neighbor reads come later under Cost, so a reader comparing marks must hold both. The M3 Max paragraph (line 111) mixes the test setup, the cost per megapixel and a WebGL2 measurement note.",
 "evidence": "stats.json lines 67, 95, 106 (file 74, 102, 111); line 103 'The fringes take 2, the streak 10 and the speed blur 6, and the grain takes none.'",
 "proposedEdit": "Add a table under 'How the parts draw': Mark | What it does | Neighbor reads | Needs (fringes 2 none; streak 10 bloom; speed blur 6 none; grain 0 none), with short paragraphs below. Under Cost keep 'a megapixel costs about a tenth of a millisecond' and move the M3 Max setup and WebGL2 note into <details><summary>Technical details: how the cost was measured</summary>.",
 "generatedSource": "",
 "id": "guides-2-readability-23",
 "slice": "guides-2",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The page is hand-written (docs/guides/lens-kit.md), so no generated source applies.
- The numbers in the proposed table are correct. In examples/addons/lens-kit/lens.wgsl, the fringes read the picture twice (lines 33-34), the streak reads bloom 10 times (a loop of 5 at line 42, two reads each), the speed blur reads 6 times (loop at line 52), and the grain reads no neighbor (lines 59-62). The total is 18, as page line 102 says. The streak needs bloom (page lines 77 and 122).
- The second half of the claim holds. Page lines 111-116 put the test machine and canvas, the whole-look cost, the per-megapixel rule, a WebGL2 measurement caveat and a README pointer in one paragraph. The WebGL2 sentences ("its cleared frame moves by more than the look there. Its marks stand instead.") are hard to follow without the README's context (examples/addons/lens-kit/README.md lines 75-98). This is the kind of dense, correct detail that belongs in a collapsible block.
- The first half does not hold. The neighbor reads are a cost fact, and the page puts them under Cost, where the next sentences use them: "up to 18 reads", "A look with only the grain therefore pays no neighbor read" (lines 102-105). A reader of "How the parts draw" does not need the read counts to understand what each mark does. The Options table (lines 52-61) already gives a one-line meaning for each mark. A new table with a "What it does" column repeats that table, and moving the counts out of Cost splits the cost argument across two sections. This part is taste with no real cost to the reader.
- One risk in the proposed edit: "a megapixel costs about a tenth of a millisecond" is a measurement on an M3 Max. If the main text keeps the rule but moves the machine into a closed block, a reader may take it as a figure for any device. The main text must keep a short device qualifier.

## Corrected claim

The Cost section's last paragraph (page lines 111-116) mixes the test setup, the result, the per-megapixel rule and a WebGL2 measurement caveat. That detail should move into a collapsible block. The neighbor-read counts already sit where the page uses them, under Cost, and the per-mark meaning is already in the Options table. A mark comparison table is not needed.

## Corrected edit

Leave "How the parts draw" and the first two Cost paragraphs as they are. Replace page lines 111-116 with:

```markdown
The cost follows the pixels. On a fast laptop GPU, the whole look costs about a tenth of a
millisecond for each megapixel that the canvas draws.

<details>
<summary>Technical details: how the cost was measured</summary>

The figure comes from a MacBook Pro with an M3 Max. The canvas is 3840 by 2160 CSS pixels with
the pixel ratio held at 2, so it draws 33 megapixels. There the whole look costs about 3 to 4 ms of
GPU time a frame, on WebGPU and in compatibility mode.

WebGL2 keeps no figure for the whole look. On that path the frame's own time changes by more than
the look costs, so the timer cannot separate the two. The figure for each mark is still measured
there. The add-on's README gives the figure at each preset and for each mark.

</details>
```

The main text makes sense with the block closed, the block has no heading and no nested block, and the edit uses no internal process words.
