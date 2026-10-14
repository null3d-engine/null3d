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
