# Verdicts: guides/physics shots and demo links

## Shot "crates-pile" (scripted): REJECT

- The source does not exist and cannot be built as proposed. The workspace does not carry Rapier or cannon-es. The guide's own check (tests/lib/physics-guide.test.ts) says the sample "cannot run in this repository" and only reads the code. A test page would need a new dependency only to make one picture.
- The picture adds little. The section teaches how to wire a library into the sketch; a pile of boxes does not show the wiring.
- Replacement: a "reference" shot of the hold-mode demo, placed under "Step the world at a fixed rate", next to the hold-mode bullet.
  - Source: tests/image/references/chrome-real-gpu/webgpu/demo-hold-mode.png (also in compat/ and webgl2/). It shows 400 balls held at 3 s in a stone pen.
  - Alt: "Hundreds of glossy balls at rest in a low stone pen, the same frame on every run."
  - Caveat: the reference is only 320 x 180 pixels. For a sharper picture, use a scripted shot of the hold-mode demo with ?hold=3 in the address (a real switch: the demo's sketch and its entry, hold: 3, in examples/demos.ts).
  - The caption must not say a physics library made it; the demo moves the balls with its own short code.

## Demo link "hold-mode/" for "Fixed steps and repeatable frames": KEEP

- The code exists: demos.ts entry "hold-mode" (no code field, so "hold-mode/" is right).
- It shows the section's points: it moves 400 balls in onFixedUpdate, sets fixedRate: 120 (the guide's advice for fast screens), and uses Math.random, which hold mode seeds, so the held frame repeats.
- Caveats for the link text: the demo uses no physics library (it has its own gravity and bounce code), and it writes each ball's position inside onFixedUpdate, not in onUpdate as the guide advises. Say "a sketch that steps its own simple ball physics at a fixed rate", not "a physics demo".

## Concepts said to have no demo

- Rapier in the sketch worker: CONFIRMED. No demo or test imports Rapier; the workspace does not carry it.
- cannon-es with one object per body: CONFIRMED. No demo imports cannon-es. (hold-mode uses one mesh per ball with setPosition, but no library.)
- Collision events sent to the page: CONFIRMED for collisions. The closest is sound/: its sketch sends one message per lightning strike to the page with page.post, which is the same mechanism, but no collision is involved. A link to sound/ could go beside the sentence that names "Sound in a scene", not as a collision demo.
