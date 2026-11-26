# Verdicts: errors/E1218 (screenshots and demo links)

Shots: none proposed. None needed. An error page shows a message, not a picture.

## Demo links

Where to add them: this page is generated. The fix text comes from the engine's error fix list (packages/engine/src/errors/fixes.ts), and the engine also loads that text at run time into its error messages (packages/engine/src/errors/engine-error.ts). So do not put Markdown links in the fix text. Add the links in the error page code in tools/lib/docs.ts (or as a docs-only field beside the error's entry in packages/engine/src/errors/codes.ts), shown under "How to fix it".

- character/ — KEEP. The demo exists (name 'character', no code value, so 'character/' is right). Its sketch calls playBlend with clip names Idle, Walking_A and Running_A, plays a named clip on layer 1 with a fade, sets a layer mask by joint name ('spine'), and listens for the animator's own 'finished' event. This covers clip names, layers, fades and blends.
- morph-flowers/ — KEEP, with a note. The demo exists ('morph-flowers/'). Its sketch builds a geometry with one morph target named 'Open' and calls setMorphWeight(0, ...). It sets the weight by number only, never by name. Word the link as "morph targets by number", or accept that the name is shown only where the target is made.
- look-at/ — KEEP. The demo exists ('look-at/'). Its sketch names the joints 'spine', 'chest' and 'head' for a look-at, and plays the clips 'Idle' and 'Blocking' by name. The character demo also names a joint ('spine' in its layer mask), so one link to character/ could cover joints too, but look-at shows joint names more clearly.

## Concepts said to have no demo

- The clip key limit: CONFIRMED. No demo builds a clip near that size. A demo cannot usefully show a refused clip.
- Reserved clip event names 'loop' and 'finished': NOT CONFIRMED in part. No demo defines clip events of its own. But the character demo listens for the 'finished' event that the animator reports itself (animator.onEvent('finished', ...)), which is the event name the page says to keep free. The character/ link already proposed for this page can cover it.
