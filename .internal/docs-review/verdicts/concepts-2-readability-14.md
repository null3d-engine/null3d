# Verdict: concepts-2-readability-14

## The finding as given

- Page: concepts/particle-buffer
- Anchor: line 58 'frame[1] says how many records...', lines 130, 190, emitter example 152-162
- Category: term-before-definition
- Severity: medium
- Claim: Line 58 uses frame[1] before the page says what buffer.frame is. Slot 0 comes 70 lines later and slots 2-3 come under Limits. The table at line 33 gives no slot numbers. The emitter example then names a different five-number array 'frame', with other meanings.
- Evidence: Line 33 'The time, the record count, the time shift and the wind texture's number'. Line 155 'const frame = new Float64Array(5);'. Line 190 'The value in frame[2] ... frame[3]'.
- Proposed edit: Under 'What the buffer holds', add a table 'The frame's values': slot, meaning (0 time, 1 record count, 2 first record on old base, 3 seconds to take off, 4 wind texture), and who writes it. Move the frame[1] paragraph after the first example. In the emitter example, rename the array emitArgs and list its five slots in a small table under the code.

Verdict: partly

## Evidence

- The claim holds. In docs/concepts/particle-buffer.md, line 58 is the first use of `frame` on the page. The property name `buffer.frame` first shows at line 95, inside the example. Line 126 then calls it "a view into that memory". Slot 0 is first explained at line 130. Slots 2 and 3 are explained only in Limits, at line 190. The table row at line 33 lists four meanings for five numbers, with no slot numbers. Readers cannot tell that "the time shift" takes two slots.
- The slot meanings in the proposed table match the code. In packages/engine/src/scene/particles.ts, the `frame` getter's comment (lines 739-745) gives time, record count, then a record and a number of seconds. The wind texture slot is index 4 (line 464), and the frame holds five floats (packages/engine/src/generated/core.ts:186).
- The emitter example clash is real. Line 155 declares `const frame = new Float64Array(5)`. Its slots mean start, end, rate, emitting and prewarm (`emitFrame`, particles.ts:906-919). That is a different array with other meanings, and it uses the same name as `buffer.frame`.
- The "who writes it" column the edit proposes also fixes a small error. Line 33 says "The sketch writes them, or the core's emitter does". But the wind texture slot is written by `setWind` (particles.ts:1078 and 1100), not by the sketch.

## What does not hold

- Moving the frame[1] paragraph after the first example is not needed. Once the new table defines the slots, the term is defined before line 58. The paragraph is about which rows draw, so it belongs in "Layout in practice". A move would also leave that section's code line (`born % buffer.capacity`) without its context about the count.
- A table under the emitter code would repeat the code comment at lines 152-154, which already lists the five numbers. The real fix is the rename. Name the array after the method's parameter (`numbers`), for example `emitNumbers`. Keep the comment, or turn the comment into the table, but do not do both.
- The time-base detail for slots 2 and 3 (line 190) is dense implementer detail. It fits a collapsible block better than the main table.

## Corrected claim

Line 58 uses `frame[1]` before the page names `buffer.frame` or numbers its slots. Slot 0 is first explained at line 130, and slots 2 and 3 only at line 190. The table row at line 33 gives four meanings for five slots and says the sketch or the emitter writes them all, but `setWind` writes the wind slot. The emitter example at line 155 reuses the name `frame` for a different five-number array.

## Corrected edit

1. Under "What the buffer holds", after the table, add a short table "The frame's values" with three columns: slot, meaning, who writes it.
   - 0: the buffer's time in seconds. The sketch, or the core's emitter.
   - 1: how many records from the first the draw reads. The sketch, or the core's emitter.
   - 2: the first record that still counts from the old time base. The core's emitter, when it moves the time base.
   - 3: the seconds to take off the birth times of those records. The core's emitter, when it moves the time base.
   - 4: the wind texture's number. `setWind`.

   Name the property there: "`buffer.frame` is a view of these five numbers."
2. Fix the line 33 row to match: "The sketch or the core's emitter writes the time and count; `setWind` writes the wind texture's number."
3. Leave the line 58 paragraph where it is.
4. In the emitter example, rename `frame` to `emitNumbers` in the declaration, the five assignments and the `emitFrame` call. Keep the comment that lists the five numbers.
5. Optionally, move the time-base sentences of line 190 into a block under the new table. Leave a one-line limit in Limits that links to it:

   <details>
   <summary>Technical details: how the time base moves</summary>

   Birth times are 32-bit floats ... An emitter does this after 1,024 seconds.

   </details>
