# D-165: Inertial transitions as the fade that switches a layer's clip

Status: decided, 2026-10-13. Date: 2026-10-13. Task: M2-C10.

Summary: An inertial transition ("dead blending") switches what a layer plays by sampling only the
new clip. The pose that the layer leaves keeps moving at its own velocity, and it eases into the
new clip over the fade. It costs 20 floats per joint for as long as a transition runs, nothing when none
runs, and it allocates nothing. It is opt-in as `play(name, { transition: 'inertial' })`;
`crossFade` stays the weighted blend that three.js's `crossFadeTo` maps to. The default for a new
scene's `play` with a fade flips to inertial when prototype A4 passes and the owner picks it by eye.

## Question

How should `play` switch what a layer plays with a fade? The animator cross-fades: it samples the outgoing clips and the incoming clip for the whole fade and blends them by weight, as three.js's `AnimationMixer` does (D-28). A cross-fade of a walk into a run therefore passes through a pose that is half of each gait, which slides the feet. It also samples two clips at once, which doubles a character's sample work while it fades.

## Rule

- `play(name, { fade, transition: 'inertial' })` exists and switches the layer with an inertial transition; without `transition`, or with `'blend'`, it cross-fades as before.
- An inertial transition never mixes two clips: only the new clip is sampled while the fade runs.
- It costs nothing in a frame when no transition runs, and a transition that starts allocates nothing.
- `crossFade(name, duration)` keeps the cross-fade whatever its options name, because a port of three.js's `crossFadeTo` expects the blend three.js shows.
- The engines' poses match when a scene uses no inertial transition: the change touches no existing path.

## Data

### What the reference stores and computes

Holden's `deadblending.c` (Spring-It-On, MIT, S-21) stores the source pose and its velocity at a
switch, and resets one timer. Each step then extrapolates the source pose at its velocity, and
cross-fades to the input pose with `smoothstep(t / blendtime)`:

```c
ext_x += ext_v * dt; ext_t += dt;
float alpha = smoothstep(ext_t / blendtime);
out_x = lerp(ext_x, in_x, alpha);
```

The Motion-Matching `dead_blending` branch keeps the same idea per joint, with a velocity that
decays. It holds the position (3), velocity (3), rotation (4), angular velocity (3) and a
slerp-direction quaternion (4), 13 to 17 floats. null3D stores the outgoing pose (10 floats:
translation 3, rotation 4, scale 3) and its velocity. That is 20 floats per joint, for one layer of
one instance, while a transition runs.

### What null3D does

At the switch, `play` samples the layer's outgoing base clips at their current times. It samples
them once more `step` seconds earlier, blends each into the layer's pose, and stores the two poses.
Their difference over `step` is the outgoing velocity. The outgoing clips then leave their slots at
once, so the frame step samples only the new clip. Each step, the outgoing pose moves at its
velocity. The layer's pose eases from it toward the new pose by `smoothstep(t / fade)`.

The buffers are made on the first inertial play, as the joint-override table is. They hold
[`MAX_LAYERS`] poses of the largest skeleton and their velocities per instance, and one timer per
layer. A scene that never asks for an inertial transition keeps empty buffers, and the frame step
skips the work with one read.

### Why opt-in, and the default

The owner ruled on 4 October 2026 (technique analysis, decision 18) that inertial transitions
become the default fade for switching what a layer plays, after prototype A4. A4 compares inertial
against cross-fade on S5's walk-to-run switches on the owner's iPad. It records frames for the
owner's pick. Until that pick, the default stays `'blend'`, so no existing scene changes how it
looks. The flip is one line in `Animator.playOptions`.

## Options rejected

- **Velocity from a per-instance history of the last two poses.** It would need a pose copy per
  instance per frame even for a scene that never transitions. Sampling the outgoing clips twice at
  the switch costs nothing per frame and gives the same velocity.
- **Making `crossFade` inertial.** The port rule maps `crossFadeTo` to the native blend, because a
  long three.js cross-fade between two looping clips is meant to show the mix. An inertial fade
  there would look different from the port's source.
- **Decaying the offset with a spring half-life instead of `smoothstep` over the fade.** Holden's
  scalar reference and the fade's own length agree, so the transition ends exactly with the fade.

## Consequences

- `docs/api/animation.md` documents the `transition` option and `crossFade`'s fixed blend.
- The mapping records that `crossFadeTo` maps to the blend, never to inertial.
- S5 keeps its clip-weight blend; no benchmark scene changes.
- Prototype A4's frames and the owner's pick decide the default. The result is recorded here or in
  an addendum when the iPad run is done.
