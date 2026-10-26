# D-170: Every showcase scene gives a tailored cinematic route and a manual fly camera

Status: decided by the owner, and built. Not built yet: the scene readback that would let the
overlap check cover Creek and the feature demos. Task: M2-EX8.

Summary: Every showcase scene carries an Auto and a Manual camera, by the owner's rule. Auto is the default and plays a spline route made for that scene alone: it opens on a brief wide view, flies through the scene's interesting parts, never passes through an object and never stops. Manual turns, zooms and pans around the point the route was looking at, inside a ring of mountains that hides the scene's edge; the shared player is `examples/lib/cinematic.ts`, and each scene gives its own shots.

## Question

What camera does a showcase scene give a visitor who touches nothing, and what does it give a visitor who takes over? May every scene reuse one shared route, or must each make its own?

## Rule

The camera must show the scene at its best with no input, because a showcase exists to be looked at. It must also let a visitor explore with no jump and with no stall. One route cannot suit two scenes: they differ in size, layout and the sight worth showing. So each scene makes its own route, and the shared code only plays it.

## Decision

The owner set the rule after reviewing the small night town in Chrome.

1. Every showcase scene has the Auto and Manual toggle. The `c` key and a row of the on-screen help switch between them, and the help's camera row is a button, so a touch screen with no keyboard can switch too. Auto is the default, so a first visitor sees the tour with no input.
2. Auto plays a route tailored to that scene. It opens on a brief hold of a wide establishing view that shows the whole scene, then moves through the scene's interesting parts as a smooth flythrough. It never passes through a building or other geometry, unless a shot intends to reveal what is inside. It never stands still: consecutive shots differ and the loop closes without a pause.
3. Manual hands the camera to the user at the pose the route left. It turns, zooms and pans around the point that the route was looking at, through the engine's orbit controls (`createOrbitControls` in `@null3d/controls`, the Orbit preset). It stays inside the scene's ring of mountains. The scene's help and the controls HUD name the controls.
4. The shared player, `examples/lib/cinematic.ts`, is generic: it plays whatever route a scene gives it, keeps the pose when the user takes over, and glides back onto the nearest point of the route when the user returns to Auto. Each scene defines its own route.

## Data

The night town and Creek are the two showcase scenes of M2-EX8. Their routes differ in every part that matters.

| | Creek | Night town |
| --- | --- | --- |
| Scene | A stream in a valley, 160 m across, low and open | A town square about 40 m across, with houses, a tower and lanes |
| Opening view | High over the valley, both banks and the stream in frame | High and back, the whole town, the square and the clock tower in frame |
| Flythrough | Low along the water past the cave, then up over the trees | Down the east lane to the clock tower, across the square past the well and the lamps, up the north lane |
| Held pose | The near bank, as the scene's first references show it | A low pose in the south lane, looking north over the square |

How the data was produced: the routes in `examples/showcase/creek/sketch.ts` and `examples/showcase/night-town/sketch.ts`, with held frames along each route (`bunx @null3d/cli shot`).

## The Manual camera

Manual turns, zooms and pans around the point that the route was looking at.

- Desktop: a left drag turns the camera, the wheel zooms, a right drag pans, and `W`, `A`, `S` and `D` pan the camera: `W` and `S` see forward and back, `A` and `D` move across, and `R` and `F` rise and fall.
- Touch: one finger turns, a pinch zooms, and a two-finger drag pans.

`examples/lib/cinematic.ts` keeps the camera where the route left it and sets the controls' target to the route's current look-at point, so a turn, a zoom and a pan act around what the shot was showing. The orbit controls answer the fingers themselves. The sketch's frame step calls `pan` for the keys, so the frame path allocates nothing. The player reads the manual speed in pixels a second, and the scenes take its default of 420 pixels a second. A speed in meters, such as 8, moves the camera only a few pixels a frame.

The Manual camera has no clearance guard. A turn, a zoom and a pan may pass through a building, which is what the owner wants when they fly the scene themselves.

## A takeover halts the route at once

Taking the camera stops the route's motion at once: the manual camera takes the route's pose that moment and holds it, with no drift, and the controls take their target from the shot's look-at point. The camera is still the moment the mode switches. The pose is the route's own, never a snap to a shot. A takeover during the glide back onto the route keeps the camera exactly where it is, whichever phase the glide has reached, never the route's own pose of that moment.

With damping on, the orbit controls keep the turn, tilt, pan and zoom that remain and decay them in `update`. Auto does not call `update`, so the remainder of the last fling would stay stored and resume at the next takeover. `OrbitControls.stop()` drops the remainder, and `cinematic.ts` calls it at every switch, so the camera is still from the first frame of the mode change.

`examples/lib/takeover.test.ts` checks that the camera holds within a millimeter of the route's pose from the first frame after the switch and does not move over the second that follows. It also checks that a fling does not resume, and that a mid-glide takeover never jumps.

## The Auto route never passes through an object

The Auto route never passes through an object, unless a shot intends to reveal what is inside it. The Manual camera moves freely and may pass through anything.

- The guard: each frame, it raycasts the camera's last pose to the route's new pose against the scene's own geometry (the engine's raycast, D-30). It looks a whole move plus a margin (0.5 m) ahead, so a short step is guarded like any other. A route's frame moves far less than the margin, so a guard that skipped short moves would let the Auto camera walk into a building a little at a time. A blocked segment stops the camera the margin short of the surface, so it slides along it. A surface that is already within the margin holds the point where it is instead of letting it draw closer. A shot may set `through: true` to pass on purpose. A move that leaves a surface is never stopped.
- What fills the air, such as falling snow, mist and fairy lights, is put on `EFFECT_LAYER` alone by `markEffect`, so the guard never treats a snowflake as a wall. An object whose inside a visitor may see is put on `INTERIOR_LAYER` alone by `markInterior`, and Creek's cave mouth is marked so. The showcase camera's layers include both.
- `examples/lib/clearance.ts` holds the guard and gives it to every showcase scene. It makes its ray and its one hit result once, so the frame path allocates nothing.
- Tests: `examples/showcase/*/route.test.ts` sample each route and fail when a sample comes within the margin of a house, a tree, the tower or the cave. `examples/lib/clearance.test.ts` checks the guard's rules and the short step, and that the manual camera dollies out, keeps the distance, and turns without shrinking it.

## The route is a spline

`routePosition` in `examples/lib/cinematic.ts` flies a centripetal Catmull-Rom spline through the shots' positions and the points they look at. So the camera never stops between shots. Each shot's own seconds warp onto its stretch of the spline's parameter, so a shot lasts what it says and the camera keeps its speed as it passes that shot. A shot marked `hold` stays on its own knot, so the pose of a held frame is the shot's own pose, which the image tests' references depend on. The mid-points between shots are the spline's own, so a route's shots are a rough guide rather than the path itself.

The spline bends away from the straight lines between the shots, so a route tuned to clear geometry must be checked along the whole curve, not only at its shots. The two route tests sample 2,000 points of the loop for that reason. In the night town, a shot at (-13, 13, -11) lifts the bend clear of a house at about (-8.0, 6.8, -10.9). The clearance guard still clamps each frame, so a bulge that a scene's own test does not know about cannot pass through a building unnoticed: the camera slides along the surface instead.

A glide back onto the route follows the route while it eases onto it, so the route's own speed is what the camera has when the glide ends, rather than the route setting off again from a standstill.

## The opening hold

A showcase scene must not stand still for long when its page loads, by the owner's rule. Each route therefore opens on a brief hold of the establishing view, about half a second to a second, and then moves off it. A route whose first two shots repeat one pose reads as a pause, so the second shot must set the camera moving. Night town's opening hold is 0.8 s, and the demo's `hold` time is 0.5 s, which lands the image test's held frame on that hold. The held frame changes with the hold time, so a change to the hold remakes the scene's references.

## The Manual camera stays inside the scene's mountains

Every showcase scene sits inside a ring of mountains, by the owner's rule. The Manual camera can never zoom out past them, and can never turn to below the ground, so the plain background below the horizon never shows past the land's edge. Creek has the same ring and the same bounds as the night town. A dolly out works up to the scene's bounds.

- The geometry: a camera that stays inside the ring, below its lowest crest and above the ground never sees the background. Every view ray that falls hits the land or a mountain. Every one that rises hits a mountain or the sky. `examples/lib/mountains.ts` builds the ring from each scene's settings in its `land.ts`. Every bearing's crest stands at least as high as the scene's lowest crest.
- The bounds: a scene passes `bounds` to `createCinematic`. They hold the farthest distance from the point the camera turns around, which is the orbit controls' own `maxDistance`. They also hold a disc and a band of heights for that point, and the ground's height. The camera's highest reach is that point's highest plus the distance. Each lowest crest stands at least 10 m above it: 95 m against 74 m in the night town, and 65 m against 51 m in Creek. Each distance is above the Auto route's farthest pose: 62 m in the night town and 34 m in Creek. So a takeover never moves the camera. The orbit's lowest angle stays a little past level, 1.85 rad from straight up, so the night town's look up at its tower is in reach. The ground stops anything lower.
- No ratchet: the ground check lifts the camera along its orbit: same distance, same bearing, a higher angle. Pushing against the ground therefore never draws the camera in. A pan that would carry the point past the disc's edge moves the camera back with it, so the view does not turn.
- Tests:
  - `examples/lib/mountains.test.ts` checks the crests against the camera's reach and height, and that the ring passes under the land's edge, so the two never overlap.
  - `examples/lib/bounds.test.ts` drives the bounded camera through a dolly, a push against the ground and a pan. It checks that the distance holds through 400 frames of pushing.
  - `examples/lib/showcase-routes.test.ts` checks every one of 2,000 poses of each route against its bounds.

Creek adds three things to the ring:

- The stream runs on through the mountains. It continues into the distance both ways, through a gap in the range, and fog lies beyond. The ring takes a gorge along each end of the stream: the valley's own floor, with walls that climb to the mountains either side. The land and the water run on to 720 m. The engine's fog never covers the background, so ten thin haze sheets across each gorge fade the far end into the air's color and hide the end of the world.
- The camera may go under the water. The bounds take a `clearance` above the ground. Creek's is 0.15 m, and its ground under the water is the stream's bed, so the camera dips under the surface but never through the bed.
- The petals draw solid. The ambient occlusion pass handles masked surfaces, so the grass behind them does not show as dark blocks ([D-135](D-135-contact-shadows.md)).

## The shadow range follows the scene's core

Each scene gives `createShowcaseEffects` the sphere of its core. The sun's shadow range follows the camera on a ladder of 1.25 times per step, so the core never leaves it ([Examples](../examples.md#showcase-scenes) gives the rule). A fixed range does not suit a camera that zooms: with shadows that reach 70 m and fade over their last 7 m, a quick zoom carries the whole night town across that fade in about a fifth of a second, and its shadows appear all at once.

## A demo's geometry must not overlap

A demo's and a showcase scene's own geometry must not overlap, by the owner's rule: two pieces that cross or lie coplanar over one another z-fight and shimmer. `examples/lib/overlap.ts` holds `findOverlaps`, which tests every pair of triangles of the parts it is given, counting a crossing or a coplanar area overlap as a fault and a shared edge or vertex as none. A deliberate intersection, such as a chimney sunk through a roof, is named in the check's `ignore` list, so the check stays meaningful. The check stops at a deliberate intersection, so a piece built from boxes that overlap on purpose, such as the night town's clock tower, is left out of it.

The owner asked for the check to cover every demo and showcase scene. What it covers:

- `examples/showcase/night-town/overlap.test.ts` checks every house's walls, roof and chimney, with the chimney sunk through its roof as the one deliberate intersection. The `examples/showcase` folder is in the `bun run test` list, so this test and the two scenes' route tests run in CI.
- The other showcase scene, Creek, and the feature demos build their pieces through the engine (`scene.createMesh`, `scene.createInstances`, `assets.loadGltf`), which keeps no triangle arrays that a unit test can read. The check needs a scene readback: the engine would have to expose the world-space triangles of its objects and instance rows. That readback is not built, so those scenes are not covered. An overlap in a demo is caught by eye or in a review, not by a test.

## Options rejected

- A fly model for Manual, with a one-finger look-and-walk and a two-finger twist on a touch screen. The owner chose the orbit controls, which act around what the shot was showing.
- A clearance clamp on the Manual camera. It shortens the orbit distance each frame, ratchets the camera inward, and can pin it.
- An ease of the route's last motion to a halt over about 0.22 s at a takeover. The owner wants no transition at all.
- A smoothstep between shots. Its speed is zero at both ends, so the camera stops at every shot boundary, ten times a loop, and turns a corner where two straight segments meet.
- Wide Manual limits that let a user dolly well out and swing below the horizon. The town then shrinks to a patch of land in a plain brown field.

## Consequences

- `examples/lib/cinematic.ts` holds the route player, the Auto and Manual mode, and the manual camera. It takes the shots, the lens's focus point, a manual speed and any extra help rows from each scene.
- A new showcase scene gives its own shots. The Town, Lights, Swarm and City scenes inherit this rule under M2-EX8.
- The help lists the camera mode and, in Manual, the movement keys. A row with an action is a button, which sends the action to the sketch.
- [Examples](../examples.md) states the rule in its showcase section.
