# Verdicts: errors/E1101 (stale handle), shots and demo links

## Shots
None were proposed. That is right. The page is about an error message that appears as text. A picture of a 3D scene does not help the reader. The text example block on the page already shows what the reader sees.

## Demo links
None were proposed. That is right. No demo or comparison makes this error happen.

## Concepts said to have no demo

1. "Use of an object after destroy()": confirmed, no demo shows it.
   - I searched every demo and comparison for the error code, "stale" and "generation". None makes or shows the error.
   - Two comparisons show the correct pattern that the page's fix describes. They destroy objects and then remove them from their array in the same step:
     - compare/battle/ (examples/compare/battle/sketch.ts, near line 757: destroy each unit past the target count, then shorten the array).
     - compare/factory/ (examples/compare/factory/sketch.ts, near line 405: destroy the last meshes, then shorten the array).
   - Do not link them. Each sketch has hundreds of lines about other things. A reader who came for one error would not find the two relevant lines. A short code sample on the page would serve the reader better.

2. "Slots and generations of handles": confirmed, no demo shows it.
   - No demo prints or inspects handle slots or generations. This is internal engine detail.
   - The page does not use the word "generation" at all; it only shows "slot 7" in the example message. If the page explains slots, a short collapsible "Technical details" block is the right place, not a demo.
