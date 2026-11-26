# guides-1-substance-27

## Finding as given

- Page: guides/audio
- Anchor: A mix that works, bullets at lines 131 and 133
- Category: unclear. Severity: low.
- Claim: Line 56 says a bed has no near and far, but line 131 speaks of "a bed that carries a thousand meters". Line 133 says "points" where the page elsewhere says members and voices.
- Evidence: docs/guides/audio.md:56, 102, 131, 133.
- Proposed edit: Line 131: "A source whose far reaches a thousand meters makes an opening view over open water roar." Line 133: "three voices at full level sound about five decibels louder than one loop. Give a group's members a lower level than a loop's."

Verdict: survives

## Evidence

- docs/guides/audio.md:56 defines a bed as a sound made "with no `near` and no `far`", whose level the sketch sets each frame. A bed so defined has no reach. So "a bed that carries a thousand meters" (line 131) contradicts the page's own term. Line 71 allows a positional bed, but it still says its level "comes from the sketch", so distance reach is still a property of sources, not beds.
- docs/guides/audio.md:75 and :91 tie reach to a source's `far`. Line 91 already says "A source whose `far` reaches a kilometre is heard from the whole map, and a scene's opening view roars". The proposed line 131 text matches this term.
- docs/guides/audio.md:102 uses "members" and "voices" for groups. Line 133 is the only place that says "points". The code agrees with "members": a group's level is set per member index (packages/sound/src/sound.ts:170, `setLevel(index, level)`; implementation at sound.ts:537).
- The five-decibel figure holds: three equal sources add as power, 10 x log10(3) = 4.8 dB. The edit keeps it.
- I found no other place on the page that fixes these two words, and the edit breaks no writing rule.

## Notes on the edit

- The new line 131 sentence repeats line 91 nearly word for word. That is acceptable in a summary list, but the writer may instead cut it and keep only the "first frame is the test" sentence. Either choice fixes the contradiction.
- Line 91 spells "kilometre" while line 131 says "meters". Use one spelling on the page (for example "a kilometre" in both).
