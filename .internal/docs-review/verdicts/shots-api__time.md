# Verdicts: api/time (slice api-3)

## Shots

### hold-mode: reject
- The source is right. tests/image/references/chrome-real-gpu/webgpu/demo-hold-mode.png exists (also in compat and webgl2). It is the demo's held frame at 3 seconds, 320 x 180 pixels.
- The picture does not help this page. The paragraph under "The step" is about step lengths in hold mode: 0 in the first frame, then 1/60 second, and a shorter last step. One still frame of balls cannot show step lengths, and it cannot show that the frame is the same on every run.
- If a hold-mode picture is wanted anywhere, it fits the testing guide better, but even there one frame does not show sameness.

## Demo links

### Hold mode -> hold-mode/: keep, and also link it from "Fixed steps"
- The demo has no code value, so hold-mode/ is the right code. Its sketch moves 400 balls in onFixedUpdate, runs with ?hold=3, and says the held frame is the same on every run.
- It also sets fixedRate to 120 "as many as a fast display draws, so the balls move in every frame". This is the advice at the end of "Fixed steps" (line 113). So this demo is the best link for "Fixed steps" too.

### Fixed steps -> replay/: reject
- The code replay/ exists. But the demo does not use the engine's fixed steps. It has no onFixedUpdate. Its page part runs its own tick clock (TickClock in session.ts) outside the engine, which runs with input turned off. The sketch only draws.
- Under "Fixed steps", the link tells a reader that onFixedUpdate drives this demo. It does not.
- Replace with hold-mode/ (onFixedUpdate with fixedRate). A second choice is compare/battle/ (onFixedUpdate with fixedRate and maxFixedSteps), but its sketch is about 990 lines.

### Easing at any frame rate -> math/: keep
- The demo has no code value, so math/ is the right code.
- Its onUpdate uses both patterns that the section gives: math.damp(weight, goal, pace, dt), and vec3.lerp with the factor 1 - Math.exp(-pace * dt).
- Note: the easing runs only while the pointer leads the lamp. The rest of the motion comes from time.now. The code shows the pattern, so the link holds.

## Concepts said to have no demo

### maxFixedSteps: confirmed
- compare/battle/, compare/factory/ and compare/night-town/ pass maxFixedSteps: 8 in the defineSketch options. 8 is the default, and none of them shows the cap drop steps after a slow frame. They show only the option's syntax. No demo shows the concept.
