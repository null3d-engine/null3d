# D-170: Every showcase scene gives a tailored cinematic route and a manual fly camera

Status: decided. Date: 14 October 2026. Task: M2-EX8.

Summary: The owner ruled on 14 October 2026 that every showcase scene carries an Auto and a Manual camera. Auto is the default and plays a route made for that scene alone: it opens on a wide establishing view, flies through the scene's interesting parts, never clips through geometry and never stands still. Manual hands the camera to the user, who flies with W, A, S and D and the mouse, or, on a touch screen, drags to look and move. The shared player is `examples/lib/cinematic.ts`; each scene gives its own shots.

## Question

What camera does a showcase scene give a visitor who touches nothing, and what does it give a visitor who takes over? May every scene reuse one shared route, or must each make its own?

## Rule

The camera must show the scene at its best with no input, because a showcase exists to be looked at. It must also let a visitor explore with no jump and with no stall. One route cannot suit two scenes: they differ in size, layout and the sight worth showing. So each scene makes its own route, and the shared code only plays it.

## Decision

The owner set the rule on 14 October 2026, after reviewing the small night town in Chrome.

1. Every showcase scene has the Auto and Manual toggle. The `c` key and a row of the on-screen help switch between them, and the help's camera row is a button, so a touch screen with no keyboard can switch too. Auto is the default, so a first visitor sees the tour with no input.
2. Auto plays a route tailored to that scene. It opens on a wide establishing view that shows the whole scene, then moves through the scene's interesting parts as a smooth flythrough. It never passes through a building or other geometry, and it never stands still: consecutive shots differ and the loop closes without a pause.
3. Manual hands the camera to the user at the pose the route left. On a desktop the user flies with W, A, S and D and R and F, and looks with the mouse or a drag. On a touch screen a drag looks and walks, and the help names it.
4. The shared player, `examples/lib/cinematic.ts`, is generic: it plays whatever route a scene gives it, keeps the pose when the user takes over, and glides back onto the nearest point of the route when the user returns to Auto. Each scene defines its own route.

## Data

The night town and Creek are the two showcase scenes of M2-EX8. Their routes differ in every part that matters.

| | Creek | Night town |
| --- | --- | --- |
| Scene | A stream in a valley, 160 m across, low and open | A town square about 40 m across, with houses, a tower and lanes |
| Opening view | High over the valley, both banks and the stream in frame | High and back, the whole town, the square and the clock tower in frame |
| Flythrough | Low along the water past the cave, then up over the trees | Down the east lane to the clock tower, across the square past the well and the lamps, up the north lane |
| Held pose | The near bank, as the scene's first references show it | A low pose in the south lane, looking north over the square |

How the data was produced: the routes in `examples/showcase/creek/sketch.ts` and `examples/showcase/night-town/sketch.ts`, with held frames along each route (`bunx @null3d/cli shot`), on 14 October 2026.

## Consequences

- `examples/lib/cinematic.ts` holds the route player, the Auto and Manual mode, and the manual camera. It takes the shots, the lens's focus point, a manual speed and any extra help rows from each scene.
- A new showcase scene gives its own shots. The Town, Lights, Swarm and City scenes inherit this rule under M2-EX8.
- The help lists the camera mode and, in Manual, the movement keys. A row with an action is a button, which sends the action to the sketch.
- [Examples](../examples.md) states the rule in its showcase section.

## Addendum: the Manual camera turns, zooms and pans (owner, 14 October 2026)

The owner replaced the Manual camera's fly model on 14 October 2026. Manual now turns, zooms and pans
around the point that the route was looking at, through the engine's orbit controls
(`createOrbitControls` in `@null3d/controls`, the Orbit preset). The scene's help and the controls HUD
name it.

- **Desktop:** a left drag turns the camera, the wheel zooms, a right drag pans, and `W`, `A`, `S` and
  `D` pan the camera: `W` and `S` see forward and back, `A` and `D` move across, and `R` and `F` rise
  and fall.
- **Touch:** one finger turns, a pinch zooms, and a two-finger drag pans.

This replaces the earlier one-finger look-and-walk and the two-finger twist. `examples/lib/cinematic.ts`
keeps the camera where the route left it and sets the controls' target to the route's current look-at
point, so a turn, a zoom and a pan act around what the shot was showing. `examples/lib/touch-gestures.ts`
is gone: the orbit controls answer the fingers themselves. The sketch's frame step calls `pan` for the
keys, so the frame path still allocates nothing.

## Addendum: the Auto route never passes through an object (owner, 14 October 2026)

The owner set a rule for every showcase scene on 14 October 2026, and settled it the same day: the
**Auto** route never passes through an object, unless a shot intends to reveal what is inside it.
The **Manual** camera moves freely and may pass through anything, which is what the owner wants when
they fly the scene themselves.

- The Auto route: each frame, the guard raycasts the camera's last pose to the route's new pose
  against the scene's own geometry (the engine's raycast, D-30). A blocked segment stops the camera
  a margin (0.5 m) short of the surface, so it slides along it. A shot may set `through: true` to
  pass on purpose. A move that leaves a surface is never stopped.
- Manual: no guard. A turn, a zoom and a pan may pass through a building, and a dolly out always
  works. An earlier draft clamped the manual camera too; that clamp shortened the orbit distance
  each frame and ratcheted the camera inward, and it could pin the camera, so the owner removed it.
- What fills the air, such as falling snow, mist and fairy lights, is put on `EFFECT_LAYER` alone
  by `markEffect`, so the guard never treats a snowflake as a wall. An object whose inside a visitor
  may see is put on `INTERIOR_LAYER` alone by `markInterior`, and Creek's cave mouth is marked so.
  The showcase camera's layers include both.
- `examples/lib/clearance.ts` holds the guard and gives it to every showcase scene. It makes its ray
  and its one hit result once, so the frame path allocates nothing.
- Tests: `examples/showcase/*/route.test.ts` sample each route and fail when a sample comes within
  the margin of a house, a tree, the tower or the cave. `examples/lib/clearance.test.ts` checks the
  guard's rules and that the manual camera dollies out, keeps the distance, and turns without
  shrinking it. `examples/lib/takeover.test.ts` checks that a takeover never jumps.

## Addendum: a takeover halts the route at once (owner, 14 October 2026)

The owner replaced the takeover's ease-to-halt the same day. Taking the camera now stops the route's
motion at once: the manual camera takes the route's pose that moment and holds it, with no drift, and
the controls take their target from the shot's look-at point. The earlier design eased the route's
last motion to a halt over about 0.22 s. The owner wanted no transition at all, so the camera is
still the moment the mode switches. The pose is still the route's own, never a snap to a shot.
`examples/lib/takeover.test.ts` checks that the camera holds within a millimetre of the route's pose
from the first frame after the switch and does not move over the second that follows.

## Addendum: the camera starts moving soon after the page loads (owner, 14 October 2026)

The owner ruled that a showcase scene must not stand still for long when its page loads: the camera
starts moving quickly. Each route therefore opens on a **brief** hold of the establishing view, about
half a second to a second, and then moves off it. A route whose first two shots repeat one pose reads
as a pause, so the second shot must set the camera moving. Night town's opening hold is 0.8 s, and
the demo's `hold` time is 0.5 s, which lands the image test's held frame on that hold. The held frame
changes with the hold time, so the scene's references are remade in the same change.

## Addendum: a demo's geometry must not overlap (owner, 14 October 2026)

The owner ruled that a demo's and a showcase scene's own geometry must not overlap: two pieces that
cross or lie coplanar over one another z-fight and shimmer. `examples/lib/overlap.ts` holds
`findOverlaps`, which tests every pair of triangles of the parts it is given, counting a crossing or
a coplanar area overlap as a fault and a shared edge or vertex as none. A deliberate intersection,
such as a chimney sunk through a roof, is named in the check's `ignore` list, so the check stays
meaningful. The check stops at a deliberate intersection, so a piece built from boxes that overlap on
purpose, such as the night town's clock tower, is left out of it.

The owner asked for the check to cover every demo and showcase scene. What runs today:

- `examples/showcase/night-town/overlap.test.ts` checks every house's walls, roof and chimney, with
  the chimney sunk through its roof as the one deliberate intersection. The `examples/showcase`
  folder is now in the `bun run test` list, so this test and the two scenes' route tests run in CI;
  before, the folder was not listed.
- The other showcase scene, Creek, and the feature demos build their pieces through the engine
  (`scene.createMesh`, `scene.createInstances`, `assets.loadGltf`), which keeps no triangle arrays
  that a unit test can read. The check needs a scene readback: the engine would have to expose the
  world-space triangles of its objects and instance rows. That readback is not built, so those scenes
  are not covered yet. Until it is, an overlap in a demo is caught by eye or in a review, not by a
  test.

## Addendum: the guards of the switches and the route (15 October 2026)

A code review on 15 October 2026 found four faults in this camera, and each fix keeps a rule above.
They are recorded here, since the camera's behaviour is what the rules describe.

- **The clearance guard skipped a short move.** `examples/lib/clearance.ts` cast a ray only when the
  move was longer than its margin. A route's frame moves far less than the margin, so the guard never
  tested it and the Auto camera could walk into a building a little at a time. The guard now looks a
  whole move plus a margin ahead, so a short step is guarded like any other, and a surface that is
  already within the margin holds the point where it is instead of letting it draw closer.
- **The camera resumed a fling after a switch.** With damping on, the controls keep the turn, tilt,
  pan and zoom that remain and decay them in `update`. Auto does not call `update`, so the remainder
  of the last fling stayed stored and resumed at the next takeover. `OrbitControls.stop()` drops the
  remainder, and `cinematic.ts` calls it at every switch, so the camera is still from the first frame
  of the mode change, as the addendum above requires.
- **A takeover during the glide jumped.** Taking the camera back while the route glided onto it
  applied the route's own pose that moment, not the mid-glide pose the camera held. The takeover now
  keeps the camera exactly where it is, whichever phase the glide had reached.
- **The manual keys barely moved.** Both scenes passed the old fly speed in metres (`speed: 8` and
  `speed: 7`) to a player that reads pixels a second, so the keys moved the camera a few pixels a
  frame. The scenes take the player's default (420 pixels a second) instead.

`examples/lib/takeover.test.ts` holds a case for each: a fling that must not resume, a mid-glide
takeover, and `examples/lib/clearance.test.ts` holds the short step.

## Addendum: the route is a spline, and the camera never stops between shots (15 October 2026)

A code review on 15 October 2026 found that the route stopped at every shot. Each shot eased into the
next with a smoothstep, whose speed is zero at both ends, so the camera came to a full stop at every
shot boundary, ten times a loop, and turned a corner where the two straight segments met. The rule
above says the route never stands still.

`routePosition` in `examples/lib/cinematic.ts` now flies a centripetal Catmull-Rom spline through the
shots' positions and the points they look at. Each shot's own seconds warp onto its stretch of the
spline's parameter, so a shot still lasts what it says and the camera keeps its speed as it passes
that shot. A shot marked `hold` stays on its own knot, so the pose of a held frame is the pose it
always was, which the image tests' references depend on. The mid-points between shots are the
spline's own, so a route's shots are now a rough guide rather than the path itself.

The spline bends away from the straight lines between the shots, so a route tuned to clear geometry
must be checked along the whole curve, not only at its shots. The two route tests sample 2,000 points
of the loop for that reason. The night town's route cut a house at about (-8.0, 6.8, -10.9) once the
spline was in, and a shot at (-13, 13, -11) lifts the bend clear. The clearance guard still clamps
each frame, so a bulge that a scene's own test does not know about cannot pass through a building
unnoticed: the camera slides along the surface instead.

A glide back onto the route follows the route while it eases onto it, so the route's own speed is
what the camera has when the glide ends, rather than the route setting off again from a standstill.

## Addendum: the Manual camera stays inside the scene's mountains (owner, 20 October 2026)

The owner zoomed the night town's Manual camera far out on 20 October 2026. The town shrank to a
patch of land in a plain brown field: the background below the horizon showed past the land's edge.
The owner ruled that every showcase scene sits inside a ring of mountains. The Manual camera can
never zoom out past them, and can never turn to below the ground, so the plain background never
shows. Creek gets the same ring and the same bounds.

This replaces two rules above. "A dolly out always works" now holds only up to the scene's bounds.
"The limits are wide, so a user can dolly well out and swing below the horizon" is gone.

- **The geometry.** A camera that stays inside the ring, below its lowest crest and above the ground
  never sees the background. Every view ray that falls hits the land or a mountain. Every one that
  rises hits a mountain or the sky. `examples/lib/mountains.ts` builds the ring from each scene's
  settings in its `land.ts`. Every bearing's crest stands at least as high as the scene's lowest crest.
- **The bounds.** A scene passes `bounds` to `createCinematic`. They hold the farthest distance from
  the point the camera turns around, which is the orbit controls' own `maxDistance`. They also hold a
  disc and a band of heights for that point, and the ground's height. The camera's highest reach is
  that point's highest plus the distance. Each lowest crest stands at least 10 m above it: 95 m
  against 74 m in the night town, and 65 m against 51 m in Creek. Each distance is above the Auto
  route's farthest pose: 62 m in the night town and 34 m in Creek. So a takeover never moves the
  camera. The orbit's lowest angle stays a little past level, 1.85 rad from straight up, so the
  night town's look up at its tower is still in reach. The ground stops anything lower.
- **No ratchet.** The clamp that the owner removed on 14 October shortened the orbit distance each
  frame and walked the camera inward. The new ground check lifts the camera along its orbit instead:
  same distance, same bearing, a higher angle. Pushing against the ground therefore never draws the
  camera in. A pan that would carry the point past the disc's edge moves the camera back with it, so
  the view does not turn.
- **Tests.**
  - `examples/lib/mountains.test.ts` checks the crests against the camera's reach and height, and that
    the ring passes under the land's edge, so the two never overlap.
  - `examples/lib/bounds.test.ts` drives the bounded camera through a dolly, a push against the ground
    and a pan. It checks that the distance holds through 400 frames of pushing.
  - `examples/lib/showcase-routes.test.ts` checks every one of 2,000 poses of each route against its
    bounds.

Later the same day the owner asked for three more changes in Creek:

- **The stream runs on through the mountains.** The stream continues into the distance both ways,
  through a gap in the range, and fog lies beyond. The ring takes a gorge along each end of the
  stream: the valley's own floor, with walls that climb to the mountains either side. The land and
  the water run on to 720 m. The engine's fog never covers the background, so ten thin haze sheets
  across each gorge fade the far end into the air's color and hide the end of the world.
- **The camera may go under the water.** The bounds take a `clearance` above the ground. Creek's is
  0.15 m, and its ground under the water is the stream's bed, so the camera dips under the surface
  but never through the bed.
- **The petals must be solid.** They looked see-through: the grass behind them showed as dark
  blocks. That is the masked-surface fault of the ambient occlusion pass, fixed in the engine
  ([D-135](D-135-contact-shadows.md)).

The same recording showed the night town's shadows appearing all at once as the camera zoomed in.
The sun's shadows reached a fixed 70 m and faded over their last 7 m. A quick zoom carried the whole
town across that fade in about a fifth of a second. Each scene now gives `createShowcaseEffects` the
sphere of its core. The range follows the camera on a ladder of 1.25 times per step, so the core
never leaves it ([Examples](../examples.md#showcase-scenes) gives the rule).
