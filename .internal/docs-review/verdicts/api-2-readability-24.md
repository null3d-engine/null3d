# Verdict on api-2-readability-24

## The finding as given

- Page: api/particles
- Anchor: lines 21-61 (install block line 25; update rules line 61)
- Category: example-placement. Severity: low.
- Claim: The install command sits with no heading between two paragraphs, unlike impostors' '## Install'. The page has no link to the particles demo. The update() rules, the most important usage rules on the page, come after a long example.
- Evidence: line 25 'bun add @null3d/particles'; examples/demos.ts line 690 code: 'particles/'; stats.json api/particles exampleLinks: [].
- Proposed edit: Add '## Install' before line 25. Add a link to https://github.com/null3d-engine/null3d/tree/main/examples/particles/ after the first example. Make line 61 a short list: pass ctx; call update() once a frame in onLateUpdate; update(dt) steps by a given time.

Verdict: partly

## Evidence

- Install heading: refuted. Of the ten add-on pages under docs/api/ that show a `bun add` command, only impostors.md has a `## Install` heading. controls, geometry, grass, particles, sound, terrain, three-compat, water and wind all put the command in the opening text with no heading. Impostors is the odd one out. A heading on particles alone would make the pages less alike, not more. This is a matter of taste with no real cost to a reader.
- Demo link: holds. docs/api/particles.md has no link to the demo and does not name it (stats.json exampleLinks is empty). examples/demos.ts lines 687-690 define the "particles" demo (title "Particles", scene "Campfire glade") with code 'particles/'. Sibling pages controls.md, geometry.md and sound.md do link their demos. The proposed URL fits the website contract.
- update() rules: partly. The rules at page line 61 (stats line 54: 76 words, 5 sentences) come straight after the first example, and they explain that example's own `sparks.update()` call in `onLateUpdate`. The diagram at line 15 also states "system.update() in onLateUpdate" before the example. So the rules are not hidden or misplaced. A list does help scanning. But the proposed three-item list drops two correct facts: why `onLateUpdate` is the right hook (world places are the frame's, so a moving emitter starts particles where the object is now), and that `update` allocates nothing once a sub-emitter table has grown.

## Corrected claim

The page does not link to or name its "Particles" demo (examples/particles/). The update() rules sit in one 76-word paragraph that would scan better as a list. The missing `## Install` heading is not an issue: nine of ten add-on pages have none, and impostors is the exception.

## Corrected edit

- Do not add `## Install`.
- After the first example, add one sentence such as: "The demo [Particles](https://github.com/null3d-engine/null3d/tree/main/examples/particles/) builds a campfire glade with flames, embers, smoke, leaves and fireflies."
- Turn line 61 into a list that keeps every fact:
  - Pass the whole sketch context, `ctx`, as the first argument. The system reads its scene, and the frame's step from its clock.
  - Call `update()` once per frame in `onLateUpdate`. There, objects' world places are the frame's, so an emitter that follows a moving object starts its particles where the object is now.
  - `update(dt)` steps by `dt` seconds in place of the frame's step.
  - `update` allocates nothing, once the table of a system with sub-emitters has grown.
