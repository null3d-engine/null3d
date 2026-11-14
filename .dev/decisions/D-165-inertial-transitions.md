# D-165: Inertial transitions as the fade that switches a layer's clip

Status: decided. Built: the opt-in inertial transition and its transition pool. Not built yet: the
flip of the default fade, which waits for prototype A4 and the owner's pick by eye. Task: M2-C10.

Summary: An inertial transition ("dead blending") switches what a layer plays by sampling only the
new clip. The pose that the layer leaves keeps moving at its own velocity, and it eases into the
new clip over the fade. It costs 20 floats per joint for as long as a transition runs, nothing when none
runs, and it allocates nothing. It is opt-in as `play(name, { transition: 'inertial' })`;
`crossFade` stays the weighted blend that three.js's `crossFadeTo` maps to. The default for a new
scene's `play` with a fade flips to inertial when prototype A4 passes and the owner picks it by eye.

## Question

How should `play` switch what a layer plays with a fade? The animator cross-fades: it samples the outgoing clips and the incoming clip for the whole fade and blends them by weight, as three.js's `AnimationMixer` does (D-28). A cross-fade of a walk into a run therefore passes through a pose that is half of each gait, which slides the feet. It also samples two clips at once, which doubles a character's sample work while it fades.

## Rule

- `play(name, { fade, transition: 'inertial' })` exists and switches the layer with an inertial transition; without `transition`, or with `'blend'`, it cross-fades.
- An inertial transition never mixes two clips: only the new clip is sampled while the fade runs.
- It costs nothing in a frame when no transition runs, and a transition that starts allocates nothing.
- `crossFade(name, duration)` keeps the cross-fade whatever its options name, because a port of three.js's `crossFadeTo` expects the blend three.js shows.
- The engines' poses match when a scene uses no inertial transition: the inertial path touches no other path.

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
them once more `step * speed` seconds earlier, blends each into the layer's pose, and stores the two
poses. Their difference over the step is the outgoing velocity. A clip that ended steps back by
nothing. The outgoing clips then leave their slots at once, so the frame step samples only the new
clip. Each step, the outgoing pose moves at its velocity. The layer's pose eases from it toward the
new pose by `smoothstep(t / fade)`.

The pose that a capture takes is the pose that the frame showed. A second switch during a fade
therefore starts from the screen. A capture of the bare clip pose would jump by most of the first
switch's difference.

### What a running transition follows

- A blend belongs to the instance that started it. `add_instance` and `remove_instance` end the
  instance's blends, so a unit that dies mid-fade never passes its blend to whatever takes its id.
- The timer runs on the size of the step. A negative time scale therefore still ends the fade.
- The outgoing velocity follows the clip's own speed. A bare step back gives the wrong velocity for
  a clip at speed 2, a clip that plays backward or a play-once clip held at its end, and the limbs
  overshoot.
- A skeleton with more lanes than any before remakes the pool's records, and every blend ends with
  them. The remake zeroes the pose a blend decays from, so a blend that ran on would sink toward a
  pose of nothing.

### The transition pool

The pool is made on the first inertial play, as the joint-override table is. It holds transition
records, each a pose of the largest skeleton with its velocity. `transition_of` holds one record
index per instance layer, and [`NO_TRANSITION`] says that no blend runs there. A pool of eight
records is made with the index, and it doubles as blends need more. A crowd therefore pays for the
transitions that run at once, not for its size. A record frees when its blend ends, when its
instance is removed, or when a wider skeleton remakes the records. The first inertial play of a
crowd of 1,024 instance slots with a rig of 100 lanes allocates about 74 KB. A scene that never asks
for an inertial transition keeps no pool, and the frame step skips the work with one read.

A doubling is the one allocation a play may make. It is rare: the pool reaches any number of
concurrent transitions in a few doublings, and it then holds them. The frame step itself allocates
nothing. The no-allocation test warms up until a crowd's transitions have reached their steady
number. It counts only after that, so the pool's growth is not mistaken for a frame cost.

### A layer above the first

A layer above the first takes its shares from the channels its own clips animate, and the outgoing
clips leave their slots at the switch. Each record therefore keeps the outgoing clips' channel
weights. The layer gives those lanes `layer_weight * (1 - alpha)` until the fade ends, where `alpha`
is the fade's own ease. The pose the blend decays from shows at the switch, and the pose below takes
over by the end. That is what a cross-fade on the layer does. Without the kept weights, a joint that
only the outgoing clips animated would drop to the pose below at the switch instead of fading.

### Why opt-in, and the default

The owner decided (technique analysis, decision 18) that inertial transitions become the default
fade for switching what a layer plays, after prototype A4. A4 compares inertial against cross-fade
on S5's walk-to-run switches on the owner's iPad. It records frames for the owner's pick. Until that
pick, the default stays `'blend'`, so no existing scene changes how it looks. The flip is one line
in `Animator.playOptions`.

## Options rejected

- **Velocity from a per-instance history of the last two poses.** It would need a pose copy per
  instance per frame even for a scene that never transitions. Sampling the outgoing clips twice at
  the switch costs nothing per frame and gives the same velocity.
- **Pose buffers laid out for every instance slot.** At 1,024 instance slots and a rig of 100 lanes
  they take about 33 MB, whether or not a slot ever transitions. Battle's grown table (16,384 to
  32,768 slots) reaches 357 to 714 MB, and each growth copies all of it, so a phone refuses the play
  with E1109.
- **Making `crossFade` inertial.** The port rule maps `crossFadeTo` to the native blend, because a
  long three.js cross-fade between two looping clips is meant to show the mix. An inertial fade
  there would look different from the port's source.
- **Decaying the offset with a spring half-life instead of `smoothstep` over the fade.** Holden's
  scalar reference and the fade's own length agree, so the transition ends exactly with the fade.

## Consequences

- `docs/api/animation.md` documents the `transition` option and `crossFade`'s fixed blend.
- The mapping records that `crossFadeTo` maps to the blend, never to inertial.
- S5 keeps its clip-weight blend; no benchmark scene changes.
- Prototype A4's frames and the owner's pick decide the default. This record states the result when
  the iPad run is done.
