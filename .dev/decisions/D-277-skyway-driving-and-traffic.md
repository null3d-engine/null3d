# D-277: Skyway's driven hover car, its traffic and the demos' key help

Status: decided by the owner. Built: the driven hover car with its two views, the stacked
right-hand traffic and the key help panel. Pending: the owner's look review, and the software-GPU
references of `demo-skyway`, which come from a CI run. Task: M3-C1.

Summary: In Skyway's Manual mode the user drives the hero car with W, A, S, D, R and F. V switches
the view from behind the car to its seat. The sky lanes keep to the right on 12 heights, with one
speed to a lane. They draw 6,000 to 16,000 cars, so a lane at High carries a car about every 96 m
instead of every 20 m. Every demo's keys show as key caps in a panel under its caption.

## Question

How does Skyway let the user fly the hover car, and how dense and how layered should its traffic
be? Where does a demo show its keys?

## Rule

The owner's review of Skyway set these points:

- The traffic must look like real traffic. Each lane carries fewer cars, and many lanes fly at
  different heights, rather than crowds of cars at one height.
- The user drives the car that the camera follows. The car sits in the middle of the frame, not to
  one side.
- The user can drive from behind the car and from inside it.
- W, A, S and D drive the car. C still switches between Auto and Manual, where Auto follows the car
  along the route as before. H still opens and closes the controls. Skyway's keys may therefore
  differ from the other showcases'.
- The keys are not part of the demo's description. They show beside it, in a panel of their own.

## Data

The grid plan, before: 10 streets on each axis and 8 levels from 26 m to 88 m. Each level had one
lane on each side of a street, and both headings of a street flew in the same lanes. That is 640
lanes of 2,400 m. Every car took a speed of its own, from 19 to 43 m/s, so a fast car flew through
a slow one in the same lane, and cars of the two headings met head on.

| Preset | Cars before | Gap before | Cars now | Gap now |
| --- | --- | --- | --- | --- |
| Low | 30,000 | 51 m | 6,000 | 192 m |
| Medium | 50,000 | 31 m | 9,000 | 128 m |
| High | 75,000 | 20 m | 12,000 | 96 m |
| Ultra | 100,000 | 15 m | 16,000 | 72 m |

The gap is the lane's length over its cars, with the cars spread evenly over every lane.

The listed plan, now: the same 10 streets on each axis, with 6 levels on each, from 22 m in steps
of 24 m. The streets along z fly 12 m higher than those along x, so two crossing streets never
share a height. The traffic stands on 12 heights from 22 m to 154 m. Each heading keeps to its
right of the street's center line, in two lanes 4.5 m and 9.5 m from it. That is 480 lanes. The inner lane
flies at 30 to 36 m/s and the outer at 21 to 27 m/s, and every car of a lane flies at its lane's
speed. At 30 m/s a gap of 96 m is about three seconds.

How the data was produced: the counts and the lane plan in `examples/showcase/skyway/traffic.ts`
and `layout.ts`. The gaps are 2,400 m over the cars of a lane.

## Look

The listed plan looks better. Cars of one lane hold their order and their gaps, and the two
headings never meet. The traffic fills the canyon in layers from the street to the tower tops,
instead of a band of cars over the low streets. The owner judges the final look.

## Decision

- **The lanes.** The traffic-lanes add-on takes a list of lanes, each with its heading, its line,
  its height and its speed (`plan: { from, to, lanes }`). Skyway builds the list in `skyLanes()`.
  The grid plan stays for the instances demo, which shows the count rather than a street, so its
  pictures do not move.
- **Roaming cars.** Beside the lanes, 16 to 56 cars (40 at High) fly routes of their own
  (`roamers.ts`). A roamer cruises down a street's middle line, where no lane runs. At each
  junction it flies on, or in two cases of five takes a quarter turn of 12 m radius onto the cross
  street, and at the city's edge it always turns back in. At a quarter of the junctions it picks a
  new height, from 16 m to 125 m. In about one block of eight it slides to the kerb, sets down
  1.4 m over the street, waits 3 s to 8 s and takes off again. It never stops in a block that ends
  at the edge, so it is back in the street's middle before it must turn there. The scene flies
  them on the CPU and writes their rows of one batch each frame; their surface paints the
  traffic's lights from each car's own place, which the hull's texture coordinates carry, since a
  roamer turns any way. `roamers.test.ts` flies 40 of them for two minutes and checks that they
  stay on the streets, inside the city and out of the towers, and that they turn, climb and park.
- **The counts.** 6,000 cars at Low, 9,000 at Medium, 12,000 at High and 16,000 at Ultra. The
  Traffic buttons offer Light, Busy and Rush hour, at the Low, High and Ultra counts.
- **Driving.** In Manual the cinematic camera hands the frame to a driver (`CinematicOptions.driver`)
  in place of its orbit controls. The driver's keys take the Manual camera's place in the scene's
  key table, so a clash still throws. The camera hands the driver a key check that answers only for
  the driver's keys, so the scene reads no key outside the table. The flight lives in
  `examples/showcase/skyway/drive.ts`. W gains speed up to 60 m/s, S brakes, then reverses up to
  12 m/s, and with no key the car coasts to a hover. A and D turn it, slowly while it hovers. R and
  F climb and sink. The towers are boxes: a car that flies into one slides along its face or lands
  on its roof. The street, a ceiling at 260 m and the city's edge bound it too.
- **The cockpit.** The hero car has a body of its own (`body.ts`): the lane hull's loft with a
  well cut into its roof, closed by a tinted glass canopy. Inside sit a floor, a seat, a yoke and a
  dashboard. The three screens stand on the dashboard, so from outside they show only dimly
  through the glass. The fittings take no light: the car's own lamps sit a meter from them and
  would light them far brighter than the city does. The body's texture coordinates carry each
  vertex's place in its own space, so the paint, the running lights and the cockpit's trim turn
  with the car.
- **The views.** Behind: the camera eases to 13 m behind the car and 4.4 m above it. It looks 22 m
  ahead, and keeps out of the towers as the car does. Inside: the camera sits in the driver's seat
  and turns with the car, and the speed blur keeps a quarter of its strength, so the dashboard
  stays readable. V and the View buttons switch the two, in Auto too: there the car carries the
  camera along the route. A switch flies the camera over 0.9 s along a path that rises 1.2 m over
  the canopy and comes down through it into the seat, or back out. The car never moves for a view
  change. In Auto it keeps flying its own path ahead of the route, and the seat view puts the
  camera in its seat. A car that slid back to meet the camera read as a car that turned round on
  the way out, and its speed screen counted the slide.
- **The route's opening.** The route opens on a held shot, then the same pose again, which the
  camera eases away from. Without the repeat, the end of the hold snaps the camera to the next
  shot, 90 m away, which reads as the page loading twice.
- **The console.** A touchscreen on the dashboard's face repeats the scene's controls, one tab at
  a time, with the hour as a bar (`console.ts`). The cinematic camera hands it the controls model
  each time it sends the model to the page (`CinematicOptions.onControls`). It draws again only
  when what it shows changes: the model comes several times a second while Auto runs, and a whole
  new picture each time made its tab row flicker. The open group's rows share the height under the
  tabs, so no group leaves the console half empty. The scene finds a press on it in the car's own
  space, from the driver's eye along the press's direction onto the console's plane. The engine's
  own hit tests the console where the last update put it, against the ray of the frame on screen.
  In a moving car the two differ by a frame of travel, which moved presses across the rows. A
  press that lands in a gap takes the nearest target within 36 texels.
- **Rain and the canopy.** The rain keeps out of an ellipsoid round the glass bubble, which the
  car hands the rain each frame, and out of the last 0.8 m before the lens. So none falls inside
  the cockpit, and the rain streams past just outside the glass. A press posts
  `hud-press` to the page, which sends it on to the sketch as its own panel's button would. Both
  panels then show the change.
- **The weather add-on.** The ground's water is the weather add-on's wet surface
  (`createWetSurface`), which the city's surface function copies and calls. The scene reflects from
  the screen, so the add-on binds no planar pass. The car's own mirror is added over that surface's
  shading, where the water is, because the screen-space reflections never see the car's underside.
  The hero car's bubble carries the add-on's windshield drops and wiper, and the splashes on its
  roof and the vapour from its nozzles are the add-on's particle systems.
- **The cars' bodies.** The traffic and the hero car are flying cars (`createFlyingCarHull` and
  `loftHull` in the traffic-lanes add-on): a smooth body lofted through eight rounded sections,
  with a cut-off tail where the tail lights sit and a nose that tapers to a point, a bubble
  canopy, and two hover pods along the flanks. The box-section lane hull read as blocky. At
  `full` detail a car has 258 vertices and 472 triangles; at `light`, which Low draws, 112 and
  200, with no pods. A car costs about four times the box hull's vertices, and the lanes draw a
  sixth of the cars they drew, so High's lanes draw 3.1 million vertices against 5.4 million, and
  Low's about 0.67 million against 0.72 million.
- **The cars' lights.** The tail bars glow at about a third of their brightness. The glow that
  filled each car's underside, and the hero car's lamp under its belly, gave way to a neon band
  round the body's lower edge, on the faces that look outward: the edge of the field that holds
  the car up. The hero car's engine nozzles are smaller and dimmer. The instances demo shares the
  add-on's surface, so its traffic shows the dimmer tails and the band too.
- **The other cars' windows.** The traffic-lanes add-on takes `look.windows`, a tint that draws each
  car's canopy as dark, smooth glass with a faint glow from the cabin. Skyway tints them teal. The
  instances demo sets none, so its pictures do not move.
- **The pointer while driving.** A drag swings the chase camera round the car, and the wheel or a
  pinch zooms it from 6 m to 70 m. In the seat a drag turns the driver's head. After 1.5 s with no
  press, while the car moves, the camera eases back behind the car or straight ahead. A user may
  look round a car that hovers.
- **The driving pad.** A touch screen has no keys, so the page shows a pad while the user drives,
  where a finger is the main pointer: a thumb stick at the bottom left that speeds up, brakes and
  turns, and Climb, Sink and View buttons at the bottom right (`examples/lib/drive-pad.ts`). The
  scene asks for the pad with a `drive-pad` message. The pad sends its stick and buttons as one
  `drive` message, only when they change, in steps of a twentieth. The keys add to the pad.
- **Auto.** The car flies 26 m ahead of the route's camera and 5.2 m below it, in the middle of the
  frame. A switch back to Auto glides the camera onto the nearest point of the route at 40 m/s,
  and never faster than the shared glide of 1.5 s. The car eases after the camera, so it flies
  back onto the route rather than jumps (`CinematicOptions.glideSpeed`).
- **The key help.** `controls` in `examples/demos.ts` lists each key or pointer action with what it
  does. The demos page draws the list as key caps in a glass panel under the caption.

Options rejected:

- Keeping 30,000 to 100,000 cars over more levels and lanes. A lane must carry a car only every
  60 m or more to read as traffic, and 100,000 cars would need about 1,700 lanes. The canyons would
  stand full of cars from wall to wall, the crowd that the owner asked to remove.
- A speed for each car in the listed lanes. The cars of a lane would fly through each other, as
  they did in the grid.
- Driving with the arrow keys too. W, A, S and D are what the owner named, and the arrows stay free.
- Keeping the key text in the caption. The owner asked for a panel of its own, under the caption.
- Turning the orbit controls on while the user drives. They turn the camera round a fixed point,
  and the car moves away from it. The scene's own drag follows the car.

## Consequences

- `examples/lib/cinematic.ts` gains the driver option, and `keyTable` takes a driver's keys.
- D-171's rule that shortcuts stay basic holds for Skyway too: C and H are unchanged, and V is a
  camera key. W, A, S and D drive in Skyway and pan the Manual camera in the other showcases.
- The website imports `examples/demos.ts`. Its pages must draw `controls` as a list.
- `demo-skyway`'s Mac references show the car in the middle and the new traffic. Its software-GPU
  references come from CI's drawing.
