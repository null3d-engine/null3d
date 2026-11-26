# Shot and demo-link verdicts: api/sound

## Shot: sound-demo (keep, with a fixed alt text)

- Source is right. `tests/image/references/chrome-real-gpu/webgpu/demo-sound.png` exists (also under compat and webgl2). It is the default view of the `sound` demo (code `sound/`, hold 1 s).
- What the picture shows: a dark moor at night, rain streaks, a lightning bolt over the hills, a ring of standing stones and a dark brook in front.
- It helps a little. A picture cannot carry sound, but it shows the three sound sources the paragraph names: the bolt (the thunder shots), the rain (the loop in both ears) and the brook (the group of points). It belongs beside the paragraph that links the sound demo, as proposed.
- The proposed alt text leaves out the bolt, the rain and the brook, which are the things the paragraph talks about. Use: "Lightning strikes a dark moor in the rain, behind a ring of standing stones and a brook".
- Note: the reference is only 320 x 180 pixels. It reads as a small inline picture, not a wide figure.

## Demo link: "Loops, groups and shots" -> sound/ (keep, move it)

- `sound/` is the code of the `sound` demo in examples/demos.ts.
- The sketch uses all three kinds: `sound.loop` for the rain (positional: false), `sound.group` for the brook (voices: 3, near/far set, `positions.set` in one call), and two `sound.shot`s for near and far thunder, played with `play(x, y, z, level, rate)`.
- Place: the proposal puts it at "The page's calls". The page already links this demo at the end of that section. The concept "loops, groups and shots" belongs under "The sketch's calls" table, where those three calls are listed. Add the link there, or move the existing one there, so the page does not link the same demo twice for the same point.

## Concepts said to have no demo

- Panning by quality preset: confirmed. No demo is built to show it. The `sound/` demo page takes the `?preset=` switch, so on headphones a reader can compare `?preset=low` with `?preset=high`, but nothing on the page points this out.
- Gapless MP3 loops: confirmed as a concept with no demo that shows it. The `sound/` demo's rain and brook loops are MP3 files that loop, so they rely on it, but a reader cannot see or test the join from the demo.
