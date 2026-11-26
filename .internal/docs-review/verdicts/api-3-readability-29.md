# Verdict: api-3-readability-29

## The finding as given

- page: api/ui
- anchor: line 81; ## Which frame the labels follow (line 115)
- category: long-paragraph
- severity: low
- claim: Line 81 (102 words, 7 sentences) gives five separate container and element rules as prose, so they are easy to miss. 'Which frame the labels follow' explains threads and layout batching, but most readers only need its result.
- evidence: stats.json longParagraphs for api/ui (stats line 74, file line 81).
- proposedEdit: Turn line 81 into a checklist: container covers the canvas exactly; container has pointer-events: none; do not set the element's transform; offset content inside the element to anchor another point; screen labels stack in page order. In the frame section keep one sentence ('Each element sits over its object in the frame on screen, in every thread mode.') and put lines 117-121 in <details><summary>Technical details: how labels stay in step with the frame</summary>.
- generatedSource: (none; docs/api/ui.md is hand-written)

Verdict: partly

## Evidence

What holds:
- stats.json gives api/ui one long paragraph: stats line 74, which is file line 81 of docs/api/ui.md (102 words, 7 sentences). It is the only long paragraph on the page.
- Line 81 mixes two engine facts (it centers the element through its CSS transform; it sets position absolute at the top left of the container) with four things the reader must do or know. A list makes those easier to find. This part of the finding holds.
- The frame section (lines 115-121) is mostly about how the engine works inside: threads, keeping the places of the frame on screen, writing only on a change of half a CSS pixel, reading before writing to avoid layout. A reader who only places labels needs the result. A block is a fair place for this detail, and the user asked for such blocks.

What does not hold:
- The proposed checklist drops the two engine facts at the start of line 81. They are the reason for the rules: the reader must not set the transform because the engine writes it, and the container must cover the canvas because the engine positions the element at its top left. Without them the checklist gives rules with no cause.
- "Screen labels stack in page order" is not a thing the reader does. It is a behavior. It belongs after the list as a plain sentence, not as a checklist item.
- The frame section is not a long paragraph in stats.json. Lines 117, 119 and 121 are all under the limit. That part is a matter of placement, not length, so it is low priority.
- The proposed kept sentence uses "in every thread mode" without context once the thread sentences move into the block. The main text must make sense with every block closed. A newcomer does not know what a thread mode is.
- The proposal moves "While no element is bound, the labels cost the page nothing" (line 121) into the block. That is a result a user cares about (cost), not an inner detail. It should stay in the main text.
- The edit is otherwise safe: the block has no heading and no nested block, and nothing else on the page or in guides/ui-overlays.md repeats the frame detail. guides/ui-overlays.md line 97 says only that the engine writes the transform and visibility without a new layout.

## Corrected claim

Line 81 packs two engine facts and four reader rules into one paragraph, so the rules are easy to miss. The frame section is not over the length limit, but most of it explains engine internals that most readers do not need. Only its result and the cost note matter to them.

## Corrected edit

Replace line 81 with:

> The engine places the element's center over the label through its CSS `transform`, and sets its `position` to `absolute` at the top left of its container. So:
>
> - Put the elements in a container that covers the canvas exactly, as the example above does.
> - Give the container `pointer-events: none`, so the canvas still gets the pointer.
> - Do not set the element's `transform`: the engine owns it.
> - To anchor another point of the element on the label, offset the content inside the element with CSS.
>
> The elements of labels flat on the screen stack in the order of the page, whatever their distance to the camera.

Replace lines 117-121 with:

> Each element sits over its object in the frame that is on screen, not the frame the sketch computes next. So labels do not run ahead of the image during a fast camera move. While no element is bound, the labels cost the page nothing.
>
> <details>
> <summary>Technical details: how labels stay in step with the frame</summary>
>
> (lines 117, 119 and 121 as they are now, minus the last sentence of line 121)
>
> </details>
