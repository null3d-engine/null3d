# api-2-substance-28

## Finding as given

- page: api/post
- anchor: ### Grading controls (lines 332-336) and its last bullet (line 371)
- category: duplication
- severity: low
- claim: 'The frame that lands a bake uploads the table, 256 KB' appears twice. 'A job worker' is not explained. Lines 332-336 are hard-wrapped mid-sentence, unlike the rest of the page.
- evidence: docs/api/post.md:332-336, 371.
- proposedEdit: Rewrite 332-336 as one unwrapped paragraph: 'The grading controls set a look from a few numbers, without a table file. One of the engine's background workers bakes them into a table, so a change never stalls a frame. The new grade shows within a few frames.' Keep the 256 KB figure and the no-worker case only at 371, inside <details>.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- Duplication holds. docs/api/post.md:335-336 and docs/api/post.md:371 both say "The frame that lands a bake uploads the table, 256 KB". The "stalls no frame" point also appears at both places.
- Hard wrap holds. Lines 332-336 are the only prose lines on the page that break mid-sentence near column 100. Every other prose paragraph is one line.
- "A job worker is not explained" does not hold as stated. "Job workers" is the engine's defined name for one kind of thread. docs/concepts/architecture.md:42 (section "The kinds of thread", line 35) defines it. The same term is used without a gloss in docs/pages.md, docs/cookbook/index.md:223 and :268, docs/getting-started/cdn.md:159, docs/getting-started/hosting.md:16, docs/concepts/post-processing.md:369, and the TSDoc in packages/engine/src/scene/post.ts:481 and :860. The real gap is that docs/api/post.md has no link to the architecture page (grep finds no "architecture" on the page).
- The proposed rewrite replaces the defined term with "one of the engine's background workers". That breaks term consistency across the docs, and a reader can no longer search for it. Link the term instead.
- The no-worker case should not go into a closed block. packages/engine/src/scene/post.ts:877-904 shows that when the bake task fails, the grade never applies and only development builds warn, once. A reader who sees no grade needs that sentence with every block closed. Only the 256 KB upload size is implementer detail.
- The proposed rewrite drops "before a `lut`". That is acceptable, because docs/api/post.md:369 says the same.

## Corrected claim

The 256 KB upload sentence is duplicated at lines 335-336 and 371, and lines 332-336 are hard-wrapped, unlike the rest of the page. "Job worker" is a defined engine term (docs/concepts/architecture.md, "The kinds of thread"), but this page does not link to it.

## Corrected edit

Replace lines 332-336 with one unwrapped paragraph:

The grading controls set a look from a few numbers, without a table file. A [job worker](../concepts/architecture.md#the-kinds-of-thread) bakes them into a table of its own, so a change stalls no frame. The final pass applies that table to the display color that the tone curve leaves. The picture shows the new grade once the bake reaches the GPU, usually within a few frames.

Change line 371 to keep the visible behavior and drop the upload size:

- The bake runs in a job worker, so a value that changes in a frame loop does not stall the frames. Where no worker can run tasks, the picture keeps its colors and development builds warn once.

Optionally, after the bullet list, add one block that holds the table detail now in line 367 together with the upload size:

<details>
<summary>Technical details: the grading table</summary>

The table holds 32 texels along each side. The final pass takes the square root of the color before it reads the table, so its texels lie closer together toward black, where a grade's curve is steepest. The frame that lands a bake uploads the table, 256 KB.

</details>
