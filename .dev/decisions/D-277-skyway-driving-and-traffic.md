# D-277: Skyway's driven hover car, its traffic and the demos' key help

Status: decided by the owner. Built: the driven hover car with its two views, the stacked
right-hand traffic and the key help panel. Pending: the owner's look review, and the software-GPU
references of `demo-skyway`, which come from a CI run. Task: M3-C1.

Summary: In Skyway's Manual mode the user drives the hero car with W, A, S, D, R and F. V switches
the view from behind the car to its seat. The sky lanes keep to the right on 12 heights, with one
speed to a lane. They draw 6,000 to 16,000 cars, so a lane at High carries a car about every 96 m
instead of every 20 m. Every demo's keys show as key caps in a panel beside its caption.

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
- **The views.** Behind: the camera eases to 13 m behind the car and 4.4 m above it. It looks 22 m
  ahead, and keeps out of the towers as the car does. Inside: the camera sits in the driver's seat and
  turns with the car. The three panels move to a dashboard in front of the seat, and the speed blur
  keeps a quarter of its strength, so the dashboard stays readable. V and the View buttons switch
  the two, in Auto too: there the car carries the camera along the route.
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
